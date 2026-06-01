# Cron environment variables

`/api/cron/cleanup` is intentionally fail-closed. It returns 500 when `CRON_SECRET`
is not configured and 401 when the request does not include the matching bearer
token.

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
