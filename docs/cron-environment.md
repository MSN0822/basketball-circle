# Cron environment variables

`/api/cron/cleanup` and `/api/cron/publish-drafts` are intentionally
fail-closed. They return 500 when `CRON_SECRET` is not configured and 401 when
the request does not include the matching bearer token.

Required Vercel environment variable:

```text
CRON_SECRET=<long random secret>
```

The Vercel Cron caller must send:

```text
Authorization: Bearer <CRON_SECRET>
```

Do not commit the real value. Store it only in `.env.local` for local testing and
in the Vercel project Environment Variables for deployed environments.

Scheduled publishing is handled by Supabase Cron, not Vercel Cron, so it can run
once per minute even while the Vercel project is on a Hobby plan. The database
job calls `public.publish_due_draft_events()` and promotes due draft events to
`accepting`, moving them from the admin draft list into the normal member-facing
event list.

`/api/cron/publish-drafts` remains available as an authenticated manual fallback
for the same promotion logic, but it is not scheduled from `vercel.json`.
