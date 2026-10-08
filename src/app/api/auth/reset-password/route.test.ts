import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    emailVerifiedAt: null as Date | null,
    userUpdate: null as Record<string, unknown> | null,
    identitiesDeleted: false,
  },
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    passwordResetToken: { updateMany: async () => ({ count: 1 }) },
    user: {
      findUniqueOrThrow: async () => ({ emailVerifiedAt: state.emailVerifiedAt }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.userUpdate = data;
      },
    },
    authIdentity: {
      deleteMany: async () => {
        state.identitiesDeleted = true;
      },
    },
  };
  return {
    prisma: {
      passwordResetToken: {
        findUnique: async () => ({ id: "t1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), usedAt: null }),
      },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const reset = () =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ token: "tok", password: "new-password-1" }) }));

beforeEach(() => {
  state.emailVerifiedAt = null;
  state.userUpdate = null;
  state.identitiesDeleted = false;
});

describe("reset password", () => {
  it("proves the inbox: an unverified account becomes verified, and loses anything its creator attached", async () => {
    expect((await reset()).status).toBe(200);
    expect(state.userUpdate).toMatchObject({
      emailVerifiedAt: expect.any(Date),
      twoFactorEnabledAt: null,
      twoFactorSecretCiphertext: null,
      twoFactorBackupCodeHashes: [],
    });
    expect(state.identitiesDeleted).toBe(true);
  });

  it("leaves a verified account's two-factor and connected sign-ins alone", async () => {
    state.emailVerifiedAt = new Date("2026-01-01");
    expect((await reset()).status).toBe(200);
    expect(state.userUpdate).not.toHaveProperty("twoFactorEnabledAt");
    expect(state.identitiesDeleted).toBe(false);
  });
});
