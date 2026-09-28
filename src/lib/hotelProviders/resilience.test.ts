import { describe, expect, it, vi } from "vitest";
import { HotelProviderAdapterError, HotelProviderTimeoutError } from "@/lib/hotelProviders/types";
import { withResilientAdapter, withRetry, type ResilienceConfig } from "@/lib/hotelProviders/resilience";
import { createFixtureAdapter } from "@/lib/hotelProviders/testFixtures";

/** Small, fast config for tests - real timeouts/backoff would make this suite slow without adding any coverage. */
const FAST_CONFIG: ResilienceConfig = {
  timeoutMs: 30,
  maxAttempts: 3,
  totalBudgetMs: 5000,
  baseDelayMs: 2,
  maxDelayMs: 5,
  minAttemptMs: 5,
};

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("withRetry: timeout", () => {
  it("returns normally when the provider responds within the timeout", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), FAST_CONFIG);
    expect(result).toBe("ok");
  });

  it("rejects with HotelProviderTimeoutError when the provider exceeds the timeout, without waiting for it to ever settle", async () => {
    const start = Date.now();
    await expect(withRetry(() => neverResolves(), { ...FAST_CONFIG, maxAttempts: 1 })).rejects.toThrow(
      HotelProviderTimeoutError,
    );
    // Generous upper bound - this only needs to prove we didn't wait
    // anywhere near "forever", not pin down exact scheduler timing.
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("surfaces the timeout as both a HotelProviderTimeoutError and a retryable HotelProviderAdapterError", async () => {
    await expect(withRetry(() => neverResolves(), { ...FAST_CONFIG, maxAttempts: 1 })).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof HotelProviderTimeoutError &&
        err instanceof HotelProviderAdapterError &&
        err.retryable === true
      );
    });
  });

  it("does not crash the caller when every attempt times out - it rejects cleanly, which is what search.ts's own catch(HotelProviderAdapterError) depends on", async () => {
    await expect(withRetry(() => neverResolves(), FAST_CONFIG)).rejects.toBeInstanceOf(HotelProviderAdapterError);
  });
});

describe("withRetry: retry policy", () => {
  it("retries a retryable provider error and returns normally once a later attempt succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new HotelProviderAdapterError("transient", { retryable: true });
      return "recovered";
    });

    const result = await withRetry(fn, FAST_CONFIG);

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable provider error - fails on the first attempt", async () => {
    const fn = vi.fn(async () => {
      throw new HotelProviderAdapterError("bad credentials", { retryable: false });
    });

    await expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow("bad credentials");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unexpected error that isn't even a HotelProviderAdapterError", async () => {
    const bug = new TypeError("a real bug");
    const fn = vi.fn(async () => {
      throw bug;
    });

    await expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow(bug);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects the configured retry limit and stops after maxAttempts", async () => {
    const fn = vi.fn(async () => {
      throw new HotelProviderAdapterError("always down", { retryable: true });
    });

    await expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow("always down");
    expect(fn).toHaveBeenCalledTimes(FAST_CONFIG.maxAttempts);
  });
});

describe("withResilientAdapter", () => {
  it("works against the fixture adapter, not just the mock provider - proves this layer is genuinely provider-agnostic", async () => {
    const fixture = createFixtureAdapter({
      searchHotels: vi.fn().mockResolvedValue([{ externalId: "f:1", name: "Fixture", city: "Testville", country: "Testland", facilities: [], currency: "GBP", priceCents: 100 }]),
    });
    const wrapped = withResilientAdapter(fixture, FAST_CONFIG);

    const results = await wrapped.searchHotels({
      destination: "Testville",
      checkIn: new Date("2026-11-01"),
      checkOut: new Date("2026-11-02"),
      adults: 2,
      children: 0,
      rooms: 1,
    });

    expect(results).toHaveLength(1);
    expect(wrapped.code).toBe("fixture");
  });

  it("retries getAvailability transparently when the underlying adapter fails once with a retryable error", async () => {
    let calls = 0;
    const fixture = createFixtureAdapter({
      getAvailability: vi.fn(async () => {
        calls++;
        if (calls < 2) throw new HotelProviderAdapterError("flaky", { retryable: true });
        return [];
      }),
    });
    const wrapped = withResilientAdapter(fixture, FAST_CONFIG);

    const deals = await wrapped.getAvailability("f:1", {
      checkIn: new Date("2026-11-01"),
      checkOut: new Date("2026-11-02"),
      adults: 2,
      children: 0,
      rooms: 1,
    });

    expect(deals).toEqual([]);
    expect(calls).toBe(2);
  });

  it("leaves createDeepLink completely untouched - synchronous, no timeout/retry wrapping", () => {
    const fixture = createFixtureAdapter();
    const wrapped = withResilientAdapter(fixture, FAST_CONFIG);

    const url = wrapped.createDeepLink({
      externalId: "f:1",
      checkIn: new Date("2026-11-01"),
      checkOut: new Date("2026-11-02"),
      adults: 2,
      children: 0,
      rooms: 1,
      subId: "hc_test",
    });

    expect(url).toContain("fixture-provider.invalid");
  });
});

/** A provider call that only ends when its signal is aborted - records every signal it was given. */
function abortableCall(seen: AbortSignal[]) {
  return (signal: AbortSignal) =>
    new Promise<never>((_, reject) => {
      seen.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

describe("withRetry: cancellation", () => {
  it("aborts the attempt's AbortSignal when it times out, with the timeout error as the reason", async () => {
    const seen: AbortSignal[] = [];
    await expect(withRetry(abortableCall(seen), { ...FAST_CONFIG, maxAttempts: 1 })).rejects.toBeInstanceOf(
      HotelProviderTimeoutError,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
    expect(seen[0].reason).toBeInstanceOf(HotelProviderTimeoutError);
  });

  it("gives every retry its own fresh, not-yet-aborted signal", async () => {
    const seen: AbortSignal[] = [];
    const abortedAtStart: boolean[] = [];
    const fn = (signal: AbortSignal) => {
      abortedAtStart.push(signal.aborted);
      return abortableCall(seen)(signal);
    };
    await expect(withRetry(fn, FAST_CONFIG)).rejects.toBeInstanceOf(HotelProviderTimeoutError);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(abortedAtStart).toEqual([false, false, false]);
    expect(seen.every((s) => s.aborted)).toBe(true);
  });

  it("stops a signal-aware provider's work: a fixture that honours the signal sees the abort and stops", async () => {
    let workStopped = false;
    const fixture = createFixtureAdapter({
      searchHotels: (_params, signal) =>
        new Promise((_, reject) => {
          const work = setInterval(() => {}, 5);
          signal?.addEventListener("abort", () => {
            clearInterval(work);
            workStopped = true;
            reject(signal.reason);
          });
        }),
    });
    const wrapped = withResilientAdapter(fixture, { ...FAST_CONFIG, maxAttempts: 1 });
    await expect(
      wrapped.searchHotels({ destination: "x", checkIn: new Date(), checkOut: new Date(), adults: 1, children: 0, rooms: 1 }),
    ).rejects.toBeInstanceOf(HotelProviderTimeoutError);
    expect(workStopped).toBe(true);
  });

  it("propagates a caller's own abort immediately and never retries it", async () => {
    const caller = new AbortController();
    const seen: AbortSignal[] = [];
    const pending = withRetry(abortableCall(seen), { ...FAST_CONFIG, timeoutMs: 1000 }, caller.signal);
    caller.abort(new Error("guest navigated away"));
    await expect(pending).rejects.toThrow("guest navigated away");
    expect(seen).toHaveLength(1);
    expect(seen[0].aborted).toBe(true);
  });
});

describe("withRetry: overall budget", () => {
  const BUDGET_CONFIG: ResilienceConfig = {
    timeoutMs: 60,
    maxAttempts: 10,
    totalBudgetMs: 100,
    baseDelayMs: 5,
    maxDelayMs: 5,
    minAttemptMs: 10,
  };

  it("never lets repeated timeouts exceed the total budget, even with attempts to spare", async () => {
    const seen: AbortSignal[] = [];
    const start = Date.now();
    await expect(withRetry(abortableCall(seen), BUDGET_CONFIG)).rejects.toBeInstanceOf(HotelProviderTimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(BUDGET_CONFIG.totalBudgetMs + 50);
    expect(seen.length).toBeLessThan(BUDGET_CONFIG.maxAttempts);
  });

  it("caps an attempt's timeout at the remaining budget, not the full per-attempt timeout", async () => {
    const errors: string[] = [];
    const fn = (signal: AbortSignal) =>
      abortableCall([])(signal).catch((err: Error) => {
        errors.push(err.message);
        throw err;
      });
    await expect(withRetry(fn, BUDGET_CONFIG)).rejects.toBeInstanceOf(HotelProviderTimeoutError);
    // First attempt gets the full 60ms; the second only what's left of 100ms.
    expect(errors[0]).toBe("Provider call timed out after 60ms");
    const secondMs = Number(errors[1]?.match(/after (\d+)ms/)?.[1]);
    expect(secondMs).toBeLessThan(60);
  });

  it("does not start a retry when the backoff would not leave at least minAttemptMs of budget", async () => {
    const fn = vi.fn(async () => {
      throw new HotelProviderAdapterError("transient", { retryable: true });
    });
    await expect(
      withRetry(fn, { ...BUDGET_CONFIG, totalBudgetMs: 100, baseDelayMs: 95, maxDelayMs: 95 }),
    ).rejects.toThrow("transient");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lets fast retryable failures use every attempt, since they consume almost no budget", async () => {
    const fn = vi.fn(async () => {
      throw new HotelProviderAdapterError("503", { retryable: true });
    });
    await expect(withRetry(fn, { ...FAST_CONFIG, maxAttempts: 3 })).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("keeps the agreed production defaults' worst case at the 10s budget, not 3 x 4s plus backoff", async () => {
    const { resolveHotelProviderConfig } = await import("@/lib/hotelProviders/config");
    const defaults = resolveHotelProviderConfig({}).resilience;
    // Scale the real defaults down 100x so the test is fast but exercises
    // exactly the same budget arithmetic.
    const scaled: ResilienceConfig = {
      timeoutMs: defaults.timeoutMs / 100,
      maxAttempts: defaults.maxAttempts,
      totalBudgetMs: defaults.totalBudgetMs / 100,
      baseDelayMs: defaults.baseDelayMs / 100,
      maxDelayMs: defaults.maxDelayMs / 100,
      minAttemptMs: defaults.minAttemptMs / 100,
    };
    const start = Date.now();
    await expect(withRetry(abortableCall([]), scaled)).rejects.toBeInstanceOf(HotelProviderTimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(scaled.totalBudgetMs + 40);
    expect(elapsed).toBeGreaterThanOrEqual(scaled.totalBudgetMs - 20);
  });
});

describe("withRetry: cancellation during retry backoff", () => {
  const BACKOFF_CONFIG: ResilienceConfig = {
    timeoutMs: 1000,
    maxAttempts: 3,
    totalBudgetMs: 60_000,
    baseDelayMs: 5000,
    maxDelayMs: 5000,
    minAttemptMs: 10,
  };

  it("rejects promptly with the caller's abort reason while waiting to retry, starts no further attempt, and leaves no timer or listener behind", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
      const fn = vi.fn(async () => {
        throw new HotelProviderAdapterError("503", { retryable: true });
      });
      const pending = withRetry(fn, BACKOFF_CONFIG, caller.signal);
      const settled = pending.catch((err: unknown) => err);
      // Let the first attempt fail and the 5s backoff begin.
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      const reason = new Error("guest navigated away");
      caller.abort(reason);
      // No timer advance: the abort alone must settle the call.
      expect(await settled).toBe(reason);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      // Both the attempt's and the backoff's abort listeners were removed.
      expect(removeSpy.mock.calls.filter(([type]) => type === "abort").length).toBeGreaterThanOrEqual(1);

      // Running every remaining timer can't start another attempt.
      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the backoff's abort listener when the wait completes normally, so retries still happen as before", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const addSpy = vi.spyOn(caller.signal, "addEventListener");
      const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new HotelProviderAdapterError("503", { retryable: true });
        return "ok";
      });
      const pending = withRetry(fn, BACKOFF_CONFIG, caller.signal);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
      // Every abort listener added (2 attempts + 1 backoff) was removed again.
      const added = addSpy.mock.calls.filter(([type]) => type === "abort").length;
      const removed = removeSpy.mock.calls.filter(([type]) => type === "abort").length;
      expect(added).toBe(3);
      expect(removed).toBe(added);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withRetry: synchronous throws", () => {
  it("retries a retryable error thrown synchronously (not as a rejected promise)", async () => {
    let calls = 0;
    const result = await withRetry(() => {
      calls++;
      if (calls === 1) throw new HotelProviderAdapterError("sync transient", { retryable: true });
      return Promise.resolve("ok");
    }, FAST_CONFIG);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a non-retryable error thrown synchronously", async () => {
    const fn = vi.fn(() => {
      throw new HotelProviderAdapterError("sync config", { retryable: false });
    });
    await expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow("sync config");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
