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

// The homepage's Popular stays row and its filter buttons (one per town
// with enough stays, plus Sea views).
const townButton = (page: Page, name: string) =>
  page.getByRole("group", { name: "Show popular stays in" }).getByRole("button", { name, exact: true });

test("Popular stays offers a town or sea-views filter only once real data supports it", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: "Popular stays" })).toBeVisible();
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
      const row = page.locator("section", { has: page.getByRole("heading", { name: "Popular stays" }) });
      await expect(row.getByText("E2E fixture: second stay, same fixture city").first()).toBeVisible();

      // The dedicated results page never renders this browse row at all;
      // it's only for the homepage.
      await page.goto(`/search?city=${encodeURIComponent(fixtureCity)}`);
      await expect(page.getByRole("group", { name: "Show popular stays in" })).toHaveCount(0);
    } finally {
      await prisma.listing.deleteMany({ where: { id: { in: [second.id, ...extras.map((e) => e.id)] } } });
    }
  } finally {
    await prisma.listing.delete({ where: { id: first.id } });
    await prisma.$disconnect();
  }
});
