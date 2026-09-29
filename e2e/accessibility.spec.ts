import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { FYLDE_COAST_DESTINATIONS } from "../src/lib/destinations";
import { TOWN_COORDINATES } from "../src/lib/geocoding";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

/**
 * Runs axe-core against whatever's currently rendered on `page` and fails
 * on any "serious" or "critical" WCAG violation - a real, automated
 * regression backstop for the manual aria work already throughout this
 * codebase, not a replacement for it. "moderate"/"minor" findings are
 * logged, not failed on: axe's own docs note these often need human
 * judgment (e.g. color-contrast against a background image), and gating
 * CI on them would make this suite flaky against content, not layout,
 * changes. Scoped to the whole document rather than a single component,
 * since a real user encounters the whole page at once.
 */
async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (results.violations.length > blocking.length) {
    const minor = results.violations.filter((v) => !blocking.includes(v));
    console.log(
      `[a11y] ${label}: ${minor.length} moderate/minor finding(s) (not failing the test): ` +
        minor.map((v) => v.id).join(", "),
    );
  }
  expect(
    blocking,
    `${label} has ${blocking.length} serious/critical a11y violation(s):\n` +
      blocking
        .map((v) => `- ${v.id} (${v.impact}): ${v.help}\n  ${v.nodes[0]?.target.join(" ")}`)
        .join("\n"),
  ).toEqual([]);
}

test.describe("accessibility", () => {
  test("homepage has no serious a11y violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Got it" }).click().catch(() => {});
    await expectNoSeriousViolations(page, "Homepage");
  });

  test("search results page has no serious a11y violations", async ({ page }) => {
    await page.goto("/search");
    await expectNoSeriousViolations(page, "Search results");
  });

  test("listing detail page has no serious a11y violations", async ({ page }) => {
    const listing = await prisma.listing.findFirstOrThrow({
      where: { published: true },
      orderBy: { createdAt: "asc" },
    });
    await page.goto(`/listings/${listing.id}`);
    await expectNoSeriousViolations(page, "Listing detail");
  });

  test("a destination page has no serious a11y violations", async ({ page }) => {
    // LocalTown rows are created by the app itself on first local-data read
    // (ensureTownsSeeded), not by the seed - so a fresh CI database has none
    // before any destination page is visited. Upsert exactly the one row the
    // app would create for the first geocoded destination, from the same
    // source; never overwrite a row that already exists.
    const destination = FYLDE_COAST_DESTINATIONS.find((d) => TOWN_COORDINATES[d.searchCity.toLowerCase()]);
    if (!destination) throw new Error("No geocoded destination to build a LocalTown fixture from");
    const coordinates = TOWN_COORDINATES[destination.searchCity.toLowerCase()];
    const town = await prisma.localTown.upsert({
      where: { slug: destination.slug },
      create: { slug: destination.slug, name: destination.name, ...coordinates },
      update: {},
    });
    await page.goto(`/destinations/${town.slug}`);
    await expectNoSeriousViolations(page, "Destination page");
  });

  test("login and register pages have no serious a11y violations", async ({ page }) => {
    await page.goto("/login");
    await expectNoSeriousViolations(page, "Login");

    await page.goto("/register");
    await expectNoSeriousViolations(page, "Register");
  });

  test("signed-in guest surfaces have no serious a11y violations", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "guest@fystay.dev");
    await page.fill("#password", "guestpass123");
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    await page.goto("/account");
    await expectNoSeriousViolations(page, "Account page");

    await page.goto("/bookings");
    await expectNoSeriousViolations(page, "My trips");

    await page.goto("/wishlist");
    await expectNoSeriousViolations(page, "Wishlist");
  });

  test("signed-in host dashboard has no serious a11y violations", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "host@fystay.dev");
    await page.fill("#password", "hostpass123");
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    await page.goto("/host/dashboard");
    await expectNoSeriousViolations(page, "Host dashboard");
  });
});
