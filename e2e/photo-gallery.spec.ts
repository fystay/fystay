import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

function svgDataUri(w: number, h: number, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

test.describe("photo gallery lightbox", () => {
  let listingId: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const listing = await prisma.listing.create({
      data: {
        title: "E2E fixture: photo gallery listing",
        description: "Temporary listing for testing the swipeable photo lightbox.",
        city: "GalleryE2ECity",
        country: "England",
        pricePerNightCents: 10000,
        maxGuests: 4,
        // Mixed aspect ratios (landscape, portrait, square) to exercise
        // object-contain sizing without stretching any of them.
        photos: [
          svgDataUri(1200, 900, "#0d9488"),
          svgDataUri(900, 1200, "#b45309"),
          svgDataUri(800, 800, "#9f1239"),
          svgDataUri(1200, 900, "#4f46e5"),
        ],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;
  });

  test.afterAll(async () => {
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.$disconnect();
  });

  test("clicking a thumbnail opens the lightbox with arrow navigation and a counter", async ({
    page,
  }) => {
    await page.goto(`/listings/${listingId}`);

    // The first photo is the page's hero; each tile under it opens the
    // lightbox at its own photo (the second photo is the first tile).
    await page.locator('[data-testid="gallery-tile"]').first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("span").first()).toHaveText("2 / 4");

    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(dialog.locator("span").first()).toHaveText("3 / 4");
    await page.getByRole("button", { name: "Previous photo" }).click();
    await expect(dialog.locator("span").first()).toHaveText("2 / 4");

    // Past the last photo it comes round to the first.
    await page.getByRole("button", { name: "Next photo" }).click();
    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(dialog.locator("span").first()).toHaveText("4 / 4");
    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(dialog.locator("span").first()).toHaveText("1 / 4");

    // Images render without distortion regardless of their own aspect ratio.
    const objectFit = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('[role="dialog"] img'));
      const visible = imgs.find((img) => img.getBoundingClientRect().width > 0);
      return visible ? getComputedStyle(visible).objectFit : null;
    });
    expect(objectFit).toBe("contain");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Escape closes the lightbox", async ({ page }) => {
    await page.goto(`/listings/${listingId}`);
    await page.locator('[data-testid="gallery-tile"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("swiping on a touch device navigates between photos", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    try {
      await page.goto(`/listings/${listingId}`);
      await page.locator('[data-testid="gallery-tile"]').first().click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("span").first()).toHaveText("2 / 4");

      const swipeZone = dialog.locator(".touch-none");
      const box = (await swipeZone.boundingBox())!;
      const y = box.y + box.height / 2;

      // A left-drag (finger moves right-to-left) advances to the next photo.
      await page.mouse.move(box.x + box.width * 0.8, y);
      await page.mouse.down();
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(box.x + box.width * (0.8 - 0.6 * (step / 8)), y);
      }
      await page.mouse.up();

      await expect(dialog.locator("span").first()).toHaveText("3 / 4");
    } finally {
      await context.close();
    }
  });
});
