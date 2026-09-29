import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatDateParam } from "@/lib/hotelSearchParams";
import { mockHotelProviderAdapter } from "@/lib/hotelProviders/providers/mock";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

// Several tests here toggle the "mock" HotelProvider's own status to
// exercise the "provider unavailable" state - running any two of these
// tests concurrently against the shared dev database could make an
// unrelated test see the wrong provider state, so (matching
// search-filters.spec.ts's own precedent for shared-state tests) every
// test in this file runs one at a time.
test.describe.configure({ mode: "serial" });

/** yyyy-mm-dd, `daysFromNow` in the future - matches buildHotelSearchQuery's own date format. */
function dateString(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return formatDateParam(d);
}

/** The exact Date construction parseDateParam (src/lib/hotelSearchParams.ts) applies when parsing this same string back out of a query param - matching it here means the mock adapter's own deterministic hash produces exactly what the running server will compute for the same query string. */
function parsedDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/**
 * Finds a check-in offset (in days from today) whose deterministic mock
 * availability for `externalId` is sold out (or not), without guessing at
 * or hardcoding a magic date - it calls the exact same production adapter
 * function the running server calls, so this is guaranteed to agree with
 * it rather than relying on a coincidence that only holds today. See
 * mock.ts's own comment: sold-out is a deliberate ~5% chance keyed off
 * (externalId, checkIn, checkOut), so a short search almost always finds
 * a match in either direction well within this offset range.
 */
async function findStayWithDealStatus(
  externalId: string,
  wantSoldOut: boolean,
): Promise<{ checkInStr: string; checkOutStr: string }> {
  for (let offset = 10; offset < 500; offset++) {
    const checkInStr = dateString(offset);
    const checkOutStr = dateString(offset + 2);
    const deals = await mockHotelProviderAdapter.getAvailability(externalId, {
      checkIn: parsedDate(checkInStr),
      checkOut: parsedDate(checkOutStr),
      adults: 2,
      children: 0,
      rooms: 1,
    });
    if ((deals.length === 0) === wantSoldOut) return { checkInStr, checkOutStr };
  }
  throw new Error(`Could not find a stay with sold out=${wantSoldOut} for ${externalId} in range`);
}

/** externalId of the first (index 0) result for a given destination - matches encodeExternalId/slugifyDestination in mock.ts exactly, so it always names the same hotel the running server's search would return first. */
function firstResultExternalId(destinationSlug: string): string {
  return `mock:${destinationSlug}:0`;
}

async function clickFirstResult(page: Page): Promise<void> {
  await page.getByRole("link", { name: /View deal/ }).first().click();
}

test.describe("hotel affiliate: search -> results -> detail -> redirect", () => {
  test("happy path: a real deal's Book now button opens the provider's deep link and records a real, attributed click", async ({
    page,
  }) => {
    const destinationSlug = "e2e-happy-path-hotel-test";
    const { checkInStr, checkOutStr } = await findStayWithDealStatus(
      firstResultExternalId(destinationSlug),
      false,
    );

    await page.goto(
      `/hotels?destination=${destinationSlug}&checkIn=${checkInStr}&checkOut=${checkOutStr}&adults=2`,
    );
    await expect(page.getByText(/hotels? found/)).toBeVisible();
    await expect(page.getByRole("link", { name: /View deal/ }).first()).toBeVisible();

    await clickFirstResult(page);
    await expect(page.getByRole("heading", { name: "Available deals" })).toBeVisible();

    const bookNowLink = page.getByRole("link", { name: /Book now/ }).first();
    await expect(bookNowLink).toBeVisible();
    const redirectHref = await bookNowLink.getAttribute("href");
    expect(redirectHref).toContain("/api/hotels/redirect?");
    expect(redirectHref).toContain("hotel=");

    // mock-hotel-provider.invalid is an IANA-reserved TLD that deliberately
    // never resolves (see mock.ts's own comment), so read the deep link from
    // the redirect route's own 302 in the popup rather than from where the
    // popup ends up. Not by routing the provider URL: a route handler isn't
    // reliably called for a redirect's target (Chromium's headless shell,
    // which CI runs, never calls it), which left this test waiting forever.
    const context = page.context();
    const [popup, redirectResponse] = await Promise.all([
      context.waitForEvent("page"),
      context.waitForEvent("response", (response) => response.url().includes("/api/hotels/redirect?")),
      bookNowLink.click(),
    ]);
    expect(redirectResponse.status()).toBe(302);
    const capturedUrl = redirectResponse.headers()["location"];
    expect(capturedUrl).toContain("https://mock-hotel-provider.invalid/deeplink/");
    await popup.close().catch(() => {});

    // Proves the click was actually recorded server-side (not just that the
    // link had the right href) - the real attribution write the redirect
    // route makes before issuing the 302.
    const expectedCity = "E2e Happy Path Hotel Test";
    const recorded = await prisma.affiliateClick.findFirst({
      where: { hotel: { city: expectedCity } },
      orderBy: { createdAt: "desc" },
      include: { hotel: true },
    });
    expect(recorded).not.toBeNull();
    expect(recorded?.deepLinkUrl).toBe(capturedUrl);
    expect(recorded?.sessionId).not.toBeNull();
  });

  test("sold-out state: a hotel with no available deals for these dates shows the empty state, not a broken/blank page", async ({
    page,
  }) => {
    const destinationSlug = "e2e-sold-out-hotel-test";
    const { checkInStr, checkOutStr } = await findStayWithDealStatus(
      firstResultExternalId(destinationSlug),
      true,
    );

    await page.goto(
      `/hotels?destination=${destinationSlug}&checkIn=${checkInStr}&checkOut=${checkOutStr}&adults=2`,
    );
    await clickFirstResult(page);

    await expect(page.getByText("No rooms available for these dates.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Try different dates" })).toBeVisible();
    await expect(page.getByRole("link", { name: /See other hotels in/ })).toBeVisible();
    // The deal card/Book now button must not render at all when sold out.
    await expect(page.getByRole("link", { name: /Book now/ })).toHaveCount(0);
  });

  test("hotel-not-found state: an unknown slug shows the hotel-specific 404, not a broken page or FYStay's own listing 404 copy", async ({
    page,
  }) => {
    const response = await page.goto("/hotels/blackpool/e2e-this-slug-does-not-exist-xyz");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that hotel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Search hotels" })).toBeVisible();
  });

  test("invalid dates on the search page show a dates-specific error, not a crash or the generic 'no results' message", async ({
    page,
  }) => {
    await page.goto("/hotels?destination=Blackpool&checkIn=not-a-real-date&checkOut=also-not-a-date");
    await expect(page.getByText("Check your dates")).toBeVisible();
  });

  test("out-of-range guest count shows a guests-specific error", async ({ page }) => {
    // Valid dates alongside the bad guest count, so this test actually
    // isolates the guests-specific branch: with no dates at all,
    // parseHotelSearchParams also sets errors.dates, and
    // HotelSearchResults checks that branch first (see its own source) -
    // this would otherwise show "Check your dates" and pass for the wrong
    // reason.
    const checkInStr = dateString(30);
    const checkOutStr = dateString(32);
    await page.goto(
      `/hotels?destination=Blackpool&checkIn=${checkInStr}&checkOut=${checkOutStr}&adults=999`,
    );
    await expect(page.getByText("Check your guest numbers")).toBeVisible();
  });

  test("no destination entered yet shows the initial prompt, not an error", async ({ page }) => {
    await page.goto("/hotels");
    await expect(page.getByText("Search for a destination to see hotel deals")).toBeVisible();
  });

  test("provider unavailable: with no ACTIVE hotel provider, search shows the unavailable state honestly rather than an empty/broken grid", async ({
    page,
  }) => {
    await prisma.hotelProvider.update({ where: { code: "mock" }, data: { status: "INACTIVE" } });
    try {
      // Valid dates, same reasoning as the guests-error test above: with no
      // dates at all, parsing fails before searchHotels() (and therefore
      // this test's own provider-status change) is ever reached.
      const checkInStr = dateString(30);
      const checkOutStr = dateString(32);
      await page.goto(
        `/hotels?destination=Blackpool&checkIn=${checkInStr}&checkOut=${checkOutStr}&adults=2`,
      );
      await expect(page.getByText("Hotel search is unavailable")).toBeVisible();
      await expect(
        page.getByText("Hotel search isn't available right now. Please try again later."),
      ).toBeVisible();
    } finally {
      await prisma.hotelProvider.update({ where: { code: "mock" }, data: { status: "ACTIVE" } });
    }
  });
});

test.describe("EV Exec cross-sell on the hotel detail page", () => {
  test("renders with real EV Exec data and hands off to /travel-extras with the trip's real context, never a fabricated airport", async ({
    page,
  }) => {
    const destinationSlug = "e2e-ev-exec-hotel-test";
    const { checkInStr, checkOutStr } = await findStayWithDealStatus(
      firstResultExternalId(destinationSlug),
      false,
    );

    await page.goto(
      `/hotels?destination=${destinationSlug}&checkIn=${checkInStr}&checkOut=${checkOutStr}&adults=2`,
    );
    await clickFirstResult(page);

    await expect(page.getByText("Optional: airport transfer")).toBeVisible();
    await expect(page.getByText(/EV Exec/)).toBeVisible();

    const cta = page.getByRole("link", { name: "View transfer options" });
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute("href");
    expect(href).toContain("/travel-extras?");
    expect(href).toContain("category=AIRPORT_TRANSFER");
    expect(href).toContain("destination=");
    expect(href).toContain(`checkIn=${checkInStr}`);
    expect(href).toContain(`checkOut=${checkOutStr}`);
    expect(href).toContain("adults=2");
    // The one field that must never appear, since no airport mapping exists
    // anywhere in this codebase - see EvExecCrossSellCard/travelAddons.ts.
    expect(href).not.toContain("airport=");

    await cta.click();
    await page.waitForURL(/\/travel-extras\?/);
    await expect(page.getByText("For your trip:", { exact: false })).toBeVisible();
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
