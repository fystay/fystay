import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Playwright's test process doesn't load .env the way `next dev` does.
// CI sets these vars directly instead of via a .env file, so don't fail
// when there isn't one to load.
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

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("guest can log in, book a listing, and see it in their trips", async ({ page }) => {
  // Anchored to the oldest published listing (one of the permanent seeded
  // ones) rather than "whatever the homepage shows first": other specs
  // create and delete their own temporary listings concurrently, and since
  // the homepage sorts newest-first, "first listing" can transiently be one
  // of those, which then disappears mid-test when its owning spec's
  // afterAll runs.
  const listing = await prisma.listing.findFirstOrThrow({
    where: { published: true },
    orderBy: { createdAt: "asc" },
  });

  await page.goto("/login");
  await page.fill("#email", "guest@fystay.dev");
  await page.fill("#password", "guestpass123");
  await page.click("button[type=submit]");
  // Wherever login lands (a host goes to their dashboard, a guest home).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto(`/listings/${listing.id}`);
  const listingTitle = (await page.locator("h1").first().textContent())!.trim();

  await page.getByRole("button", { name: "Add dates" }).click();

  // Randomized within a wide window so repeat local runs against the same
  // dev database don't collide with dates a previous run already booked.
  const start = 30 + Math.floor(Math.random() * 300);
  const checkIn = addDays(start);
  const checkOut = addDays(start + 3);
  const monthsAdvanced = await selectDay(page, checkIn, 0);
  await selectDay(page, checkOut, monthsAdvanced);

  await expect(page.getByText(/Total/)).toBeVisible();

  // One press from chosen dates to checkout - no separate check step.
  await expect(page.getByRole("button", { name: "Reserve your stay" })).toBeVisible({
    timeout: 15_000,
  });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/bookings") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Reserve your stay" }).click(),
  ]);

  // Reserving goes straight to checkout (no in-between transfer step).
  await page.waitForURL(/\/checkout\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Confirm and pay" })).toBeVisible();
  // Name/email are prefilled from the account; only phone is missing.
  await page.fill("#guestPhone", "07700 900123");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/checkout") && r.request().method() === "POST"),
    page.getByRole("button", { name: /Pay securely/ }).first().click(),
  ]);

  await page.waitForURL(/\/bookings\/.+\/confirmation/, { timeout: 15_000 });
  expect(page.url()).toContain("dev_confirmed=1");

  await expect(page.getByText("Booking confirmed!")).toBeVisible();
  await expect(page.getByText(listingTitle).first()).toBeVisible();
  await expect(page.getByText(/Booking #FY-/)).toBeVisible();

  await page.goto("/bookings");
  await expect(page.getByText(listingTitle).first()).toBeVisible();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
});

test("logged-out guest is redirected to log in when trying to book", async ({ page }) => {
  const listing = await prisma.listing.findFirstOrThrow({
    where: { published: true },
    orderBy: { createdAt: "asc" },
  });

  await page.goto(`/listings/${listing.id}`);

  await page.getByRole("button", { name: "Log in to book" }).click();
  await page.waitForURL(/\/login/);
  // The callback is URL-encoded (it can carry the selected dates/guests).
  expect(decodeURIComponent(page.url())).toContain("callbackUrl=/listings/");
});
