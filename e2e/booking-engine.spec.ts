import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { generateBookingReference } from "../src/lib/bookingReference";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

function addDays(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/** The calendar popover opens showing the current month; step forward as needed and click the day. */
async function selectDay(page: Page, target: Date, monthsAlreadyAdvanced: number): Promise<number> {
  const monthsNeeded = monthsBetween(addDays(0), target);
  const stepsToTake = monthsNeeded - monthsAlreadyAdvanced;
  for (let i = 0; i < stepsToTake; i++) {
    await page.getByRole("button", { name: "Go to the Next Month" }).click();
  }
  await page.locator(`[data-day="${isoDate(target)}"] button`).click();
  return monthsAlreadyAdvanced + stepsToTake;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

test.describe("booking engine", () => {
  let listingId: string;
  let bookedCheckIn: Date;
  let bookedCheckOut: Date;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    bookedCheckIn = addDays(200);
    bookedCheckOut = addDays(203);

    const listing = await prisma.listing.create({
      data: {
        title: "E2E fixture: booking engine listing",
        description: "Temporary listing for testing pricing and availability.",
        city: "BookingEngineCity",
        country: "England",
        pricePerNightCents: 10000,
        cleaningFeeCents: 2500,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;

    // An existing CONFIRMED booking to collide with.
    await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId: listing.id,
        guestId: host.id,
        checkIn: bookedCheckIn,
        checkOut: bookedCheckOut,
        guests: 1,
        nights: 3,
        nightlyPriceCents: 10000,
        cleaningFeeCents: 2500,
        serviceFeeCents: 1000,
        totalPriceCents: 33500,
        status: "CONFIRMED",
        paymentStatus: "PAID",
      },
    });
  });

  test.afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.$disconnect();
  });

  test("shows the cleaning fee and service fee in the price breakdown, and carries them through to checkout", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/listings/${listingId}`);

    await page.getByRole("button", { name: "Add dates" }).click();
    const start = addDays(220);
    const end = addDays(222);
    const monthsAdvanced = await selectDay(page, start, 0);
    await selectDay(page, end, monthsAdvanced);

    // 2 nights @ £100 + £25 cleaning fee + 10% service fee (£20) = £245.
    await expect(page.getByText("Cleaning fee")).toBeVisible();
    await expect(page.getByText("£245").first()).toBeVisible();

    // Waiting on the actual response (rather than a short default
    // toBeVisible timeout) matters here: these are freshly-created routes a
    // dev server compiles on first hit, which under CI's parallel workers
    // can comfortably exceed a 5s default.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/availability") && r.request().method() === "GET"),
      page.getByRole("button", { name: "Check dates & price" }).click(),
    ]);
    await expect(page.getByRole("button", { name: "Reserve your stay" })).toBeVisible({
      timeout: 15_000,
    });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/bookings") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Reserve your stay" }).click(),
    ]);
    // Instant Book goes through the optional airport-transfer step first.
    await page.waitForURL(/\/checkout\/[^/]+\/transfer$/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Skip for now" }).click();
    await page.waitForURL(/\/checkout\/[^/]+$/, { timeout: 15_000 });

    await expect(page.getByText("Cleaning fee")).toBeVisible();
    await expect(page.getByText("Total (GBP)")).toBeVisible();
    await expect(page.getByText("£245").first()).toBeVisible();
  });

  test("the availability endpoint rejects dates that overlap an existing confirmed booking", async ({
    request,
  }) => {
    const params = new URLSearchParams({
      checkIn: bookedCheckIn.toISOString(),
      checkOut: bookedCheckOut.toISOString(),
      guests: "1",
    });
    const res = await request.get(`/api/listings/${listingId}/availability?${params}`);
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.error).toMatch(/not available/i);
  });

  test("the availability endpoint rejects a check-out date on or before check-in", async ({
    request,
  }) => {
    const day = addDays(210);
    const params = new URLSearchParams({
      checkIn: day.toISOString(),
      checkOut: day.toISOString(),
      guests: "1",
    });
    const res = await request.get(`/api/listings/${listingId}/availability?${params}`);
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.error).toMatch(/check-out date must be after check-in/i);
  });
});
