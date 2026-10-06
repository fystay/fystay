import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { passwordHash: null as string | null } }));
const anonymize = vi.fn();
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user_1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUniqueOrThrow: async () => ({ passwordHash: state.passwordHash }) } },
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/accountDeletion", () => ({
  findAccountDeletionBlocks: async () => [],
  anonymizeAccount: (...a: unknown[]) => anonymize(...a),
}));

import { DELETE } from "./route";

const req = (body?: object) =>
  new Request("http://x/api/account", { method: "DELETE", body: body ? JSON.stringify(body) : undefined });

beforeEach(() => anonymize.mockReset());

describe("DELETE /api/account", () => {
  describe("an account with a password", () => {
    beforeEach(() => {
      state.passwordHash = bcrypt.hashSync("right-password", 4);
    });

    it("deletes with the right password", async () => {
      const res = await DELETE(req({ currentPassword: "right-password" }));
      expect(res.status).toBe(200);
      expect(anonymize).toHaveBeenCalledOnce();
    });

    it("refuses a wrong password", async () => {
      const res = await DELETE(req({ currentPassword: "nope" }));
      expect(res.status).toBe(400);
      expect(anonymize).not.toHaveBeenCalled();
    });

    it("refuses no password at all", async () => {
      const res = await DELETE(req());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/enter your password/i);
      expect(anonymize).not.toHaveBeenCalled();
    });
  });

  it("deletes a Google-only account, which has no password to ask for", async () => {
    state.passwordHash = null;
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(anonymize).toHaveBeenCalledOnce();
  });
});
