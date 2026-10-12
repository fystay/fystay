import { expect, type Page } from "@playwright/test";

// The main search needs where, check-in and check-out (see
// src/lib/searchRequest.ts) - these build valid ones for tests.

/** A calendar date `days` from today, as "yyyy-MM-dd". */
export function isoInDays(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** checkIn/checkOut params for a stay starting `start` days ahead. */
export function stayParams(start = 300, nights = 2): string {
  return `checkIn=${isoInDays(start)}&checkOut=${isoInDays(start + nights)}`;
}

/** A /search URL with valid dates added to the given params. */
export function searchUrl(params: string, start = 300, nights = 2): string {
  return `/search?${params ? `${params}&` : ""}${stayParams(start, nights)}`;
}

/** Types a town into Where and picks it from the suggestions. */
export async function pickTown(page: Page, town: string, country = "England") {
  await page.locator("#search-city").fill(town);
  await page.getByRole("option", { name: `${town} ${country}`, exact: true }).click();
  await expect(page.locator("#search-city")).toHaveValue(town);
}

/** Opens the date picker and picks a stay starting `start` days ahead. */
export async function pickDates(page: Page, start = 300, nights = 2) {
  const dialog = page.getByRole("dialog", { name: "Choose check-in and check-out dates" });
  await expect(async () => {
    await page.getByRole("button", { name: /Check-in/ }).first().click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  for (const iso of [isoInDays(start), isoInDays(start + nights)]) {
    const day = dialog.locator(`[data-day="${iso}"] button`);
    for (let i = 0; i < 24 && !(await day.isVisible()); i++) {
      await dialog.getByRole("button", { name: "Go to the Next Month" }).click();
    }
    await day.click();
  }
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
}

/** The whole Fylde Coast, as a Google place's viewport - covers every seeded town. */
export const FYLDE_COAST_PLACE = {
  placeId: "ChIJ_test_fylde_coast",
  name: "Fylde Coast",
  latitude: 53.82,
  longitude: -3.03,
  bounds: { south: 53.7, west: -3.12, north: 53.95, east: -2.85 },
};

/** Picks a Google place through the real search box, with Google's two answers stubbed (no key in tests). */
export async function pickMockPlace(page: Page, place = FYLDE_COAST_PLACE) {
  await page.route("**/api/search/suggestions**", (route) =>
    route.fulfill({
      json: { query: place.name, popular: false, destinations: [], landmarks: [], hotels: [], places: [{ placeId: place.placeId, label: place.name, sublabel: "UK" }] },
    }),
  );
  await page.route("**/api/search/place**", (route) =>
    route.fulfill({ json: { place: { ...place, formattedAddress: `${place.name}, UK` } } }),
  );
  await page.locator("#search-city").fill(place.name);
  await page.getByRole("option", { name: new RegExp(place.name) }).click();
  await expect(page.locator("#search-city")).toHaveValue(place.name);
}

/** A /search URL for FYLDE_COAST_PLACE with valid dates. */
export function fyldeCoastSearchUrl(params = "", start = 300, nights = 2): string {
  const { placeId, name, latitude, longitude, bounds } = FYLDE_COAST_PLACE;
  const place = `place=${placeId}&placeLabel=${encodeURIComponent(name)}&lat=${latitude}&lng=${longitude}&bbox=${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return searchUrl(params ? `${place}&${params}` : place, start, nights);
}
