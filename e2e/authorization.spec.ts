import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateBookingReference } from "../src/lib/bookingReference";

// Server-side authorization, tested by going straight to URLs and APIs - a
// hidden button is not security. Signed in as one guest, nothing belonging
// to another guest, another host, or an admin may be reachable.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "otherguestpass123";

function addDays(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Visits a page that may redirect straight away (which interrupts the original navigation). */
async function visit(page: Page, path: string) {
  await page.goto(path).catch(() => {});
  await page.waitForLoadState("domcontentloaded");
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("authorization by direct URL", () => {
  const suffix = generateBookingReference().toLowerCase();
  const otherGuestEmail = `e2e-other-guest-${suffix}@fystay.dev`;
  const otherHostEmail = `e2e-other-host-${suffix}@fystay.dev`;
  let otherGuestId: string;
  let listingId: string;
  let otherBookingId: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const otherGuest = await prisma.user.create({
      data: { email: otherGuestEmail, name: "Other Guest", passwordHash, role: "GUEST", referralCode: `AUTHG${suffix}` },
    });
    await prisma.user.create({
      data: { email: otherHostEmail, name: "Other Host", passwordHash, role: "HOST", referralCode: `AUTHH${suffix}` },
    });
    otherGuestId = otherGuest.id;
    const listing = await prisma.listing.create({
      data: {
        title: `E2E fixture: authorization listing ${suffix}`,
        description: "Temporary listing for authorization tests.",
        city: "AuthTestCity",
        country: "England",
        address: "9 Private Road, AuthTestCity",
        pricePerNightCents: 10000,
        maxGuests: 2,
        photos: [],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;
    const booking = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: otherGuestId,
        checkIn: addDays(540),
        checkOut: addDays(542),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        paidAt: new Date(),
        guestName: "Other Guest",
        guestEmail: otherGuestEmail,
        guestPhone: "07700 999888",
      },
    });
    otherBookingId = booking.id;
  });

  test.afterAll(async () => {
    if (listingId) {
      await prisma.booking.deleteMany({ where: { listingId } });
      await prisma.listing.delete({ where: { id: listingId } });
    }
    await prisma.user.deleteMany({ where: { email: { in: [otherGuestEmail, otherHostEmail] } } });
    await prisma.$disconnect();
  });

  test("a guest can't open, pay for or cancel another guest's booking", async ({ page }) => {
    await login(page, "guest@fystay.dev", "guestpass123");

    for (const path of [
      `/bookings/${otherBookingId}`,
      `/bookings/${otherBookingId}/receipt`,
      `/bookings/${otherBookingId}/confirmation`,
      `/checkout/${otherBookingId}`,
    ]) {
      await visit(page, path);
      // Next streams the page, so "not found" can arrive after a 200 status -
      // what matters is the not-found page and none of the booking's data.
      await expect(page.getByRole("heading", { name: "We can't find that page" }), path).toBeVisible();
      await expect(page.getByText("Other Guest")).toHaveCount(0);
      await expect(page.getByText("07700 999888")).toHaveCount(0);
      await expect(page.getByText("9 Private Road")).toHaveCount(0);
    }

    const read = await page.request.get(`/api/bookings/${otherBookingId}`);
    expect([403, 404]).toContain(read.status());
    const cancel = await page.request.post(`/api/bookings/${otherBookingId}/cancel`);
    expect([403, 404]).toContain(cancel.status());
    const pay = await page.request.post("/api/checkout", { data: { bookingId: otherBookingId } });
    expect([403, 404]).toContain(pay.status());

    const unchanged = await prisma.booking.findUniqueOrThrow({ where: { id: otherBookingId } });
    expect(unchanged.status).toBe("CONFIRMED");
    expect(unchanged.paymentStatus).toBe("PAID");
  });

  test("a guest can't reach host or admin pages and APIs", async ({ page }) => {
    await login(page, "guest@fystay.dev", "guestpass123");

    await visit(page, "/host/dashboard");
    await expect(page).not.toHaveURL(/\/host\/dashboard/);
    await visit(page, `/host/listings/${listingId}/edit`);
    await expect(page.getByText("9 Private Road")).toHaveCount(0);
    await visit(page, "/admin");
    await expect(page).not.toHaveURL(/\/admin/);
    await visit(page, `/admin/bookings/${otherBookingId}`);
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByText("07700 999888")).toHaveCount(0);

    const adminApi = await page.request.get("/api/admin/bookings");
    expect([401, 403]).toContain(adminApi.status());
    const edit = await page.request.patch(`/api/listings/${listingId}`, { data: { title: "Taken over" } });
    expect([401, 403, 404]).toContain(edit.status());
  });

  test("one host can't see or change another host's listing", async ({ page }) => {
    await login(page, otherHostEmail, PASSWORD);

    await visit(page, `/host/listings/${listingId}/edit`);
    await expect(page.getByText("9 Private Road")).toHaveCount(0);
    await visit(page, `/host/listings/${listingId}/calendar`);
    await expect(page.getByText("Other Guest")).toHaveCount(0);

    const edit = await page.request.patch(`/api/listings/${listingId}`, { data: { title: "Taken over" } });
    expect([403, 404]).toContain(edit.status());
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.title).not.toBe("Taken over");
  });

  test("signed out, private pages ask for a login and private APIs refuse", async ({ page }) => {
    for (const path of ["/bookings", `/bookings/${otherBookingId}`, "/wishlist", "/account", "/inbox"]) {
      await visit(page, path);
      await expect(page, path).toHaveURL(/\/login\?callbackUrl=/);
    }
    expect((await page.request.get("/api/bookings")).status()).toBe(401);
    expect((await page.request.get(`/api/bookings/${otherBookingId}`)).status()).toBe(401);
    expect((await page.request.post("/api/wishlist", { data: { listingId } })).status()).toBe(401);
  });
});
