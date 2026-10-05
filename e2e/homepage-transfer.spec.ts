import { test, expect } from "@playwright/test";

// The demo seed makes EV Exec's return airport transfer a live offering, so
// the homepage gives it its own panel in More from FYStay (TransferFeature).
test("the homepage features EV Exec's airport transfer, priced from the live offering, linking to booking", async ({
  page,
}) => {
  await page.goto("/");
  const cta = page.getByRole("link", { name: "Add an airport transfer" });
  await cta.scrollIntoViewIfNeeded();
  const panel = page.locator("div.isolate", { has: cta });
  await expect(panel.getByText("EV Exec", { exact: true })).toBeVisible();
  await expect(panel.getByText("Return airport transfer")).toBeVisible();
  await expect(panel.getByText("£45")).toBeVisible();
  await expect(panel.getByText("Meet & greet")).toBeVisible();

  await cta.click();
  await expect(page).toHaveURL(/\/travel-extras\?category=AIRPORT_TRANSFER/);
});
