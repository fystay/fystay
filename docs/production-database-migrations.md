# Production database migrations

Production schema changes happen in exactly one place: the manually approved
GitHub Actions workflow `.github/workflows/db-migrate-production.yml`. Nothing
else migrates production - not a Vercel build (the build is plain `next build`
and never connects to a database), not a push, not a preview.

## Release order

```
push -> CI + Vercel preview -> test the preview
     -> run "Production database migration" for commit X (reviewer approves)
     -> promote commit X's Vercel deployment to production
```

Migrate first, then promote. Write every migration so the *currently deployed*
code keeps working against the migrated schema (expand/contract): add columns
and tables first, and drop or rename only in a later release once no deployed
code uses the old shape. That's also what keeps Vercel's instant rollback safe.

## Adding a migration

1. `npx prisma migrate dev --name <change>` against your **local** database.
2. `npm run db:manifest` - appends the new migration to
   `prisma/migration-manifest.json`.
3. Commit both together. The manifest diff is how a reviewer sees that a
   migration is being added.

Committed migrations are immutable: never edit, rename or delete one - write a
new migration instead. CI (`npm run db:check-migrations`, in `ci.yml`) fails
if the repository and manifest disagree - an edited, renamed, deleted or
unlisted migration, a file added to an existing one, or a changed
`migration_lock.toml`. It also fails if anything that existed at the base
commit (the push's previous head, or a pull request's base) changed, or if the
manifest was rewritten rather than appended to. `npm run db:manifest` refuses
to record an edit. The production workflow runs the same manifest check, and
then compares production's recorded checksums with those files.

## Running it

1. GitHub -> Actions -> **Production database migration** -> **Run workflow**.
2. "Use workflow from": the branch that contains the commit.
3. `sha`: the full 40-character SHA - not a branch name or short SHA. Stray
   spaces or line breaks (a phone's paste often adds one) are ignored.
4. `drift_check`: `report` (default) or `enforce` - see *Drift check* below.
5. The run waits for a required reviewer on the `production` Environment.
   **Reviewer: check the SHA in the run's title before approving** - the
   workflow runs that commit's own check scripts with the production secret.

Only one production migration can run at a time (`concurrency`). A second run
queues behind it, and a newer queued run replaces an older queued one - a
started run is never cancelled.

## What it checks, in order

| Step | Touches production? | Stops the run if |
|---|---|---|
| Validate / check out / verify the commit | no | the SHA isn't a full SHA, doesn't exist, isn't on the branch the workflow was run from, lacks the schema, migrations or these check scripts, or its build command would migrate |
| Unit-test the safety checks | no | that commit's own checks fail their tests |
| Check the migrations match the manifest | no | any migration file differs from `prisma/migration-manifest.json` |
| Verify the target is production | read-only | `PROD_DIRECT_URL` doesn't name project `wzatjhyfwtmxdxfmurkm` on port 5432 (session pooler or direct - not the 6543 transaction pooler), or the server isn't database `postgres` on PostgreSQL 17 with Supabase's `authenticator` role and `auth` schema, the enabled `ensure_rls` event trigger, and production's history fingerprint (the retired row below) |
| History check (before) | read-only | a migration is failed/unresolved; an applied migration was edited (checksum differs from the file); a migration is applied but missing from the commit (other than the retired one); a rolled-back migration was never re-applied; a pending migration is older than one already applied; two migrations share a timestamp |
| `prisma migrate status` | read-only | never - informational, because it exits 1 whenever anything is pending |
| **`prisma migrate deploy`** | **writes** | Prisma fails a migration (each runs in its own transaction and rolls back on error) |
| `prisma migrate status` (after) | read-only | anything is failed or pending |
| History check (after) | read-only | anything above, or anything still pending |
| Schema health | read-only | a `schema.prisma` model has no table, or any public table has RLS disabled |
| Drift check | read-only | `enforce` mode and production differs from `schema.prisma` |

Why a custom history check: tested against a copy of production's recovered
history, `prisma migrate status` reports "Database schema is up to date!"
(exit 0) for a migration edited after it was applied and for a migration
applied but missing from the repository. It only catches failed rows.

## When it fails

It never repairs anything. No `migrate resolve`, `reset` or `dev`, and no
rollback - a human decides.

- **Before the deploy step:** production is untouched. Fix the cause (wrong
  SHA, missing secret, bad history) and run again.
- **During `migrate deploy`:** Postgres rolled the failing migration's
  transaction back, but Prisma recorded a failed row, and every later deploy
  is blocked (P3009) until it's resolved by hand. Inspect what the migration
  did, fix it *in a new migration*, and only then mark the failed one
  `--rolled-back` deliberately - see the 2026-09-28 recovery for the
  standard to hold that to.
- **After the deploy step:** the migration is applied. A failed health or
  drift check is an alarm: investigate before promoting the app.

## Drift check and the objects Prisma doesn't model

`prisma migrate diff --from-schema-datasource prisma/schema.prisma
--to-schema-datamodel prisma/schema.prisma --exit-code` compares production's
`public` schema with the commit's `schema.prisma` (exit 0 = identical,
2 = different, 1 = error). The URL comes from the environment, never the
command line.

Production has objects no Prisma schema describes. Prisma ignores them, so
they are **not** drift:

- the `ensure_rls` event trigger and `public.rls_auto_enable()` - a
  project-level setup that enables RLS on every new public table (no
  migration creates them);
- the RLS policies and the `fystay_pms_host_scoped` role from
  `20260914070000_add_pms_row_level_security`;
- RLS enabled on every table;
- everything Supabase itself manages outside `public` (`auth`, `storage`,
  extensions...).

Baseline: on a local replica of production's post-recovery state (same 44
history rows, the objects above present), the drift check reports **"No
difference detected" (exit 0)**. The first production run defaults to
`report`, so an unexpected difference shows as a warning with the details in
the run summary instead of failing. Once a real run confirms the empty
baseline, use `enforce`.

## The retired migration

`_prisma_migrations` has a row for `20260924190352_add_hotel_affiliate_system`,
whose directory no longer exists: it was applied by a preview build, then
edited and renamed to `20260924191043_…`, which now owns those objects. The
recovery kept the row as history. `RETIRED_MIGRATIONS` in
`src/lib/migrationSafety/history.ts` accepts exactly that name and checksum.
Because a database migrated from scratch never has it, the target check also
uses it as production's fingerprint.

## Connection strings: DIRECT_URL and PROD_DIRECT_URL

- **The app doesn't need `DIRECT_URL`.** `schema.prisma`'s `directUrl` is
  read only by Prisma Migrate. The running app uses `DATABASE_URL` (the
  transaction pooler, port 6543). This was verified with a client generated
  from this schema: it queries normally with `DIRECT_URL` absent, empty, or
  pointing nowhere. The build doesn't need it either - it never migrates or
  connects.
- **Migrations do need an equivalent.** Prisma Migrate needs a session: an
  advisory lock held across statements and a whole migration file per
  transaction. The transaction pooler can't provide that. Use Supabase's
  **session pooler** (`aws-1-eu-west-1.pooler.supabase.com:5432`, user
  `postgres.wzatjhyfwtmxdxfmurkm`). It's IPv4, which GitHub's runners need;
  the direct host `db.<ref>.supabase.co` is IPv6-only.
- **Where it lives:** the GitHub `production` Environment secret
  `PROD_DIRECT_URL`, visible only to jobs a reviewer has approved. The workflow
  passes it to Prisma as `DATABASE_URL`/`DIRECT_URL` only for the steps that
  need it.
- Vercel's `DIRECT_URL` stays for now. It can be deleted from Vercel once this
  workflow has completed a production run.

## Setting up the `production` Environment

GitHub -> repository Settings -> Environments:

1. Create (or open) `production`. Names are case-insensitive, so an existing
   `Production` - for instance one Vercel's GitHub integration created for its
   deployment statuses - *is* this environment; check what else uses it.
2. Required reviewers: Moss. Turn on "Prevent self-review" only if a second
   person can approve.
3. Deployment branches: restrict to the branch releases come from.
4. Environment secret `PROD_DIRECT_URL`: the session-pooler connection string
   from the Supabase dashboard (Connect -> Session pooler) with the database
   password. Vercel's sensitive values can't be read back. Take the password
   from where it's stored - **don't reset it**, which would break the
   production app's `DATABASE_URL`.
