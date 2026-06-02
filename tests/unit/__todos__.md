# Unit Test TODOs

Low-priority coverage candidates intentionally left as documentation rather than executable tests in this pass.

- `SEC-015`: legacy member registration fallback can still race on `member_number`; prefer retiring the fallback once `register_member` RPC is guaranteed everywhere.
- `SEC-016`: `DELETE /api/admin/verify` clears the cookie without requiring an active session. This is expected logout behavior, but add explicit product-level coverage if the requirement changes.
- `BL-019`: `publishes_at` currently has no visibility gate in the API layer. Add tests when publish scheduling behavior is defined.
- `GAP-019`: `DELETE /api/admin/events` returns success for a valid but nonexistent event id if Supabase delete reports no error. Decide whether a 404 is required before adding a test.
- `GAP-016`: `verifyAdminSessionToken` treats `expiresAt === now` as expired; covered in unit tests, but keep an E2E/session-expiry scenario if browser auth flows grow.
- `BL-020`: `generateUserCode()` collision handling is delegated to the `join_event` RPC and database constraints. Add integration coverage around retry behavior if collisions are handled in the API later.
