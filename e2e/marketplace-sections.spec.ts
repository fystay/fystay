import { test, expect } from "@playwright/test";
import { fyldeCoastSearchUrl } from "./support/search";

// The results page's own filter chips (the homepage no longer has a
// filtered row - its stays are in the Spotlight carousel).
test("the long-stay filter carries to the results page as a chip that can be removed", async ({ page }) => {
  await page.goto(fyldeCoastSearchUrl("longStay=1"));
  const chip = page.getByRole("link", { name: "Remove filter: Long-stay discounts" });
  await expect(chip).toBeVisible();
  const cards = page.locator('main [data-testid="listing-card-title"]');
  const withFilter = await cards.count();
  await chip.click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("longStay") && url.searchParams.has("checkIn") && url.searchParams.has("place"));
  await expect(chip).toHaveCount(0);
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(withFilter);
});
