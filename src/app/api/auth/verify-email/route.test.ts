import { describe, expect, it, vi } from "vitest";

const { outcome } = vi.hoisted(() => ({ outcome: { value: "verified" as string } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/emailVerification", () => ({ verifyEmailToken: async () => outcome.value }));

import { GET } from "./route";

const open = async (query: string) => {
  const res = await GET(new Request(`http://x/api/auth/verify-email?${query}`));
  return new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;
};

describe("GET /api/auth/verify-email", () => {
  it("sends a confirmed address on to log in, back to where sign-up started", async () => {
    outcome.value = "verified";
    expect(await open("token=t&next=%2Flistings%2Fabc")).toBe("/login?emailConfirmed=1&callbackUrl=%2Flistings%2Fabc");
    expect(await open("token=t")).toBe("/account?emailVerified=verified");
  });

  it("never follows an off-site return path", async () => {
    outcome.value = "verified";
    expect(await open("token=t&next=%2F%2Fevil.example")).toBe("/account?emailVerified=verified");
  });

  it.each(["expired", "used", "invalid"])("explains a %s link and offers a new one", async (value) => {
    outcome.value = value;
    expect(await open("token=t")).toBe(`/verify-email?status=${value}`);
  });

  it("treats a missing token as invalid", async () => {
    expect(await open("")).toBe("/verify-email?status=invalid");
  });
});
