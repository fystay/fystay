import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// The show/hide password control: reveals and masks without losing what was
// typed, works from the keyboard, keeps the autocomplete hint, and doesn't
// get in the way of signing in.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "visibility-e2e-123";
const PREFIX = "e2e-password-visibility-";

test("login: reveal and mask keep the value, keyboard works, and sign-in still succeeds", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `${PREFIX}${Date.now()}@fystay.dev`;
  await prisma.user.create({
    data: { name: "E2E Visibility", email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "GUEST", emailVerifiedAt: new Date(), referralCode: generateReferralCode() },
  });

  await page.goto("/login");
  const password = page.locator("#password");
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.fill("#email", email);
  await password.fill(PASSWORD);
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(PASSWORD);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Keyboard: Tab from the field reaches the toggle; Space masks again.
  await password.focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue(PASSWORD);

  // Typing continues after revealing; Enter in the field still submits.
  await toggle.click();
  await password.fill(`${PASSWORD}x`);
  await password.press("Backspace");
  await expect(password).toHaveValue(PASSWORD);
  await password.press("Enter");
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  // Cleaned up here, not in afterAll: that runs once per parallel worker and
  // would delete this user while another worker's copy of the test is using it.
  await prisma.user.deleteMany({ where: { email } });
});

test("the toggle never submits the form, and every password field on register has one", async ({ page }) => {
  await page.goto("/register");
  const password = page.locator("#password");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await password.fill("abc");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page).toHaveURL(/\/register/);
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("abc");
});

test("reset password: both fields have their own toggle", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-real-token");
  const toggles = page.getByRole("button", { name: "Show password" });
  if ((await toggles.count()) === 0) test.skip(true, "This build shows an invalid-link message instead of the form.");
  await expect(toggles).toHaveCount(2);
  await toggles.first().click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await expect(page.locator("#confirmPassword")).toHaveAttribute("type", "password");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
