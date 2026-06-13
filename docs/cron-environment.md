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

`/api/cron/publish-drafts` promotes due draft events to `accepting` so scheduled
events move from the admin draft list into the normal member-facing event list.
The Vercel cron schedule is configured for once per minute. Vercel documents
that this precision requires a Pro or Enterprise plan; Hobby plans only allow
daily cron runs.
