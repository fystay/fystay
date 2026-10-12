import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUnique, userUpdate, accountsCreate, accountLinksCreate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  accountsCreate: vi.fn(),
  accountLinksCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1", role: "HOST" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUniqueOrThrow: userFindUnique, update: userUpdate } },
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    v2: { core: { accounts: { create: accountsCreate }, accountLinks: { create: accountLinksCreate } } },
  }),
}));

import { GET } from "./route";

const host = { id: "host_1", email: "host@example.com", name: "Host", stripeConnectAccountId: null };

beforeEach(() => {
  userFindUnique.mockReset();
  userUpdate.mockReset();
  accountsCreate.mockReset().mockResolvedValue({ id: "acct_1" });
  accountLinksCreate.mockReset().mockResolvedValue({ url: "https://connect.stripe.com/setup/x" });
});

describe("GET /api/host/stripe/connect", () => {
  it("sends a host with an unconfirmed email back to payouts without creating a Stripe account", async () => {
    userFindUnique.mockResolvedValue({ ...host, emailVerifiedAt: null });
    const res = await GET();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/host\/payouts\?error=email_not_verified$/);
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(accountLinksCreate).not.toHaveBeenCalled();
  });

  it("starts Stripe onboarding once the email is confirmed", async () => {
    userFindUnique.mockResolvedValue({ ...host, emailVerifiedAt: new Date() });
    const res = await GET();
    expect(res.headers.get("location")).toBe("https://connect.stripe.com/setup/x");
    expect(accountsCreate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "host_1" }, data: { stripeConnectAccountId: "acct_1" } });
  });
});
