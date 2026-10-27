import { test, expect } from "@playwright/test";

// The demo seed makes EV Exec's return airport transfer a live offering, so
// the homepage's Services section leads with it as a partner service
// (PartnerServiceCard, src/lib/partnerServices.ts).

function services(page: import("@playwright/test").Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Services", exact: true }) });
}

test("Services leads with EV Exec as a FYStay service partner, booked through the transfer flow", async ({ page }) => {
  await page.goto("/");
  const row = services(page);
  await row.scrollIntoViewIfNeeded();
  const card = row.locator("a", { hasText: "Book with EV Exec" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("EV Exec", { exact: true })).toBeVisible();
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

test("the other services each open a working page", async ({ page }) => {
  for (const [name, url] of [
    ["Local Guides", /\/destinations$/],
    ["Help & support", /\/help$/],
  ] as const) {
    await page.goto("/");
    await services(page).scrollIntoViewIfNeeded();
    await services(page).getByRole("link", { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(url);
  }
});
