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
  await page.waitForURL("/");
}

test.describe("customer booking dashboard", () => {
  let listingId: string;
  let listingTitle: string;
  let confirmedId: string;
  let pendingId: string;
  let completedId: string;

  test.beforeAll(async () => {
    const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });
    const guest = await prisma.user.findUniqueOrThrow({ where: { email: "guest@fystay.dev" } });

    listingTitle = `E2E fixture: dashboard listing ${generateBookingReference()}`;
    const listing = await prisma.listing.create({
      data: {
        title: listingTitle,
        description: "Temporary listing for testing the customer booking dashboard.",
        city: "DashboardTestCity",
        country: "England",
        address: "1 Fixture Street, DashboardTestCity",
        pricePerNightCents: 10000,
        maxGuests: 4,
        photos: [],
        amenities: [],
        hostId: host.id,
      },
    });
    listingId = listing.id;

    // 2 nights @ £100 = £200 subtotal + 10% service fee = £220 total.
    const confirmed = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: guest.id,
        checkIn: addDays(450),
        checkOut: addDays(452),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        paidAt: new Date(),
        guestName: "Jamie Guest",
        guestEmail: "guest@fystay.dev",
        guestPhone: "07700 111222",
      },
    });
    confirmedId = confirmed.id;

    const pending = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: guest.id,
        checkIn: addDays(460),
        checkOut: addDays(462),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });
    pendingId = pending.id;

    const completed = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: guest.id,
        checkIn: addDays(-12),
        checkOut: addDays(-10),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "COMPLETED",
        paymentStatus: "PAID",
        paidAt: addDays(-13),
      },
    });
    completedId = completed.id;

    await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId,
        guestId: guest.id,
        checkIn: addDays(470),
        checkOut: addDays(472),
        guests: 2,
        nights: 2,
        nightlyPriceCents: 10000,
        serviceFeeCents: 2000,
        totalPriceCents: 22000,
        status: "REFUNDED",
        paymentStatus: "REFUNDED",
        paidAt: addDays(-1),
        refundedAt: new Date(),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.booking.deleteMany({ where: { listingId } });
    await prisma.listing.delete({ where: { id: listingId } });
    await prisma.$disconnect();
  });

  test("My trips sections show the real upcoming, past and cancelled bookings", async ({ page }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto("/bookings");

    // Upcoming is the default tab: both the confirmed and pending fixture
    // bookings belong here.
    const upcomingPanel = page.getByRole("tabpanel");
    await expect(upcomingPanel.getByText(listingTitle).first()).toBeVisible();
    await expect(upcomingPanel.getByText("Confirmed").first()).toBeVisible();
    await expect(upcomingPanel.getByText("Pending payment").first()).toBeVisible();

    await page.getByRole("tab", { name: /Past trips/ }).click();
    const pastPanel = page.getByRole("tabpanel");
    // .first(): a COMPLETED, unreviewed booking also gets a "Review {title}"
    // form heading repeating the listing title, so an unscoped match is ambiguous.
    await expect(pastPanel.getByText(listingTitle).first()).toBeVisible();
    await expect(pastPanel.getByText("Completed").first()).toBeVisible();

    await page.getByRole("tab", { name: /Cancelled/ }).click();
    const cancelledPanel = page.getByRole("tabpanel");
    await expect(cancelledPanel.getByText(listingTitle)).toBeVisible();
    await expect(cancelledPanel.getByText("Refunded").first()).toBeVisible();
  });

  test("a confirmed, paid, upcoming booking's detail page shows full stay info and every applicable action", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/bookings/${confirmedId}`);

    const main = page.locator("#main-content");
    await expect(main.getByRole("heading", { name: listingTitle })).toBeVisible();
    await expect(main.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(main.getByText("1 Fixture Street, DashboardTestCity")).toBeVisible();
    // Scoped to the total row itself: the (closed, so invisible, but still
    // present in the DOM) cancel dialog also previews this booking's paid
    // and refund amounts, both of which happen to be the same £220 figure.
    const totalRow = main.getByText("Total (GBP)", { exact: true }).locator("..");
    await expect(totalRow.getByText("£220")).toBeVisible();
    await expect(main.getByText("Jamie Guest")).toBeVisible();

    await expect(main.getByRole("link", { name: "View property" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Request changes" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await expect(main.getByRole("link", { name: "View receipt" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Message host" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Rebook this stay" })).toHaveCount(0);
    // Where the stay stands under its policy today, before any Cancel press.
    await expect(main.getByText(/Free cancellation until|refund if you cancel by|can no longer be refunded/)).toBeVisible();
  });

  test("a completed booking's detail page offers rebook and a receipt but not modify or cancel", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/bookings/${completedId}`);

    const main = page.locator("#main-content");
    await expect(main.getByText("Completed", { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Rebook this stay" })).toBeVisible();
    await expect(main.getByRole("link", { name: "View receipt" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Message host" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Request changes" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
  });

  test("a pending, unpaid booking's detail page hides the receipt, host's email and exact address", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/bookings/${pendingId}`);

    const main = page.locator("#main-content");
    await expect(main.getByText("Pending payment", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await expect(main.getByRole("link", { name: "View receipt" })).toHaveCount(0);
    await expect(main.getByText("host@fystay.dev")).toHaveCount(0);
    await expect(main.getByText("1 Fixture Street, DashboardTestCity")).toHaveCount(0);
    // It says how long the dates are held, and that nothing's been charged.
    await expect(main.getByText(/holding these dates for you until \d\d:\d\d/)).toBeVisible();
  });

  test("the receipt page shows the real price breakdown for a paid booking and a friendly message for an unpaid one", async ({
    page,
  }) => {
    await login(page, "guest@fystay.dev", "guestpass123");

    await page.goto(`/bookings/${confirmedId}/receipt`);
    const main = page.locator("#main-content");
    await expect(main.getByText("Total charged (GBP)")).toBeVisible();
    await expect(main.getByText("£220")).toBeVisible();
    await expect(main.getByText("Jamie Guest")).toBeVisible();

    await page.goto(`/bookings/${pendingId}/receipt`);
    await expect(main.getByText("No receipt available yet")).toBeVisible();
  });
});
