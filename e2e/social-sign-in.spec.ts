import { test, expect } from "@playwright/test";

// The Google/Apple buttons only appear once their credentials are set, which
// CI doesn't have. What a person sees when a provider sign-in comes back
// refused or cancelled doesn't depend on them, so that's checked here.

test("a cancelled Apple sign-in says so, by name", async ({ page }) => {
  await page.goto("/login?error=OAuthCallbackError&provider=apple");
  await expect(page.getByText("Apple sign-in was cancelled. Please try again.")).toBeVisible();
});

test("an existing password account explains how to connect Google instead of making a duplicate", async ({ page }) => {
  await page.goto("/login?error=AccountExists&provider=google");
  await expect(
    page.getByText(
      "You already have a FYStay account with this email. Log in with your email and password below, then you can connect Google from your account page.",
    ),
  ).toBeVisible();
  // The email form is right there to do exactly that.
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("an unexpected provider error never shows the raw code", async ({ page }) => {
  await page.goto("/register?error=Configuration");
  await expect(page.getByText("We couldn't sign you in. Please try again.")).toBeVisible();
  await expect(page.getByText("Configuration")).toHaveCount(0);
});
