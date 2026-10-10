import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

// The homepage's Explore stays in Lancashire row of stays and its filter
// buttons: the kind of stay (Top rated, Families, Long-stay discounts, Sea
// views), then one per town with enough stays.
const filterButton = (page: Page, name: string) =>
  page.getByRole("group", { name: "Filter stays" }).getByRole("button", { name, exact: true });
const townButton = filterButton;

const exploreRow = (page: Page) =>
  page.locator("section", { has: page.getByRole("heading", { name: "Explore stays in Lancashire" }) });

/** The ids of the stays the row is showing right now. */
async function shownListingIds(page: Page): Promise<string[]> {
  const hrefs = await exploreRow(page)
    .locator("a[href^='/listings/']:visible")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  return [...new Set(hrefs.map((href) => href.split("/")[2].split(/[?#]/)[0]))];
}

test("Explore stays in Lancashire offers a town or sea-views filter only once real data supports it", async ({ page }) => {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });

  // A city name unique to this test run, not a real seeded (or otherwise
  // used) city. This test used to check "Popular in Blackpool" against the
  // real seeded city and assert *no* "Popular in ..." heading existed
  // anywhere before adding a second Blackpool listing - a global,
  // catalog-wide invariant that isn't safe under Playwright's default
  // fullyParallel execution: another spec file's own listing fixture
  // (created and cleaned up around the same time, in any city) can
  // transiently push a city over MIN_LISTINGS_PER_SECTION and fail this
  // test's "before" assertion, even against a freshly-seeded CI database
  // (confirmed happening in CI, not just a locally-polluted dev DB).
  // Scoping to a fabricated city name only this test ever creates makes the
  // "before" check immune to whatever any other spec is doing concurrently.
  const fixtureCity = `E2E Marketplace City ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const first = await prisma.listing.create({
    data: {
      title: "E2E fixture: first stay in a fresh city",
      description: "Temporary listing created for this test.",
      city: fixtureCity,
      country: "England",
      pricePerNightCents: 6000,
      maxGuests: 2,
      photos: [],
      amenities: ["Wifi"],
      hostId: host.id,
    },
  });

  try {
    // One listing in a brand-new city isn't enough to offer it as a filter.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Explore stays in Lancashire" })).toBeVisible();
    await expect(townButton(page, fixtureCity)).toHaveCount(0);

    // A second listing in the same fixture city, with a beach-style
    // amenity - combined with the seed catalog's own "Sea view" listing,
    // this also crosses the sitewide threshold for "Sea views". Unlike
    // the "before" check above, asserting these are *visible* afterwards is
    // safe under parallel execution: once genuinely enough matching
    // listings exist, nothing another spec does concurrently can un-satisfy
    // that.
    const second = await prisma.listing.create({
      data: {
        title: "E2E fixture: second stay, same fixture city",
        description: "Temporary listing created for this test.",
        city: fixtureCity,
        country: "England",
        pricePerNightCents: 6500,
        maxGuests: 2,
        photos: [],
        amenities: ["Wifi", "Ocean view"],
        hostId: host.id,
      },
    });

    // Two listings clear MIN_LISTINGS_PER_SECTION, but the homepage only
    // offers the MAX_POPULAR_TOWN_FILTERS busiest towns - so how many the
    // fixture city needs depends on the catalogue, not a fixed number. One
    // more than the busiest other city right now ranks it first; a
    // concurrent spec's fixture can at most tie it, never push it out.
    const otherCities = await prisma.listing.groupBy({
      by: ["city"],
      where: { published: true, city: { not: fixtureCity } },
      _count: { _all: true },
    });
    const needed = Math.max(0, ...otherCities.map((c) => c._count._all)) + 1;
    const extras = await Promise.all(
      Array.from({ length: Math.max(0, needed - 2) }, (_, i) =>
        prisma.listing.create({
          data: {
            title: `E2E fixture: extra stay ${i + 1}, same fixture city`,
            description: "Temporary listing created for this test.",
            city: fixtureCity,
            country: "England",
            pricePerNightCents: 7000,
            maxGuests: 2,
            photos: [],
            amenities: ["Wifi"],
            hostId: host.id,
          },
        }),
      ),
    );

    try {
      await page.goto("/");
      await expect(townButton(page, "Sea views")).toBeVisible();
      await townButton(page, fixtureCity).click();
      await expect(townButton(page, fixtureCity)).toHaveAttribute("aria-pressed", "true");
      const row = exploreRow(page);
      await expect(row.getByText("E2E fixture: second stay, same fixture city").first()).toBeVisible();

      // The dedicated results page never renders this browse row at all;
      // it's only for the homepage.
      await page.goto(`/search?city=${encodeURIComponent(fixtureCity)}`);
      await expect(page.getByRole("group", { name: "Filter stays" })).toHaveCount(0);
    } finally {
      await prisma.listing.deleteMany({ where: { id: { in: [second.id, ...extras.map((e) => e.id)] } } });
    }
  } finally {
    await prisma.listing.delete({ where: { id: first.id } });
  }
});

test("the kind-of-stay filters show only stays that really match, and come before the towns", async ({ page }) => {
  // The demo seed has plenty of family-sized stays and a few with weekly or
  // monthly discounts.
  await page.goto("/");
  const labels = await page.getByRole("group", { name: "Filter stays" }).getByRole("button").allTextContents();
  expect(labels[0]).toBe("All");
  expect(labels.indexOf("Families")).toBeGreaterThan(0);
  expect(labels.indexOf("Long-stay discounts")).toBeGreaterThan(0);
  expect(labels.indexOf("Families")).toBeLessThan(labels.indexOf("Blackpool"));

  await filterButton(page, "Families").click();
  await expect(filterButton(page, "Families")).toHaveAttribute("aria-pressed", "true");
  const families = await shownListingIds(page);
  expect(families.length).toBeGreaterThan(1);
  const familyStays = await prisma.listing.findMany({ where: { id: { in: families } }, select: { bedrooms: true } });
  expect(familyStays.every((listing) => listing.bedrooms >= 2)).toBe(true);
  // :visible - the row also renders a hidden sizing copy of its first card.
  await expect(exploreRow(page).locator("p:visible", { hasText: /\b\d+ bedrooms\b/ }).first()).toBeVisible();

  await filterButton(page, "Long-stay discounts").click();
  const discounted = await shownListingIds(page);
  expect(discounted.length).toBeGreaterThan(1);
  const discountedStays = await prisma.listing.findMany({
    where: { id: { in: discounted } },
    select: { weeklyDiscountPercent: true, monthlyDiscountPercent: true },
  });
  expect(
    discountedStays.every((listing) => (listing.weeklyDiscountPercent ?? 0) > 0 || (listing.monthlyDiscountPercent ?? 0) > 0),
  ).toBe(true);

  // The old "Find your perfect stay" tiles are gone; this row replaces them.
  await expect(page.getByRole("heading", { name: "Find your perfect stay" })).toHaveCount(0);
});

test("See all follows the chosen filter to the results page, and Back keeps it", async ({ page }) => {
  await page.goto("/");
  const row = exploreRow(page);
  const seeAll = row.getByRole("link", { name: /^See all/ });
  await expect(seeAll).toHaveAttribute("href", "/search");

  await expect(async () => {
    await filterButton(page, "Blackpool").click();
    await expect(filterButton(page, "Blackpool")).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]stays=blackpool\b/);
  await expect(seeAll).toHaveAttribute("href", "/search?city=Blackpool");

  await seeAll.click();
  await expect(page).toHaveURL(/\/search\?city=Blackpool$/);
  await expect(page.getByRole("heading", { name: "Stays in Blackpool" })).toBeVisible();
  const blackpoolStays = await prisma.listing.count({
    where: { published: true, suspendedAt: null, city: { contains: "Blackpool", mode: "insensitive" } },
  });
  await expect(page.getByText(`Blackpool · ${blackpoolStays} stay${blackpoolStays === 1 ? "" : "s"}`)).toBeVisible();

  await page.goBack();
  await expect(filterButton(page, "Blackpool")).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("link", { name: /^See all/ })).toHaveAttribute("href", "/search?city=Blackpool");
});

test("the long-stay filter carries to the results page as a chip that can be removed", async ({ page }) => {
  await page.goto("/search?longStay=1");
  const chip = page.getByRole("link", { name: "Remove filter: Long-stay discounts" });
  await expect(chip).toBeVisible();
  const discounted = await prisma.listing.count({
    where: {
      published: true,
      suspendedAt: null,
      OR: [{ weeklyDiscountPercent: { gt: 0 } }, { monthlyDiscountPercent: { gt: 0 } }],
    },
  });
  await expect(page.getByText(`${discounted} stay${discounted === 1 ? "" : "s"}`, { exact: true })).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(chip).toHaveCount(0);
});
