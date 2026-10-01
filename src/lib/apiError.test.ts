import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { withApiErrorHandling } from "./apiError";

describe("withApiErrorHandling", () => {
  it("turns a malformed JSON body into a 400 without reporting it", async () => {
    const handler = withApiErrorHandling(async (request: Request) => {
      await request.json();
      return new Response("ok");
    });
    const res = await handler(new Request("http://x", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("turns an unexpected error into a generic 500 and reports it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiErrorHandling(async () => {
      throw new Error("database exploded");
    });
    const res = await handler();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong. Please try again." });
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
