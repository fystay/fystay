import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// The host's calendar sync card: what it explains, a failed sync shown with
// its reason, and resetting the private export link (the old one stops
// working). The import itself is covered by unit tests - the safe fetcher
// refuses local addresses, so a local test feed can't be served to it.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "calendar-sync-e2e-123";

test("host sees sync timing, a failed sync's reason, and can reset the export link", async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `e2e-calendar-sync-${Date.now()}@fystay.dev`;
  const host = await prisma.user.create({
    data: { name: "E2E Calendar", email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "HOST", emailVerifiedAt: new Date(), referralCode: generateReferralCode() },
  });
  const listing = await prisma.listing.create({
    data: {
      title: "E2E calendar flat",
      description: "Temporary listing created for this test.",
      city: "Blackpool",
      country: "United Kingdom",
      pricePerNightCents: 8000,
      photos: [],
      amenities: [],
      published: false,
      hostId: host.id,
      icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/123.ics",
      icalSyncedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      icalSyncError: "The other site refused the calendar link (403).",
      icalSyncFailedAt: new Date(Date.now() - 10 * 60 * 1000),
    },
  });

  try {
    const oldToken = listing.icalExportToken;
    const oldFeed = await request.get(`/api/listings/${listing.id}/calendar.ics?token=${oldToken}`);
    expect(oldFeed.status()).toBe(200);
    expect(await oldFeed.text()).toContain("BEGIN:VCALENDAR");

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

    await page.goto(`/host/listings/${listing.id}/calendar`);
    await expect(page.getByText(/Syncing isn.t instant/)).toBeVisible({ timeout: 30_000 });
    const alert = page.getByRole("alert").filter({ hasText: "Last sync failed" });
    await expect(alert).toContainText("Airbnb refused the link (403)");
    await expect(alert).toContainText("copy a fresh export link from Airbnb");
    await expect(alert).toContainText("are still blocked");

    await page.getByRole("button", { name: "Reset link" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset link" }).click();
    await expect(page.locator("#icalExportUrl")).not.toHaveValue(new RegExp(oldToken), { timeout: 30_000 });

    const newToken = (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).icalExportToken;
    expect(newToken).not.toBe(oldToken);
    expect((await request.get(`/api/listings/${listing.id}/calendar.ics?token=${oldToken}`)).status()).toBe(404);
    expect((await request.get(`/api/listings/${listing.id}/calendar.ics?token=${newToken}`)).status()).toBe(200);
  } finally {
    await prisma.listing.delete({ where: { id: listing.id } });
    await prisma.user.delete({ where: { id: host.id } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
