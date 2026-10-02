import { test, expect, type Page } from "@playwright/test";

const RAILS = ["Featured stays", "Explore the Fylde Coast", "Services"];

function rail(page: Page, label: string) {
  return page.getByRole("region", { name: label });
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
    const explore = rail(page, "Explore the Fylde Coast");
    const scroller = explore.locator("ul");
    await scroller.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" }));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    await scroller.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
    await explore.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/destinations\/[a-z-]+$/);
  });
});

test("desktop shows about three cards, with arrows to move along", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  // Explore always has six towns, so unlike Services (three cards, which
  // all fit at this size) it always has somewhere to scroll to.
  const explore = rail(page, "Explore the Fylde Coast");
  await explore.scrollIntoViewIfNeeded();
  const [first] = await slotBoxes(page, "Explore the Fylde Coast");
  const railWidth = await explore.locator("ul").evaluate((el) => el.clientWidth);
  expect(railWidth / first.width).toBeGreaterThan(3);
  expect(railWidth / first.width).toBeLessThan(3.7);

  const next = explore.getByRole("button", { name: "Next" });
  await expect(next).toBeVisible();
  await next.click();
  await expect.poll(() => explore.locator("ul").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(explore.getByRole("button", { name: "Previous" })).toBeVisible();
});
