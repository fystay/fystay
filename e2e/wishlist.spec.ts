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

test("guest can save a listing and unsave it from the wishlist page", async ({ page }) => {
  const guest = await prisma.user.findUniqueOrThrow({ where: { email: "guest@fystay.dev" } });
  // Anchored to the oldest published listing (one of the permanent seeded
  // ones), not just "any published listing": other specs create and delete
  // their own temporary listings concurrently, which could otherwise 404
  // this test mid-run the moment that other spec's cleanup deletes it.
  const listing = await prisma.listing.findFirstOrThrow({
    where: { published: true },
    orderBy: { createdAt: "asc" },
  });

  await prisma.savedListing.deleteMany({ where: { userId: guest.id, listingId: listing.id } });

  try {
    await page.goto("/login");
    await page.fill("#email", "guest@fystay.dev");
    await page.fill("#password", "guestpass123");
    await page.click("button[type=submit]");
    // Wherever login lands (a host goes to their dashboard, a guest home).
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto(`/listings/${listing.id}`);
    // The heart flips straight away; wait for the save itself before leaving the page.
    const saved = page.waitForResponse((res) => res.url().endsWith("/api/wishlist") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Save to wishlist" }).click();
    await expect(page.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
    expect((await saved).ok()).toBe(true);

    await page.goto("/wishlist");
    await expect(page.getByText(listing.title)).toBeVisible();

    await page.getByRole("button", { name: "Remove from wishlist" }).click();
    await expect(page.getByText("No saved stays yet")).toBeVisible();
  } finally {
    await prisma.savedListing.deleteMany({ where: { userId: guest.id, listingId: listing.id } });
    await prisma.$disconnect();
  }
});
