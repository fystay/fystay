import { afterEach, describe, expect, it, vi } from "vitest";

const { captureCheckIn, flush } = vi.hoisted(() => ({
  captureCheckIn: vi.fn(() => "checkin_1"),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/nextjs", () => ({ captureCheckIn, flush, captureException: vi.fn() }));

import { withCronMonitor } from "./observability";

const request = (auth?: string) =>
  new Request("https://fystay.test/api/cron/x", { headers: auth ? { authorization: auth } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("withCronMonitor", () => {
  it("checks in ok, then error, around a real run of the job", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@sentry.test/1");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const ok = withCronMonitor("job", "0 8 * * *", "JOB_SECRET", async () => new Response("ok"));
    await ok(request("Bearer s3cret"));
    expect(captureCheckIn).toHaveBeenNthCalledWith(1, { monitorSlug: "job", status: "in_progress" }, expect.anything());
    expect(captureCheckIn).toHaveBeenNthCalledWith(2, { checkInId: "checkin_1", monitorSlug: "job", status: "ok" });

    const failing = withCronMonitor("job", "0 8 * * *", "JOB_SECRET", async () => new Response("x", { status: 500 }));
    await failing(request("Bearer s3cret"));
    expect(captureCheckIn).toHaveBeenLastCalledWith({ checkInId: "checkin_1", monitorSlug: "job", status: "error" });
  });

  it("never lets an unauthorised caller mark the job as run or failed", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@sentry.test/1");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const job = withCronMonitor("job", "0 8 * * *", "JOB_SECRET", async () => new Response("no", { status: 401 }));
    expect((await job(request("Bearer wrong"))).status).toBe(401);
    expect(captureCheckIn).not.toHaveBeenCalled();
  });

  it("does nothing extra without Sentry", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const job = withCronMonitor("job", "0 8 * * *", "JOB_SECRET", async () => new Response("ok"));
    await job(request("Bearer s3cret"));
    expect(captureCheckIn).not.toHaveBeenCalled();
  });
});
