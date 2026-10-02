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
    // Pages outside the four sections have no pill row.
    await expect(sectionNav(page)).toHaveCount(0);

    await page.goto("/");
    await sectionNav(page).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));

    const nav = sectionNav(page);
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
  });
}

test("the desktop header doesn't repeat links the pills already cover", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/search");
  const header = page.locator("header");
  // exact: the logo link's name includes its "Hotels · B&Bs · Apartments" tagline.
  await expect(header.getByRole("link", { name: "Hotels", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "About", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Stays", exact: true })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Destinations", exact: true })).toHaveCount(0);
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
