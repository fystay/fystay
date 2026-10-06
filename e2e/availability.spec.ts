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

async function checkAvailability(
  page: Page,
  listingId: string,
  checkIn: Date,
  checkOut: Date,
): Promise<{ available: boolean; error?: string }> {
  const params = new URLSearchParams({
    checkIn: checkIn.toISOString(),
    checkOut: checkOut.toISOString(),
    guests: "1",
  });
  const res = await page.request.get(`/api/listings/${listingId}/availability?${params}`);
  return res.json();
}

test.describe("availability system", () => {
  let listingId: string;
  // Kept close together (a few months out) rather than spread across years:
  // every date in this file only needs to avoid colliding with another date
  // in this same file's own isolated fixture listing, and each calendar
  // navigation in the tests below has to click "Next Month" once per month
  // of distance, which gets slow (and flake-prone under CI-like
  // concurrency) if these are placed a year or more out.
  const bookedCheckIn = addDays(60);
  const bookedCheckOut = addDays(65);

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const listing = await prisma.listing.create({
      data: {
        title: "E2E fixture: availability listing",
        description: "Temporary listing for testing the availability and calendar system.",
        city: "AvailabilityTestCity",
        country: "England",
        pricePerNightCents: 10000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;

    await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: host.id,
        checkIn: bookedCheckIn,
        checkOut: bookedCheckOut,
        guests: 1,
        nights: 5,
        nightlyPriceCents: 10000,
        totalPriceCents: 55000,
        status: "CONFIRMED",
        paymentStatus: "PAID",
      },
    });
  });

  test.afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.availabilityBlock.deleteMany({ where: { listingId } });
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.$disconnect();
  });

  test("1. an available range with no conflicting bookings or blocks checks out as available", async ({
    page,
  }) => {
    const result = await checkAvailability(page, listingId, addDays(100), addDays(103));
    expect(result.available).toBe(true);
  });

  test("2. a range fully inside an existing booking is fully booked and unavailable", async ({
    page,
  }) => {
    const result = await checkAvailability(page, listingId, addDays(61), addDays(64));
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/not available/i);
  });

  test("3. a range partially overlapping an existing booking is unavailable", async ({ page }) => {
    const result = await checkAvailability(page, listingId, addDays(58), addDays(62));
    expect(result.available).toBe(false);
  });

  test("4. attempting to actually create a booking for overlapping dates is rejected server-side", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");

    const res = await page.request.post("/api/bookings", {
      data: {
        listingId,
        checkIn: addDays(62).toISOString(),
        checkOut: addDays(67).toISOString(),
        guests: 1,
      },
    });

    expect(res.status()).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/not available/i);
  });

  test("5. a host can manually block a range of dates, and it becomes unavailable to guests", async ({
    page,
  }, testInfo) => {
    // /host/listings/[id]/calendar is a brand-new route; a dev server
    // compiling it on first hit, plus several sequential month-navigation
    // clicks after that, can comfortably exceed the default 30s budget.
    testInfo.setTimeout(60_000);

    await login(page, "host@fystay.dev", "hostpass123");
    await page.goto(`/host/listings/${listingId}/calendar`);

    const blockStart = addDays(120);
    const blockEnd = addDays(123);
    const monthsAdvanced = await selectDay(page, blockStart, 0);
    await selectDay(page, blockEnd, monthsAdvanced);

    await page.fill("#blockReason", "Maintenance");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/blocks") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Block selected dates" }).click(),
    ]);

    await expect(page.getByText("Maintenance")).toBeVisible({ timeout: 15_000 });

    const result = await checkAvailability(page, listingId, blockStart, blockEnd);
    expect(result.available).toBe(false);
  });

  test("6. a host can unblock previously blocked dates, making them bookable again", async ({
    page,
  }, testInfo) => {
    // Same cold-route-compile margin as test 5, in case this is the first
    // hit to /host/listings/[id]/calendar in this run.
    testInfo.setTimeout(60_000);

    const unblockStart = addDays(140);
    const unblockEnd = addDays(143);
    const block = await prisma.availabilityBlock.create({
      data: { listingId, startDate: unblockStart, endDate: unblockEnd, reason: "Owner stay" },
    });

    await login(page, "host@fystay.dev", "hostpass123");
    await page.goto(`/host/listings/${listingId}/calendar`);

    // Scoped to this block's own row: test 5 (running concurrently against
    // the same fixture listing) may have already created its own block, so
    // an unscoped "Unblock" button match is ambiguous once more than one
    // block is on the calendar.
    const ownerStayRow = page.locator("li", { hasText: "Owner stay" });
    await expect(ownerStayRow).toBeVisible({ timeout: 15_000 });
    await ownerStayRow.getByRole("button", { name: "Unblock" }).click();

    const confirmDialog = page.getByRole("dialog", { name: "Unblock these dates" });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/blocks/${block.id}`) && r.request().method() === "DELETE",
      ),
      confirmDialog.getByRole("button", { name: "Unblock" }).click(),
    ]);

    await expect(page.getByText("Owner stay")).toHaveCount(0);

    const result = await checkAvailability(page, listingId, unblockStart, unblockEnd);
    expect(result.available).toBe(true);
  });

  test("7. booking fails with a clear message if the dates are taken after the guest chose them", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/listings/${listingId}`);

    const raceCheckIn = addDays(160);
    const raceCheckOut = addDays(163);

    await page.getByRole("button", { name: "Add dates" }).click();
    const monthsAdvanced = await selectDay(page, raceCheckIn, 0);
    await selectDay(page, raceCheckOut, monthsAdvanced);

    // One press from chosen dates to checkout - no separate check step.
    await expect(page.getByRole("button", { name: "Reserve your stay" })).toBeVisible({
      timeout: 15_000,
    });

    // Someone else books the exact same dates in the meantime.
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const racingBooking = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: host.id,
        checkIn: raceCheckIn,
        checkOut: raceCheckOut,
        guests: 1,
        nights: 3,
        nightlyPriceCents: 10000,
        totalPriceCents: 33000,
        status: "CONFIRMED",
        paymentStatus: "PAID",
      },
    });

    try {
      await page.getByRole("button", { name: "Reserve your stay" }).click();

      // Scoped to the widget itself: the same message is also shown in a
      // toast notification, which would otherwise make this an ambiguous
      // match for a plain page-wide text locator.
      await expect(page.locator("#booking-widget").getByText(/not available/i)).toBeVisible();
      // The server's own check catches it: no checkout, and the guest can
      // simply pick other dates and press Reserve again.
      expect(page.url()).not.toContain("/checkout/");
      await expect(page.getByRole("button", { name: "Reserve your stay" })).toBeEnabled();
    } finally {
      await prisma.booking.delete({ where: { id: racingBooking.id } });
    }
  });
});
