# Environment variables

Every variable the app reads, what it does, and its state in **Vercel
Production** as of 1 October 2026. Read from the variable list, never the
values. `.env.example` holds the developer-facing notes for each one.

**Any change only takes effect after a new Production build**, because
Vercel attaches variables when a deployment is built. `NEXT_PUBLIC_*`
values are also compiled into the browser code.

Secret = mark it **Sensitive** in Vercel. Public = safe to be seen; the
`NEXT_PUBLIC_` ones are visible to anyone in the page source.

## Core

| Variable | Used for | Type | Production |
|---|---|---|---|
| `DATABASE_URL` | App database (Supabase transaction pooler) | Secret | Set |
| `DIRECT_URL` | Prisma direct connection | Secret | Set |
| `PMS_HOST_SCOPED_DATABASE_URL` | Row-level-security-scoped role for PMS data | Secret | Set |
| `AUTH_SECRET` | Signs login sessions | Secret | Set |
| `NEXTAUTH_URL` | Auth origin | Public | Set; update when the domain changes |
| `NEXT_PUBLIC_BASE_URL` | Every absolute link: emails, Stripe redirects, sitemap, canonical URLs | Public | Set (`fystay.vercel.app`, trailing slash now harmless); update for the domain |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Photo/avatar storage | URL public, key **secret** | Set |
| `CRON_SECRET` | Authenticates Vercel Cron to all `/api/cron/*` routes | Secret | Set, verified |

## Needed for launch

| Variable | Used in | Type | Production |
|---|---|---|---|
| `RESEND_API_KEY` | `src/lib/email.ts`: every email (booking, reset, email change) | Secret | **Missing** |
| `EMAIL_FROM` | Sender, e.g. `FYStay <bookings@mail.yourdomain>`; must be on the Resend-verified domain | Server-only | **Missing** (fallback only reaches the Resend account owner) |
| `TWO_FACTOR_ENCRYPTION_KEY` | `src/lib/twoFactorCrypto.ts`: encrypts 2FA secrets (AES-256-GCM, key derived from any string). Use `openssl rand -hex 32`. **Never change once anyone uses 2FA.** | Secret | **Missing** (2FA shows "not available") |
| `NEXT_PUBLIC_COMPANY_LEGAL_NAME` | Terms + Privacy operator disclosure (`src/lib/companyInfo.ts`) | Public | **Missing** |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | Same | Public | **Missing** |
| `NEXT_PUBLIC_COMPANY_NUMBER` | Same; only if a limited company/LLP | Public | Leave empty if sole trader |
| `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PRIVACY_EMAIL`, `NEXT_PUBLIC_LEGAL_EMAIL` | Contact addresses on the site (`src/lib/seo.ts`) | Public | Unset (default `support@` / `privacy@` / `legal@fystay.co.uk`) |
| `SENTRY_DSN` | Server error reporting (`src/instrumentation.ts`, every generic 500) | Low-sensitivity | **Missing** |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser error reporting (`src/instrumentation-client.ts`); same value as above | Public | **Missing** |

## Stripe (parked: do not configure until the Stripe decision)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`
(secrets), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (public). None are set in
Production, by design: payments are refused cleanly until they are.

## Optional

| Variable(s) | Feature | Production |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google | Unset (button hidden) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Phone verification | Unset |
| `PMS_ENCRYPTION_KEY` | Storing PMS credentials; `openssl rand -hex 32`, never change | Unset |
| `CLOUDBEDS_CLIENT_ID`, `CLOUDBEDS_CLIENT_SECRET`, `CLOUDBEDS_WEBHOOK_SECRET`, `SITEMINDER_WEBHOOK_SECRET`, `SUPERCONTROL_WEBHOOK_SECRET` | PMS integrations | Unset |
| `TICKETMASTER_API_KEY` | Events on destination pages | Unset |
| `BOOKING_COM_API_KEY`, `BOOKING_COM_AFFILIATE_ID`, `BOOKING_COM_API_BASE_URL` | Hotel affiliate; also needs a code change to activate | Unset |
| `HOTEL_PROVIDER_*`, `HOTEL_*_CACHE_TTL_MS` | Hotel affiliate tuning | Unset (defaults) |
| `DISPUTE_ALERT_EMAIL` | Chargeback alerts; defaults to the support address | Unset |
| `EV_EXEC_NOTIFICATION_EMAIL`, `EV_EXEC_BOOKING_FORM_URL` | Trip-extra provider seeding (demo/Preview) | Unset |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secret) | Readable stack traces | Unset |
| Per-route cron secrets (`LOCAL_DATA_`, `ICAL_SYNC_`, `PMS_RECONCILE_`, `BOOKING_LIFECYCLE_`, `BOOKING_REQUEST_`, `SECURITY_DEPOSIT_CRON_SECRET`) | Manual job runs only; `CRON_SECRET` covers everything | Unset (fine) |

## Should not be in Production

| Variable | Why |
|---|---|
| `SEED_ADMIN_SECRET` | Demo seeding is refused in Production anyway. **Currently set: remove it.** |
| `PROD_DIRECT_URL` | Only the GitHub "production" environment (migration workflow) needs it. **Currently set in Vercel Production: remove it.** |
| `ALLOW_PRODUCTION_SEED` | Would allow demo data into Production. Never set. |
