import { test, expect } from "@playwright/test";

// The homepage's moving "Now covering" strip: the Fylde Coast towns, then
// popular Lake District towns, then Liverpool and Manchester, each opening
// search for that town.

function strip(page: import("@playwright/test").Page) {
  return page.locator("div", { has: page.getByText("Now covering", { exact: true }) }).last();
}
const scroller = (page: import("@playwright/test").Page) => strip(page).locator("div.overflow-x-auto");
const scrollLeft = (page: import("@playwright/test").Page) => scroller(page).evaluate((el) => el.scrollLeft);

test("Now covering lists the Fylde Coast, Lake District and city towns, each opening its search", async ({ page }) => {
  await page.goto("/");
  for (const town of ["Blackpool", "Fleetwood", "Windermere", "Keswick", "Ambleside", "Liverpool", "Manchester"]) {
    // .first() - the list is drawn twice for the seamless loop (the copy is hidden from assistive tech).
    await expect(strip(page).getByRole("link", { name: town, exact: true }).first()).toBeAttached();
  }
  await scroller(page).hover();
  await strip(page).getByRole("link", { name: "Windermere", exact: true }).first().click();
  await expect(page).toHaveURL(/\/search\?city=Windermere$/);
  await expect(page.locator("#search-city")).toHaveValue("Windermere");
});

test("it drifts by itself, stops to be swiped while pointed at, and carries on from there", async ({ page }) => {
  await page.goto("/");
  await scroller(page).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  const start = await scrollLeft(page);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(start + 5);

  // Pointing at it stops the drift...
  await scroller(page).hover();
  const held = await scrollLeft(page);
  await page.waitForTimeout(800);
  expect(Math.abs((await scrollLeft(page)) - held)).toBeLessThanOrEqual(1);

  // ...and it can be scrolled by hand (a touchpad swipe), either way.
  await page.mouse.wheel(300, 0);
  await expect.poll(() => scrollLeft(page)).not.toBe(held);
  const swiped = await scrollLeft(page);
  await page.waitForTimeout(500);
  expect(Math.abs((await scrollLeft(page)) - swiped)).toBeLessThanOrEqual(1);

  // Leaving it picks the drift up again from where it was left.
  await page.mouse.move(5, 5);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(swiped + 3);
});
