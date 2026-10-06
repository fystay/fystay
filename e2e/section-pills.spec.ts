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
    // exact: the logo link's name includes its "Hotels · B&Bs · Apartments" tagline.
    await expect(header.getByRole("link", { name: "About", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Stays", exact: true })).toHaveCount(1);
    // One set of names: no competing "Hotels" or "Destinations" link.
    await expect(header.getByRole("link", { name: "Hotels", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Destinations", exact: true })).toHaveCount(0);
  }
});

test("on phones the sections sit under the header as four equal tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/search"]) {
    await page.goto(path);
    const links = sectionNav(page).getByRole("link");
    await expect(links).toHaveCount(4);
    const widths = await links.evaluateAll((all) => all.map((link) => Math.round(link.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
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
