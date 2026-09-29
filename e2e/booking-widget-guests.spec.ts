import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

test("booking widget's guest picker matches the listing's capacity and pet policy", async ({
  page,
}) => {
  const petFriendly = await prisma.listing.findFirstOrThrow({
    where: { published: true, amenities: { has: "Pet friendly" } },
  });
  const notPetFriendly = await prisma.listing.findFirstOrThrow({
    where: { published: true, NOT: { amenities: { has: "Pet friendly" } } },
  });

  try {
    await page.goto(`/listings/${notPetFriendly.id}`);
    await page.getByRole("button", { name: /Guests/ }).click();
    await expect(page.getByText("Adults")).toBeVisible();
    // Scoped to the picker: the listing's own facts list shows "Pets: Allowed"
    // for a pet-friendly place, which isn't what this test is about.
    const pickerPanel = page.locator("#guest-picker-panel");
    await expect(pickerPanel.getByText("Pets", { exact: true })).toHaveCount(0);

    await page.goto(`/listings/${petFriendly.id}`);
    await page.getByRole("button", { name: /Guests/ }).click();
    await expect(pickerPanel.getByText("Pets", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`This place has a maximum of ${petFriendly.maxGuests} guests.`),
    ).toBeVisible();

    // Push adults past the listing's capacity; the "+" button should disable at maxGuests.
    const increaseAdults = page.getByRole("button", { name: "Increase adults" });
    for (let i = 0; i < petFriendly.maxGuests + 2 && !(await increaseAdults.isDisabled()); i++) {
      await increaseAdults.click();
    }
    await expect(increaseAdults).toBeDisabled();
    await expect(page.getByRole("button", { name: /Guests/ })).toContainText(
      `${petFriendly.maxGuests} guests`,
    );
  } finally {
    await prisma.$disconnect();
  }
});
