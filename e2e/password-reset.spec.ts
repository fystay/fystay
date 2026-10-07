import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

test("guest can reset a forgotten password and log in with the new one", async ({ page }) => {
  const email = `e2e-password-reset-${Date.now()}@fystay.dev`;
  const originalPasswordHash = await bcrypt.hash("originalpass123", 10);

  const user = await prisma.user.create({
    data: {
      name: "E2E Password Reset",
      email,
      passwordHash: originalPasswordHash,
      role: "GUEST",
      referralCode: generateReferralCode(),
    },
  });

  try {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL(/\/forgot-password/);

    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();

    // No Stripe-style keys are configured in this environment either, so the
    // API returns the reset link directly instead of emailing it (dev mode) -
    // this exercises the same code path production email delivery would.
    const resetLink = page.getByRole("link").filter({ hasText: "/reset-password?token=" });
    await expect(resetLink).toBeVisible();
    const resetUrl = await resetLink.getAttribute("href");

    await page.goto(resetUrl!);
    await page.getByLabel("New password", { exact: true }).fill("brandnewpass456");
    await page.getByLabel("Confirm new password").fill("brandnewpass456");
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.waitForURL(/\/login/);

    // The old password no longer works.
    await page.fill("#email", email);
    await page.fill("#password", "originalpass123");
    await page.click("button[type=submit]");
    await expect(page.getByText("don't match an account")).toBeVisible();

    // The new password does.
    await page.fill("#email", email);
    await page.fill("#password", "brandnewpass456");
    await page.click("button[type=submit]");
    // Wherever login lands (a host goes to their dashboard, a guest home).
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    // The same reset link can't be reused.
    await page.goto(resetUrl!);
    await page.getByLabel("New password", { exact: true }).fill("yetanotherpass789");
    await page.getByLabel("Confirm new password").fill("yetanotherpass789");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/invalid or has expired/)).toBeVisible();
  } finally {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});

test("requesting a reset for an unknown email doesn't reveal whether the account exists", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("definitely-not-a-real-user@fystay.dev");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText(/we've sent a link to reset your password/)).toBeVisible();
  await expect(page.getByText(/dev mode/i)).toHaveCount(0);
});
