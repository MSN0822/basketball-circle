# Admin Session Signature

管理者セッショントークンは次の仕様で署名する。

- algorithm: HMAC-SHA256
- secret: `ADMIN_SESSION_SECRET || ADMIN_PASSWORD`
- payload: `${expiresAt}.${nonce}`
- signature encoding: base64url without padding
- token format: `${expiresAt}.${nonce}.${signature}`

Runtime notes:

- `lib/api-auth.ts` uses Node `crypto`.
- `proxy.ts` uses Web Crypto because proxy runs in the Next.js route pre-processing layer.
- Unit tests must verify that both implementations produce the same signature for the same payload and secret.
