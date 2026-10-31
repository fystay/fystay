import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/email", () => ({
  EMAIL_FROM: "FYStay <hello@fystay.co.uk>",
  EMAIL_REPLY_TO: "hello@fystay.co.uk",
  reportUnsentOpsAlert: vi.fn(),
  getResendClient: () => ({ emails: { send } }),
}));

import { sendHostInvitation } from "./listingOnboarding";

describe("the owner invitation email", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ error: null });
  });

  it("pitches the whole journey and links the owner into their draft", async () => {
    const update = vi.fn().mockResolvedValue({});
    const result = await sendHostInvitation(
      { hostInvitation: { update } } as never,
      { id: "inv_1", email: "owner@example.com", name: "Sam" },
      ["Lodge on the Lake | 3-Bedroom Lakeside Retreat"],
      { local: false },
    );

    expect(result.sent).toBe(true);
    const message = send.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toBe("We've built your FYStay listing - ready for you to approve");
    expect(message.html).toContain("Hi Sam");
    expect(message.html).toContain("Lodge on the Lake | 3-Bedroom Lakeside Retreat");
    // The steps an owner takes, in order, and what it costs.
    for (const step of ["Create your free account", "Check and approve it", "Set up how you get paid", "Link your calendar", "Go live and start taking bookings"]) {
      expect(message.html).toContain(step);
    }
    expect(message.html).toContain("10% commission");
    expect(message.html).toMatch(/\/host-invitation\?token=[0-9a-f]{64}/);
    // The link is stored hashed and expires.
    expect(update.mock.calls[0][0].data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
