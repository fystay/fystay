import { test, expect } from "@playwright/test";

// The homepage's moving "Now covering" strip: the Fylde Coast towns, then
// popular Lake District towns, each opening search for that town.
test("Now covering lists the Fylde Coast and Lake District towns, each opening its search", async ({ page }) => {
  await page.goto("/");
  const strip = page.locator("div", { has: page.getByText("Now covering", { exact: true }) }).last();
  for (const town of ["Blackpool", "Fleetwood", "Windermere", "Keswick", "Ambleside"]) {
    // .first() - the list is drawn twice for the seamless loop (the copy is hidden from assistive tech).
    await expect(strip.getByRole("link", { name: town, exact: true }).first()).toBeAttached();
  }
  await page.goto("/");
  await page.getByRole("link", { name: "Windermere", exact: true }).first().click({ force: true });
  await expect(page).toHaveURL(/\/search\?city=Windermere$/);
  await expect(page.locator("#search-city")).toHaveValue("Windermere");
});
