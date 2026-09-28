# Hotel provider integration runbook

**Status: Booking.com is NOT live.** As of this writing, `booking_com` is a
registered adapter (`src/lib/hotelProviders/providers/bookingCom.ts`) whose
every method throws before doing anything - either because credentials are
unset, or (even once they're set) because the request/response shapes and
deep-link format haven't been confirmed against Booking.com's live API. No
`HotelProvider` row with `code: "booking_com"` is ever seeded, and
`LIVE_HOTEL_PROVIDER_CODES` (`src/lib/hotelProviders/registry.ts`) does not
list it - so the registry refuses it at runtime even if its row were set
`ACTIVE` and credentials were present. Section 5 describes that activation
mechanism exactly as the code enforces it today; the rest of this document
is what has to happen, in order, before Booking.com can be activated.

This runbook covers connecting *any* real hotel provider through the
existing `HotelProviderAdapter` abstraction. Booking.com is used as the
worked example because it's the provider already stubbed out, but nothing
here is Booking.com-specific except where explicitly labelled.

---

## 1. Credentials

| Env var | Where it belongs | Notes |
|---|---|---|
| `BOOKING_COM_API_KEY` | Server-only env var (Vercel project env, never `NEXT_PUBLIC_*`) | Issued via the Booking.com Affiliate Partner Centre. Rotate every 12 months per Booking.com's own recommendation. |
| `BOOKING_COM_AFFILIATE_ID` | Same as above | Identifies the affiliate account in every request. |
| `BOOKING_COM_API_BASE_URL` | Same as above, optional | Defaults to the confirmed sandbox host (`https://demandapi-sandbox.booking.com`). Only ever set to a production host once you have specifically decided to go live - never as a default, and never committed anywhere. |

**Which environments need them**: production and any preview/staging
environment that should exercise real Booking.com traffic. Local
development and CI should keep these unset and use the `mock` provider
instead - that's what it exists for.

**Storage**: Vercel project environment variables (or your platform's
equivalent secret store), scoped per-environment. Never in `.env` files
committed to git, never in `NEXT_PUBLIC_*` variables, never logged (see
Security below).

---

## 2. Provider specification - what must be confirmed before writing code

`bookingCom.ts`'s own top-of-file comment is the authoritative, current
ledger of what's confirmed vs. not - read it first; don't duplicate or
re-derive it here, since it will go stale independently of this doc. As of
this phase, confirmed: auth headers (`Authorization: Bearer`,
`X-Affiliate-Id`), the sandbox host, and that Managed Affiliate Partner
status + a signed contract are required just to get Partner Centre access.
**Not confirmed - required before implementation, not to be guessed**:

- API base URL / path segment (search, hotel details, availability, rates
  and rooms) - confirmed only by reading Booking.com's own live OpenAPI
  spec once partner access exists (never invented, never inferred from a
  training-data guess or a paraphrased blog post).
- Full request/response schemas for search, hotel details, and
  availability.
- The rate/room schema (what fields a "deal" actually carries).
- The error response schema (status codes, error body shape) - needed to
  correctly set `HotelProviderAdapterError.retryable` per error type (a 429
  or 5xx should be retryable; a 400/401/403 should not).
- Rate limits (requests/minute or /day) - needed to size
  `HOTEL_PROVIDER_MAX_ATTEMPTS`/backoff sensibly and to decide whether the
  cache TTLs in `cache.ts` need lengthening for this specific provider.
- Realistic timeout expectations (p50/p99 latency) - needed to tune
  `HOTEL_PROVIDER_TIMEOUT_MS` correctly; the current 8000ms default is a
  generic placeholder, not validated against any real provider.

## 3. Affiliate tracking - what must be confirmed

- **Deep-link/redirect URL format**: the single most important unconfirmed
  fact. Until this is read from Booking.com's own affiliate documentation,
  `createDeepLink()` must keep throwing rather than guessing at a URL
  shape - a wrong deep link either loses commission attribution silently or
  sends a guest to a broken page.
- **Required affiliate parameters**: which query params/headers Booking.com
  expects to attribute a click (their own "aid"/sub-id mechanism or
  equivalent).
- **Sub-ID/tracking requirements**: confirm the accepted format/length for
  a sub-ID before wiring `computeClickSubId`'s output into it - the current
  32-hex-char `hc_...` format is FYStay's own convention, not validated
  against any provider's actual constraints.
- **Attribution rules**: how long after a click Booking.com will still
  attribute a resulting booking (their "cookie window" equivalent) - this
  affects how confidently `AffiliateConversion` rows can be trusted to
  correspond to a specific click.
- **Conversion/postback requirements**: what access level, format, and
  authentication Booking.com's reporting/postback API needs before
  `supportsConversionTracking` can honestly become `true` for this
  provider. Until then it must stay `false` (see `AffiliateConversion`'s
  own schema comment on why a fabricated conversion is never acceptable).

---

## 4. Application changes required once the above is confirmed

In the order they'd actually need implementing:

1. **`src/lib/hotelProviders/providers/bookingCom.ts`** - replace each
   `notYetConfirmed(...)` call with a real implementation, following the
   confirmed schemas exactly. `getBookingComCredentials()` stays as-is. Each
   network method must pass the `signal` argument it receives to `fetch()`,
   so a timed-out or over-budget call is genuinely cancelled rather than
   left running in the background.
2. **`src/lib/hotelProviders/click.ts`** - add `"booking_com"` to
   `ALLOWED_DEEP_LINK_HOSTS` with the confirmed real host(s), *only* once
   `createDeepLink()` is implemented and manually verified to only ever
   return URLs on that host.
3. **Database**: create the `HotelProvider` row with the operator CLI
   (`npm run db:hotel-provider -- create booking_com`, see Section 5). It is
   always created `INACTIVE` - creating the row is not the same as going
   live.
4. **`src/lib/hotelProviders/registry.ts`** - add `"booking_com"` to
   `LIVE_HOTEL_PROVIDER_CODES`. This is the code-level authorisation the
   registry enforces at runtime (see Section 5) - do this only after
   Section 6's testing checklist passes in full against the sandbox.
5. **Tuning**: revisit `HOTEL_PROVIDER_TIMEOUT_MS` (default 4000),
   `HOTEL_PROVIDER_MAX_ATTEMPTS` (default 3),
   `HOTEL_PROVIDER_TOTAL_BUDGET_MS` (default 10000), and the two cache TTL
   env vars against Booking.com's actual confirmed latency/rate-limit numbers
   from Section 2 - the shipped defaults are generic placeholders, not tuned
   to any real provider. Invalid values fail closed (see Section 8).
6. No changes needed anywhere else: `search.ts`, the redirect route, the
   admin dashboard, and every UI component already call through the
   `HotelProviderAdapter` abstraction and the resilience/cache wrappers -
   that's the whole point of Phase 12.

---

## 5. How a provider becomes operational (enforced in code)

Every provider call in the app obtains its adapter through
`getOperationalHotelProviderAdapter` in `src/lib/hotelProviders/registry.ts`,
which applies `evaluateProviderActivation` at runtime. A provider that fails
the rule gets a locked adapter: every method throws
`HotelProviderNotOperationalError` and the real adapter is never called.
Search skips it, the detail page shows "unavailable", and the redirect route
falls back to `/hotels` before recording any click.

**The rule**, in the order the code checks it:

1. The code has a registered adapter in `registry.ts`.
2. The `HotelProvider` row's `status` is `ACTIVE`. `INACTIVE` and
   `COMING_SOON` are never operational.
3. If it is a fixture provider (`FIXTURE_HOTEL_PROVIDER_CODES`, currently
   only `mock`): operational in development and preview, **never** when
   `VERCEL_ENV=production`, even if someone also lists it as live.
4. Otherwise it is an external provider: operational only if its code is in
   `LIVE_HOTEL_PROVIDER_CODES`.
5. Once operational, the adapter still enforces its own readiness. For
   example `booking_com` throws until credentials are set and its endpoints
   have been confirmed and implemented.

**What each piece does:**

| Piece | What it does | What it does *not* do |
|---|---|---|
| `HotelProvider.status` (database) | Must be `ACTIVE` for any provider to operate. Can be flipped without a deploy, so it is the quick off switch. | Cannot make an external provider operational by itself, and cannot make `mock` operational in production. |
| `LIVE_HOTEL_PROVIDER_CODES` (code) | Explicitly authorises an external provider. Changing it requires a code change and deploy. Frozen at runtime. | Cannot make a provider operational while its database status isn't `ACTIVE`. Has no effect on fixture providers. |
| `FIXTURE_HOTEL_PROVIDER_CODES` (code) | Marks demo providers (`mock`) that may run outside production only. | Nothing in production - a fixture provider can never operate there. |
| Provider credentials (env vars) | Let an operational adapter authenticate to its provider. | **Never** make a provider operational on their own. |

**What makes `mock` usable:** its row is `ACTIVE` (the dev seed does this;
the seed refuses to run in production) and the deployment is not
production.

**What makes an external provider usable:** its adapter is registered, its
row is `ACTIVE`, its code is in `LIVE_HOTEL_PROVIDER_CODES`, and its adapter's
own readiness checks pass. On a production deployment an external provider
is the only kind that can serve traffic.

**Before `booking_com` can be activated**, all of these must be true:
Sections 2 and 3 are confirmed from Booking.com's own documentation;
Section 4 steps 1-3 are implemented; every Section 6 check has passed against
the sandbox; production credentials are set in production only; its
`HotelProvider` row is set to `ACTIVE`; and `"booking_com"` is added to
`LIVE_HOTEL_PROVIDER_CODES` as its own reviewed change.

The rule is covered by `registry.test.ts`, including tests that fail if the
runtime check is removed.

**Operator tooling for `HotelProvider` rows** (`prisma/hotel-provider.ts`,
logic in `src/lib/hotelProviders/providerAdmin.ts`). A terminal command run
with the target database's own `DATABASE_URL` - deliberately not an HTTP
endpoint or admin page:

```
npm run db:hotel-provider -- list
npm run db:hotel-provider -- create <code> [--apply --confirm-host=<host>]
npm run db:hotel-provider -- set-status <code> <ACTIVE|INACTIVE|COMING_SOON> [--apply --confirm-host=<host>]
```

- `list` shows every registered adapter and database row, with the
  activation decision for both non-production and production (the tool
  can't know which deployment a database serves).
- `create` only accepts registered codes, always creates the row
  `INACTIVE`, and copies the name and capability flags from the adapter.
- `set-status` prints the resulting decision, including when `ACTIVE` still
  won't make a provider operational (not live-listed, or a fixture in
  production).
- Every write is a dry run unless `--apply` is given, and `--apply` also
  requires `--confirm-host` to match the `DATABASE_URL` host exactly. The
  host and database name are printed; credentials never are.
- There is no delete and no flag editing. `LIVE_HOTEL_PROVIDER_CODES` is
  unaffected - the tool cannot make an external provider operational.

---

## 6. Testing - what must pass before a provider can be marked live

All of the following, against the confirmed sandbox (never production,
until every one of these has passed against sandbox first):

- [ ] Unit tests for the real adapter implementation: successful response
  parsing, malformed/partial response handling, and every documented error
  status mapped to the correct `retryable` value.
- [ ] `resilience.ts`'s existing tests still pass unmodified - the adapter
  change should need zero changes there (it's provider-agnostic by
  construction).
- [ ] `cache.ts`'s existing tests still pass unmodified, plus a manual
  sanity check that a real search/availability call is actually being
  cached (check `HotelProviderCacheEntry` rows) and expiring on schedule.
- [ ] A live sandbox smoke test: real search, real hotel details, real
  availability, for at least 3 different real destinations/date ranges.
- [ ] A live sandbox click: confirm the generated deep link resolves to a
  real Booking.com sandbox page, and that `AffiliateClick.deepLinkUrl`
  matches exactly what was followed.
- [ ] Cancellation confirmed: force a slow sandbox response past the
  per-attempt timeout and confirm the underlying HTTP request is aborted
  (the adapter passes the `signal` through to `fetch()`).
- [ ] Rate-limit behavior confirmed: intentionally exceed the documented
  rate limit against sandbox and confirm the adapter surfaces a retryable
  `HotelProviderAdapterError`, not a crash or a silently-wrong result.
- [ ] `e2e/hotel-affiliate.spec.ts` passes unmodified with `mock` still the
  only provider exercised by that suite (it should never need to change to
  accommodate a new provider - if it does, something leaked provider-
  specific logic outside the adapter).
- [ ] A new, provider-specific e2e smoke test added for `booking_com`
  itself, run against sandbox only, never in the default CI run against
  production credentials.
- [ ] Full regression: `npx vitest run`, `npx tsc --noEmit`,
  `npx eslint . --max-warnings=0`, `npm run build` all clean.
- [ ] Manual review: confirm no credential, sandbox/production host, or
  real guest PII ever appears in a log line (see Security below).

Only once every box above is checked against sandbox does activating the
provider as described in Section 5 - with production credentials - become
appropriate. Do that as its own deliberate, reviewed change, not bundled
into an unrelated feature commit.

---

## 7. Security

- **Server-side secret handling**: every credential is read only inside
  `getBookingComCredentials()` (server-only module, never imported from a
  `"use client"` file) and never returned from any function, logged, or
  serialized into a response. This pattern must not change when the real
  implementation is written in.
- **Deep-link allowlisting**: `ALLOWED_DEEP_LINK_HOSTS` in `click.ts` is
  the last line of defense against a future adapter bug returning an
  unexpected host - adding a provider here is always paired with manually
  confirming `createDeepLink()` genuinely only ever returns that host, not
  assumed from documentation alone.
- **Credential handling**: never commit a `.env` file with real values;
  `.env.example` documents every variable name with an empty value only.
  Rotate `BOOKING_COM_API_KEY` per Booking.com's own 12-month
  recommendation once live.
- **Logging restrictions**: every provider failure is logged through
  `src/lib/hotelProviders/providerLog.ts` as one JSON line built from named
  fields only (operation, provider code, outcome, error class, retryable,
  status code, not-operational reason, validation issue paths/codes,
  duration, the provider's hotel id). It never logs an error's message,
  cause or stack, the provider's response, or anything about the guest
  (search text, dates, guest counts, user/session id, IP, cookies, the
  deep-link URL). Adapter error messages should still never contain a
  credential or payload, since other code (e.g. `withApiErrorHandling`)
  may log unexpected errors in full. Log events: `hotel_provider.call_failed`,
  `hotel_provider.response_items_dropped`, `hotel_provider.upsert_conflict`,
  `hotel_provider.deep_link_refused`. Malformed responses are also reported
  to Sentry when `SENTRY_DSN` is set.
- **PII considerations**: `AffiliateClick` already stores `ipAddress`,
  `userAgent`, and (for logged-in users) `userId` - this predates Phase 12
  and is unchanged by it. A real provider's error responses or logs must
  never be persisted verbatim if they could contain another guest's PII
  (unlikely for a hotel-search API, but verify against the confirmed error
  schema in Section 2 before shipping).

---

## 8. What Phase 12 already built, ready for a real provider to use for free

- **Timeout, cancellation, retry and overall budget**
  (`src/lib/hotelProviders/resilience.ts`): wraps every operational adapter
  automatically via `registry.ts`. Defaults: 4000ms per attempt, up to 3
  attempts, 10000ms total budget, 200ms/400ms backoff. The total budget
  always wins - each attempt is capped at the budget remaining, and a retry
  only starts if the failure is retryable and the backoff plus a useful
  attempt still fit. Worst case for one provider call is therefore about 10
  seconds (4000ms, 200ms, 4000ms, 400ms, then a final ~1400ms attempt), not
  3 x 4 seconds. Each attempt gets its own `AbortSignal`, aborted on timeout.
- **Caching** (`src/lib/hotelProviders/cache.ts`): automatic via
  `registry.ts`, provider-scoped cache keys, safe TTLs for price/inventory
  data. Expired rows are removed by a bounded cleanup pass (at most 200
  rows) that about 5% of cache writes schedule to run after the response
  is sent.
- **Configuration validation** (`src/lib/hotelProviders/config.ts`): every
  tuning env var must be a positive whole number within its documented
  range. An invalid value fails closed - the detail is logged server-side
  and the provider call returns the generic "unavailable" state to guests.
- **The activation gate**: `evaluateProviderActivation` /
  `getOperationalHotelProviderAdapter`, described in Section 5.

Phase 14 added:

- **Response validation** (`src/lib/hotelProviders/validation.ts`): every
  adapter result is checked against FYStay's own domain types before it can
  be retried, cached or written to `AffiliateHotel`. Invalid search results
  or deals (and repeated `externalId`s) are dropped and logged; the whole
  response is rejected, non-retryably, when it isn't an array, exceeds its
  size limit (200 results / 100 deals), or had items but none were valid.
  Details are all-or-nothing and must be for the hotel requested. Unknown
  fields are stripped. A real adapter only has to map its provider's
  payload into those types to get this for free.
- **Failure logging** (`providerLog.ts`): see Section 7.
- **Concurrent upserts**: `upsertAffiliateHotels` retries a lost
  `P2002` race (bounded, then falls back to the rows that exist) and takes
  its locks in a consistent order so concurrent writers can't deadlock.
- **Cancellable backoff**: a caller abort during the wait between retries
  takes effect immediately.
- **Parallel detail page**: live details and live availability are fetched
  concurrently after a database-only lookup, so the page's worst case is one
  provider budget (~10s by default) rather than two.

None of this required, or should ever require, a single Booking.com-shaped
conditional anywhere in the application.

---

## 9. Go-live check: function execution time on Vercel

Provider calls run inside the page's serverless function, so the function's
maximum duration must exceed the worst-case provider time plus database
work. With the default tuning:

| Path | Provider calls | Worst case |
|---|---|---|
| `/hotels/[destination]/[hotelSlug]` | details and availability, in parallel | ~10s + DB |
| `/hotels` (search results) | one `searchHotels` per operational provider, **sequentially** | ~10s x providers + DB |
| `/api/hotels/redirect` | none (`createDeepLink` is synchronous) | DB only |

`HOTEL_PROVIDER_TOTAL_BUDGET_MS` can be raised to 120s, and each extra
operational provider adds a full budget to search - both must stay inside
the function limit.

**Not yet verified (Phase 14):** the project's effective default and maximum
function duration. The Vercel connector could read the team, project,
region (`iad1`) and deployments, but not the plan, whether Fluid compute is
enabled, or the function-duration setting, so no `maxDuration` was added to
either hotel page. Comments elsewhere in this codebase assume a 10s default
and 60s Hobby ceiling; that predates Fluid compute and must not be relied on.

Before going live with a real provider:

1. In the Vercel dashboard (Project -> Settings -> Functions, and the team's
   plan), record the plan, whether Fluid compute is on, and the default and
   maximum function duration.
2. If the default is below the worst case above plus a safety margin, add
   `export const maxDuration = <seconds>` to the affected `page.tsx`, no
   higher than the verified maximum.
3. Re-check this whenever the tuning env vars change or a second provider
   becomes operational.
