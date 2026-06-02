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
const BASE = 1_000_000

beforeEach(async () => {
  await __resetAttempts()
})

describe('admin login lockout', () => {
  it('is not locked below MAX_ATTEMPTS', async () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await recordFailure(KEY, BASE)
    }
    await expect(isLocked(KEY, BASE)).resolves.toBe(false)
  })

  it('locks out exactly at MAX_ATTEMPTS failures (=> 429)', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KEY, BASE)
    }
    await expect(isLocked(KEY, BASE)).resolves.toBe(true)
  })

  it('keeps the lock even after the attempt window has elapsed', async () => {
    await recordFailure(KEY, BASE)
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KEY, BASE + i)
    }

    const afterWindow = BASE + ATTEMPT_WINDOW_MS + 1
    expect(afterWindow).toBeLessThan(BASE + (MAX_ATTEMPTS - 1) + LOCK_MS)
    await expect(isLocked(KEY, afterWindow)).resolves.toBe(true)
  })

  it('clears the lock on success (clearFailure)', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KEY, BASE)
    }
    await expect(isLocked(KEY, BASE)).resolves.toBe(true)
    await clearFailure(KEY)
    await expect(isLocked(KEY, BASE)).resolves.toBe(false)
  })

  it('releases the lock after LOCK_MS has passed', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KEY, BASE)
    }
    await expect(isLocked(KEY, BASE)).resolves.toBe(true)
    await expect(isLocked(KEY, BASE + LOCK_MS + 1)).resolves.toBe(false)
  })

  it('tracks keys independently', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordFailure(KEY, BASE)
    }
    await expect(isLocked(KEY, BASE)).resolves.toBe(true)
    await expect(isLocked('198.51.100.9', BASE)).resolves.toBe(false)
  })

  it('resets the failure count after the attempt window when not locked', async () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await recordFailure(KEY, BASE)
    }

    const afterWindow = BASE + ATTEMPT_WINDOW_MS + 1
    await recordFailure(KEY, afterWindow)
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) {
      await recordFailure(KEY, afterWindow + i)
    }

    await expect(isLocked(KEY, afterWindow + MAX_ATTEMPTS - 2)).resolves.toBe(false)
    await recordFailure(KEY, afterWindow + MAX_ATTEMPTS)
    await expect(isLocked(KEY, afterWindow + MAX_ATTEMPTS)).resolves.toBe(true)
  })
})
