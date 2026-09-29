import { test, expect } from "@playwright/test";
import { PrismaClient, type Listing } from "@prisma/client";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

// Each test creates its own fixture listings and deletes them before the
// next one runs, so results stay predictable regardless of what other
// listings exist in the shared dev database.
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
      latitude: overrides.latitude,
      longitude: overrides.longitude,
      hostId: host.id,
    },
  });
}

test("Blackpool + under £150 + parking genuinely narrows results to matching listings only", async ({
  page,
}) => {
  const expensiveWithParking = await fixtureListing({
    title: "E2E fixture: pricey Blackpool flat with parking",
    city: "Blackpool",
    pricePerNightCents: 20000,
    amenities: ["Wifi", "Free parking"],
  });
  const cheapNoParking = await fixtureListing({
    title: "E2E fixture: cheap Blackpool flat without parking",
    city: "Blackpool",
    pricePerNightCents: 6000,
    amenities: ["Wifi"],
  });
  const cheapWrongCity = await fixtureListing({
    title: "E2E fixture: cheap Lytham flat with parking",
    city: "Lytham",
    pricePerNightCents: 6000,
    amenities: ["Wifi", "Free parking"],
  });

  try {
    await page.goto("/search?city=Blackpool&adults=2&maxPrice=150&amenities=parking");

    await expect(page.getByRole("heading", { name: "Search results" })).toBeVisible();
    // The real seeded Blackpool listing (£75/night, parking) genuinely matches.
    await expect(
      page.getByText("Seafront apartment overlooking Blackpool promenade"),
    ).toBeVisible();

    // Excluded for price, amenity, and city respectively - each on its own
    // would otherwise have matched, proving every filter is actually applied.
    await expect(page.getByText(expensiveWithParking.title)).toHaveCount(0);
    await expect(page.getByText(cheapNoParking.title)).toHaveCount(0);
    await expect(page.getByText(cheapWrongCity.title)).toHaveCount(0);

    // Two filters are active (price range + amenities), reflected on the trigger.
    await expect(page.getByRole("button", { name: /Filters/ })).toContainText("2");
  } finally {
    await prisma.listing.deleteMany({
      where: { id: { in: [expensiveWithParking.id, cheapNoParking.id, cheapWrongCity.id] } },
    });
  }
});

test("property type filter, applied through the filter sheet, narrows real results", async ({
  page,
}) => {
  const hotel = await fixtureListing({
    title: "E2E fixture: Blackpool hotel room",
    city: "Blackpool",
    propertyType: "HOTEL",
    pricePerNightCents: 9000,
  });

  try {
    await page.goto("/search?city=Blackpool");
    await expect(page.getByText(hotel.title)).toBeVisible();
    await expect(
      page.getByText("Seafront apartment overlooking Blackpool promenade"),
    ).toBeVisible();

    await page.getByRole("button", { name: /Filters/ }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.getByRole("button", { name: "Hotel", exact: true }).click();
    await page.getByRole("button", { name: "Show results" }).click();

    await page.waitForURL(/propertyType=HOTEL/);
    await expect(page.getByText(hotel.title)).toBeVisible();
    await expect(
      page.getByText("Seafront apartment overlooking Blackpool promenade"),
    ).toHaveCount(0);
  } finally {
    await prisma.listing.delete({ where: { id: hotel.id } });
  }
});

test("minimum rating filter excludes listings with no qualifying reviews", async ({ page }) => {
  await page.goto("/search?minRating=4");

  // Only the seeded listing with a genuine 5-star review qualifies.
  await expect(
    page.getByText("Seafront apartment overlooking Blackpool promenade"),
  ).toBeVisible();
  await expect(page.getByText("Elegant Victorian townhouse in Lytham")).toHaveCount(0);
  await expect(page.getByText("Cosy cottage near Fleetwood Marina")).toHaveCount(0);
});

test("sorting by price low to high genuinely reorders results", async ({ page }) => {
  // Asserts the relative order of the three known seeded listings rather
  // than the exact full result set: this page shows every published
  // listing with no city/other filter, so under fullyParallel test runs
  // against the shared dev database it can transiently include another
  // spec's own temporary fixture listing too. That's not what this test is
  // checking - it only cares that price sorting genuinely reorders results.
  async function assertPriceOrder(url: string, expectedOrder: string[]) {
    await page.goto(url);
    const titles = page.locator('main [data-testid="listing-card-title"]');
    await expect(titles.first()).toBeVisible();
    const allTitles = await titles.allTextContents();
    const indices = expectedOrder.map((title) => allTitles.indexOf(title));
    expect(indices, `expected every listing in ${JSON.stringify(expectedOrder)} to be present, got ${JSON.stringify(allTitles)}`).not.toContain(-1);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  }

  await assertPriceOrder("/search?sort=price_asc", [
    "Cosy cottage near Fleetwood Marina",
    "Seafront apartment overlooking Blackpool promenade",
    "Elegant Victorian townhouse in Lytham",
  ]);

  await assertPriceOrder("/search?sort=price_desc", [
    "Elegant Victorian townhouse in Lytham",
    "Seafront apartment overlooking Blackpool promenade",
    "Cosy cottage near Fleetwood Marina",
  ]);
});

test("list/map view toggle switches the results presentation without losing filters", async ({
  page,
}) => {
  // A city only this test uses, so the search matches exactly this one
  // geocoded fixture however many real listings the seed has in any town.
  const city = `E2E Map City ${Date.now()}`;
  const listing = await fixtureListing({
    title: `E2E fixture: map pin in ${city}`,
    city,
    latitude: 53.8175,
    longitude: -3.0357,
  });

  try {
    await page.goto(`/search?city=${encodeURIComponent(city)}`);
    await expect(page.getByRole("button", { name: "Map" })).toBeVisible();

    await page.getByRole("button", { name: "Map" }).click();
    await page.waitForURL(/view=map/);
    // A real interactive map now renders here (see ListingsMap /
    // src/lib/geocoding.ts) rather than the old "coming soon" placeholder -
    // .leaflet-container is Leaflet's own root element, and this listing's
    // pin is a real marker for it, not a city-count list.
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

    await page.getByRole("button", { name: "List" }).click();
    await page.waitForURL((url) => !url.search.includes("view=map"));
    await expect(page.getByText(listing.title)).toBeVisible();
    // The city filter survived the round trip: still in the URL, and a real
    // Blackpool listing is still filtered out.
    expect(new URL(page.url()).searchParams.get("city")).toBe(city);
    await expect(
      page.getByText("Seafront apartment overlooking Blackpool promenade"),
    ).toHaveCount(0);
  } finally {
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
