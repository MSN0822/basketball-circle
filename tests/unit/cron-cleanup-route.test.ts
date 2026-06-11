import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest } from './helpers/route'

async function loadRoute(options: { safeCompareOk?: boolean; cronSecret?: string } = {}) {
  vi.resetModules()
  process.env.CRON_SECRET = options.cronSecret ?? 'cron-secret'

  const getServerSupabase = vi.fn()
  const safeCompare = vi.fn().mockReturnValue(options.safeCompareOk ?? false)

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase }))
  vi.doMock('@/lib/api-auth', () => ({ safeCompare }))

  const route = await import('@/app/api/cron/cleanup/route')
  return { GET: route.GET, mocks: { getServerSupabase, safeCompare } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/cleanup', () => {
  it('requires CRON_SECRET before comparing authorization', async () => {
    const { GET, mocks } = await loadRoute({ cronSecret: '' })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer cron-secret' } }))

    expect(res.status).toBe(500)
    expect(mocks.safeCompare).not.toHaveBeenCalled()
    expect(mocks.getServerSupabase).not.toHaveBeenCalled()
  })

  it('compares the authorization header with safeCompare before touching Supabase', async () => {
    const { GET, mocks } = await loadRoute({ safeCompareOk: false })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer wrong' } }))

    expect(res.status).toBe(401)
    expect(mocks.safeCompare).toHaveBeenCalledWith('Bearer wrong', 'Bearer cron-secret')
    expect(mocks.getServerSupabase).not.toHaveBeenCalled()
  })
})
