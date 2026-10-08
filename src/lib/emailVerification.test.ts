import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ EMAIL_FROM: "x", getResendClient: () => null }));

import { hashResetToken } from "@/lib/passwordReset";
import { sendVerificationEmail, verifyEmailToken } from "./emailVerification";

function fakeDb(user: { emailVerifiedAt: Date | null; referredByUserId: string | null }) {
  const tokens: { id: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; userId: string }[] = [];
  const row = { ...user, creditBalanceCents: 0 };
  const db = {
    emailVerificationToken: {
      create: async ({ data }: { data: { tokenHash: string; expiresAt: Date; userId: string } }) => {
        tokens.push({ id: `t${tokens.length}`, usedAt: null, ...data });
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: { where: { id: string }; data: { usedAt: Date } }) => {
        const t = tokens.find((x) => x.id === where.id && !x.usedAt);
        if (!t) return { count: 0 };
        t.usedAt = data.usedAt;
        return { count: 1 };
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
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as never, row, tokens };
}

const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

describe("email verification", () => {
  it("verifies once, and only then gives a referred account its welcome credit", async () => {
    const { db, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: "referrer" });
    const { devUrl } = await sendVerificationEmail(db, { id: "u1", email: "a@b.c", name: "A" }, { local: true });
    expect(row.creditBalanceCents).toBe(0);

    const token = tokenFrom(devUrl!);
    expect(await verifyEmailToken(db, token)).toBe("verified");
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(row.creditBalanceCents).toBe(1000);

    // The same link again (a mail scanner, then the person) changes nothing.
    expect(await verifyEmailToken(db, token)).toBe("invalid");
    expect(row.creditBalanceCents).toBe(1000);
  });

  it("gives no credit to an account nobody referred", async () => {
    const { db, row } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    const { devUrl } = await sendVerificationEmail(db, { id: "u1", email: "a@b.c", name: "A" }, { local: true });
    expect(await verifyEmailToken(db, tokenFrom(devUrl!))).toBe("verified");
    expect(row.creditBalanceCents).toBe(0);
  });

  it("refuses an expired or unknown link", async () => {
    const { db, tokens } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    tokens.push({ id: "old", tokenHash: hashResetToken("old"), expiresAt: new Date(Date.now() - 1000), usedAt: null, userId: "u1" });
    expect(await verifyEmailToken(db, "old")).toBe("invalid");
    expect(await verifyEmailToken(db, "nonsense")).toBe("invalid");
  });

  it("never hands out the link itself on a deployed site", async () => {
    const { db } = fakeDb({ emailVerifiedAt: null, referredByUserId: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendVerificationEmail(db, { id: "u1", email: "a@b.c", name: "A" }, { local: false })).toEqual({ sent: false });
  });
});
