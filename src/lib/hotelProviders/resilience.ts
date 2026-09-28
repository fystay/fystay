import type { HotelProviderAdapter } from "@/lib/hotelProviders/types";
import { HotelProviderAdapterError, HotelProviderTimeoutError } from "@/lib/hotelProviders/types";
import type { ResilienceConfig } from "@/lib/hotelProviders/config";

export type { ResilienceConfig } from "@/lib/hotelProviders/config";

/**
 * Provider-agnostic timeout, cancellation, bounded retry and overall budget
 * around the three network-facing HotelProviderAdapter methods (never
 * createDeepLink, a synchronous pure string builder). Knows nothing about any
 * specific provider - it only reads HotelProviderAdapterError.retryable.
 *
 * Rules (defaults from config.ts: 4000ms per attempt, 3 attempts, 10000ms
 * total budget, 200ms/400ms backoff):
 *   - The total budget always wins. Each attempt's timeout is the smaller of
 *     timeoutMs and whatever budget remains.
 *   - A retry happens only if the failure is retryable, attempts remain, the
 *     caller hasn't aborted, and after the backoff at least minAttemptMs of
 *     budget would still remain.
 *   - When an attempt times out, its AbortSignal is aborted (reason: the
 *     HotelProviderTimeoutError), so an adapter that passes the signal to
 *     fetch() genuinely cancels the request. An adapter that ignores the
 *     signal can't be forcibly stopped by JavaScript - its result is simply
 *     discarded - so network-facing adapters must honour it.
 *
 * Worst case with the defaults is ~10 seconds for one provider call, never
 * 3 x 4 seconds plus backoff: 4000ms timeout, 200ms backoff, 4000ms timeout,
 * 400ms backoff, then a final attempt capped at the ~1400ms of budget left.
 * Fast retryable failures (e.g. an immediate 503) can still use all 3
 * attempts, since they consume almost none of the budget.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One attempt: gives `fn` a fresh AbortSignal, aborts it when the attempt
 * times out (or when the caller's own signal aborts), and always clears the
 * timer and listener however the attempt settles - including when `fn`
 * throws synchronously instead of returning a rejected promise.
 */
function runAttempt<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      settle();
    };
    const timer = setTimeout(() => {
      const timeoutError = new HotelProviderTimeoutError(timeoutMs);
      controller.abort(timeoutError);
      finish(() => reject(timeoutError));
    }, timeoutMs);
    function onCallerAbort() {
      controller.abort(callerSignal?.reason);
      finish(() => reject(callerSignal?.reason));
    }

    if (callerSignal?.aborted) {
      onCallerAbort();
      return;
    }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(fn(controller.signal));
    } catch (err) {
      finish(() => reject(err));
      return;
    }
    pending.then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/**
 * Runs `fn` under the rules in this file's top comment. A non-retryable
 * adapter error (e.g. missing credentials) or a genuinely unexpected error
 * that isn't a HotelProviderAdapterError at all propagates on the first
 * attempt, unchanged.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  config: ResilienceConfig,
  callerSignal?: AbortSignal,
): Promise<T> {
  const deadline = Date.now() + config.totalBudgetMs;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    const attemptTimeoutMs = Math.max(1, Math.min(config.timeoutMs, remaining));
    try {
      return await runAttempt(fn, attemptTimeoutMs, callerSignal);
    } catch (err) {
      const retryable = err instanceof HotelProviderAdapterError && err.retryable;
      if (!retryable || attempt >= config.maxAttempts || callerSignal?.aborted) throw err;
      const backoffMs = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
      if (deadline - Date.now() - backoffMs < config.minAttemptMs) throw err;
      await delay(backoffMs);
    }
  }
}

/**
 * Wraps every network-facing method of `adapter` in withRetry, leaving
 * `code`, `name`, the capability flags, and createDeepLink untouched. Called
 * only from registry.ts.
 */
export function withResilientAdapter(adapter: HotelProviderAdapter, config: ResilienceConfig): HotelProviderAdapter {
  return {
    ...adapter,
    searchHotels: (params, signal) => withRetry((s) => adapter.searchHotels(params, s), config, signal),
    getHotelDetails: (externalId, signal) => withRetry((s) => adapter.getHotelDetails(externalId, s), config, signal),
    getAvailability: (externalId, params, signal) =>
      withRetry((s) => adapter.getAvailability(externalId, params, s), config, signal),
  };
}
