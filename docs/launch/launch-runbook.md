# FYStay launch runbook

Do the steps in order. Each says who does it and how to check it worked.
Remaining items are tracked in [master-checklist.md](master-checklist.md).

## 0. Golden rules

- Production changes go out as a **fresh Production build** from a commit
  (Vercel → Deployments → "Redeploy" without build cache, or a new
  production deployment of that commit). Never re-point Production at a
  Preview build: Preview builds carry Preview variables.
- Database changes go through the **"Production database migration"**
  GitHub Action, never by hand. See `docs/production-database-migrations.md`.
  Order: migrate, then deploy.
- Never set `ALLOW_PRODUCTION_SEED`. Never put test Stripe keys in Production.

## 1. Business and legal (you)

1. Decide the trading entity (limited company or sole trader). Note the
   exact legal name, the registered/business address, and the company
   number if any.
2. Register with the ICO (data-protection fee) if required.
3. Send `docs/launch/legal-drafts.md`, the live `/legal/terms`,
   `/legal/privacy` and `/legal/cookies` pages and `/cancellation-policies` to
   a solicitor. Ask an accountant about VAT on the 10% service fee.

## 2. Domain and email (you, with me)

1. Buy or confirm the domain. In Vercel → Settings → Domains, add it and
   follow the DNS instructions until it shows **Valid**.
2. Resend: add a sending subdomain (e.g. `mail.yourdomain`). Add the SPF, DKIM
   and bounce MX records it shows, plus a DMARC record (`_dmarc`, starting
   `p=none`). Wait for **Verified**.
3. Resend → API Keys → create a **Sending access** key restricted to that
   domain. Paste it straight into Vercel (step 3); don't send it anywhere else.
4. Create real mailboxes or forwarders for support, privacy and legal.

## 3. Production variables (you enter secrets; I can enter public values)

In Vercel → Settings → Environment Variables, target **Production only**:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | from step 2.3 (Sensitive) |
| `EMAIL_FROM` | `FYStay <bookings@mail.yourdomain>` |
| `TWO_FACTOR_ENCRYPTION_KEY` | output of `openssl rand -hex 32` on your own computer (Sensitive). **Never change it.** |
| `SENTRY_AUTH_TOKEN` | Sentry Organization Auth Token (Sensitive). The DSN, org and project are already set. |
| `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_COMPANY_NUMBER` (if any) | from step 1.1 |
| `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PRIVACY_EMAIL`, `NEXT_PUBLIC_LEGAL_EMAIL` | from step 2.4 |
| `NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL` | `https://yourdomain` |


## 4. Deploy (me)

1. Check whether any new migration exists since the last Production
   migration. If so, run the migration workflow for the target commit first.
2. Create a fresh Production build of the target commit, and confirm it
   builds rather than re-pointing an existing deployment.
3. Verify:
   - `/`, `/search`, `/login` return 200;
   - `/legal/terms` shows the operator disclosure;
   - a spoofed `x-vercel-cron` request gets 401;
   - password reset sends a real email and its JSON contains no link;
   - the 2FA card offers setup;
   - Vercel shows no runtime errors.

## 5. First admin (you, then me to verify)

1. Sign up on the live site with the email you'll use as admin. Use a
   strong password, then turn on 2FA (possible once step 3 is live).
2. Grant the role. Either:
   - **You:** with the Production `DATABASE_URL` in your shell, run
     `npx tsx scripts/admin/grant-admin.ts you@yourdomain`. It's a dry run and
     prints the target host. Then re-run it with `--confirm`.
   - **Or ask me** to run the same change through the Supabase connection.
     It's a single role update on your account, which I'll do only on your
     explicit say-so.
3. Log in again and open `/admin`. Every admin section should load, including
   `/admin/listings`.

## 6. Stripe and email

Follow [stripe-and-email-setup.md](stripe-and-email-setup.md): the exact
variables, webhook endpoints, events and dashboard settings, and the first
live booking and refund check. You enter every secret yourself.

## 7. Soft launch

1. Onboard a few known hosts. They create listings, which go live on
   publish. Review each in `/admin/listings` and suspend anything wrong.
2. Watch Sentry and Vercel logs daily for the first two weeks. Cron jobs run
   between 05:00 and 10:00 UTC; check they return 200.
3. Keep `docs/launch/master-checklist.md` current.

## Rollback

- **App:** Vercel → Deployments → the previous Production deployment →
  "Promote", or Instant Rollback. Previous production builds were built with
  Production variables, so promoting one of *them* is safe.
- **Database:** migrations are expand/contract, so the previous app version
  keeps working against the migrated schema. Never roll a migration back by
  hand; ask first.
