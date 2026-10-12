import { test, expect } from "@playwright/test";
import { pickDates, pickMockPlace } from "./support/search";

test("guest picker toggles adults, children, infants, and pets, and filters results", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Guests/ }).click();
  await expect(page.getByText("Ages 13 or above")).toBeVisible();

  await page.getByRole("button", { name: "Increase children" }).click();
  await page.getByRole("button", { name: "Increase infants" }).click();
  await page.getByRole("button", { name: "Increase pets" }).click();

  await expect(page.getByRole("button", { name: /Guests/ })).toContainText(
    "2 guests, 1 infant, 1 pet",
  );

  // Adjustments only update the popover's own display until Done is
  // pressed - matching the date-range picker's confirm-on-Done behavior.
  await page.getByRole("button", { name: "Done" }).click();

  // An area covering every seeded town, so only guests and pets narrow it.
  await pickMockPlace(page);
  await pickDates(page, 200);
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/children=1/);
  expect(page.url()).toContain("infants=1");
  expect(page.url()).toContain("pets=1");

  // Only the pet-friendly, 3-guest-capacity cottage should match a 2-guest + pet search.
  await expect(page.getByText("Cosy cottage near Fleetwood Marina").first()).toBeVisible();
  await expect(page.getByText("Elegant Victorian townhouse")).toHaveCount(0);
  await expect(page.getByText("Seafront apartment")).toHaveCount(0);
});
