import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest } from './helpers/route'

async function loadRoute(
  options: {
    cronSecret?: string
    safeCompareOk?: boolean
    publishError?: Error
  } = {},
) {
  vi.resetModules()
  process.env.CRON_SECRET = options.cronSecret ?? 'cron-secret'

  const supabase = {}
  const getServerSupabase = vi.fn().mockReturnValue(supabase)
  const safeCompare = vi.fn().mockReturnValue(options.safeCompareOk ?? false)
  const publishDueDraftEvents = vi.fn().mockImplementation(async () => {
    if (options.publishError) throw options.publishError
  })

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase }))
  vi.doMock('@/lib/api-auth', () => ({ safeCompare }))
  vi.doMock('@/lib/event-publishing', () => ({ publishDueDraftEvents }))

  const route = await import('@/app/api/cron/publish-drafts/route')
  return { GET: route.GET, mocks: { getServerSupabase, publishDueDraftEvents, safeCompare, supabase } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/publish-drafts', () => {
  it('requires CRON_SECRET before comparing authorization', async () => {
    const { GET, mocks } = await loadRoute({ cronSecret: '' })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer cron-secret' } }))

    expect(res.status).toBe(500)
    expect(mocks.safeCompare).not.toHaveBeenCalled()
    expect(mocks.getServerSupabase).not.toHaveBeenCalled()
    expect(mocks.publishDueDraftEvents).not.toHaveBeenCalled()
  })

  it('compares the authorization header with safeCompare before touching Supabase', async () => {
    const { GET, mocks } = await loadRoute({ safeCompareOk: false })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer wrong' } }))

    expect(res.status).toBe(401)
    expect(mocks.safeCompare).toHaveBeenCalledWith('Bearer wrong', 'Bearer cron-secret')
    expect(mocks.getServerSupabase).not.toHaveBeenCalled()
    expect(mocks.publishDueDraftEvents).not.toHaveBeenCalled()
  })

  it('promotes due drafts when authorized', async () => {
    const { GET, mocks } = await loadRoute({ safeCompareOk: true })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer cron-secret' } }))

    expect(res.status).toBe(200)
    expect(mocks.publishDueDraftEvents).toHaveBeenCalledWith(mocks.supabase)
  })

  it('returns 500 when publishing fails', async () => {
    const { GET } = await loadRoute({
      safeCompareOk: true,
      publishError: new Error('db failed'),
    })

    const res = await GET(emptyRequest({ headers: { authorization: 'Bearer cron-secret' } }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('db failed')
  })
})
