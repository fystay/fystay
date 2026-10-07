import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { generateBookingReference } from "../src/lib/bookingReference";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

test.describe("favourites / wishlist", () => {
  let hostId: string;
  let guestId: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const guest = await prisma.user.findUniqueOrThrow({ where: { email: "guest@fystay.dev" } });
    hostId = host.id;
    guestId = guest.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createListing() {
    return prisma.listing.create({
      data: {
        title: `E2E fixture: favourites listing ${generateBookingReference()}`,
        description: "Temporary listing for the favourites/wishlist flow tests.",
        city: "FavouritesTestCity",
        country: "England",
        propertyType: "VILLA",
        pricePerNightCents: 12000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId,
      },
    });
  }

  test("a logged-out visitor gets a friendly sign-in/create-account prompt, not a silent redirect", async ({
    page,
  }) => {
    const listing = await createListing();

    try {
      await page.goto(`/listings/${listing.id}`);

      // This is the very first interaction on a freshly-navigated page, with
      // nothing before it to incidentally buffer for React to finish
      // hydrating - the same pre-existing hydration race documented on the
      // homepage's "Dates" button in search-bar-dates.spec.ts, just landing
      // on a different first-clicked control here. Wrapping the click in a
      // retrying assertion means a mistimed first click - landing on the
      // server-rendered button before its onClick is attached - simply gets
      // retried once hydration is done, rather than failing the test.
      const saveButton = page.getByRole("button", { name: "Save to wishlist" });
      const dialog = page.getByRole("dialog", { name: "Save this stay" });
      await expect(async () => {
        await saveButton.click();
        await expect(dialog).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
      await expect(dialog.getByText(/Sign in or create a free account/)).toBeVisible();
      await expect(dialog.getByRole("link", { name: "Log in" })).toBeVisible();
      await expect(dialog.getByRole("link", { name: "Create account" })).toBeVisible();

      // The listing was never silently saved against no one.
      const saved = await prisma.savedListing.findMany({ where: { listingId: listing.id } });
      expect(saved).toHaveLength(0);

      // Following "Log in" takes them to the real login page, preserving
      // where they were so they land back on the property after signing in.
      await dialog.getByRole("link", { name: "Log in" }).click();
      await page.waitForURL(/\/login\?callbackUrl=/);
    } finally {
      await prisma.savedListing.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("a guest who signs up from the prompt lands back on the property, already saved", async ({ page }) => {
    const listing = await createListing();
    const email = `e2e-favourite-signup-${generateBookingReference()}@fystay.dev`.toLowerCase();

    try {
      await page.goto(`/listings/${listing.id}`);
      // Only one sign-in prompt exists, and only once it's asked for.
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const dialog = page.getByRole("dialog", { name: "Save this stay" });
      await expect(async () => {
        await page.getByRole("button", { name: "Save to wishlist" }).click();
        await expect(dialog).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
      await dialog.getByRole("link", { name: "Create account" }).click();
      await page.waitForURL(/\/register\?callbackUrl=/);

      await page.fill("#name", "New Favourite Fan");
      await page.fill("#email", email);
      await page.fill("#password", "newfanpass123");
      await page.getByRole("checkbox", { name: /I agree to/ }).check();
      await page.getByRole("button", { name: "Create account" }).click();

      await page.waitForURL(new RegExp(`/listings/${listing.id}$`));

      // The save they started finishes by itself - no second tap.
      await expect(page.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
      await expect
        .poll(async () => {
          const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
          return user ? prisma.savedListing.count({ where: { userId: user.id, listingId: listing.id } }) : 0;
        })
        .toBe(1);
    } finally {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.savedListing.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.savedListing.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("a logged-in guest can save from the property page and see it on My Favourites with its type, then remove it", async ({
    page,
  }) => {
    const listing = await createListing();
    await prisma.savedListing.deleteMany({ where: { userId: guestId, listingId: listing.id } });

    try {
      await page.goto("/login");
      await page.fill("#email", "guest@fystay.dev");
      await page.fill("#password", "guestpass123");
      await page.click("button[type=submit]");
      // Wherever login lands (a host goes to their dashboard, a guest home).
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));

      await page.goto(`/listings/${listing.id}`);
      // The heart flips straight away; wait for the save itself before
      // leaving the page, so what follows checks the stored result.
      const saved = page.waitForResponse((res) => res.url().endsWith("/api/wishlist") && res.request().method() === "POST");
      await page.getByRole("button", { name: "Save to wishlist" }).click();
      await expect(page.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
      expect((await saved).ok()).toBe(true);

      await page.goto("/wishlist");
      await expect(page.getByRole("heading", { name: "My Favourites" })).toBeVisible();
      await expect(page.getByText(listing.title)).toBeVisible();
      await expect(page.getByText("FavouritesTestCity, England")).toBeVisible();
      await expect(page.getByText("Villa", { exact: true })).toBeVisible();
      await expect(page.getByText("£120")).toBeVisible();

      // Clicking through the card returns to the property page.
      await page.getByText(listing.title).click();
      await page.waitForURL(new RegExp(`/listings/${listing.id}$`));

      // Real, DB-backed persistence: reloading the property page still
      // shows it saved (not a local-only, per-tab flag).
      await expect(page.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();

      // Remove it via the explicit Remove button on the favourites page.
      await page.goto("/wishlist");
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByText("Removed from wishlist")).toBeVisible();
      await expect(page.getByText("No saved stays yet")).toBeVisible();

      const remaining = await prisma.savedListing.findMany({
        where: { userId: guestId, listingId: listing.id },
      });
      expect(remaining).toHaveLength(0);
    } finally {
      await prisma.savedListing.deleteMany({ where: { userId: guestId, listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });
});
