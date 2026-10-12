import { test, expect, type Page } from "@playwright/test";

const SECTIONS = [
  { label: "Stays", path: "/search" },
  { label: "Explore", path: "/destinations" },
  { label: "Travel", path: "/travel-extras" },
  { label: "Services", path: "/services" },
];

function sectionNav(page: Page) {
  return page.getByRole("navigation", { name: "Sections" });
}

test("the homepage shows the four section pills with Stays pressed", async ({ page }) => {
  await page.goto("/");
  const nav = sectionNav(page);
  await expect(nav.getByRole("link")).toHaveText(["Stays", "Explore", "Travel", "Services"]);
  await expect(nav.getByRole("link", { name: "Stays" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
});

for (const { label, path } of SECTIONS) {
  test(`${label} opens ${path} and shows as the pressed pill`, async ({ page }) => {
    await page.goto("/about");
    // Pages outside the four sections show the control with none selected.
    await expect(sectionNav(page).locator("[aria-current]")).toHaveCount(0);

    await page.goto("/");
    await sectionNav(page).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));

    const nav = sectionNav(page);
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  });
}

test("on desktop the sections sit in the header, each offered once", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ["/", "/search"]) {
    await page.goto(path);
    const header = page.locator("header");
    await expect(header.getByRole("navigation", { name: "Sections" })).toBeVisible();
    // exact: the logo link's name includes its "Apartments · B&Bs · Lodges" descriptor.
    await expect(header.getByRole("link", { name: "About", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Stays", exact: true })).toHaveCount(1);
    // One set of names: no competing "Hotels" or "Destinations" link.
    await expect(header.getByRole("link", { name: "Hotels", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Destinations", exact: true })).toHaveCount(0);
  }
});

test("on phones the sections are a bottom tab bar: four equal, thumb-sized tabs that cover nothing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/search"]) {
    await page.goto(path);
    const nav = sectionNav(page);
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    // Pinned to the bottom edge, full width.
    expect(Math.round(box!.y + box!.height)).toBe(844);
    expect(Math.round(box!.width)).toBe(390);

    const links = nav.getByRole("link");
    await expect(links).toHaveCount(4);
    const sizes = await links.evaluateAll((all) =>
      all.map((link) => {
        const rect = link.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
    );
    expect(new Set(sizes.map((size) => size.width)).size).toBe(1);
    for (const size of sizes) expect(size.height).toBeGreaterThanOrEqual(44);

    // The page reserves the bar's height, so the end of the page (the footer)
    // scrolls clear of it.
    const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(Math.floor(box!.height));
    // Not repeated at the top: the header has no section links on phones.
    await expect(page.locator("header").getByRole("link", { name: "Stays", exact: true })).toHaveCount(0);
  }
});

test("on desktop there's no bottom bar and nothing reserved for one", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/search");
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(1);
  await expect(page.locator("header").getByRole("navigation", { name: "Sections" })).toBeVisible();
  const padding = await page.evaluate(() => getComputedStyle(document.body).paddingBottom);
  expect(padding).toBe("0px");
});

test("on phones the bottom bar is on every page, and the account menu holds only account actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about");
  // Outside the four sections: the same tabs, none selected.
  await expect(sectionNav(page).getByRole("link")).toHaveText(["Stays", "Explore", "Travel", "Services"]);
  await expect(sectionNav(page).locator("[aria-current]")).toHaveCount(0);

  const menuButton = page.getByRole("button", { name: "Account menu" });
  const menu = page.locator("#guest-menu-panel");
  await expect(async () => {
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(menu.getByRole("link", { name: "Log in" })).toBeVisible();
  for (const label of ["Stays", "Explore", "Travel", "Services", "About"]) {
    await expect(menu.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
});

test("selecting a pill does not change the size of the row (no layout shift)", async ({ page }) => {
  await page.goto("/search");
  const widths = async () =>
    sectionNav(page)
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().width)));
  const onStays = await widths();
  await page.goto("/services");
  expect(await widths()).toEqual(onStays);
});

test("on a listing the booking bar has the bottom edge to itself", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search");
  const firstListing = page.locator('a[href^="/listings/"]').first();
  test.skip((await firstListing.count()) === 0, "No listings in this database.");
  await page.goto((await firstListing.getAttribute("href"))!);
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
});
