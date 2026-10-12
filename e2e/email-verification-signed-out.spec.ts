import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";
import { generateResetToken } from "../src/lib/passwordReset";

// Opening the "Confirm your email" link while signed out (often on a phone)
// confirms the address, and the login page and account page both say so.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "verifysignedout123";

test("a signed-out guest who opens the confirm link is told it worked, through login", async ({ page }) => {
  const email = `e2e-verify-signed-out-${Date.now()}@fystay.dev`;
  const user = await prisma.user.create({
    data: {
      name: "E2E Verify",
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "GUEST",
      referralCode: generateReferralCode(),
    },
  });
  const { token, tokenHash } = generateResetToken();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });

  await page.goto(`/api/auth/verify-email?token=${token}`);
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await expect(page.getByText("Your email is confirmed. Log in to continue.")).toBeVisible();

  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/account\?emailVerified=verified/);
  await expect(page.getByText("Email confirmed.")).toBeVisible();

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerifiedAt: true } });
  expect(after.emailVerifiedAt).not.toBeNull();
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-verify-signed-out-" } } });
  await prisma.$disconnect();
});
