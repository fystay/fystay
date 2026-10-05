import { test, expect } from "@playwright/test";

// The demo seed makes EV Exec's return airport transfer a live offering, so
// the homepage's More from FYStay row leads with it as a partner service
// (PartnerServiceCard, src/lib/partnerServices.ts).

function moreFromFyStay(page: import("@playwright/test").Page) {
  return page.getByRole("region", { name: "More from FYStay" }).and(page.locator('[aria-roledescription="carousel"]'));
}

test("More from FYStay leads with EV Exec as a FYStay service partner, booked through the transfer flow", async ({
  page,
}) => {
  await page.goto("/");
  const row = moreFromFyStay(page);
  await row.scrollIntoViewIfNeeded();
  // :visible - the rail also renders a hidden sizing copy of its first card.
  const card = row.locator("a:visible", { hasText: "Book with EV Exec" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("EV Exec", { exact: true })).toBeVisible();
  await expect(card.getByText("Premium electric airport transfers")).toBeVisible();
  await expect(card.getByText("FYStay service partner")).toBeVisible();
  // The offer reads in full on the card: the live offering's price and what it buys.
  await expect(card.getByText("£45")).toBeVisible();
  await expect(card.getByText("return airport transfer")).toBeVisible();
  // It's EV Exec's service, presented through FYStay - never FYStay's own.
  await expect(row.getByText(/FYStay (airport transfers|taxi)/i)).toHaveCount(0);

  await card.click();
  await expect(page).toHaveURL(/\/travel-extras\?category=AIRPORT_TRANSFER/);
  await expect(page.getByText("EV Exec").first()).toBeVisible();
});

test("the Hosting card in More from FYStay still opens the host guide", async ({ page }) => {
  await page.goto("/");
  const row = moreFromFyStay(page);
  await row.scrollIntoViewIfNeeded();
  await row.locator("a:visible", { hasText: "Hosting" }).first().click();
  await expect(page).toHaveURL(/\/host-guide$/);
});
