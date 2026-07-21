# Auth, Retention, and Archive Notes

## Production Supabase Auth

- Enable Supabase Auth email confirmation in production.
- Set the email OTP length to 6 (the signup verification UI validates a 6-digit code; `supabase/config.toml` also sets `otp_length = 6`).
- Configure the signup email template so the user sees the token/code.
- The app completes signup after `verifyOtp({ type: 'signup' })` succeeds, then creates the `members` row.

## Member Access Retention

- `members.last_accessed_at` is refreshed on authenticated page access.
- The page-access refresh is throttled to at most once per 24 hours per member (`LAST_ACCESS_TOUCH_INTERVAL_MS` in `lib/server-member.ts`). Login always refreshes it via the `register_member` RPC.
- `/api/cron/cleanup` removes members with `last_accessed_at` older than 365 days.
- Before removing a dormant member, cleanup clears `participants.member_id` so historical participant rows remain available in admin archives.
- Cleanup then deletes the `members` row and attempts to delete the Supabase Auth user.

## Event Archives

- Ended events are moved to `status = 'archived'` instead of being deleted.
- Archived events are hidden from member-facing reads and `participants_public`.
- Admin APIs can still fetch archived events with `/api/admin/events?archived=1`.
