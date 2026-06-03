import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonRequest } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const START = '2026-07-01T10:00:00.000Z'
const END = '2026-07-01T12:00:00.000Z'

const baseEvent = {
  id: EVENT_ID,
  title: 'Practice',
  event_date: START,
  event_end_date: END,
  location: 'Gym',
  location_url: null,
  closes_at: null,
  publishes_at: null,
  max_participants: 35,
  threshold: 30,
  status: 'accepting',
  is_manual_close: false,
  created_at: START,
}

const validCreateBody = {
  title: 'Practice',
  event_date: START,
  event_end_date: END,
  location: 'Gym',
  max_participants: 35,
  threshold: 30,
}

async function loadRoute(options: {
  adminOk?: boolean
  currentEvent?: unknown
  insertResult?: { data: unknown; error: null | { message: string } }
  updateResult?: { data: unknown; error: null | { message: string } }
  deleteResult?: { error: null | { message: string } }
} = {}) {
  vi.resetModules()

  const supabase = mockSupabaseFrom({
    selectSingleResult: { data: options.currentEvent ?? baseEvent, error: null },
    insertSingleResult: options.insertResult ?? { data: baseEvent, error: null },
    updateSingleResult: options.updateResult ?? { data: baseEvent, error: null },
    deleteEqResult: options.deleteResult ?? { error: null },
  })
  const checkAdmin = vi.fn().mockReturnValue(options.adminOk ?? true)

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))
  vi.doMock('@/lib/api-auth', () => ({ checkAdmin }))

  const route = await import('@/app/api/admin/events/route')
  return { POST: route.POST, PATCH: route.PATCH, DELETE: route.DELETE, supabase, mocks: { checkAdmin } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/admin/events', () => {
  it('rejects requests without an admin session before touching Supabase', async () => {
    const { POST, supabase } = await loadRoute({ adminOk: false })

    const res = await POST(jsonRequest(validCreateBody))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('rejects title and location values over 200 characters', async () => {
    const titleCase = await loadRoute()
    const titleRes = await titleCase.POST(jsonRequest({ ...validCreateBody, title: 'a'.repeat(201) }))
    expect(titleRes.status).toBe(400)
    expect(titleCase.supabase.spies.insert).not.toHaveBeenCalled()

    const locationCase = await loadRoute()
    const locationRes = await locationCase.POST(jsonRequest({ ...validCreateBody, location: 'a'.repeat(201) }))
    expect(locationRes.status).toBe(400)
    expect(locationCase.supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('rejects blank-looking title and location values', async () => {
    const titleCase = await loadRoute()
    const titleRes = await titleCase.POST(jsonRequest({ ...validCreateBody, title: '   ' }))
    expect(titleRes.status).toBe(400)
    expect(titleCase.supabase.spies.insert).not.toHaveBeenCalled()

    const locationCase = await loadRoute()
    const locationRes = await locationCase.POST(jsonRequest({ ...validCreateBody, location: '   ' }))
    expect(locationRes.status).toBe(400)
    expect(locationCase.supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('rejects non-http location_url schemes and overlong URLs', async () => {
    const javascriptCase = await loadRoute()
    const javascriptRes = await javascriptCase.POST(jsonRequest({ ...validCreateBody, location_url: 'javascript:alert(1)' }))
    expect(javascriptRes.status).toBe(400)
    expect(javascriptCase.supabase.spies.insert).not.toHaveBeenCalled()

    const dataCase = await loadRoute()
    const dataRes = await dataCase.POST(jsonRequest({ ...validCreateBody, location_url: 'data:text/html,test' }))
    expect(dataRes.status).toBe(400)
    expect(dataCase.supabase.spies.insert).not.toHaveBeenCalled()

    const longCase = await loadRoute()
    const longRes = await longCase.POST(jsonRequest({ ...validCreateBody, location_url: `https://example.com/${'a'.repeat(2000)}` }))
    expect(longRes.status).toBe(400)
    expect(longCase.supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('rejects event_end_date equal to event_date', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ ...validCreateBody, event_end_date: START }))

    expect(res.status).toBe(400)
    expect(supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('allows threshold equal to max_participants', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ ...validCreateBody, max_participants: 30, threshold: 30 }))

    expect(res.status).toBe(200)
    expect(supabase.spies.insert).toHaveBeenCalledWith(expect.objectContaining({
      max_participants: 30,
      threshold: 30,
    }))
  })

  it('rejects threshold greater than max_participants', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ ...validCreateBody, max_participants: 30, threshold: 31 }))

    expect(res.status).toBe(400)
    expect(supabase.spies.insert).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/events', () => {
  it('rejects malformed id before loading the current event', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: 'bad-id', status: 'closed' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('sets is_manual_close when an admin manually closes an event', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'closed' }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({
      status: 'closed',
      is_manual_close: true,
    })
  })

  it('resets is_manual_close when an admin reopens an event', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, status: 'closed', is_manual_close: true },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'accepting' }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({
      status: 'accepting',
      is_manual_close: false,
    })
  })

  it('validates capacity across current and patched fields', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, max_participants: 30, threshold: 30 },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, max_participants: 29 }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('allows clearing location_url with null', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, location_url: 'https://example.com' },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, location_url: null }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({ location_url: null })
  })
})

describe('DELETE /api/admin/events', () => {
  it('rejects malformed id before deleting participants or events', async () => {
    const { DELETE, supabase } = await loadRoute()

    const res = await DELETE(jsonRequest({ id: 'bad-id' }, { method: 'DELETE' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('aborts event deletion if participant deletion fails', async () => {
    const { DELETE, supabase } = await loadRoute({ deleteResult: { error: { message: 'delete failed' } } })

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(500)
    expect(supabase.spies.mockFrom).toHaveBeenCalledTimes(1)
    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('participants')
  })
})
