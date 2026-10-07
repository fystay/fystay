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
  // Wherever login lands (a host goes to their dashboard, a guest home).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("guest can request a date change, host approves, and guest pays the difference", async ({
  page,
  browser,
}) => {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
  const guest = await prisma.user.findUniqueOrThrow({ where: { email: "guest@fystay.dev" } });

  const listing = await prisma.listing.create({
    data: {
      title: "E2E fixture: booking change request listing",
      description: "Temporary listing for the change-request flow test.",
      city: "TestChangeCity",
      country: "England",
      pricePerNightCents: 10000,
      maxGuests: 4,
      photos: [],
      amenities: [],
      hostId: host.id,
    },
  });

  const checkIn = addDays(120);
  const checkOut = addDays(122); // 2 nights: £200 subtotal + 10% service fee = £220 total

  const booking = await prisma.booking.create({
    data: {
      reference: generateBookingReference(),
      listingId: listing.id,
      guestId: guest.id,
      checkIn,
      checkOut,
      guests: 2,
      nights: 2,
      nightlyPriceCents: 10000,
      serviceFeeCents: 2000,
      totalPriceCents: 22000,
      status: "CONFIRMED",
      paymentStatus: "PAID",
    },
  });

  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  try {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto("/bookings");

    await page
      .locator(".p-4", { hasText: "E2E fixture: booking change request listing" })
      .getByRole("button", { name: "Request changes" })
      .click();

    await page.getByRole("dialog", { name: "Request a change" }).getByRole("button", { name: /–/ }).click();

    // Extend the stay by a night (3 nights instead of 2), which costs more.
    const newCheckOut = addDays(123);
    const monthsAdvanced = await selectDay(page, checkIn, 0);
    await selectDay(page, newCheckOut, monthsAdvanced);

    // Scoped to the open dialog: this guest account accumulates other
    // bookings across the e2e suite, each with its own (closed) "Request a
    // change" dialog carrying similar preview text, so an unscoped
    // page-wide match is ambiguous once more than one exists in the DOM.
    const changeDialog = page.getByRole("dialog", { name: "Request a change" });
    await expect(changeDialog.getByText(/You'll owe an extra/)).toBeVisible();
    await page.getByRole("button", { name: "Submit request" }).click();

    // exact: true, since a toast ("Change requested. The host will review it
    // shortly.") transiently contains the same substring as the status badge.
    await expect(page.getByText("Change requested", { exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting host response")).toBeVisible();

    // Host reviews and approves the request.
    await login(hostPage, "host@fystay.dev", "hostpass123");
    // It's waiting under Bookings → Needs action, on the booking's own page.
    await hostPage.goto("/host/bookings?tab=action");
    await hostPage
      .getByRole("link", { name: /E2E fixture: booking change request listing/ })
      .first()
      .click();
    await hostPage.waitForURL(/\/host\/bookings\/.+/);
    await expect(hostPage.getByText("Date change requested")).toBeVisible();
    await expect(hostPage.getByText(/The guest pays £\d+ more/)).toBeVisible();
    const [respondResponse] = await Promise.all([
      hostPage.waitForResponse(
        (r) => r.url().includes("/respond") && r.request().method() === "POST",
      ),
      hostPage.getByRole("button", { name: "Approve" }).click(),
    ]);
    expect(respondResponse.status()).toBe(200);
    await expect(hostPage.getByText("Date change requested")).toHaveCount(0);

    // Guest pays the difference (dev mode: no Stripe keys, so it confirms immediately).
    await page.reload();
    await expect(page.getByRole("button", { name: /^Pay £/ })).toBeVisible();
    await page.getByRole("button", { name: /^Pay £/ }).click();
    await page.waitForURL(/dev_confirmed=1/, { timeout: 15_000 });

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    // 3 nights: £300 subtotal + 10% service fee = £330 total
    expect(finalBooking.totalPriceCents).toBe(33000);
    expect(finalBooking.checkOut.toISOString().slice(0, 10)).toBe(isoDate(newCheckOut));
  } finally {
    // DB cleanup first and unguarded: it's what actually matters for later
    // tests/retries. hostContext.close() is best-effort after - if the
    // browser already crashed and closing it throws, that must never
    // block the real cleanup above (this is exactly what happened in a
    // prior CI run: a crashed context skipped cleanup, leaving an
    // orphaned fixture listing that then collided with the automatic
    // retry's own freshly-created one of the same title).
    await prisma.bookingChangeRequest.deleteMany({ where: { bookingId: booking.id } });
    await prisma.booking.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
    await prisma.$disconnect();
    await hostContext.close().catch(() => {});
  }
});
