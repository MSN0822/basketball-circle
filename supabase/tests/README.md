# Supabase Database Tests

This directory contains pgTAP database tests for local Supabase only. Do not run these tests against production.

## Supabase CLI flow

Prerequisites:

- Supabase CLI installed
- Docker Desktop running

Run:

```bash
# 1. The pg_cron migration fails locally (the local migration role cannot create the extension),
#    so move it aside first. Later migrations do not depend on it.
mv supabase/migrations/20260614031000_schedule_due_draft_promotion.sql \
   supabase/migrations/20260614031000_schedule_due_draft_promotion.sql.localskip

# 2. Use `db reset`, NOT `db start` / `supabase start` (see the warning below).
npx supabase db reset

npm run test:db

# 3. ALWAYS restore the file afterwards, then confirm with `git status`.
mv supabase/migrations/20260614031000_schedule_due_draft_promotion.sql.localskip \
   supabase/migrations/20260614031000_schedule_due_draft_promotion.sql
```

> **Do not use `supabase start` / `supabase db start`.**
> They reuse the existing Docker volume, so migrations added after the volume was created are
> never applied. pgTAP then fails because the database is stale, not because the SQL is wrong.
> Always recreate the database with `db reset`. See the 2026-06-21 entry in `ERRORS.md`.

> Forgetting step 3 is the most common mistake. The renamed file shows up in `git status`,
> so check it before committing.

`npm run test:db` runs:

```bash
supabase test db
```

## Direct psql fallback

If the Supabase CLI is unavailable but a local PostgreSQL 15 database with pgTAP is available:

1. Apply migrations to a disposable local database.
2. Enable pgTAP in that database.
3. Run the test SQL in a transaction.

Example:

```bash
psql "$LOCAL_DATABASE_URL" -c "create extension if not exists pgtap with schema public;"
psql "$LOCAL_DATABASE_URL" -f supabase/tests/database/record_admin_login_failure.test.sql
```

> **Check the connection string before running this.** `SUPABASE_DB_URL` in `.env.local` points at
> **production**. `$LOCAL_DATABASE_URL` must resolve to `127.0.0.1:54322` (the local Supabase
> Postgres port). Running pgTAP against production would execute test fixtures on live data.

The test files start with `begin` and end with `rollback`, so test rows are not retained.

## Production note

The production project currently uses a single cloud database. These pgTAP tests are intended to create a local safety net for SQL logic before migration files are applied manually to production.

Note that the local baseline (`20260525000000_baseline_schema.sql`) was never applied to
production — production already had the base tables. A green pgTAP run therefore validates the
SQL logic, not that production's schema matches. Use `node scripts/check-migration-status.mjs`
to verify production separately.
