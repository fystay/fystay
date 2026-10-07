import { afterEach, describe, expect, it, vi } from "vitest";

const { send, captureMessage } = vi.hoisted(() => ({ send: vi.fn(), captureMessage: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

import { getResendClient } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getResendClient", () => {
  it("is null without a key, so development skips email", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(getResendClient()).toBeNull();
  });

  it("reports an email Resend refused instead of letting it vanish", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domain not verified" } });

    const result = await getResendClient()!.emails.send({ from: "a@b.c", to: "guest@example.com", subject: "Booking confirmed", html: "x" });

    expect(result.error?.message).toBe("domain not verified");
    expect(captureMessage).toHaveBeenCalledWith(
      "Email not sent: validation_error",
      expect.objectContaining({ extra: { subject: "Booking confirmed", reason: "domain not verified" } }),
    );
    // The recipient stays out of the report.
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain("guest@example.com");
  });

  it("reports nothing when the email was accepted", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    send.mockResolvedValueOnce({ data: { id: "e1" }, error: null });
    await getResendClient()!.emails.send({ from: "a@b.c", to: "x@y.z", subject: "Hi", html: "x" });
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
