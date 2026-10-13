import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const { authMock, userFindUnique, userUpdateMany, accountsCreate, accountLinksCreate, stripeConfigured } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    userFindUnique: vi.fn(),
    userUpdateMany: vi.fn(),
    accountsCreate: vi.fn(),
    accountLinksCreate: vi.fn(),
    stripeConfigured: { value: true },
  }),
);

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/baseUrl", () => ({ BASE_URL: "https://www.fystay.co.uk" }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUniqueOrThrow: userFindUnique, updateMany: userUpdateMany } },
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () =>
    stripeConfigured.value
      ? { v2: { core: { accounts: { create: accountsCreate }, accountLinks: { create: accountLinksCreate } } } }
      : null,
}));

import { GET } from "./route";

const host = {
  id: "host_1",
  email: "host@example.com",
  name: "Host",
  stripeConnectAccountId: null as string | null,
  emailVerifiedAt: new Date(),
};

function stripeError(raw: { type?: string; code?: string; statusCode?: number }) {
  return Stripe.errors.StripeError.generate({
    type: raw.type ?? "invalid_request_error",
    code: raw.code,
    message: "Stripe said no",
    statusCode: raw.statusCode ?? 400,
    requestId: "req_123",
  } as Stripe.StripeRawError);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stripeConfigured.value = true;
  authMock.mockReset().mockResolvedValue({ user: { id: "host_1", role: "HOST" } });
  userFindUnique.mockReset().mockResolvedValue(host);
  userUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  accountsCreate.mockReset().mockResolvedValue({ id: "acct_1" });
  accountLinksCreate.mockReset().mockResolvedValue({ url: "https://connect.stripe.com/setup/x" });
});

const location = (res: Response) => res.headers.get("location");

describe("GET /api/host/stripe/connect", () => {
  it("sends a signed-out visitor to log in, then back to payouts", async () => {
    authMock.mockResolvedValue(null);
    expect(location(await GET())).toBe("https://www.fystay.co.uk/login?callbackUrl=%2Fhost%2Fpayouts");
    expect(accountsCreate).not.toHaveBeenCalled();
  });

  it("never starts onboarding for a guest account", async () => {
    authMock.mockResolvedValue({ user: { id: "guest_1", role: "GUEST" } });
    expect(location(await GET())).toBe("https://www.fystay.co.uk/host");
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(accountsCreate).not.toHaveBeenCalled();
  });

  it("explains when Stripe isn't configured", async () => {
    stripeConfigured.value = false;
    expect(location(await GET())).toMatch(/\/host\/payouts\?error=stripe_not_configured$/);
  });

  it("sends a host with an unconfirmed email back to payouts without creating a Stripe account", async () => {
    userFindUnique.mockResolvedValue({ ...host, emailVerifiedAt: null });
    expect(location(await GET())).toMatch(/\/host\/payouts\?error=email_not_verified$/);
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(accountLinksCreate).not.toHaveBeenCalled();
  });

  it("creates the host's account, stores it only if they have none, and sends them to Stripe", async () => {
    expect(location(await GET())).toBe("https://connect.stripe.com/setup/x");
    expect(accountsCreate).toHaveBeenCalledTimes(1);
    expect(accountsCreate.mock.calls[0][0].metadata).toEqual({ fystay_user_id: "host_1" });
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "host_1", stripeConnectAccountId: null },
      data: { stripeConnectAccountId: "acct_1" },
    });
    expect(accountLinksCreate).toHaveBeenCalledWith({
      account: "acct_1",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient", "merchant"],
          refresh_url: "https://www.fystay.co.uk/api/host/stripe/connect",
          return_url: "https://www.fystay.co.uk/host/payouts?onboarding=return",
        },
      },
    });
  });

  it("resumes an existing account with a fresh link instead of creating another", async () => {
    userFindUnique.mockResolvedValue({ ...host, stripeConnectAccountId: "acct_existing" });
    await GET();
    await GET();
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(accountLinksCreate).toHaveBeenCalledTimes(2);
    expect(accountLinksCreate.mock.calls[1][0].account).toBe("acct_existing");
  });

  it("uses the account another request already stored when two clicks race", async () => {
    userFindUnique
      .mockResolvedValueOnce(host)
      .mockResolvedValueOnce({ stripeConnectAccountId: "acct_first" });
    userUpdateMany.mockResolvedValue({ count: 0 });
    accountsCreate.mockResolvedValue({ id: "acct_second" });
    await GET();
    expect(accountLinksCreate.mock.calls[0][0].account).toBe("acct_first");
  });

  it("shows a plain 'not open yet' page, not JSON, when FYStay's Stripe platform can't create accounts", async () => {
    accountsCreate.mockRejectedValue(stripeError({ code: "account_creation_losses_collector_unavailable" }));
    const res = await GET();
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://www.fystay.co.uk/host/payouts?error=connect_unavailable");
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(accountLinksCreate).not.toHaveBeenCalled();
  });

  it("treats a Stripe permission error as platform setup, too", async () => {
    accountsCreate.mockRejectedValue(
      new Stripe.errors.StripePermissionError({ message: "no", type: "invalid_request_error" } as Stripe.StripeRawError),
    );
    expect(location(await GET())).toMatch(/error=connect_unavailable$/);
  });

  it("offers a retry when Stripe fails for any other reason", async () => {
    accountsCreate.mockRejectedValue(stripeError({ type: "api_error", statusCode: 500 }));
    expect(location(await GET())).toBe("https://www.fystay.co.uk/host/payouts?error=connect_failed");
  });

  it("offers a retry when the onboarding link can't be made, keeping the account it already has", async () => {
    userFindUnique.mockResolvedValue({ ...host, stripeConnectAccountId: "acct_existing" });
    accountLinksCreate.mockRejectedValue(stripeError({ code: "resource_missing", statusCode: 404 }));
    expect(location(await GET())).toMatch(/error=connect_failed$/);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("logs enough to find the request in Stripe, without the host's details", async () => {
    const consoleError = vi.mocked(console.error);
    accountsCreate.mockRejectedValue(stripeError({ code: "account_creation_losses_collector_unavailable" }));
    await GET();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("account_creation_losses_collector_unavailable");
    expect(logged).toContain("req_123");
    expect(logged).not.toContain("host@example.com");
  });

  it("never reports a database failure as success", async () => {
    userFindUnique.mockRejectedValue(new Error("db down"));
    expect(location(await GET())).toMatch(/error=connect_failed$/);
  });
});
