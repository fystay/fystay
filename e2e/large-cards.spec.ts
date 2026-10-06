import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Playwright's test process doesn't load .env the way `next dev` does; CI
// sets the variables directly instead.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const RAILS = ["Last Minute Deals", "More from FYStay"];

function rail(page: Page, label: string) {
  // The carousel itself - a homepage row's <section> can share its name.
  return page.getByRole("region", { name: label }).and(page.locator('[aria-roledescription="carousel"]'));
}

async function slotBoxes(page: Page, label: string) {
  return rail(page, label)
    .locator("ul > li")
    .evaluateAll((items) =>
      items.slice(0, 2).map((item) => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    );
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("each rail shows one full card and about half of the next, without widening the page", async ({ page }) => {
    await page.goto("/");
    for (const label of RAILS) {
      await rail(page, label).scrollIntoViewIfNeeded();
      const [first, second] = await slotBoxes(page, label);
      expect(first.left).toBeGreaterThanOrEqual(0);
      expect(first.right).toBeLessThanOrEqual(390);
      const peek = (390 - second.left) / second.width;
      expect(peek, `${label}: share of the next card visible`).toBeGreaterThan(0.3);
      expect(peek).toBeLessThan(0.65);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a rail scrolls sideways and its cards open their pages", async ({ page }) => {
    await page.goto("/");
    const deals = rail(page, "Last Minute Deals");
    await deals.scrollIntoViewIfNeeded();
    const scroller = deals.locator("ul");
    await scroller.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" }));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    await scroller.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
    // :visible - the rail also renders a hidden sizing copy of its first card.
    await deals.locator("a[href^='/listings/']:visible").first().click();
    await expect(page).toHaveURL(/\/listings\/[^/]+$/);
  });
});

test("desktop shows about three cards, with arrows to move along", async ({ page }) => {
  // Three cards fit at this size, so the row needs more than that to have
  // somewhere to scroll to: two extra (small, so last-sorted) deals of its own.
  const prisma = new PrismaClient();
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
  const extras = await Promise.all(
    [1, 2].map((n) =>
      prisma.listing.create({
        data: {
          title: `E2E fixture: rail deal ${n} ${Date.now()}`,
          description: "Temporary listing created for this test.",
          city: "Blackpool",
          country: "England",
          pricePerNightCents: 9000,
          maxGuests: 2,
          photos: [],
          amenities: ["Wifi"],
          hostId: host.id,
          lastMinuteDiscountPercent: 5,
          lastMinuteWindowDays: 14,
        },
      }),
    ),
  );

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const deals = rail(page, "Last Minute Deals");
    await deals.scrollIntoViewIfNeeded();
    const [first] = await slotBoxes(page, "Last Minute Deals");
    const railWidth = await deals.locator("ul").evaluate((el) => el.clientWidth);
    expect(railWidth / first.width).toBeGreaterThan(3);
    expect(railWidth / first.width).toBeLessThan(3.7);

    const next = deals.getByRole("button", { name: "Next" });
    await expect(next).toBeVisible();
    await next.click();
    await expect.poll(() => deals.locator("ul").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(deals.getByRole("button", { name: "Previous" })).toBeVisible();
  } finally {
    await prisma.listing.deleteMany({ where: { id: { in: extras.map((listing) => listing.id) } } });
    await prisma.$disconnect();
  }
});
