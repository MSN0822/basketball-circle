import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest, jsonRequest, responseJson } from './helpers/route'

async function loadRoute(options: {
  locked?: boolean
  passwordOk?: boolean
  token?: string | null
  adminOk?: boolean
} = {}) {
  vi.resetModules()

  const isLocked = vi.fn().mockResolvedValue(options.locked ?? false)
  const recordFailure = vi.fn().mockResolvedValue(undefined)
  const clearFailure = vi.fn().mockResolvedValue(undefined)
  const safeCompare = vi.fn().mockReturnValue(options.passwordOk ?? false)
  const createAdminSessionToken = vi.fn().mockReturnValue(options.token === undefined ? 'signed-token' : options.token)
  const checkAdmin = vi.fn().mockReturnValue(options.adminOk ?? false)

  vi.doMock('@/lib/admin-rate-limit', () => ({ isLocked, recordFailure, clearFailure }))
  vi.doMock('@/lib/api-auth', () => ({
    ADMIN_SESSION_COOKIE: 'basketball_admin_session',
    ADMIN_SESSION_MAX_AGE_SECONDS: 60 * 60 * 8,
    checkAdmin,
    createAdminSessionToken,
    safeCompare,
  }))

  const route = await import('@/app/api/admin/verify/route')
  return { GET: route.GET, POST: route.POST, DELETE: route.DELETE, mocks: { isLocked, recordFailure, clearFailure, safeCompare, createAdminSessionToken, checkAdmin } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.ADMIN_PASSWORD = 'correct-password'
})

describe('/api/admin/verify', () => {
  it('returns 429 without checking the password when the client key is locked', async () => {
    const { POST, mocks } = await loadRoute({ locked: true, passwordOk: true })

    const res = await POST(jsonRequest({ password: 'correct-password' }, {
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.1' },
    }))

    expect(res.status).toBe(429)
    expect(mocks.isLocked).toHaveBeenCalledWith('ip:198.51.100.1')
    expect(mocks.isLocked).toHaveBeenCalledWith('global:admin-login')
    expect(mocks.safeCompare).not.toHaveBeenCalled()
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  it('sets an HttpOnly Strict admin cookie and clears failures on success', async () => {
    const { POST, mocks } = await loadRoute({ passwordOk: true, token: 'signed-token' })

    const res = await POST(jsonRequest({ password: 'correct-password' }, {
      headers: { 'x-real-ip': '198.51.100.20' },
    }))

    expect(res.status).toBe(200)
    expect(mocks.clearFailure).toHaveBeenCalledWith('ip:198.51.100.20')
    expect(mocks.clearFailure).toHaveBeenCalledWith('global:admin-login')
    expect(mocks.recordFailure).not.toHaveBeenCalled()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('basketball_admin_session=signed-token')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=strict')
  })

  it('records a failure on an incorrect password', async () => {
    const { POST, mocks } = await loadRoute({ passwordOk: false })

    const res = await POST(jsonRequest({ password: 'wrong' }))

    expect(res.status).toBe(403)
    expect(mocks.recordFailure).toHaveBeenCalledWith('ip:unknown')
    expect(mocks.recordFailure).toHaveBeenCalledWith('global:admin-login')
    expect(mocks.clearFailure).not.toHaveBeenCalled()
  })

  it('returns 400 and records a failure for invalid JSON bodies', async () => {
    const { POST, mocks } = await loadRoute({ passwordOk: false })

    const res = await POST(new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '198.51.100.30' },
      body: '{',
    }) as never)
    const body = await responseJson<{ error?: string }>(res)

    expect(res.status).toBe(400)
    expect(body.error).toBe('password は必須です')
    expect(mocks.recordFailure).toHaveBeenCalledWith('ip:198.51.100.30')
    expect(mocks.recordFailure).toHaveBeenCalledWith('global:admin-login')
    expect(mocks.safeCompare).not.toHaveBeenCalled()
  })

  it('returns 500 when the admin token cannot be created', async () => {
    const { POST, mocks } = await loadRoute({ passwordOk: true, token: null })

    const res = await POST(jsonRequest({ password: 'correct-password' }))
    const body = await responseJson<{ error?: string }>(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('Admin auth is not configured')
    expect(mocks.clearFailure).not.toHaveBeenCalled()
  })

  it('uses checkAdmin for GET verification', async () => {
    const unauthorized = await loadRoute({ adminOk: false })
    expect((await unauthorized.GET(emptyRequest())).status).toBe(401)

    const authorized = await loadRoute({ adminOk: true })
    expect((await authorized.GET(emptyRequest())).status).toBe(200)
  })

  it('clears the admin cookie on DELETE', async () => {
    const { DELETE } = await loadRoute()

    const res = await DELETE()

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('basketball_admin_session=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })
})
