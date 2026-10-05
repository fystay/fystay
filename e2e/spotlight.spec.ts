import { test, expect } from "@playwright/test";

// Without a Stripe key (CI, local development) a Spotlight purchase is
// activated straight away - the same dev-mode fallback every checkout uses -
// so the whole journey can run here: a host features a listing and it
// appears in the homepage's Spotlight row, labelled as paid placement.
test("a host features a listing and it shows in Spotlight stays, labelled Promoted", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "host@fystay.dev");
  await page.fill("#password", "hostpass123");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/host/promote");
  await expect(page.getByRole("heading", { name: "Spotlight", exact: true })).toBeVisible();

  const listing = page.locator("main ul > li").first();
  const title = (await listing.locator("p.font-semibold").first().textContent())!.trim();
  // A listing that's already featured (from an earlier run) offers "Add"
  // instead of "Feature for" - either buys another 7 days.
  await listing.getByRole("button", { name: /(Feature for|Add) 7 days/ }).click();
  await expect(page.getByText(`${title} is in Spotlight`)).toBeVisible();
  await expect(listing.getByText(/Live until/)).toBeVisible();

  await page.goto("/");
  const spotlight = page.locator("section", { has: page.getByRole("heading", { name: "Spotlight stays" }) });
  await expect(spotlight.getByText("who pay for these spots")).toBeVisible();
  await expect(spotlight.getByRole("link", { name: title }).first()).toBeVisible();
  // :visible - the rail also renders a hidden sizing copy of its first card.
  await expect(spotlight.locator("span:text-is('Promoted'):visible").first()).toBeVisible();
});
