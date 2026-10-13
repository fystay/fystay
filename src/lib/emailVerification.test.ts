import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Resend client (no email ever leaves these tests); each
// test says whether the provider accepts, refuses or throws.
const { provider } = vi.hoisted(() => ({
  provider: { client: null as null | { emails: { send: (msg: unknown) => Promise<{ error: unknown }> } } },
}));
vi.mock("@/lib/email", () => ({
  EMAIL_FROM: "FYStay <hello@fystay.co.uk>",
  EMAIL_REPLY_TO: "hello@fystay.co.uk",
  getResendClient: () => provider.client,
}));

import { hashResetToken } from "@/lib/passwordReset";
import { sendVerificationEmail, verifyEmailToken } from "./emailVerification";

type Token = { id: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; userId: string };

function fakeDb(user: { emailVerifiedAt: Date | null; referredByUserId: string | null }) {
  const tokens: Token[] = [];
  const row = { ...user, creditBalanceCents: 0 };
  const db = {
    emailVerificationToken: {
      create: async ({ data }: { data: { tokenHash: string; expiresAt: Date; userId: string } }) => {
        tokens.push({ id: `t${tokens.length}`, usedAt: null, ...data });
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: { where: { id?: string; userId?: string; usedAt: null }; data: { usedAt: Date } }) => {
        const matches = tokens.filter((t) => !t.usedAt && (where.id ? t.id === where.id : t.userId === where.userId));
        for (const t of matches) t.usedAt = data.usedAt;
        return { count: matches.length };
      },
    },
    user: {
      findUnique: async () => row,
      updateMany: async ({ data }: { data: { emailVerifiedAt: Date; creditBalanceCents?: { increment: number } } }) => {
        if (row.emailVerifiedAt) return { count: 0 };
        row.emailVerifiedAt = data.emailVerifiedAt;
        row.creditBalanceCents += data.creditBalanceCents?.increment ?? 0;
        return { count: 1 };
      },
    },
    $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(db)),
  };
  return { db: db as never, row, tokens };
}

const user = { id: "u1", email: "guest@example.com", name: "Guest" };
const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

beforeEach(() => {
  provider.client = null;
  vi.restoreAllMocks();
});

describe("sending the confirmation email (mocked provider)", () => {
  it("reports sent only when the provider accepts the message, to that exact address", async () => {
    const send = vi.fn<(msg: unknown) => Promise<{ error: unknown }>>(async () => ({ error: null }));
    provider.client = { emails: { send } };
    const { db } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    expect(await sendVerificationEmail(db, user, { local: false })).toEqual({ sent: true });
    const message = send.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(message.to).toBe("guest@example.com");
    expect(message.html).toContain("/api/auth/verify-email?token=");
    expect(message.html).toContain("48 hours");
  });

  it("never reports a refused or failed send as sent, and never logs the link", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<(msg: unknown) => Promise<{ error: unknown }>>(async () => ({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field" } }));
    provider.client = { emails: { send } };
    const { db } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    expect(await sendVerificationEmail(db, user, { local: false })).toEqual({ sent: false });

    provider.client = { emails: { send: async () => Promise.reject(new Error("network down")) } };
    expect(await sendVerificationEmail(db, user, { local: false })).toEqual({ sent: false });

    const logged = JSON.stringify(errorLog.mock.calls);
    const html = (send.mock.calls[0][0] as { html: string }).html;
    const token = html.match(/token=([A-Za-z0-9_-]+)/)![1];
    expect(logged).not.toContain(token);
  });

  it("with no email provider: hands the link back on a developer's machine only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    expect(await sendVerificationEmail(db, user, { local: false })).toEqual({ sent: false });
    const local = await sendVerificationEmail(db, user, { local: true });
    expect(local.sent).toBe(false);
    expect(local.devUrl).toContain("/api/auth/verify-email?token=");
  });

  it("carries a same-site return path, and drops anything off-site", async () => {
    const { db } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    const inside = await sendVerificationEmail(db, user, { local: true, next: "/listings/abc?save=1" });
    expect(new URL(inside.devUrl!).searchParams.get("next")).toBe("/listings/abc?save=1");
    const outside = await sendVerificationEmail(db, user, { local: true, next: "//evil.example" });
    expect(new URL(outside.devUrl!).searchParams.get("next")).toBeNull();
  });
});

describe("opening the link", () => {
  it("verifies once, and only then gives a referred account its welcome credit", async () => {
    const { db, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: "referrer" });
    const { devUrl } = await sendVerificationEmail(db, user, { local: true });
    expect(row.creditBalanceCents).toBe(0);

    const token = tokenFrom(devUrl!);
    expect(await verifyEmailToken(db, token)).toBe("verified");
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(row.creditBalanceCents).toBe(1000);

    // The same link again (a mail scanner, then the person) changes nothing.
    expect(await verifyEmailToken(db, token)).toBe("used");
    expect(row.creditBalanceCents).toBe(1000);
  });

  it("gives no credit to an account nobody referred", async () => {
    const { db, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    const { devUrl } = await sendVerificationEmail(db, user, { local: true });
    expect(await verifyEmailToken(db, tokenFrom(devUrl!))).toBe("verified");
    expect(row.creditBalanceCents).toBe(0);
  });

  it("says when a link has expired, and refuses an unknown one", async () => {
    const { db, tokens, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    tokens.push({ id: "old", tokenHash: hashResetToken("old"), expiresAt: new Date(Date.now() - 1000), usedAt: null, userId: "u1" });
    expect(await verifyEmailToken(db, "old")).toBe("expired");
    expect(await verifyEmailToken(db, "nonsense")).toBe("invalid");
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("lets only the newest link work after a resend", async () => {
    const { db, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    const first = await sendVerificationEmail(db, user, { local: true });
    const second = await sendVerificationEmail(db, user, { local: true });
    expect(await verifyEmailToken(db, tokenFrom(first.devUrl!))).toBe("used");
    expect(row.emailVerifiedAt).toBeNull();
    expect(await verifyEmailToken(db, tokenFrom(second.devUrl!))).toBe("verified");
  });
});
