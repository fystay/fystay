import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateBookingReference } from "../src/lib/bookingReference";

// What happens to reservations that never become stays, and to cancelled
// paid ones: an abandoned checkout is closed off (credit returned, not shown
// as a trip), and a cancelled stay says exactly what was refunded.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
// Its own guest, not the shared guest@fystay.dev: the abandoned-checkout test
// changes the guest's credit balance, which a booking test running alongside
// would otherwise pick up at checkout.
const GUEST_PASSWORD = "lifecycleguest123";

function addDays(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("booking lifecycle", () => {
  let listingId: string;
  let listingTitle: string;
  let guestId: string;
  let guestEmail: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const suffix = generateBookingReference().toLowerCase();
    guestEmail = `e2e-lifecycle-guest-${suffix}@fystay.dev`;
    const guest = await prisma.user.create({
      data: {
        email: guestEmail,
        name: "Lifecycle Guest",
        passwordHash: await bcrypt.hash(GUEST_PASSWORD, 10),
        role: "GUEST",
        referralCode: `LIFE${suffix}`,
      },
    });
    guestId = guest.id;
    listingTitle = `E2E fixture: lifecycle listing ${suffix}`;
    const listing = await prisma.listing.create({
      data: {
        title: listingTitle,
        description: "Temporary listing for booking lifecycle tests.",
        city: "LifecycleTestCity",
        country: "England",
        pricePerNightCents: 10000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId: host.id,
        cancellationPolicy: "MODERATE",
      },
    });
    listingId = listing.id;
  });

  test.afterAll(async () => {
    if (listingId) {
      await prisma.booking.deleteMany({ where: { listingId } });
      await prisma.listing.delete({ where: { id: listingId } });
    }
    if (guestEmail) await prisma.user.deleteMany({ where: { email: guestEmail } });
    await prisma.$disconnect();
  });

  test("a reservation left unpaid is closed off: credit back, not a trip, and its page explains", async ({ page }) => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: guestId }, select: { creditBalanceCents: true } });
    const abandoned = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId,
        checkIn: addDays(500),
        checkOut: addDays(502),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        creditAppliedCents: 500,
        totalPriceCents: 21500,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });
    // Reserved two hours ago and never touched since - past the date hold
    // and any payment page's life.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.$executeRaw`UPDATE "Booking" SET "createdAt" = ${twoHoursAgo}, "updatedAt" = ${twoHoursAgo} WHERE id = ${abandoned.id}`;

    await login(page, guestEmail, GUEST_PASSWORD);
    await page.goto("/bookings");
    await expect(page.getByRole("heading", { name: "My trips" })).toBeVisible();
    await expect(page.getByText(abandoned.reference)).toHaveCount(0);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: abandoned.id } });
    expect(after.status).toBe("CANCELLED");
    const credit = await prisma.user.findUniqueOrThrow({ where: { id: guestId }, select: { creditBalanceCents: true } });
    expect(credit.creditBalanceCents).toBe(before.creditBalanceCents + 500);

    // An old link to it, or to its checkout or confirmation, explains it rather than offering to pay.
    for (const path of [`/bookings/${abandoned.id}`, `/checkout/${abandoned.id}`, `/bookings/${abandoned.id}/confirmation`]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/bookings/${abandoned.id}$`));
      await expect(page.getByText("This reservation wasn't completed")).toBeVisible();
      await expect(page.getByText("You haven't been charged.")).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Book again" })).toHaveAttribute(
      "href",
      new RegExp(`/listings/${listingId}\\?checkIn=`),
    );

  });

  test("an unpaid booking's confirmation page sends the guest to pay, not to a payment that never happened", async ({
    page,
  }) => {
    const pending = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId,
        checkIn: addDays(510),
        checkOut: addDays(512),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });

    await login(page, guestEmail, GUEST_PASSWORD);
    await page.goto(`/bookings/${pending.id}/confirmation`);
    await expect(page).toHaveURL(new RegExp(`/checkout/${pending.id}$`));
    await expect(page.getByRole("heading", { name: "Confirm and pay" })).toBeVisible();
    await expect(page.getByText(/holding these dates for you until \d\d:\d\d/)).toBeVisible();

    // Coming back from Stripe, it waits for the payment to be confirmed instead.
    await page.goto(`/bookings/${pending.id}/confirmation?success=1`);
    await expect(page.getByText("Confirming your payment…")).toBeVisible();
  });

  test("a cancelled paid stay says how much was refunded and when it arrives", async ({ page }) => {
    const refundedAt = new Date();
    const cancelled = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId,
        checkIn: addDays(520),
        checkOut: addDays(522),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "CANCELLED",
        paymentStatus: "PARTIALLY_REFUNDED",
        paidAt: new Date(),
        refundedAt,
        refundedAmountCents: 11000,
      },
    });

    await login(page, guestEmail, GUEST_PASSWORD);
    await page.goto(`/bookings/${cancelled.id}`);
    await expect(page.getByText("This booking was cancelled")).toBeVisible();
    await expect(page.getByText(/£110 of the £220 you paid was refunded to your original payment method/)).toBeVisible();
    await expect(page.getByText(/usually take 5-10 working days/)).toBeVisible();
  });
});
