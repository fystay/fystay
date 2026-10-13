import { test, expect, type Page } from "@playwright/test";

// The host payouts page and its "Connect with Stripe" button. No Stripe key
// is set in tests, so this checks FYStay's own pages and redirects - never
// a live Stripe account. Every outcome lands on a FYStay page, never a
// bare JSON error.

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("Connect with Stripe lands back on the payouts page with an explanation, not raw JSON", async ({ page }) => {
  await login(page, "host@fystay.dev", "hostpass123");
  await page.goto("/host/payouts");
  await expect(page.getByText("Not connected")).toBeVisible();
  await page.getByRole("link", { name: "Connect with Stripe" }).click();
  await page.waitForURL(/\/host\/payouts\?error=stripe_not_configured/);
  await expect(page.getByText("Payouts aren't configured for this environment yet.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText('{"error"');
});

test("each Stripe failure is explained on a FYStay page with a way to try again", async ({ page }) => {
  await login(page, "host@fystay.dev", "hostpass123");
  await page.goto("/host/payouts?error=connect_unavailable");
  await expect(page.getByRole("alert").filter({ hasText: "Payout setup isn't open yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect with Stripe" })).toBeVisible();

  await page.goto("/host/payouts?error=connect_failed");
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't open Stripe" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect with Stripe" })).toBeVisible();
});

test("the onboarding links send a signed-out visitor to log in instead of an error", async ({ page }) => {
  await page.goto("/api/host/stripe/connect");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fhost%2Fpayouts/);
  await page.goto("/api/host/stripe/dashboard");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fhost%2Fpayouts/);
});
