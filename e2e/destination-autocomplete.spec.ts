import { test, expect } from "@playwright/test";
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
  await expect(option).toBeVisible();

  await option.click();
  await expect(input).toHaveValue("Blackpool");
  await expect(listbox(page)).toBeHidden();

  // Selecting a suggestion on the homepage doesn't auto-navigate by itself
  // (only the results page live-updates as fields change) - Search still
  // uses the selected structured value.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/search\?.*city=Blackpool/);
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

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(new RegExp(`/listings/${hotel.id}`));
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
