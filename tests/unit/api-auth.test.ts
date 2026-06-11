import { describe, it, expect, beforeAll } from 'vitest'
import type { NextRequest } from 'next/server'
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  safeCompare,
  createAdminSessionToken,
  verifyAdminSessionToken,
  getBearerToken,
} from '@/lib/api-auth'

// signAdminSessionPayload は呼び出し時に env を読むため、ロード時ではなく実行前に設定すれば足りる
beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'unit-test-secret'
})

// authorization ヘッダーだけを持つ最小スタブ（実装は req.headers.get しか参照しない）
function reqWithAuth(value: string | null): NextRequest {
  return {
    headers: { get: (key: string) => (key === 'authorization' ? value : null) },
  } as unknown as NextRequest
}

describe('safeCompare', () => {
  it('returns true for identical non-empty strings', () => {
    expect(safeCompare('correct-horse', 'correct-horse')).toBe(true)
  })

  it('returns false for equal-length but different strings', () => {
    expect(safeCompare('abc', 'abd')).toBe(false)
  })

  it('returns false for different-length strings', () => {
    expect(safeCompare('abc', 'abcd')).toBe(false)
    expect(safeCompare('abcd', 'abc')).toBe(false)
  })

  it('returns false for null / undefined inputs', () => {
    expect(safeCompare(null, 'abc')).toBe(false)
    expect(safeCompare('abc', undefined)).toBe(false)
    expect(safeCompare(null, null)).toBe(false)
    expect(safeCompare(undefined, undefined)).toBe(false)
  })

  it('returns false for non-string inputs without throwing', () => {
    expect(safeCompare({ value: 'abc' }, 'abc')).toBe(false)
    expect(safeCompare(['abc'], 'abc')).toBe(false)
  })

  it('returns false for empty strings (length 0 is never "comparable")', () => {
    expect(safeCompare('', '')).toBe(false)
    expect(safeCompare('', 'abc')).toBe(false)
  })
})

describe('admin session token', () => {
  const now = 1_700_000_000_000 // 固定タイムスタンプ（ms）

  it('round-trips: a freshly created token verifies at the same clock', () => {
    const token = createAdminSessionToken(now)
    expect(token).toBeTruthy()
    expect(verifyAdminSessionToken(token, now)).toBe(true)
  })

  it('rejects an expired token', () => {
    const token = createAdminSessionToken(now)
    // 有効期限は 8 時間。9 時間後の時計では失効していること
    expect(verifyAdminSessionToken(token, now + 9 * 60 * 60 * 1000)).toBe(false)
  })

  it('rejects a token exactly at its expiry second', () => {
    const token = createAdminSessionToken(now)
    const expiresAtMs = (Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS) * 1000
    expect(verifyAdminSessionToken(token, expiresAtMs)).toBe(false)
  })

  it('rejects a token with a tampered signature (same length)', () => {
    const token = createAdminSessionToken(now)!
    const [exp, nonce, sig] = token.split('.')
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(verifyAdminSessionToken(`${exp}.${nonce}.${flipped}`, now)).toBe(false)
  })

  it('rejects a token with a tampered nonce', () => {
    const token = createAdminSessionToken(now)!
    const [exp, nonce, sig] = token.split('.')
    expect(verifyAdminSessionToken(`${exp}.${nonce}x.${sig}`, now)).toBe(false)
  })

  it('rejects a token with extra segments', () => {
    const token = createAdminSessionToken(now)!
    expect(verifyAdminSessionToken(`${token}.extra`, now)).toBe(false)
  })

  it('rejects a non-integer expiry', () => {
    const token = createAdminSessionToken(now)!
    const [, nonce, sig] = token.split('.')
    expect(verifyAdminSessionToken(`abc.${nonce}.${sig}`, now)).toBe(false)
  })

  it('rejects null / undefined / empty tokens', () => {
    expect(verifyAdminSessionToken(null, now)).toBe(false)
    expect(verifyAdminSessionToken(undefined, now)).toBe(false)
    expect(verifyAdminSessionToken('', now)).toBe(false)
  })

  it('returns null when ADMIN_SESSION_SECRET is not configured', () => {
    const savedSecret = process.env.ADMIN_SESSION_SECRET
    const savedPassword = process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_SESSION_SECRET
    process.env.ADMIN_PASSWORD = 'password-is-not-a-signing-secret'
    try {
      expect(createAdminSessionToken(now)).toBeNull()
    } finally {
      process.env.ADMIN_SESSION_SECRET = savedSecret
      if (savedPassword !== undefined) process.env.ADMIN_PASSWORD = savedPassword
    }
  })
})

describe('getBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(getBearerToken(reqWithAuth('Bearer abc123'))).toBe('abc123')
  })

  it('is case-insensitive on the scheme and trims the token', () => {
    expect(getBearerToken(reqWithAuth('bearer abc123'))).toBe('abc123')
    expect(getBearerToken(reqWithAuth('Bearer   spaced  '))).toBe('spaced')
  })

  it('returns null when the header is missing or not Bearer', () => {
    expect(getBearerToken(reqWithAuth(null))).toBeNull()
    expect(getBearerToken(reqWithAuth('Basic xyz'))).toBeNull()
  })

  it('returns null for an empty Bearer token', () => {
    expect(getBearerToken(reqWithAuth('Bearer '))).toBeNull()
    expect(getBearerToken(reqWithAuth('Bearer'))).toBeNull()
  })
})
