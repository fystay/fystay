import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// Changing the account's email and deleting the account both ask for the
// current password, so a session left signed in on someone else's device
// can't take the account over or erase it.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "accountsecurity123";

async function createUser(label: string) {
  const email = `e2e-account-security-${label}-${Date.now()}@fystay.dev`;
  const user = await prisma.user.create({
    data: {
      name: "E2E Account Security",
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "GUEST",
      referralCode: generateReferralCode(),
    },
  });
  return { id: user.id, email };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("changing email needs the current password", async ({ page }) => {
  const user = await createUser("email");
  try {
    await login(page, user.email);
    await page.goto("/account");

    const newEmail = `e2e-account-security-new-${Date.now()}@fystay.dev`;
    await page.getByLabel("New email address").fill(newEmail);
    const send = page.getByRole("button", { name: "Send link" });
    await expect(send).toBeDisabled();

    await page.getByLabel("Current password").fill("not-my-password");
    await send.click();
    await expect(page.getByText("That password isn't right.")).toBeVisible();
    expect(await prisma.emailChangeToken.count({ where: { userId: user.id } })).toBe(0);

    await page.getByLabel("Current password").fill(PASSWORD);
    await send.click();
    await expect(page.getByText("We’ve sent a confirmation link to")).toBeVisible();
    expect(await prisma.emailChangeToken.count({ where: { userId: user.id } })).toBe(1);
  } finally {
    await prisma.emailChangeToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("deleting the account needs the password", async ({ page }) => {
  const user = await createUser("delete");
  try {
    await login(page, user.email);
    await page.goto("/account");

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Delete my account" });

    await confirm.click();
    await expect(dialog.getByText("Enter your password to delete your account.")).toBeVisible();

    await dialog.getByLabel("Your password").fill("not-my-password");
    await confirm.click();
    await expect(dialog.getByText("That password isn't right.")).toBeVisible();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).toBeNull();

    await dialog.getByLabel("Your password").fill(PASSWORD);
    await confirm.click();
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt).not.toBeNull();
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
});
