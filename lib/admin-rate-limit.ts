// 管理ログインのブルートフォース対策（試行回数カウント＋ロックアウト）。
// route から分離してユニットテスト可能にしている。状態はプロセス内メモリで保持する。

export type AttemptState = {
  count: number
  resetAt: number
  lockedUntil: number
}

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5

const attempts = new Map<string, AttemptState>()

export function getAttemptState(key: string, now = Date.now()): AttemptState {
  const current = attempts.get(key)
  if (!current) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  // ロック中はウィンドウ失効によるリセットを行わず、ロックを最後まで維持する
  // （lockedUntil > resetAt のケースでロックが想定より早く解けるのを防ぐ）
  if (current.lockedUntil > now) {
    return current
  }
  if (current.resetAt <= now) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  return current
}

export function isLocked(key: string, now = Date.now()): boolean {
  const current = getAttemptState(key, now)
  return current.lockedUntil > now
}

export function recordFailure(key: string, now = Date.now()) {
  const current = getAttemptState(key, now)
  const nextCount = current.count + 1
  attempts.set(key, {
    count: nextCount,
    resetAt: current.resetAt,
    lockedUntil: nextCount >= MAX_ATTEMPTS ? now + LOCK_MS : current.lockedUntil,
  })
}

export function clearFailure(key: string) {
  attempts.delete(key)
}

// テスト用: プロセス内の試行状態を全消去する
export function __resetAttempts() {
  attempts.clear()
}
