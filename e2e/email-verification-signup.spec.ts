import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";
import { generateResetToken } from "../src/lib/passwordReset";

// Sign-up needs a confirmed email before the account can log in. Locally no
// email provider is configured, so /verify-email shows the link instead of
// sending it - real inbox delivery is not exercised here.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PREFIX = "e2e-signup-verify-";
const PASSWORD = "signupverify123";

async function fillRegister(page: import("@playwright/test").Page, email: string) {
  await page.goto("/register");
  await page.fill("#name", "E2E Signup Verify");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("checkbox", { name: /I agree to/ }).check();
}

test("a new account must confirm its email before it can log in", async ({ page }) => {
  const email = `${PREFIX}${Date.now()}@fystay.dev`;
  await fillRegister(page, email);
  await page.getByRole("button", { name: "Create account" }).click();

  // No email provider locally, so the page says honestly that nothing was
  // sent, and shows the local-only link in its place.
  await page.waitForURL(/\/verify-email\?sent=0/);
  await expect(page.getByRole("heading", { name: "We couldn't send your confirmation email" })).toBeVisible();
  await expect(page.locator("#verify-email")).toHaveValue(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { emailVerifiedAt: true } });
  expect(user.emailVerifiedAt).toBeNull();
  const confirmHref = await page.getByRole("link", { name: "Confirm email" }).getAttribute("href");

  // Logging in before confirming is refused, with a way to get a new link.
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page.getByText("Please confirm your email first.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.goto(confirmHref!);
  await page.waitForURL(/\/login\?emailConfirmed=1|\/login\?callbackUrl=/);
  await expect(page.getByText("Your email is confirmed. Log in to continue.")).toBeVisible();
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // The link was single use.
  await page.goto(confirmHref!);
  await page.waitForURL(/\/account\?emailVerified=already_verified|\/verify-email\?status=used/);
});

test("a likely typo is questioned, never rewritten, and the person chooses", async ({ page }) => {
  const typed = `${PREFIX}${Date.now()}@fystay.couk`;
  await fillRegister(page, typed);
  await page.locator("#email").blur();
  const prompt = page.locator("#email-suggestion");
  await expect(prompt).toContainText(`Did you mean ${typed.replace(".couk", ".co.uk")}?`);
  await expect(page.locator("#email")).toHaveValue(typed);

  await prompt.getByRole("button", { name: /^Use / }).click();
  await expect(page.locator("#email")).toHaveValue(typed.replace(".couk", ".co.uk"));
  await expect(prompt).toBeHidden();
  expect(await prisma.user.count({ where: { email: typed } })).toBe(0);
});

test("expired, used and broken links each explain what happened and offer a new one", async ({ page }) => {
  const email = `${PREFIX}links-${Date.now()}@fystay.dev`;
  const user = await prisma.user.create({
    data: { name: "E2E Links", email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "GUEST", referralCode: generateReferralCode() },
  });
  const expired = generateResetToken();
  const used = generateResetToken();
  await prisma.emailVerificationToken.createMany({
    data: [
      { userId: user.id, tokenHash: expired.tokenHash, expiresAt: new Date(Date.now() - 60_000) },
      { userId: user.id, tokenHash: used.tokenHash, expiresAt: new Date(Date.now() + 3_600_000), usedAt: new Date() },
    ],
  });

  for (const [token, heading] of [
    [expired.token, "That link has expired"],
    [used.token, "That link has already been used"],
    ["not-a-real-token", "That link isn't valid"],
  ]) {
    await page.goto(`/api/auth/verify-email?token=${token}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new link" })).toBeVisible();
  }
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerifiedAt: true } });
  expect(after.emailVerifiedAt).toBeNull();
});

test("a session ends once its account is no longer confirmed", async ({ page }) => {
  const email = `${PREFIX}session-${Date.now()}@fystay.dev`;
  const user = await prisma.user.create({
    data: {
      name: "E2E Session",
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "HOST",
      emailVerifiedAt: new Date(),
      referralCode: generateReferralCode(),
    },
  });
  await page.goto("/login?callbackUrl=%2Faccount");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/account/);

  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  await page.goto("/host/dashboard");
  await page.waitForURL(/\/login/);
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});
