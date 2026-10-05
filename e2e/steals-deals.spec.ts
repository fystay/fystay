import { test, expect } from "@playwright/test";

const isoInDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// The demo seed gives "Seafront apartment overlooking Blackpool promenade"
// a 20% last-minute deal for check-ins within 7 days (src/lib/demoSeed.ts).
const DEAL_LISTING = "Seafront apartment overlooking Blackpool promenade";

test("Steals Deals shows a real last-minute deal, and the quoted price includes it", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("section", { has: page.getByRole("heading", { name: "Steals Deals" }) });
  await expect(row.getByText("Last-minute deals and price drops")).toBeVisible();
  // :visible - the rail also renders a hidden sizing copy of its first card.
  await expect(row.locator("span:text-is('20% off last-minute'):visible").first()).toBeVisible();
  await expect(row.getByRole("link", { name: DEAL_LISTING }).first()).toBeVisible();

  const listings = (await (await page.request.get("/api/listings?city=Blackpool")).json()).listings as {
    id: string;
    title: string;
  }[];
  const listingId = listings.find((listing) => listing.title === DEAL_LISTING)!.id;

  // Two free nights inside the window (other tests may have booked some).
  let pricing: { lengthOfStayDiscountLabel: string; lengthOfStayDiscountPercent: number } | null = null;
  for (let start = 1; start <= 5 && !pricing; start++) {
    const quote = await (
      await page.request.get(
        `/api/listings/${listingId}/availability?checkIn=${isoInDays(start)}&checkOut=${isoInDays(start + 2)}&guests=1`,
      )
    ).json();
    if (quote.available) pricing = quote.pricing;
  }
  expect(pricing).toMatchObject({ lengthOfStayDiscountLabel: "last_minute", lengthOfStayDiscountPercent: 20 });

  // Outside the window the deal doesn't apply.
  const later = await (
    await page.request.get(`/api/listings/${listingId}/availability?checkIn=${isoInDays(60)}&checkOut=${isoInDays(62)}&guests=1`)
  ).json();
  expect(later.pricing.lengthOfStayDiscountLabel).toBeNull();
});
