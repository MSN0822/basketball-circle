# Deploy Runbook — basketball-circle

> **Living document.** This file is intentionally **undated**. Update it in place whenever
> migrations, scripts, or cron jobs change. Do not create dated copies — a stale dated
> runbook (with missing migrations / inverted checks) is worse than no runbook.

Stack: **Next.js 16 + Supabase (Postgres)**, deployed on **Vercel** with **`main` branch
auto-deploy**. Application code ships automatically on push to `main`; the database does
**not**. DB migrations and operational data tasks are run **manually** with the scripts in
`scripts/`.

---

## 1. Overview & when to use

Use this runbook when you:

- apply a new DB migration to production (Vercel deploy alone does NOT touch the DB),
- verify production DB state after a deploy,
- confirm cron jobs are live,
- clear/reset production data and recreate operator demo events,
- run a pre-launch / smoke verification.

### THE GOLDEN RULE

> **`node scripts/check-migration-status.mjs` is the single source of truth for DB state.**

There is **no migration ledger** (see §3). The only reliable way to know what is applied is
to run the status checker and read the Q1..Q9 table. Never assume a migration is applied
because the file exists or because a previous deploy "should have" run it.

---

## 2. Prerequisites

### Tools
- Node.js (project's pinned version) + repo deps installed (`npm install`).
- Network access to the Supabase Postgres endpoint (scripts connect directly over SSL with
  `rejectUnauthorized: false`).

### Vercel production environment variables (Settings → Environment Variables)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (server-only, secret)
- [ ] `ADMIN_PASSWORD`
- [ ] `ADMIN_SESSION_SECRET` (distinct random value, NOT the admin password)
- [ ] `CRON_SECRET` — **required** for `/api/cron/cleanup`. If missing the endpoint returns
      500 (fail-closed) and auto-archive / dormant-member cleanup never runs.
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — optional (has a fallback).

### `.env.local` (local execution — required for ALL scripts here)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **`SUPABASE_DB_URL`** — direct Postgres connection string. **Required** by both
      `apply-migration.mjs` and `check-migration-status.mjs`; each exits immediately if unset.
- [ ] `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CRON_SECRET`
- [ ] `QA_AUTH_EMAIL` / `QA_AUTH_PASSWORD` — only for QA/E2E.

> ⚠️ **The scripts act on whatever DB `.env.local` points to.** If `.env.local` /
> `SUPABASE_DB_URL` point at production Supabase, the scripts operate on production
> regardless of any `QA_BASE_URL` you pass. Confirm which DB you are connected to before
> running anything destructive.

---

## 3. Migration apply procedure

### Mechanism — `scripts/apply-migration.mjs`

```bash
node scripts/apply-migration.mjs supabase/migrations/<file>.sql
```

What it does:
1. Reads `SUPABASE_DB_URL` from `.env.local` (exits if unset).
2. Reads the one SQL file given as `argv[2]`.
3. Connects with `pg.Client` over SSL.
4. Runs `BEGIN` → the **entire file in a single `client.query(sql)`** → `COMMIT` (or
   `ROLLBACK` on any error). One file = one transaction.
5. After commit, prints whether `join_event`'s definition contains `unique_violation` (a
   sanity probe only — not a full verification).

### CRITICAL cautions

- **No ledger.** This script writes nothing to `supabase_migrations.schema_migrations` (or
  anywhere). Nothing records "applied". You must track order by hand and verify with
  `check-migration-status.mjs`.
- **Apply ONE file at a time, in timestamp order.** There is no batch runner. Wrong order →
  referential errors or RLS gaps.
- **Re-running can clobber RLS.** Files contain `DROP POLICY` / `CREATE POLICY` and
  `REVOKE`/`GRANT`. Re-running drops a policy then recreates it (a brief unprotected window)
  and re-applies grants — which can re-expose data. In particular, **never re-run
  `20260603010000` standalone**: on its own it restores `members_select_authenticated` /
  `participants_select_authenticated` with `using true`, re-exposing `user_code` to the
  `authenticated` role. Its final intended state is overwritten by `20260603030000`.

### Full ordered migration list (28 files)

Apply in this exact order. All 28 files below exist in `supabase/migrations/`.

| # | File | Purpose | Idempotent? |
|---|------|---------|-------------|
| 1 | `20260525000000_baseline_schema.sql` | 4 tables, RLS, indexes, Realtime, `participants_public` view baseline | Yes (`IF NOT EXISTS`, `DROP IF EXISTS`+recreate, DO/exception) |
| 2 | `20260526010000_add_event_end_date.sql` | add `events.event_end_date` | Yes (`ADD COLUMN IF NOT EXISTS`) |
| 3 | `20260526020000_add_is_manual_close.sql` | add `events.is_manual_close` | Yes (`ADD COLUMN IF NOT EXISTS`) |
| 4 | `20260526030000_join_event_rpc.sql` | `join_event` RPC v1 (waitlist) | Yes (`CREATE OR REPLACE`) |
| 5 | `20260526040000_prepare_rls_hardening.sql` | participants/members update policies → deny | Yes |
| 6 | `20260526050000_register_member_rpc.sql` | `register_member` RPC v1 (max+1 numbering) | Yes (`CREATE OR REPLACE`) |
| 7 | `20260527010000_allow_guest_invites_until_capacity.sql` | `join_event` guest-invite version | Yes |
| 8 | `20260527020000_close_full_events_without_waitlist.sql` | default `max_participants`=35, redefine `join_event` | Yes |
| 9 | `20260527030000_enable_events_realtime.sql` | add events to realtime publication | Yes (DO/exception guard) |
| 10 | `20260527040000_harden_public_mutation_policies.sql` | deny all public INSERT/UPDATE/DELETE | Yes |
| 11 | `20260602010000_cancel_participant_lock_order_fix.sql` | deadlock-safe lock order; GRANT service_role only | Yes |
| 12 | `20260602020000_create_admin_login_attempts.sql` | `admin_login_attempts` table | Yes (`CREATE TABLE IF NOT EXISTS`) |
| 13 | `20260602030000_drop_participants_delete_open_policy.sql` | DROP old `participants_delete` policy | Yes (`DROP POLICY IF EXISTS`) |
| 14 | `20260602040000_join_event_unique_violation_guard.sql` | wrap `join_event` INSERT in unique_violation guard → 409 | Yes (`CREATE OR REPLACE`) |
| 15 | `20260602050000_participants_slot_unique_index.sql` | duplicate-check DO block, then `participants_event_slot_active_uq` | **Conditionally** — `CREATE INDEX IF NOT EXISTS` is idempotent, but the DO block `RAISE EXCEPTION`s if duplicate active slots exist (clean data first) |
| 16 | `20260602060000_revoke_register_member_anon_execute.sql` | REVOKE register_member from anon/authenticated | Yes (REVOKE never errors) |
| 17 | `20260602070000_update_member_name_rpc.sql` | `update_member_name` RPC (+ participant name sync) | Yes (`CREATE OR REPLACE`) |
| 18 | `20260603010000_restrict_private_rpc_and_select.sql` | restrict mutation RPCs to service_role (**intermediate state — see caution; do not re-run alone**) | Yes structurally, but unsafe standalone |
| 19 | `20260603020000_admin_login_attempts_rpc.sql` | `record_admin_login_failure` RPC | Yes (`CREATE OR REPLACE`) |
| 20 | `20260603030000_public_participants_view.sql` | redefine `participants_public` (definer); `members_select_own`; drop participants direct SELECT | Yes (`DROP VIEW IF EXISTS`+recreate) |
| 21 | `20260608010000_align_public_visibility_with_scheduled_publish.sql` | `events_select` = non-draft OR publishes_at≤now; view via events JOIN; drop anon grant | Yes |
| 22 | `20260614010000_hide_draft_events_from_members.sql` | `events_select` = `status <> 'draft'`; sync view | Yes |
| 23 | `20260614020000_restore_scheduled_publish_visibility.sql` | revert `events_select` to non-draft OR publishes_at≤now; sync view | Yes |
| 24 | `20260614030000_promote_due_drafts_before_public_read.sql` | one-time DML promote due drafts → accepting; `events_select`=`status <> 'draft'` | **One-time DML** — re-run is a harmless no-op but only first run promotes |
| 25 | `20260614031000_schedule_due_draft_promotion.sql` | `publish_due_draft_events()` + pg_cron job (every minute) | Yes (`CREATE OR REPLACE`; unschedule-then-schedule). Needs `pg_cron` extension |
| 26 | `20260619010000_member_retention_and_archives.sql` | add `archived` status; `members.last_accessed_at`; `members_auth_user_id_uq`; `events_select`=`status in ('accepting','closed')`; sync view; `register_member` lowest-free-number + auth_user_id upsert | Yes structurally, but constraint re-ADD fails if `archived` rows exist; unique index fails on duplicate auth_user_id |
| 27 | `20260619020000_participants_public_security_invoker.sql` | `participants_public` → `security_invoker = true`; REVOKE anon/authenticated, GRANT service_role only | Yes (`ALTER VIEW ... SET`) |
| 28 | `20260620010000_remove_event_deadline_auto_close.sql` | one-time DML set all `closes_at`=NULL; strip closes_at logic from `join_event` / `cancel_participant` | **One-time, irreversible DML** — re-run is a no-op but the NULL-out is not recoverable except from backup |

---

## 4. Post-apply verification

Run the source-of-truth checker:

```bash
node scripts/check-migration-status.mjs
```

It prints a `## Migration Status` markdown table (Q1..Q9) plus an `## Additional Output`
section (A1..A4 raw policy/privilege dumps for manual inspection). A migration set is healthy
only when **every** check below reports **適用済み (applied)**.

| ID | Checks | Expected healthy value |
|----|--------|------------------------|
| Q1 | `participants_event_slot_active_uq` unique index exists | `applied=true` → 適用済み |
| Q2 | `join_event` definition contains `unique_violation` guard | `applied=true` → 適用済み |
| Q3 | `cancel_participant` definition contains `slot_number = -ranked` rerank | `applied=true` → 適用済み |
| Q4 | `update_member_name` exists (Q4a) AND updates `participants` (Q4b) | `func_exists=true, updates_participants=true` → 適用済み |
| Q5 | `admin_login_attempts` table exists | `applied=true` → 適用済み |
| Q5b | `record_admin_login_failure(text,integer,integer,integer)` exists | `applied=true` → 適用済み |
| Q6 | `participants_delete` policy does **not** exist | `applied=true` → 適用済み |
| Q7 | `anon` does **not** have EXECUTE on `register_member(text,uuid)` | `anon_has_execute=false` → 適用済み |
| Q8 | All 4 mutation RPCs: anon/authenticated have NO execute, service_role HAS execute (8-way AND) | `applied=true` → 適用済み |
| Q9 | Public-read model final state (7-way AND, below) | `applied=true` → 適用済み |

### Q9 — the most important check (7 conditions, all must hold)

1. `members.members_select_own` SELECT policy exists, roles = `{authenticated}`.
2. `participants` has **no** SELECT policy at all (clients cannot SELECT participants directly).
3. `participants_public` is a view with **`security_invoker=true`** in `reloptions`.
4. `events.events_select` (authenticated) `qual` contains `accepting` AND `closed` AND
   does **not** contain `archived` (archived events excluded).
5. `participants_public` view definition contains `accepting` AND `closed` AND **not**
   `archived`.
6. `participants_public` has **no** `member_id` column.
7. `anon` and `authenticated` have **no** SELECT on `participants_public`; only
   `service_role` does.

> **Do NOT invert condition 3.** Healthy = `security_invoker = true` (invoker mode), GRANT to
> `service_role` only. The deleted prior runbook had this backwards — `false`/definer is the
> stale, unhealthy state and triggers the Supabase "SECURITY DEFINER view" advisor warning.
> The current intended state across migrations is `security_invoker = true` after #27.

Q9 false → typical causes: missing `security_invoker=true`, missing `archived` exclusion,
leaked `member_id` column, or an accidental anon/authenticated GRANT.

Cross-check with the A-section dumps when something is `要目視 (needs eyeballing)`: **A1b**
shows the live `participants_public` reloptions, **A1/A4** dump participants/members policies,
**A2/A3** dump RPC execute privileges.

---

## 5. Cron verification

### 5-A. Vercel cron — `/api/cron/cleanup`
- **Schedule:** `0 15 * * *` (15:00 UTC = 00:00 JST), defined in `vercel.json`.
- **Does:** (1) archive events with `event_end_date < now()` in status `accepting`/`closed`
  → `archived` (batch 100, no delete); (2) NULL `participants.member_id` for members with
  `last_accessed_at < now()-365d`; (3) DELETE those members and, if `auth_user_id` set, call
  `auth.admin.deleteUser()` (auth errors collected, not fatal).
- **Auth:** requires `Authorization: Bearer <CRON_SECRET>`; returns 500 if `CRON_SECRET`
  unset (fail-closed); timing-safe compare. Vercel attaches the bearer automatically.
- **Confirm live:** Vercel Dashboard → Settings → **Cron Jobs** shows `/api/cron/cleanup`
  at `0 15 * * *`. Recent runs: Dashboard → Logs → Functions, search `GET /api/cron/cleanup`.
- **Failure visibility:** every error branch now emits `console.error` with the failure
  reason, so failed runs are searchable in Dashboard → Logs → Functions (filter by
  `cron/cleanup:`). Auth-user deletions that fail are logged as 孤児化 (orphaned) with the
  auth user id. **Vercel has no native cron-job-specific failure notification feature**
  (confirmed 2026-07-10 against official docs: "Managing Cron Jobs" only offers manual
  log inspection on failure; the "Alerts" feature offers generic Error/Usage Anomaly
  detection — not cron-specific — and requires Pro/Enterprise plus the paid
  Observability Plus add-on, unavailable on Hobby). Active (non-manual) failure
  detection therefore requires external monitoring via Log Drains (e.g. Datadog, Axiom)
  or a dead-man's-switch service (e.g. Healthchecks.io) — none of these are currently
  configured for this project.
- Note: `/api/cron/publish-drafts` exists as a **manual fallback only** (not in `vercel.json`,
  same bearer auth). Invoke manually if needed:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/publish-drafts`.

### 5-B. Supabase pg_cron — `publish_due_draft_events`
- **Schedule:** `* * * * *` (every minute). SQL: `select public.publish_due_draft_events();`
  Defined in migration `20260614031000_schedule_due_draft_promotion.sql`.
- **Does:** promote `draft` events with `publishes_at <= now()` → `accepting`,
  `is_manual_close=false` (SECURITY DEFINER function).
- **Confirm live (Supabase SQL editor):**
  ```sql
  SELECT * FROM cron.job WHERE jobname = 'publish_due_draft_events';            -- expect 1 row
  SELECT * FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='publish_due_draft_events')
   ORDER BY start_time DESC LIMIT 10;
  ```
  Also confirm the `pg_cron` extension is enabled (Database → Extensions). If it is not,
  migration #25 fails.

---

## 6. Production data-clear + operator-event recreation

> Goal: clear QA leftovers and (re)create the operator demo events on production safely.
> **Use only guarded scripts.** Two scripts have NO production guard — see the warning table.

### Recommended safe sequence

```bash
# Step 1 — dry-run: see which QA events WOULD be deleted (no deletion)
node scripts/cleanup-qa-events.mjs

# Step 2 — actually delete QA test events (titles QA_E2E_* / QA_KEEP_*), >1h old by default
CONFIRM_QA_CLEANUP=1 node scripts/cleanup-qa-events.mjs
#   (add QA_CLEANUP_MIN_AGE_HOURS=0 to also include very recent events)

# Step 3 — delete & recreate operator rollout demo events (HAS production guard)
ALLOW_PRODUCTION_QA=1 node scripts/qa-create-rollout-demo-events.mjs
```

### Script guards

| Script | Guard | Notes |
|--------|-------|-------|
| `cleanup-qa-events.mjs` | `CONFIRM_QA_CLEANUP=1` required to delete (else dry-run); default min age 1h | **No host-URL check** — acts on whatever DB `.env.local` points to. Targets only `QA_E2E_*` / `QA_KEEP_*` titles. |
| `qa-create-rollout-demo-events.mjs` | **`ALLOW_PRODUCTION_QA=1`** required to run against the production origin | Deletes `【運営展開用】`-prefixed events (incl. mojibake prefix) and recreates 6 demo events. Origin guard is on `QA_BASE_URL` (default prod), but DB writes go to `.env.local` Supabase. Uses Playwright/chromium for screenshots — DB writes complete before screenshots, so a missing browser fails only the screenshot step. Demo dates are computed from JST run date (+10/17/24/31/38/45 days). |
| `qa-production-smoke.mjs` | `ALLOW_PRODUCTION_QA=1` required against prod origin | See §7. Self-cleans created data; failures mid-run may leave orphans. |

### ⛔ Do NOT use (NO production guard — act immediately on `.env.local` DB)

| Script | Why dangerous |
|--------|---------------|
| `qa-clean-events-for-demo.mjs` | No `ALLOW_PRODUCTION_QA`, no `CONFIRM_` flag. Deletes all `【運営確認用】` events and recreates 4 demos on connect. |
| `reset-demo-events.mjs` | No guard. Unconditionally deletes `【運営展開用】` events and recreates 5 demos. |

If you must run an unguarded script, point `.env.local` at a non-production DB first, or get
explicit human sign-off.

---

## 7. Smoke check — `scripts/qa-production-smoke.mjs`

> **This does NOT run automatically.** It is a manual black-box smoke test.

```bash
ALLOW_PRODUCTION_QA=1 node scripts/qa-production-smoke.mjs
ALLOW_PRODUCTION_QA=1 QA_BASE_URL=https://staging.example.com node scripts/qa-production-smoke.mjs
```

- Runs ~24 API test cases against the target host; creates events/members/auth users then
  `cleanupCreatedData()` removes them. Mid-run failures can leave orphans named
  `QA_E2E_API_<timestamp>_*` — clean them later with `cleanup-qa-events.mjs`.
- Requires `ALLOW_PRODUCTION_QA=1` for prod; reads `ADMIN_PASSWORD` and `CRON_SECRET` from
  `.env.local`.
- **Known gotcha (see project memory):** on Vercel, `x-real-ip` is overwritten with the real
  client IP, so IP-spoofing tests (POST-05) mis-FAIL and can lock the *real running line's*
  admin login for up to ~15 min. Account for this before running the admin-lockout cases from
  a network you need.

---

## 8. Rollback guidance

There is no automated down-migration. Roll back by applying a compensating SQL with
`apply-migration.mjs`, and re-verify with `check-migration-status.mjs` afterward.

- **Index #15** — `DROP INDEX IF EXISTS public.participants_event_slot_active_uq;` (loses the
  concurrent-join guard but app keeps working).
- **#18 (`restrict_private_rpc_and_select`)** — never re-apply standalone; re-apply
  **#20** to restore `members_select_own` + dropped participants SELECT.
- **#20 (`public_participants_view`)** — re-applying it reverts the view to
  `security_invoker=false`; you must then **re-apply #27** to restore `security_invoker=true`.
- **#26 (`member_retention_and_archives`)** — to revert the status constraint to 3 values you
  must first remove/relabel any `archived` rows; `members_auth_user_id_uq` won't build with
  duplicate `auth_user_id`. Drop with `DROP INDEX IF EXISTS public.members_auth_user_id_uq;`.
- **#27 (`security_invoker`)** — reverting (`ALTER VIEW public.participants_public SET
  (security_invoker = false); GRANT SELECT ... TO authenticated;`) re-exposes the view and
  re-triggers the Supabase definer-view advisor. Prefer forward-fix.
- **#28 (`remove_event_deadline_auto_close`)** — `CREATE OR REPLACE` the prior `join_event` /
  `cancel_participant` (the `20260602010000` versions) to restore RPC behavior, **but the
  NULLed `closes_at` values are unrecoverable except from a DB backup.**
- **#25 (pg_cron)** — stop the job with `SELECT cron.unschedule('publish_due_draft_events');`
  and optionally `DROP FUNCTION public.publish_due_draft_events();`.

For application (Vercel) rollback, redeploy a previous successful deployment from the Vercel
dashboard — but remember DB state does not roll back with it.

---

## 9. Pre-launch checklist

- [ ] All Vercel + `.env.local` env vars set (§2). Especially `CRON_SECRET` (cleanup cron
      fails closed without it) and `SUPABASE_DB_URL` (every script needs it).
- [ ] All 28 migrations applied **in order** (§3).
- [ ] `node scripts/check-migration-status.mjs` shows Q1..Q9 all **適用済み** — especially
      Q9 with `participants_public security_invoker=true`, `archived` excluded, no `member_id`
      column, service_role-only SELECT.
- [ ] Vercel cron `/api/cron/cleanup` listed at `0 15 * * *` (§5-A).
- [ ] Supabase `pg_cron` enabled and `publish_due_draft_events` returns 1 row (§5-B).
- [ ] Operator demo events created via the **guarded** script (§6).
- [ ] Manual smoke check run and reviewed (§7), accounting for the `x-real-ip` admin-lockout
      caveat.
- [ ] **Supabase Auth OTP / email code length = 6.** A length of **4 breaks signup**.
      (Supabase Dashboard → Authentication → providers/email settings.)
- [ ] Aware of Supabase **free-tier email limit: ~2 emails/hour**. Signup/confirmation emails
      beyond that are throttled; plan launch testing accordingly or use a custom SMTP provider.
- [ ] If changing the email-confirmation method (custom SMTP, or turning Confirm email OFF),
      follow `docs/EMAIL_SWITCHOVER_RUNBOOK.md` — the two items above become obsolete after
      switching OFF, and the unconfirmed-user rescue step there is **mandatory** before the toggle.

---

### Appendix — current intended end state (assertions)

- `participants_public`: `security_invoker = true`, SELECT granted to `service_role` only.
- `register_member`: on `auth_user_id` match → returns existing member + updates
  `last_accessed_at`; otherwise assigns the **lowest free** member number.
- `closes_at`: NULL on all rows; `join_event` never references it. Closure is capacity-based
  only (`active >= max_participants`).
- `events.status` allowed values: `accepting`, `closed`, `draft`, `archived` (4).
- `events_select` (authenticated) shows only `accepting` / `closed` rows.
- `participants` table has no direct SELECT policy for any role; public reads go through
  `participants_public` via service_role.
