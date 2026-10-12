import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateReferralCode } from "../src/lib/referral";

// Admin account controls end to end: suspending signs the person out
// everywhere and blocks sign-in (with a way to reach support), reinstating
// lets them back in, and deleting needs DELETE typed and anonymizes in place.

try {
  process.loadEnvFile();
} catch {
  // no .env file, so assume the environment already has DATABASE_URL set
}

const prisma = new PrismaClient();
const PASSWORD = "moderation-e2e-123";
const PREFIX = "e2e-moderation-";
const created: string[] = [];

async function createUser(label: string, role: "GUEST" | "HOST" | "ADMIN") {
  const user = await prisma.user.create({
    data: {
      name: `E2E ${label}`,
      email: `${PREFIX}${label}-${Date.now()}@fystay.dev`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role,
      emailVerifiedAt: new Date(),
      referralCode: generateReferralCode(),
    },
  });
  created.push(user.id);
  return user;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function signedInPage(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}

test("suspend signs the guest out and blocks sign-in; reinstate lets them back", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await createUser("admin", "ADMIN");
  const guest = await createUser("guest", "GUEST");
  const adminPage = await signedInPage(browser, admin.email);
  const guestPage = await signedInPage(browser, guest.email);

  await adminPage.goto(`/admin/users/${guest.id}`);
  await adminPage.getByRole("button", { name: "Suspend account" }).click();
  await adminPage.getByRole("dialog").getByLabel("Reason (kept in the admin record)").fill("E2E test suspension");
  await adminPage.getByRole("dialog").getByRole("button", { name: "Suspend account" }).click();
  // Generous timeouts: the first call compiles the route under `next dev`.
  await expect(adminPage.getByText(/Suspended \d/)).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByText(/user suspended by/)).toBeVisible();

  // The guest's existing session no longer works.
  await guestPage.goto("/account");
  await expect(guestPage).toHaveURL(/\/login/);

  // Signing in again says why, and how to reach support.
  await guestPage.fill("#email", guest.email);
  await guestPage.fill("#password", PASSWORD);
  await guestPage.click("button[type=submit]");
  const notice = guestPage.getByRole("alert").filter({ hasText: "suspended" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "contact support" })).toHaveAttribute("href", "/contact");

  await adminPage.getByRole("button", { name: "Reinstate account" }).click();
  await expect(adminPage.getByRole("button", { name: "Suspend account" })).toBeVisible({ timeout: 30_000 });
  await login(guestPage, guest.email);
  await guestPage.goto("/account");
  await expect(guestPage).toHaveURL(/\/account/);
});

test("deleting an account needs DELETE typed and keeps the record anonymized", async ({ browser }) => {
  const admin = await createUser("admin2", "ADMIN");
  const guest = await createUser("guest2", "GUEST");
  const adminPage = await signedInPage(browser, admin.email);

  await adminPage.goto(`/admin/users/${guest.id}`);
  await adminPage.getByRole("button", { name: "Delete account" }).click();
  const dialog = adminPage.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete account" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await confirm.click();
  await expect(adminPage.getByText("Deleted account")).toBeVisible({ timeout: 30_000 });

  const after = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
  expect(after.deletedAt).not.toBeNull();
  expect(after.email).not.toContain(PREFIX);
  expect(after.passwordHash).toBeNull();
});

test("an admin transfers a listing to another host; it comes off the site until they check it", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await createUser("admin3", "ADMIN");
  const oldHost = await createUser("oldhost", "HOST");
  const newHost = await createUser("newhost", "HOST");
  const listing = await prisma.listing.create({
    data: {
      title: `E2E transfer flat ${Date.now()}`,
      description: "Temporary listing created for this test.",
      city: "Blackpool",
      country: "United Kingdom",
      pricePerNightCents: 8000,
      photos: [],
      amenities: [],
      published: true,
      hostId: oldHost.id,
    },
  });
  const adminPage = await signedInPage(browser, admin.email);

  await adminPage.goto(`/admin/listings?q=${encodeURIComponent(listing.title)}`);
  await adminPage.getByRole("button", { name: "Transfer" }).click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("New host's email").fill(newHost.email);
  await dialog.getByRole("button", { name: "Transfer listing" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  expect(after.hostId).toBe(newHost.id);
  expect(after.published).toBe(false);
  expect(after.icalExportToken).not.toBe(listing.icalExportToken);
  expect(await prisma.adminAuditEvent.count({ where: { targetListingId: listing.id, action: "LISTING_ASSIGNED" } })).toBe(1);
  await prisma.adminAuditEvent.deleteMany({ where: { targetListingId: listing.id } });
  await prisma.listing.delete({ where: { id: listing.id } });
});

test.afterAll(async () => {
  const ids = created;
  await prisma.adminAuditEvent.deleteMany({ where: { OR: [{ targetUserId: { in: ids } }, { actorId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});
