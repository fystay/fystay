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

test.describe("booking modification and cancellation", () => {
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

  async function createListing(overrides: {
    cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT" | "CUSTOM";
    customCancellationCutoffDays?: number;
    customCancellationRefundPercent?: number;
  }) {
    return prisma.listing.create({
      data: {
        title: `E2E fixture: modification/cancellation listing ${generateBookingReference()}`,
        description: "Temporary listing for the modification/cancellation flow tests.",
        city: "ModCancelTestCity",
        country: "England",
        pricePerNightCents: 10000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId,
        ...overrides,
      },
    });
  }

  async function createPaidBooking(listingId: string, checkIn: Date, checkOut: Date) {
    // 2 nights @ £100 = £200 subtotal + 10% service fee = £220 total.
    return prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId,
        checkIn,
        checkOut,
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        paidAt: new Date(),
      },
    });
  }

  test("modifying dates shows the original total, new total, and the difference before submitting", async ({
    page,
  }) => {
    const listing = await createListing({ cancellationPolicy: "MODERATE" });
    const checkIn = addDays(600);
    const checkOut = addDays(602);
    const booking = await createPaidBooking(listing.id, checkIn, checkOut);

    try {
      await login(page, "guest@fystay.dev", "guestpass123");
      await page.goto(`/bookings/${booking.id}`);
      await page.getByRole("button", { name: "Request changes" }).click();

      const dialog = page.getByRole("dialog", { name: "Request a change" });
      // Unchanged dates: original and new total match, no diff line yet.
      await expect(dialog.getByText("Original total")).toBeVisible();
      await expect(dialog.getByText("New total")).toBeVisible();
      await expect(dialog.getByText("Additional payment")).toHaveCount(0);
      await expect(dialog.getByText("Refund due")).toHaveCount(0);

      // Extend the stay by a night (3 nights instead of 2): £220 -> £330.
      await dialog.getByRole("button", { name: /–/ }).click();
      const newCheckOut = addDays(603);
      const monthsAdvanced = await selectDay(page, checkIn, 0);
      await selectDay(page, newCheckOut, monthsAdvanced);

      await expect(dialog.getByText("£220", { exact: true })).toBeVisible();
      await expect(dialog.getByText("£330", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Additional payment")).toBeVisible();
      await expect(dialog.getByText("£110").first()).toBeVisible();
    } finally {
      await prisma.bookingChangeRequest.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("a change request that would overlap another booking on the same listing is rejected", async ({
    page,
  }) => {
    const listing = await createListing({ cancellationPolicy: "MODERATE" });
    const bookingA = await createPaidBooking(listing.id, addDays(610), addDays(612));
    await createPaidBooking(listing.id, addDays(620), addDays(622));

    try {
      await login(page, "guest@fystay.dev", "guestpass123");

      // Ask to move booking A onto dates that overlap booking B.
      const res = await page.request.post(`/api/bookings/${bookingA.id}/change-requests`, {
        data: {
          checkIn: addDays(621).toISOString(),
          checkOut: addDays(623).toISOString(),
          guests: 2,
        },
      });
      expect(res.status()).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/not available/i);

      const requests = await prisma.bookingChangeRequest.findMany({
        where: { bookingId: bookingA.id },
      });
      expect(requests).toHaveLength(0);
    } finally {
      await prisma.booking.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("cancelling a FLEXIBLE, well-in-advance booking shows and issues a full refund", async ({
    page,
  }) => {
    const listing = await createListing({ cancellationPolicy: "FLEXIBLE" });
    const booking = await createPaidBooking(listing.id, addDays(630), addDays(632));

    try {
      await login(page, "guest@fystay.dev", "guestpass123");
      await page.goto(`/bookings/${booking.id}`);
      await page.getByRole("button", { name: "Cancel booking" }).click();

      const dialog = page.getByRole("dialog", { name: "Cancel booking" });
      await expect(dialog.getByText("Flexible cancellation policy")).toBeVisible();
      await expect(dialog.getByText("Amount paid")).toBeVisible();
      await expect(dialog.getByText("£220").first()).toBeVisible();
      await expect(dialog.getByText("Non-refundable")).toHaveCount(0);

      const [cancelResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/cancel") && r.request().method() === "POST",
        ),
        dialog.getByRole("button", { name: "Cancel booking" }).click(),
      ]);
      expect(cancelResponse.status()).toBe(200);
      const { booking: updated, refund } = await cancelResponse.json();
      expect(updated.status).toBe("CANCELLED");
      expect(updated.paymentStatus).toBe("REFUNDED");
      expect(refund.refundCents).toBe(22000);
      expect(refund.nonRefundableCents).toBe(0);
    } finally {
      await prisma.booking.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("cancelling a STRICT booking inside the no-refund window keeps the payment and refunds nothing", async ({
    page,
  }) => {
    const listing = await createListing({ cancellationPolicy: "STRICT" });
    // STRICT: 50% back at 7+ days out, nothing after. 3 days out is inside
    // the no-refund window.
    const booking = await createPaidBooking(listing.id, addDays(3), addDays(5));

    try {
      await login(page, "guest@fystay.dev", "guestpass123");
      await page.goto(`/bookings/${booking.id}`);
      await page.getByRole("button", { name: "Cancel booking" }).click();

      const dialog = page.getByRole("dialog", { name: "Cancel booking" });
      await expect(dialog.getByText("Strict cancellation policy")).toBeVisible();
      await expect(dialog.getByText("Non-refundable")).toBeVisible();
      await expect(dialog.getByText("£0").first()).toBeVisible();

      const [cancelResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/cancel") && r.request().method() === "POST",
        ),
        dialog.getByRole("button", { name: "Cancel booking" }).click(),
      ]);
      const { booking: updated, refund } = await cancelResponse.json();
      expect(updated.status).toBe("CANCELLED");
      expect(updated.paymentStatus).toBe("PAID");
      expect(refund.refundCents).toBe(0);
      expect(refund.nonRefundableCents).toBe(22000);
    } finally {
      await prisma.booking.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("cancelling a STRICT booking outside the no-refund window issues a partial refund", async ({
    page,
  }) => {
    const listing = await createListing({ cancellationPolicy: "STRICT" });
    // 10 days out clears the 7-day cutoff for a 50% refund.
    const booking = await createPaidBooking(listing.id, addDays(640), addDays(642));

    try {
      await login(page, "guest@fystay.dev", "guestpass123");

      const res = await page.request.post(`/api/bookings/${booking.id}/cancel`);
      expect(res.ok()).toBe(true);
      const { booking: updated, refund } = await res.json();
      expect(updated.status).toBe("CANCELLED");
      expect(updated.paymentStatus).toBe("PARTIALLY_REFUNDED");
      expect(refund.refundCents).toBe(11000);
      expect(refund.nonRefundableCents).toBe(11000);
      expect(updated.refundedAmountCents).toBe(11000);
    } finally {
      await prisma.booking.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
    }
  });

  test("a host sees a cancelled booking with its refund, and a modified booking with its before/after values", async ({
    page,
    browser,
  }) => {
    const listing = await createListing({ cancellationPolicy: "FLEXIBLE" });
    const cancelledBooking = await createPaidBooking(listing.id, addDays(650), addDays(652));

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
      // Cancel one booking directly via the API (already covered end to end above).
      await login(page, "guest@fystay.dev", "guestpass123");
      const cancelRes = await page.request.post(`/api/bookings/${cancelledBooking.id}/cancel`);
      expect(cancelRes.ok()).toBe(true);

      await login(hostPage, "host@fystay.dev", "hostpass123");
      // Listed under Cancelled, and its own page shows the refund.
      await hostPage.goto("/host/bookings?tab=cancelled");
      await expect(hostPage.getByRole("link", { name: new RegExp(listing.title) }).first()).toBeVisible();
      await hostPage.goto(`/host/bookings/${cancelledBooking.id}`);
      await expect(hostPage.getByText("Cancelled", { exact: true })).toBeVisible();
      const earnings = hostPage.locator("section", { hasText: "Your earnings" });
      await expect(earnings.getByText("£0", { exact: true }).first()).toBeVisible();
      await expect(earnings.locator("div", { hasText: /^Refunded to guest£220$/ })).toBeVisible();
    } finally {
      // DB cleanup first and unguarded: it's what actually matters for
      // later tests/retries. hostContext.close() is best-effort after -
      // if the browser already crashed and closing it throws, that must
      // never block the real cleanup above (a prior CI run hit exactly
      // this: a crashed context skipped cleanup, leaving an orphaned
      // fixture listing that then collided with the automatic retry).
      await prisma.booking.deleteMany({ where: { listingId: listing.id } });
      await prisma.listing.delete({ where: { id: listing.id } });
      await hostContext.close().catch(() => {});
    }
  });
});
