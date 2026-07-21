import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetAttempts,
  clientIdentifier,
  createPolicy,
  enforceRateLimit,
  isLocked,
  recordAttempt,
  retryAfterSeconds,
} from '@/lib/rate-limit'
import { emptyRequest } from './helpers/route'

const POLICY = createPolicy({ windowMs: 60_000, lockMs: 120_000, maxAttempts: 3 })
const KEY = 'join:member:11111111-1111-4111-8111-111111111111'
const BASE = 1_000_000

beforeEach(async () => {
  await __resetAttempts()
})

describe('汎用ポリシー', () => {
  it('DB側は record_rate_limit_hit を汎用の引数名で呼ぶ', () => {
    expect(POLICY.rpcName).toBe('record_rate_limit_hit')
    expect(POLICY.buildRpcArgs(KEY, POLICY)).toEqual({
      p_key: KEY,
      p_window_ms: 60_000,
      p_lock_ms: 120_000,
      p_max_attempts: 3,
    })
  })
})

describe('カウントとロック', () => {
  it('上限未満ではロックされない', async () => {
    for (let i = 0; i < POLICY.maxAttempts - 1; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    await expect(isLocked(KEY, POLICY, BASE)).resolves.toBe(false)
  })

  it('上限ちょうどでロックされる', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    await expect(isLocked(KEY, POLICY, BASE)).resolves.toBe(true)
  })

  it('集計ウィンドウが過ぎてもロックは維持される', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    await expect(isLocked(KEY, POLICY, BASE + POLICY.windowMs + 1)).resolves.toBe(true)
  })

  it('ロック時間が過ぎると解除される', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    await expect(isLocked(KEY, POLICY, BASE + POLICY.lockMs + 1)).resolves.toBe(false)
  })

  it('ロックされていなければウィンドウ経過でカウントが戻る', async () => {
    for (let i = 0; i < POLICY.maxAttempts - 1; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    const afterWindow = BASE + POLICY.windowMs + 1
    await recordAttempt(KEY, POLICY, afterWindow)

    await expect(isLocked(KEY, POLICY, afterWindow)).resolves.toBe(false)
  })

  it('キーごとに独立して数える', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await recordAttempt(KEY, POLICY, BASE)
    }

    await expect(isLocked(KEY, POLICY, BASE)).resolves.toBe(true)
    await expect(isLocked('join:member:other', POLICY, BASE)).resolves.toBe(false)
  })
})

describe('enforceRateLimit', () => {
  it('上限に達するまでは null を返して通す', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await expect(enforceRateLimit(KEY, POLICY, BASE)).resolves.toBeNull()
    }
  })

  it('上限を超えた呼び出しは 429 と Retry-After を返す', async () => {
    for (let i = 0; i < POLICY.maxAttempts; i++) {
      await enforceRateLimit(KEY, POLICY, BASE)
    }

    const res = await enforceRateLimit(KEY, POLICY, BASE)

    expect(res?.status).toBe(429)
    expect(res?.headers.get('Retry-After')).toBe('120')
    const body = await res?.json() as { error: string }
    expect(body.error).toContain('しばらく時間をおいて')
  })

  it('ロック解除後は再び通る', async () => {
    for (let i = 0; i <= POLICY.maxAttempts; i++) {
      await enforceRateLimit(KEY, POLICY, BASE)
    }

    await expect(enforceRateLimit(KEY, POLICY, BASE + POLICY.lockMs + 1)).resolves.toBeNull()
  })
})

describe('retryAfterSeconds', () => {
  it('切り上げた残り秒数を返す', () => {
    expect(retryAfterSeconds({ count: 3, resetAt: 0, lockedUntil: BASE + 1_500 }, BASE)).toBe(2)
  })

  it('残りがなくても最低 1 秒を返す', () => {
    expect(retryAfterSeconds({ count: 3, resetAt: 0, lockedUntil: BASE }, BASE)).toBe(1)
  })
})

describe('clientIdentifier', () => {
  it('x-real-ip を最優先で使う（Vercel が実IPで上書きするヘッダ）', () => {
    const req = emptyRequest({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' } })

    expect(clientIdentifier(req)).toBe('203.0.113.9')
  })

  it('x-real-ip が無ければ x-forwarded-for の最後の値を使う', () => {
    const req = emptyRequest({ headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' } })

    expect(clientIdentifier(req)).toBe('203.0.113.7')
  })

  it('どちらも無ければ unknown を返す', () => {
    expect(clientIdentifier(emptyRequest())).toBe('unknown')
  })
})
