# Unit Test Notes

Future coverage candidates intentionally left as documentation rather than executable tests in this pass.

- `SEC-016`: `DELETE /api/admin/verify` clears the cookie without requiring an active session. This is expected logout behavior, but add explicit product-level coverage if the requirement changes.
- `GAP-016`: `verifyAdminSessionToken` treats `expiresAt === now` as expired; covered in unit tests, but keep an E2E/session-expiry scenario if browser auth flows grow.
