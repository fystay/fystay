import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// The phone verification card on /account. Twilio is never called here:
// with Twilio configured on the server, the two API calls are answered by
// page.route so the UI states (send, resend cooldown, wrong code, verified)
// can be checked; without it, the card must say so and offer no form.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "phone-e2e-123";

test("phone verification: honest when unconfigured, full code flow when configured", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `e2e-phone-${Date.now()}@fystay.dev`;
  await prisma.user.create({
    data: { name: "E2E Phone", email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "GUEST", referralCode: generateReferralCode() },
  });

  try {
    await page.goto("/login?callbackUrl=%2Faccount");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.locator("#password").press("Enter");
    await expect(page).toHaveURL(/\/account/, { timeout: 30_000 });

    const card = page.locator("#phone-verification");
    await expect(card).toBeVisible();
    if (await card.getByText("isn't switched on yet").isVisible()) {
      await expect(card.getByRole("button", { name: "Send code" })).toHaveCount(0);
      await expect(card.getByText("Not verified", { exact: true })).toBeVisible();
      return;
    }

    let checks = 0;
    await page.route("**/api/account/phone/send-code", (route) =>
      route.fulfill({ json: { sent: true, phone: "+447911123456", expiresInSeconds: 600, resendInSeconds: 30 } }),
    );
    await page.route("**/api/account/phone/verify-code", (route) => {
      checks += 1;
      return checks === 1
        ? route.fulfill({ status: 400, json: { error: "That code isn't right. Check the text message and try again.", reason: "incorrect" } })
        : route.fulfill({ json: { verified: true, phone: "+447911123456" } });
    });

    await card.getByLabel("Mobile number").fill("07911 123456");
    await card.getByRole("button", { name: "Send code" }).click();
    await expect(card.getByText("+447911123456")).toBeVisible();
    await expect(card.getByText("It expires in 10 minutes.")).toBeVisible();
    await expect(card.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();
    await expect(card.getByLabel("Verification code")).toHaveAttribute("autocomplete", "one-time-code");

    await card.getByLabel("Verification code").fill("12ab34");
    await expect(card.getByLabel("Verification code")).toHaveValue("1234");
    await card.getByRole("button", { name: "Verify" }).click();
    await expect(card.getByRole("alert")).toHaveText(/isn't right/);

    await card.getByRole("button", { name: "Change number" }).click();
    await expect(card.getByLabel("Mobile number")).toBeVisible();
    await card.getByRole("button", { name: "Send code" }).click();
    await card.getByLabel("Verification code").fill("123456");
    await card.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Phone number verified")).toBeVisible();
  } finally {
    await prisma.user.deleteMany({ where: { email } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
