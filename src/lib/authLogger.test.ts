import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));

import { reportAuthError } from "./authLogger";

const authError = (type: string) => Object.assign(new Error(`${type} happened`), { type });

beforeEach(() => {
  capture.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportAuthError", () => {
  it("sends provider and configuration failures to Sentry, grouped by type", () => {
    reportAuthError(authError("CallbackRouteError"));
    reportAuthError(authError("InvalidCheck"));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0][1]).toMatchObject({ tags: { area: "auth", authErrorType: "CallbackRouteError" } });
  });

  it("keeps expected outcomes like a wrong password out of Sentry", () => {
    reportAuthError(authError("CredentialsSignin"));
    reportAuthError(authError("MissingCSRF"));
    expect(capture).not.toHaveBeenCalled();
  });

  it("logs only the error type, never its message", () => {
    reportAuthError(authError("CallbackRouteError"));
    expect(console.error).toHaveBeenCalledWith("[auth][error] CallbackRouteError");
  });
});
