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

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  // Wherever login lands (a host goes to their dashboard, a guest home).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("checkout and payment", () => {
  let listingId: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const listing = await prisma.listing.create({
      data: {
        title: "E2E fixture: checkout listing",
        description: "Temporary listing for testing checkout and payment.",
        city: "CheckoutTestCity",
        country: "England",
        pricePerNightCents: 12000,
        cleaningFeeCents: 3000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;
  });

  test.afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.$disconnect();
  });

  async function createPendingBooking(offsetDays: number) {
    const checkIn = addDays(offsetDays);
    const checkOut = addDays(offsetDays + 2);
    const guest = await prisma.user.findUniqueOrThrow({ where: { email: "guest@fystay.dev" } });
    // 2 nights @ £120 = £240 subtotal + £30 cleaning + 10% service (£24) = £294.
    return prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: guest.id,
        checkIn,
        checkOut,
        guests: 2,
        nights: 2,
        nightlyPriceCents: 12000,
        cleaningFeeCents: 3000,
        serviceFeeCents: 2400,
        totalPriceCents: 29400,
        status: "PENDING",
      },
    });
  }

  test("checkout page shows the full price breakdown, guest count, and a secure-payment CTA", async ({
    page,
  }) => {
    const booking = await createPendingBooking(300);
    try {
      await login(page, "guest@fystay.dev", "guestpass123");
      await page.goto(`/checkout/${booking.id}`);

      await expect(page.getByRole("heading", { name: "Confirm and pay" })).toBeVisible();
      await expect(page.getByText("Cleaning fee")).toBeVisible();
      await expect(page.getByText("Service fee")).toBeVisible();
      await expect(page.getByText("Total (GBP)")).toBeVisible();
      await expect(page.getByText("£294").first()).toBeVisible();
      await expect(page.getByText("2 guests").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Pay securely/ }).first()).toBeVisible();
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  test("a cancelled Stripe payment shows a clear banner and lets the guest retry", async ({
    page,
  }) => {
    const booking = await createPendingBooking(310);
    try {
      await login(page, "guest@fystay.dev", "guestpass123");
      await page.goto(`/checkout/${booking.id}?cancelled=1`);

      await expect(page.getByText(/Payment was cancelled/i)).toBeVisible();
      // Still able to retry: the form and pay button are still there, not
      // replaced by an error state.
      await expect(page.getByRole("button", { name: /Pay securely/ }).first()).toBeVisible();
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  test("a duplicate payment attempt on an already-processed booking is rejected", async ({
    page,
  }) => {
    const booking = await createPendingBooking(320);
    try {
      await login(page, "guest@fystay.dev", "guestpass123");

      const first = await page.request.post("/api/checkout", {
        data: { bookingId: booking.id, guestName: "Jamie Guest", guestEmail: "guest@fystay.dev", guestPhone: "07700 000000" },
      });
      expect(first.ok()).toBe(true);
      const firstData = await first.json();
      expect(firstData.url).toContain("dev_confirmed=1");

      // Re-submitting (double-click, a second tab) must not process payment twice.
      const second = await page.request.post("/api/checkout", {
        data: { bookingId: booking.id, guestName: "Jamie Guest", guestEmail: "guest@fystay.dev", guestPhone: "07700 000000" },
      });
      expect(second.status()).toBe(409);
      const secondData = await second.json();
      expect(secondData.error).toMatch(/already been processed/i);
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  test("the confirmation page shows guest details and payment status after a successful payment", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");

    const checkoutRes = await page.request.post("/api/bookings", {
      data: {
        listingId,
        checkIn: addDays(330).toISOString(),
        checkOut: addDays(332).toISOString(),
        guests: 2,
      },
    });
    expect(checkoutRes.ok()).toBe(true);
    const { booking } = await checkoutRes.json();

    const payRes = await page.request.post("/api/checkout", {
      data: {
        bookingId: booking.id,
        guestName: "Jamie Guest",
        guestEmail: "guest@fystay.dev",
        guestPhone: "07700 123456",
      },
    });
    const { url } = await payRes.json();

    await page.goto(url);

    // Scoped to the main content: the navbar's own account menu shows the
    // same logged-in guest's name, which would otherwise make an unscoped
    // match ambiguous.
    const main = page.locator("#main-content");
    await expect(main.getByText("Booking confirmed!")).toBeVisible();
    await expect(main.getByText("Guest details")).toBeVisible();
    await expect(main.getByText("Jamie Guest")).toBeVisible();
    await expect(main.getByText("07700 123456")).toBeVisible();
    await expect(main.getByText("Paid", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "View booking" })).toHaveAttribute("href", `/bookings/${booking.id}`);
    // Where it stands on cancellation, and who the host is, without leaving the page.
    await expect(main.getByText(/Free cancellation until|refund if you cancel by|non-refundable/)).toBeVisible();
    await expect(main.getByText(/^Hosted by /)).toBeVisible();
  });
});
