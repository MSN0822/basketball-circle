import { describe, it, expect, beforeAll } from 'vitest'
import { createAdminSessionToken, signAdminSessionPayload } from '@/lib/api-auth'
import { signAdminSessionPayloadEdge, verifyAdminSessionTokenEdge } from '@/proxy'

// 発行側（lib/api-auth.ts, Node の node:crypto）と
// 検証側（proxy.ts, Edge の Web Crypto）が同じ秘密鍵で等価に動作することを保証する。
beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'unit-test-secret'
})

describe('admin session token: api-auth (Node) ↔ proxy (Edge) equivalence', () => {
  const now = 1_700_000_000_000
  const payload = '1700028800.fixed-nonce'

  it('signs the same payload identically in Node and Edge runtimes', async () => {
    expect(signAdminSessionPayload(payload)).toBe(await signAdminSessionPayloadEdge(payload))
  })

  it('a token issued by api-auth is accepted by the proxy verifier', async () => {
    const token = createAdminSessionToken(now)
    expect(token).toBeTruthy()
    await expect(verifyAdminSessionTokenEdge(token, now)).resolves.toBe(true)
  })

  it('rejects an expired token', async () => {
    const token = createAdminSessionToken(now)
    await expect(
      verifyAdminSessionTokenEdge(token, now + 9 * 60 * 60 * 1000)
    ).resolves.toBe(false)
  })

  it('rejects a token with a tampered signature', async () => {
    const token = createAdminSessionToken(now)!
    const [exp, nonce, sig] = token.split('.')
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    await expect(
      verifyAdminSessionTokenEdge(`${exp}.${nonce}.${flipped}`, now)
    ).resolves.toBe(false)
  })

  it('rejects a token with a tampered nonce', async () => {
    const token = createAdminSessionToken(now)!
    const [exp, nonce, sig] = token.split('.')
    await expect(
      verifyAdminSessionTokenEdge(`${exp}.${nonce}x.${sig}`, now)
    ).resolves.toBe(false)
  })

  it('rejects a token with extra segments', async () => {
    const token = createAdminSessionToken(now)!
    await expect(verifyAdminSessionTokenEdge(`${token}.extra`, now)).resolves.toBe(false)
  })

  it('rejects null / undefined / empty tokens', async () => {
    await expect(verifyAdminSessionTokenEdge(null, now)).resolves.toBe(false)
    await expect(verifyAdminSessionTokenEdge(undefined, now)).resolves.toBe(false)
    await expect(verifyAdminSessionTokenEdge('', now)).resolves.toBe(false)
  })

  it('rejects a token signed with a different secret', async () => {
    const saved = process.env.ADMIN_SESSION_SECRET
    const savedPassword = process.env.ADMIN_PASSWORD
    // 攻撃者の秘密鍵で発行
    process.env.ADMIN_SESSION_SECRET = 'attacker-secret'
    delete process.env.ADMIN_PASSWORD
    const forged = createAdminSessionToken(now)
    // 正規の秘密鍵に戻して検証 → 署名不一致で拒否されること
    process.env.ADMIN_SESSION_SECRET = saved
    if (savedPassword !== undefined) process.env.ADMIN_PASSWORD = savedPassword
    await expect(verifyAdminSessionTokenEdge(forged, now)).resolves.toBe(false)
  })
})
