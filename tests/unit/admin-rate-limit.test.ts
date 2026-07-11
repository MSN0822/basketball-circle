import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isLocked,
  recordFailure,
  clearFailure,
  MAX_ATTEMPTS,
  LOCK_MS,
  ATTEMPT_WINDOW_MS,
  __resetAttempts,
} from '@/lib/admin-rate-limit'
import { mockSupabaseFrom } from './helpers/mock-supabase'

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

// M-6: NODE_ENV==="test" ではメモリstoreが選ばれるため、本番用の Supabase store
// 実装（rowToState 変換・RPC呼び出しパラメータ）は通常のテストでは一度も実行されない。
// ここでは NODE_ENV を一時的に上書きしてモジュールを再読み込みし、Supabase store側の
// 実コードパスを直接検証する。他ファイルを汚染しないよう必ず finally で元に戻す。
describe('admin login lockout (Supabase store, production code path)', () => {
  it('reads, records, and clears failures through the Supabase-backed store', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    // NODE_ENV は Next.js の型定義で readonly 指定されているため、
    // テスト内での一時上書きは readonly を明示的にバイパスする。
    ;(process.env as { NODE_ENV: string }).NODE_ENV = 'production'
    try {
      vi.resetModules()

      const supabase = mockSupabaseFrom({
        selectMaybeSingleResult: {
          data: { key: 'ip:1.2.3.4', count: 3, reset_at: '2026-01-01T00:00:00.000Z', locked_until: '2026-01-01T00:15:00.000Z' },
          error: null,
        },
        rpcResult: {
          data: { key: 'ip:1.2.3.4', count: 5, reset_at: '2026-01-01T00:00:00.000Z', locked_until: '2026-01-01T00:15:00.000Z' },
          error: null,
        },
      })
      vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))

      const mod = await import('@/lib/admin-rate-limit')

      const state = await mod.getAttemptState('ip:1.2.3.4', Date.parse('2026-01-01T00:05:00.000Z'))
      expect(state).toEqual({
        count: 3,
        resetAt: Date.parse('2026-01-01T00:00:00.000Z'),
        lockedUntil: Date.parse('2026-01-01T00:15:00.000Z'),
      })
      expect(supabase.spies.mockFrom).toHaveBeenCalledWith('admin_login_attempts')
      expect(supabase.spies.selectEq).toHaveBeenCalledWith('key', 'ip:1.2.3.4')

      await mod.recordFailure('ip:1.2.3.4', Date.parse('2026-01-01T00:05:00.000Z'))
      expect(supabase.spies.mockRpc).toHaveBeenCalledWith('record_admin_login_failure', {
        p_key: 'ip:1.2.3.4',
        p_attempt_window_ms: mod.ATTEMPT_WINDOW_MS,
        p_lock_ms: mod.LOCK_MS,
        p_max_attempts: mod.MAX_ATTEMPTS,
      })

      await mod.clearFailure('ip:1.2.3.4')
      expect(supabase.spies.deleteEq).toHaveBeenCalledWith('key', 'ip:1.2.3.4')
    } finally {
      ;(process.env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv as string
      vi.resetModules()
    }
  })
})
