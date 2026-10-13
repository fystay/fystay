import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// The host Channels page: Airbnb and other calendars offered as iCal
// calendar sync (not a direct API connection), each listing's real sync
// status from its stored fields, and nothing "coming soon" on offer.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "channels-e2e-123";

test("host sees honest calendar sync status per listing on the Channels page", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `e2e-channels-${Date.now()}@fystay.dev`;
  const host = await prisma.user.create({
    data: { name: "E2E Channels", email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "HOST", emailVerifiedAt: new Date(), referralCode: generateReferralCode() },
  });
  const base = {
    description: "Temporary listing created for this test.",
    city: "Blackpool",
    country: "United Kingdom",
    pricePerNightCents: 8000,
    photos: [],
    amenities: [],
    published: false,
    hostId: host.id,
  };
  const [unlinked, healthy, broken] = await Promise.all([
    prisma.listing.create({ data: { ...base, title: "E2E channels unlinked" } }),
    prisma.listing.create({
      data: {
        ...base,
        title: "E2E channels healthy",
        icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/1.ics",
        icalSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    }),
    prisma.listing.create({
      data: {
        ...base,
        title: "E2E channels broken",
        icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/2.ics",
        icalSyncedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
        icalSyncError: "The other site refused the calendar link (404). Check it's the current export link.",
        icalSyncFailedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    }),
  ]);

  try {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

    await page.goto("/host/integrations");
    const airbnb = page.getByRole("region", { name: "Airbnb" });
    await expect(airbnb).toContainText("Calendar sync (iCal)", { timeout: 30_000 });
    await expect(airbnb).toContainText("2 of 3 listings linked");
    await expect(airbnb).toContainText("No direct Airbnb account connection");
    await expect(page.getByRole("region", { name: "Other calendar (iCal)" })).toContainText("Not connected");
    await expect(page.getByText(/once a day, at 6am UTC/)).toBeVisible();
    await expect(page.getByText(/Coming soon/i)).toHaveCount(0);

    const row = (title: string) => page.getByTestId("channel-listing").filter({ hasText: title });
    await expect(row("E2E channels unlinked")).toContainText("Not connected");
    await expect(row("E2E channels healthy")).toContainText(/Connected – last synced about 2 hours ago/);
    await expect(row("E2E channels broken")).toContainText("Sync problem");
    await expect(row("E2E channels broken")).toContainText("Airbnb returned 404 – the link may have been reset");

    await row("E2E channels unlinked").getByRole("link", { name: "Calendar settings" }).click();
    await expect(page).toHaveURL(new RegExp(`/host/listings/${unlinked.id}/calendar#calendar-sync`));
    await expect(page.locator("#icalImportUrl")).toBeVisible({ timeout: 30_000 });
  } finally {
    await prisma.listing.deleteMany({ where: { id: { in: [unlinked.id, healthy.id, broken.id] } } });
    await prisma.user.delete({ where: { id: host.id } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
