# Production database backups

FYStay's production database is backed up nightly into the **FYStay Backup**
Supabase project ("fystaybackup") by the GitHub workflow
[`db-backup-production.yml`](../.github/workflows/db-backup-production.yml)
(code: [`scripts/db/backup-production.ts`](../scripts/db/backup-production.ts),
[`src/lib/productionBackup.ts`](../src/lib/productionBackup.ts)).

## The two projects (verified 14 Oct 2026)

| Project | Ref | Evidence |
|---|---|---|
| **Production** | `wzatjhyfwtmxdxfmurkm` | Vercel Production `NEXT_PUBLIC_SUPABASE_URL`; `PRODUCTION_SUPABASE_PROJECT_REF` in `src/lib/databaseIdentity.ts`; holds the live app (63 applied migrations, the owner's host account and Stripe accounts) |
| **Backup** ("fystaybackup") | `sqkpixwvugrxllrxlexs` | Named so in the Supabase organisation "FYStay"; `BACKUP_SUPABASE_PROJECT_REF` in `src/lib/previewDatabase.ts`; owner decision 11 Oct ([handover](launch/handover.md)) |

Both are on the organisation's **Free plan**, region eu-west-1, Postgres 17.

## What Supabase itself provides: nothing, on the Free plan

- **No daily backups.** Supabase backs up Pro, Team and Enterprise projects
  only; it tells Free projects to export their own.
- **No point-in-time recovery (PITR).** PITR is a paid add-on for Pro and
  above, and needs at least the Small compute add-on.
- Having a second project does **not** back anything up or sync anything by
  itself.

So this workflow is the only backup. Native protection can be added only
with the owner's approval, because it costs money (USD, Supabase pricing as
of Oct 2026):

| Option | What you get | Approx. cost |
|---|---|---|
| Pro plan | Supabase daily backups, 7 days, restore from the dashboard | $25/month (org) |
| Pro + PITR (7 days) | Restore to any second in the last 7 days (RPO about 2 minutes) | about $25 + $15 Small compute + $100 PITR, so about $130/month |

## What is backed up

Each night, at 03:17 UTC:

1. **Database:** a `pg_dump` of the `public` schema, which holds all of the
   app's data:
   - users, password hashes, 2FA secrets (still encrypted with the app's
     key), listings, bookings, payments' Stripe IDs, messages, reviews and
     `_prisma_migrations`;
   - its schema, indexes, constraints, RLS policies, grants and functions.
2. **Storage metadata:** `storage.buckets` and `storage.objects` rows,
   which list the photos and avatars and the paths they belong to.
3. **Storage files:** every file in production's public buckets
   (`listing-photos`, `avatars`), copied to `prod-backups/storage/<bucket>/<path>`.
   A file is copied again only when it is new or its size has changed.
4. A `manifest.json`: time, Postgres versions, row count per table, number of
   migrations and the latest one, and file sizes and SHA-256 checksums.

Before a backup is kept, it is **restored into an empty Postgres 17 on the
runner** and checked:
- the restored copy has every row the dump has, table by table;
- the dump has every production table, and row counts close to the live
  counts read just before it;
- the same applied migrations as production.

After upload, the dump is read back and its checksum compared. Any failure
stops the run, keeps nothing new, and fails the workflow.

**Not in these backups**, and kept elsewhere:

| Not included | Why | Where it lives |
|---|---|---|
| `auth` schema | Unused: FYStay signs people in with its own `User` table (Auth.js); production has 0 Supabase Auth users | n/a |
| Supabase project settings, API keys, Storage bucket settings | Not in the database | Supabase dashboard; recreate on a new project |
| Passwords of database logins (e.g. `fystay_pms_host_scoped`) | Postgres never exports them | Reset after a restore |
| Vercel environment variables, Stripe/Resend/Google keys | Secrets | Owner's password manager / each provider |
| Payments themselves | Stripe is the record of payments | Stripe |
| Files in private Storage buckets | The backup reads files over public URLs | None exist today; the run fails loudly if a private bucket appears |

## Retention

In the private bucket `prod-backups` in fystaybackup, under `db/<UTC time>/`:
- every nightly backup for **35 days**;
- the **first backup of each month** for **12 months**.

Older folders are deleted at the end of each successful run. Copied storage
files are kept, not pruned.

Size today: about 14 MB of database, 3.5 MB of files. That is well inside
the Free plan's 1 GB of storage.

## Alerts

- **A failed run fails the workflow, and GitHub emails the account the
  scheduled workflow belongs to.** Check it reaches the owner's inbox:
  GitHub → Settings → Notifications → Actions → "Send notifications for
  failed workflows only".
- Each run's summary (Actions → Production database backup) says which
  backup it made, how many rows it restore-checked, and what it pruned.
- GitHub disables scheduled workflows in a repository with no activity for
  60 days. If that happens, it emails first; re-enable the workflow from the
  Actions tab.

## One-time setup (owner)

1. **Read-only login on production.** In the Supabase dashboard, open
   production (`wzatjhyfwtmxdxfmurkm`) → SQL editor. Run this with a long
   random password from your password manager:

   ```sql
   create role fystay_backup_reader with login bypassrls connection limit 2 password '<long random password>';
   grant pg_read_all_data to fystay_backup_reader;
   ```

   - It can read every row, including past RLS, so `pg_dump` sees
     everything.
   - It can't change anything.
2. **GitHub Environment `backup`.** In the repo, go to Settings →
   Environments → New environment `backup`. Add **no** required reviewers,
   so the nightly run doesn't wait. Add two secrets:
   - `PROD_BACKUP_DB_URL`:
     - In production, go to Connect → **Session pooler** (port 5432).
     - Replace the user `postgres.wzatjhyfwtmxdxfmurkm` with
       `fystay_backup_reader.wzatjhyfwtmxdxfmurkm`.
     - Put in the password from step 1.
   - `BACKUP_SUPABASE_SERVICE_ROLE_KEY`: in fystaybackup
     (`sqkpixwvugrxllrxlexs`), go to Project Settings → API keys, then
     `service_role` (or a secret key).
     - Make sure it's **fystaybackup's** key, not production's. The run
       refuses production's key.
3. Run it once by hand: Actions → Production database backup → Run
   workflow. Check the summary says "succeeded".

The workflow refuses to start if `PROD_BACKUP_DB_URL` isn't production
through `fystay_backup_reader`, or isn't on port 5432. It also refuses a
destination key from any other project.

## Restoring

**Never restore over production without a decision from the owner.** A
restore drill or a recovery goes into an empty database first.

1. **Pick the backup.** In fystaybackup → Storage → `prod-backups` → `db/`,
   choose the folder from just before the problem. Download `public.dump`
   and `manifest.json`. Compare the dump's SHA-256 with the manifest.
2. **Prepare an empty target.** That's a new Supabase project, or
   fystaybackup itself once its old demo schemas have been cleared (see
   [Open items](#open-items)). In its SQL editor, create what the dump
   refers to (Supabase projects already have the first three roles):

   ```sql
   do $$ begin
     if not exists (select from pg_roles where rolname = 'fystay_pms_host_scoped') then
       create role fystay_pms_host_scoped nologin;
     end if;
   end $$;
   create extension if not exists pgcrypto with schema extensions;
   create extension if not exists "uuid-ossp" with schema extensions;
   ```
3. **Restore.** Use Postgres 17 tools and the target's session-pooler
   connection details (as `PG*` environment variables):

   ```sh
   pg_restore --dbname postgres --no-owner --clean --if-exists --exit-on-error --single-transaction public.dump
   ```

   This is the same command the nightly restore check runs.
4. **Verify.** Row counts per table should match `manifest.json` →
   `tables`. `_prisma_migrations` should list the manifest's
   `latestMigration`.
5. **Files.** Recreate the `listing-photos` and `avatars` buckets as public.
   Copy `prod-backups/storage/<bucket>/...` back into them under the same
   paths. If the project ref changed, update the stored photo URLs in
   `Listing.photos` and `User.image`.
6. **Logins and app.** Set a new password for `fystay_pms_host_scoped` if
   PMS connections are used. Point Vercel Production's
   `DATABASE_URL`/`DIRECT_URL`/`NEXT_PUBLIC_SUPABASE_URL`/
   `SUPABASE_SERVICE_ROLE_KEY` at the restored project (owner decision).
   Update `PRODUCTION_SUPABASE_PROJECT_REF` in code, then redeploy.

**What a restore loses:** up to 24 hours of changes since the last nightly
backup (the recovery point objective, RPO). Bookings paid in that window
still exist in Stripe and can be reconciled from there.

## Limitations

- **The nightly check restores into plain Postgres 17, not a Supabase
  project.** Supabase-only objects (the `anon`/`authenticated`/`service_role`
  roles, extensions) are created before restoring, exactly as in step 2
  above. A full drill into a Supabase project needs a clean target (see
  Open items).
- **fystaybackup is a Free-plan project.** Supabase pauses Free projects
  after a week of inactivity. The nightly uploads are activity, but if it is
  ever paused, the next run fails and alerts. It also has no backups of its
  own; it *is* the backup.

## Open items

- **fystaybackup still holds old non-production data.** It has the `lodge`
  schema, demo tables in `public`, `backup_snapshot_20261011`, and the
  `fystay_preview` schema that Preview builds of branch
  `claude/host-commission` still migrate into. Clearing it (owner approval,
  [handover](launch/handover.md)) makes it a clean target for a full
  Supabase restore drill.
