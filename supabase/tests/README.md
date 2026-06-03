# Supabase Database Tests

This directory contains pgTAP database tests for local Supabase only. Do not run these tests against production.

## Supabase CLI flow

Prerequisites:

- Supabase CLI installed
- Docker Desktop running

Run:

```bash
supabase db start
npm run test:db
```

`npm run test:db` runs:

```bash
supabase test db
```

The current pgTAP coverage includes `supabase/tests/database/record_admin_login_failure.test.sql`, which exercises the `record_admin_login_failure` RPC directly.

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

The test file starts with `begin` and ends with `rollback`, so test rows are not retained.

## Production note

The production project currently uses a single cloud database. These pgTAP tests are intended to create a local safety net for SQL logic before migration files are applied manually to production.
