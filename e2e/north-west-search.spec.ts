import { test, expect } from "@playwright/test";
import { PrismaClient, type Listing } from "@prisma/client";
import { pickDates, searchUrl } from "./support/search";

// Search beyond the Fylde Coast: a Google place anywhere in the UK finds
// the real stays with map locations in it, and the Map view shows the same
// stays as the list. Google itself is stood in for (no key in tests) - what's
// checked is FYStay's own search, results and map.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();

async function fixtureListing(overrides: Partial<Listing> & { title: string; city: string }) {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
  return prisma.listing.create({
    data: {
      title: overrides.title,
      description: "Temporary listing created for this test.",
      city: overrides.city,
      country: "England",
      propertyType: "APARTMENT",
      pricePerNightCents: overrides.pricePerNightCents ?? 9500,
      maxGuests: 4,
      bedrooms: 1,
      bathrooms: 1,
      amenities: ["Wifi"],
      photos: [],
      published: true,
      latitude: overrides.latitude,
      longitude: overrides.longitude,
      hostId: host.id,
    },
  });
}

const MANCHESTER = {
  place: "ChIJ_test_manchester_city",
  label: "Manchester",
  latitude: 53.4808,
  longitude: -2.2426,
  bounds: { south: 53.34, west: -2.32, north: 53.54, east: -2.14 },
};
const manchesterParams = () =>
  `place=${MANCHESTER.place}&placeLabel=${MANCHESTER.label}&lat=${MANCHESTER.latitude}&lng=${MANCHESTER.longitude}` +
  `&bbox=${MANCHESTER.bounds.south},${MANCHESTER.bounds.west},${MANCHESTER.bounds.north},${MANCHESTER.bounds.east}`;

let manchester: Listing;
let keswick: Listing;

test.beforeAll(async () => {
  manchester = await fixtureListing({
    title: `E2E North West: Ancoats loft ${STAMP}`,
    city: "Manchester",
    latitude: 53.4848,
    longitude: -2.2265,
  });
  keswick = await fixtureListing({
    title: `E2E North West: Keswick cottage ${STAMP}`,
    city: "Keswick",
    latitude: 54.6013,
    longitude: -3.1347,
  });
});

test.afterAll(async () => {
  await prisma.listing.deleteMany({ where: { id: { in: [manchester.id, keswick.id] } } });
  await prisma.$disconnect();
});

test("a Manchester search finds stays in Manchester, not on the coast or in the Lakes", async ({ page }) => {
  await page.goto(searchUrl(manchesterParams()));
  await expect(page.getByRole("heading", { name: "Stays near Manchester" })).toBeVisible();
  await expect(page.getByText(manchester.title)).toBeVisible();
  await expect(page.getByText(keswick.title)).toHaveCount(0);
  await expect(page.getByText("Seafront apartment overlooking Blackpool promenade")).toHaveCount(0);
});

test("a county-wide search (Cumbria) covers its whole area", async ({ page }) => {
  const params = "place=ChIJ_test_cumbria_county&placeLabel=Cumbria&lat=54.5772&lng=-2.7975&bbox=54.04,-3.64,55.19,-2.16";
  await page.goto(searchUrl(params));
  await expect(page.getByText(keswick.title)).toBeVisible();
  await expect(page.getByText(manchester.title)).toHaveCount(0);
});

test("the Map view shows the same stays, and List brings the same search back", async ({ page }) => {
  await page.goto(searchUrl(manchesterParams()));
  await expect(page.getByText(manchester.title)).toBeVisible();

  await page.getByRole("button", { name: "Map" }).click();
  await page.waitForURL(/view=map/);
  // No Google key in tests, so the stand-in map renders - the same stays,
  // the same search.
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("place")).toBe(MANCHESTER.place);

  await page.getByRole("button", { name: "List" }).click();
  await page.waitForURL((url) => !url.search.includes("view=map"));
  await expect(page.getByText(manchester.title)).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("place")).toBe(MANCHESTER.place);
  expect(url.searchParams.get("placeLabel")).toBe("Manchester");

  // Back returns to the map, still the same search.
  await page.goBack();
  await page.waitForURL(/view=map/);
  expect(new URL(page.url()).searchParams.get("place")).toBe(MANCHESTER.place);
});

test("typing a place, picking Google's suggestion and searching lands on that place's stays", async ({ page }) => {
  await page.route("**/api/search/suggestions**", (route) =>
    route.fulfill({
      json: {
        query: "Manch",
        popular: false,
        destinations: [],
        landmarks: [],
        hotels: [],
        places: [{ placeId: MANCHESTER.place, label: "Manchester", sublabel: "UK" }],
      },
    }),
  );
  await page.route("**/api/search/place**", (route) =>
    route.fulfill({
      json: {
        place: {
          placeId: MANCHESTER.place,
          name: "Manchester",
          formattedAddress: "Manchester, UK",
          latitude: MANCHESTER.latitude,
          longitude: MANCHESTER.longitude,
          bounds: MANCHESTER.bounds,
        },
      },
    }),
  );

  await page.goto("/");
  await expect(page.locator("#search-city")).toHaveAttribute("placeholder", "Town, city or postcode");
  await page.locator("#search-city").fill("Manch");
  await page.getByRole("option", { name: /Manchester/ }).click();
  await expect(page.locator("#search-city")).toHaveValue("Manchester");
  await pickDates(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/place=ChIJ_test_manchester_city/);
  await expect(page.getByText(manchester.title)).toBeVisible();
});

test("a place with no stays says so plainly", async ({ page }) => {
  // Penzance: nowhere near any stay.
  const params = "place=ChIJ_test_penzance_town&placeLabel=Penzance&lat=50.1186&lng=-5.5371&bbox=50.10,-5.56,50.14,-5.51";
  await page.goto(searchUrl(params));
  await expect(page.getByRole("heading", { name: "Stays near Penzance" })).toBeVisible();
  await expect(page.getByText(manchester.title)).toHaveCount(0);
  await expect(page.getByText(/No stays/i).first()).toBeVisible();
});
