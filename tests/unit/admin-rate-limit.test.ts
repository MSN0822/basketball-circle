import { describe, it, expect, beforeEach } from 'vitest'
import {
  isLocked,
  recordFailure,
  clearFailure,
  MAX_ATTEMPTS,
  LOCK_MS,
  ATTEMPT_WINDOW_MS,
  __resetAttempts,
} from '@/lib/admin-rate-limit'

const KEY = '203.0.113.1'
const BASE = 1_000_000 // 固定基準時刻（ms）

beforeEach(() => {
  __resetAttempts()
})

describe('admin login lockout', () => {
  it('is not locked below MAX_ATTEMPTS', () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      recordFailure(KEY, BASE)
    }
    expect(isLocked(KEY, BASE)).toBe(false)
  })

  it('locks out exactly at MAX_ATTEMPTS failures (=> 429)', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(KEY, BASE)
    }
    expect(isLocked(KEY, BASE)).toBe(true)
  })

  it('keeps the lock even after the attempt window has elapsed (lockedUntil > resetAt invariant)', () => {
    // 失敗を時間差で発生させ、lockedUntil を resetAt より後ろにずらす
    recordFailure(KEY, BASE) // resetAt = BASE + ATTEMPT_WINDOW_MS
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      recordFailure(KEY, BASE + i) // 5回目で lockedUntil = (BASE + 4) + LOCK_MS
    }
    // ウィンドウ失効後・ロック満了前の時刻
    const afterWindow = BASE + ATTEMPT_WINDOW_MS + 1
    expect(afterWindow).toBeLessThan(BASE + (MAX_ATTEMPTS - 1) + LOCK_MS)
    // ウィンドウが切れてもロックは維持されること（誤って解錠されない）
    expect(isLocked(KEY, afterWindow)).toBe(true)
  })

  it('clears the lock on success (clearFailure)', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(KEY, BASE)
    }
    expect(isLocked(KEY, BASE)).toBe(true)
    clearFailure(KEY)
    expect(isLocked(KEY, BASE)).toBe(false)
  })

  it('releases the lock after LOCK_MS has passed', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(KEY, BASE)
    }
    expect(isLocked(KEY, BASE)).toBe(true)
    expect(isLocked(KEY, BASE + LOCK_MS + 1)).toBe(false)
  })

  it('tracks keys independently', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(KEY, BASE)
    }
    expect(isLocked(KEY, BASE)).toBe(true)
    expect(isLocked('198.51.100.9', BASE)).toBe(false)
  })
})
