import { test, expect } from "@playwright/test";
import { isoInDays, pickDates } from "./support/search";
import { PrismaClient, type Listing } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

test.describe.configure({ mode: "serial" });

async function fixtureListing(overrides: Partial<Listing> & { title: string }) {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
  return prisma.listing.create({
    data: {
      title: overrides.title,
      description: "Temporary listing created for this test.",
      city: overrides.city ?? "Blackpool",
      country: "England",
      propertyType: overrides.propertyType ?? "APARTMENT",
      pricePerNightCents: overrides.pricePerNightCents ?? 8000,
      maxGuests: overrides.maxGuests ?? 4,
      bedrooms: overrides.bedrooms ?? 1,
      bathrooms: overrides.bathrooms ?? 1,
      amenities: overrides.amenities ?? ["Wifi"],
      photos: [],
      published: overrides.published ?? true,
      hostId: host.id,
    },
  });
}

const listbox = (page: import("@playwright/test").Page) =>
  page.getByRole("listbox", { name: "Destination and hotel suggestions" });

test("typing a destination shows a real destination suggestion and selecting it fills the field", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator("#search-city");
  await input.fill("Blackp");

  await expect(listbox(page)).toBeVisible();
  // Exact match: the real seeded "Seafront apartment ... Blackpool ..."
  // listing also matches "Blackpool" as a hotel suggestion, so a loose
  // match would hit both the destination and the hotel option.
  const option = page.getByRole("option", { name: "Blackpool England", exact: true });
  // The first suggestions request of a run can include a cold compile.
  await expect(option).toBeVisible({ timeout: 15_000 });

  await option.click();
  await expect(input).toHaveValue("Blackpool");
  await expect(listbox(page)).toBeHidden();

  // Selecting a suggestion on the homepage doesn't auto-navigate by itself
  // (only the results page live-updates as fields change), and Search waits
  // for the dates, saying so.
  const search = page.getByRole("button", { name: "Search", exact: true });
  await expect(search).toBeDisabled();
  await expect(page.getByTestId("search-bar-issues").first()).toContainText("Check-in");
  await pickDates(page);
  await search.click();
  await page.waitForURL(/\/search\?.*city=Blackpool/);
  expect(page.url()).toContain(`checkIn=${isoInDays(300)}`);
});

test("typed text that wasn't picked from the suggestions can't be searched", async ({ page }) => {
  await page.goto("/");
  await pickDates(page);
  await page.locator("#search-city").fill("Blackpoo");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await expect(page.locator("#search-city")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("search-bar-issues").first()).toContainText("Pick a place from the suggestions");
});

test("picking a Google place stores its id, name, coordinates and area in the search", async ({ page }) => {
  let suggestSession = "";
  await page.route("**/api/search/suggestions**", (route) => {
    suggestSession = new URL(route.request().url()).searchParams.get("session") ?? "";
    return route.fulfill({
      json: {
        query: "FY4",
        popular: false,
        destinations: [],
        landmarks: [],
        hotels: [],
        places: [{ placeId: "ChIJ_test_south_shore", label: "South Shore", sublabel: "Blackpool, UK" }],
      },
    });
  });
  let detailsSession = "";
  await page.route("**/api/search/place**", (route) => {
    detailsSession = new URL(route.request().url()).searchParams.get("session") ?? "";
    return route.fulfill({
      json: {
        place: {
          placeId: "ChIJ_test_south_shore",
          name: "South Shore",
          formattedAddress: "South Shore, Blackpool, UK",
          latitude: 53.7934,
          longitude: -3.0546,
          bounds: { south: 53.78, west: -3.07, north: 53.81, east: -3.03 },
        },
      },
    });
  });

  await page.goto("/");
  await page.locator("#search-city").fill("FY4");
  await page.getByRole("option", { name: /South Shore/ }).click();
  await expect(page.locator("#search-city")).toHaveValue("South Shore");
  // One Google session from typing to the picked place.
  expect(suggestSession).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(detailsSession).toBe(suggestSession);

  await pickDates(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/place=ChIJ_test_south_shore/);
  const url = new URL(page.url());
  expect(url.searchParams.get("placeLabel")).toBe("South Shore");
  expect(url.searchParams.get("lat")).toBe("53.7934");
  expect(url.searchParams.get("lng")).toBe("-3.0546");
  expect(url.searchParams.get("bbox")).toBe("53.78,-3.07,53.81,-3.03");
  await expect(page.getByRole("heading", { name: "Stays near South Shore" })).toBeVisible();
});

test("a place whose details can't be loaded isn't selected", async ({ page }) => {
  await page.route("**/api/search/suggestions**", (route) =>
    route.fulfill({
      json: { query: "FY4", popular: false, destinations: [], landmarks: [], hotels: [], places: [{ placeId: "ChIJ_test_broken", label: "Broken Place", sublabel: "UK" }] },
    }),
  );
  await page.route("**/api/search/place**", (route) => route.fulfill({ status: 502, json: { error: "We couldn't load that place." } }));

  await page.goto("/");
  await pickDates(page);
  await page.locator("#search-city").fill("FY4");
  await page.getByRole("option", { name: /Broken Place/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "couldn't load that place" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
});

test("typing part of a hotel name shows it and selecting it routes straight to that listing", async ({
  page,
}) => {
  const hotel = await fixtureListing({
    title: "E2E fixture: Grand Fylde Hotel",
    city: "Blackpool",
    propertyType: "HOTEL",
  });

  try {
    await page.goto("/");
    const input = page.locator("#search-city");
    await input.fill("Grand Fylde");

    const option = page.getByRole("option", { name: /Grand Fylde Hotel/ });
    await expect(option).toBeVisible();
    await expect(option).toContainText("Blackpool, England");

    await option.click();
    await expect(input).toHaveValue(hotel.title);
    await expect(listbox(page)).toBeHidden();

    await pickDates(page);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(new RegExp(`/listings/${hotel.id}\\?.*checkIn=${isoInDays(300)}`));
    await expect(page.getByRole("heading", { name: hotel.title })).toBeVisible();
  } finally {
    await prisma.listing.delete({ where: { id: hotel.id } });
  }
});

test("shows a clear fallback when nothing matches", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search-city").fill("Zzzznotarealplace999");

  await expect(page.getByText("No destinations, places or hotels found")).toBeVisible();
  await expect(page.getByText(/Try a city, town, region or hotel name/)).toBeVisible();
});

test("shows a loading state while the suggestions request is in flight", async ({ page }) => {
  await page.route("**/api/search/suggestions**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await page.goto("/");
  await page.locator("#search-city").fill("Blackpool");

  await expect(page.getByText("Searching destinations and hotels…")).toBeVisible();
  await expect(page.getByText("No destinations or hotels found")).toHaveCount(0);
});

test("degrades gracefully without crashing when the suggestions API errors", async ({ page }) => {
  await page.route("**/api/search/suggestions**", (route) => route.fulfill({ status: 500, body: "{}" }));

  await page.goto("/");
  await page.locator("#search-city").fill("Blackpool");

  await expect(page.getByText(/Something went wrong loading suggestions/)).toBeVisible();
  // The rest of the page (and the field itself) still works.
  await expect(page.locator("#search-city")).toBeEnabled();
});

test("keyboard navigation highlights and Enter selects without submitting an incomplete search", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator("#search-city");
  await input.fill("Blackp");
  const destinationOption = page.getByRole("option", { name: "Blackpool England", exact: true });
  await expect(destinationOption).toBeVisible();

  // Destinations are ranked and rendered before hotels, so the first
  // ArrowDown press highlights this destination option.
  await input.press("ArrowDown");
  await expect(destinationOption).toHaveAttribute("aria-selected", "true");

  await input.press("Enter");
  await expect(input).toHaveValue("Blackpool");
  await expect(listbox(page)).toBeHidden();
  // Enter chose the highlighted suggestion rather than submitting the form
  // with a raw, un-selected "Blackp" value - confirmed by then pressing
  // Search and landing on a search for the selected "Blackpool", not "Blackp".
  await pickDates(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/search\?.*city=Blackpool/);
});

test("dropdown stays within the viewport on a narrow mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.locator("#search-city").fill("Blackpool");

  const box = await listbox(page).boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 1);
  }

  const option = page.getByRole("option", { name: /Blackpool/ }).first();
  const optionBox = await option.boundingBox();
  expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(40);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
