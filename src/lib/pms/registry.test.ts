import { afterEach, describe, expect, it, vi } from "vitest";
import { isPmsProviderConnectable } from "./registry";

describe("isPmsProviderConnectable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers Cloudbeds only once FYStay's Cloudbeds credentials are set", () => {
    vi.stubEnv("CLOUDBEDS_CLIENT_ID", "");
    vi.stubEnv("CLOUDBEDS_CLIENT_SECRET", "");
    expect(isPmsProviderConnectable("CLOUDBEDS")).toBe(false);
    vi.stubEnv("CLOUDBEDS_CLIENT_ID", "id");
    vi.stubEnv("CLOUDBEDS_CLIENT_SECRET", "secret");
    expect(isPmsProviderConnectable("CLOUDBEDS")).toBe(true);
  });

  it("never offers a provider that isn't built yet", () => {
    expect(isPmsProviderConnectable("SITEMINDER")).toBe(false);
    expect(isPmsProviderConnectable("SUPERCONTROL")).toBe(false);
  });
});
