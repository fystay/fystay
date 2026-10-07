import { test, expect } from "@playwright/test";

test("host can create, edit, and delete a listing", async ({ page }) => {
  const uniqueTitle = `E2E test cottage ${Date.now()}`;
  const updatedTitle = `${uniqueTitle} (updated)`;

  await page.goto("/login");
  await page.fill("#email", "host@fystay.dev");
  await page.fill("#password", "hostpass123");
  await page.click("button[type=submit]");
  await page.waitForURL("/");

  // --- Create ---
  await page.goto("/host/listings/new");
  await page.fill("#title", uniqueTitle);
  await page.fill(
    "#description",
    "A cosy place used only by the automated end-to-end test suite.",
  );
  await page.fill("#city", "Blackpool");
  await page.fill("#country", "England");
  await page.fill("#price", "99");

  await page.getByText("Or paste an image URL instead").click();
  await page.getByPlaceholder("https://example.com/photo.jpg").fill(
    "https://example.com/e2e-test-photo.jpg",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Amenity checkboxes plus the free-text "Other" field must both actually
  // persist, not just visually toggle.
  await page.getByRole("button", { name: "Wifi", exact: true }).click();
  await page.getByRole("button", { name: "Pet friendly", exact: true }).click();
  await page.getByPlaceholder("Sea view, Garden, EV charger").fill("Ping pong table");

  await page.getByRole("button", { name: "Create listing" }).click();
  await page.waitForURL("/host/listings");
  // Each listing card also renders a (hidden) delete-confirmation dialog
  // that repeats the title, so scope to the card's heading to stay unambiguous.
  await expect(page.getByRole("heading", { name: uniqueTitle })).toBeVisible();

  // --- Edit ---
  const row = page.locator("article").filter({ has: page.getByRole("heading", { name: uniqueTitle }) });
  await row.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/host\/listings\/.+\/edit/);

  // The ticked amenities and custom text should come back pre-populated
  // from the database, proving the checkboxes genuinely saved.
  await expect(page.getByRole("button", { name: "Wifi", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Pet friendly", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Kitchen", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByPlaceholder("Sea view, Garden, EV charger")).toHaveValue(
    "Ping pong table",
  );

  await page.fill("#title", updatedTitle);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("/host/listings");
  await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible();

  // --- Delete ---
  const updatedRow = page.locator("article").filter({ has: page.getByRole("heading", { name: updatedTitle }) });
  await updatedRow.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("heading", { name: updatedTitle })).not.toBeVisible();
});
