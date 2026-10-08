import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateBookingReference } from "../src/lib/bookingReference";
import { generateReferralCode } from "../src/lib/referral";

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  // Wherever login lands (a host goes to their dashboard, a guest home).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("guest can message a host from the listing page, and the host can reply", async ({
  page,
  browser,
}) => {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });

  const listing = await prisma.listing.create({
    data: {
      title: "E2E fixture: messaging listing",
      description: "Temporary listing for the guest-host messaging flow test.",
      city: "TestMessagingCity",
      country: "England",
      pricePerNightCents: 9000,
      maxGuests: 2,
      photos: [],
      amenities: [],
      hostId: host.id,
    },
  });

  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();

  try {
    await login(page, "guest@fystay.dev", "guestpass123");
    await page.goto(`/listings/${listing.id}`);

    await page.getByRole("button", { name: "Message host" }).click();
    await page
      .getByPlaceholder(/Ask .* a question/)
      .fill("Hi! Is early check-in possible on a Friday?");
    const [startResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/conversations") && r.request().method() === "POST"),
      page.getByRole("dialog").getByRole("button", { name: "Send" }).click(),
    ]);
    expect(startResponse.status()).toBe(201);
    await page.waitForURL(/\/inbox\//);
    await expect(page.getByText("Hi! Is early check-in possible on a Friday?")).toBeVisible();

    // The same conversation shows up in the guest's inbox list too.
    await page.goto("/inbox");
    await expect(page.getByText(listing.title)).toBeVisible();
    await expect(page.getByText("Hi! Is early check-in possible on a Friday?")).toBeVisible();

    // Host sees an unread badge, opens the conversation, and replies.
    await login(hostPage, "host@fystay.dev", "hostpass123");
    await hostPage.goto("/", { waitUntil: "networkidle" });
    await expect(hostPage.locator("header button span.bg-red-500")).toBeVisible();

    await hostPage.goto("/inbox");
    // On the conversation itself (the hosting menu shows its own unread count too).
    await expect(hostPage.getByRole("link", { name: /Jamie Guest/ }).getByText("1 new")).toBeVisible();
    await hostPage.getByText("Jamie Guest").click();
    await hostPage.waitForURL(/\/inbox\//);
    await expect(hostPage.getByText("Hi! Is early check-in possible on a Friday?")).toBeVisible();

    // Opening the thread marks it read - the nav badge clears without a
    // full reload (see RefreshOnMount).
    await expect(hostPage.locator("header button span.bg-red-500")).toHaveCount(0);

    await hostPage.getByPlaceholder("Write a message…").fill("Yes, from 12pm works great!");
    const [replyResponse] = await Promise.all([
      hostPage.waitForResponse((r) => r.url().includes("/messages") && r.request().method() === "POST"),
      hostPage.getByRole("button", { name: "Send" }).click(),
    ]);
    expect(replyResponse.status()).toBe(201);

    // Guest sees the reply on a fresh visit to the thread.
    await page.reload();
    await expect(page.getByText("Yes, from 12pm works great!")).toBeVisible();
  } finally {
    // Cascades to the Conversation and its Messages (see schema.prisma).
    await prisma.listing.delete({ where: { id: listing.id } }).catch(() => {});
    await prisma.$disconnect();
    await hostContext.close().catch(() => {});
  }
});

test("a host can't start a conversation with a guest who never booked their listing", async ({
  page,
}) => {
  const host = await prisma.user.findUniqueOrThrow({ where: { email: "host@fystay.dev" } });

  const listing = await prisma.listing.create({
    data: {
      title: "E2E fixture: messaging authorization listing",
      description: "Temporary listing for the host-can't-cold-message-a-guest test.",
      city: "TestMessagingAuthCity",
      country: "England",
      pricePerNightCents: 9000,
      maxGuests: 2,
      photos: [],
      amenities: [],
      hostId: host.id,
    },
  });

  const strangerEmail = `e2e-messaging-stranger-${generateBookingReference()}@fystay.dev`.toLowerCase();
  const stranger = await prisma.user.create({
    data: {
      name: "Never Booked",
      email: strangerEmail,
      passwordHash: await bcrypt.hash("strangerpass123", 10),
      role: "GUEST",
      referralCode: generateReferralCode(),
    },
  });

  try {
    await login(page, "host@fystay.dev", "hostpass123");

    const res = await page.request.post("/api/conversations", {
      data: { listingId: listing.id, guestId: stranger.id, body: "Hi there!" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/only message guests who have booked/);

    expect(
      await prisma.conversation.findUnique({
        where: { listingId_guestId: { listingId: listing.id, guestId: stranger.id } },
      }),
    ).toBeNull();
  } finally {
    await prisma.user.delete({ where: { id: stranger.id } }).catch(() => {});
    await prisma.listing.delete({ where: { id: listing.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
