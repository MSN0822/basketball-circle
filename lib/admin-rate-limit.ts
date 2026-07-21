import * as rateLimit from '@/lib/rate-limit'

export type AttemptState = rateLimit.AttemptState

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5

// 管理者ログインは既存の record_admin_login_failure RPC を使い続ける。
// 汎用版（record_rate_limit_hit）と挙動は同じだが引数名が異なるため、互換のため残している。
const ADMIN_POLICY: rateLimit.RateLimitPolicy = {
  windowMs: ATTEMPT_WINDOW_MS,
  lockMs: LOCK_MS,
  maxAttempts: MAX_ATTEMPTS,
  rpcName: 'record_admin_login_failure',
  buildRpcArgs: (key, policy) => ({
    p_key: key,
    p_attempt_window_ms: policy.windowMs,
    p_lock_ms: policy.lockMs,
    p_max_attempts: policy.maxAttempts,
  }),
}

// 以下は lib/rate-limit.ts への薄いラッパ。管理者ログイン側の公開APIと挙動は変えていない
// （ADM-02 / SEC-12 を壊さないため、呼び出し側とテストは無改修のまま動く）。

export function normalizeAttemptState(current: AttemptState | null, now = Date.now()): AttemptState {
  return rateLimit.normalizeAttemptState(current, ADMIN_POLICY, now)
}

export function getAttemptState(key: string, now = Date.now()): Promise<AttemptState> {
  return rateLimit.getAttemptState(key, ADMIN_POLICY, now)
}

export function isLocked(key: string, now = Date.now()): Promise<boolean> {
  return rateLimit.isLocked(key, ADMIN_POLICY, now)
}

export function recordFailure(key: string, now = Date.now()): Promise<void> {
  return rateLimit.recordAttempt(key, ADMIN_POLICY, now)
}

export function clearFailure(key: string): Promise<void> {
  return rateLimit.clearAttempts(key)
}

export function __resetAttempts(): Promise<void> {
  return rateLimit.__resetAttempts()
}
