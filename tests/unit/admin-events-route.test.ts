import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest, jsonRequest } from './helpers/route'
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
  selectOrderResult?: { data: unknown; error: null | { message: string } }
  insertResult?: { data: unknown; error: null | { message: string } }
  updateResult?: { data: unknown; error: null | { message: string } }
  deleteResult?: { error: null | { message: string } }
} = {}) {
  vi.resetModules()

  const supabase = mockSupabaseFrom({
    selectSingleResult: { data: options.currentEvent === undefined ? baseEvent : options.currentEvent, error: null },
    selectMaybeSingleResult: {
      data: options.currentEvent === undefined ? { id: EVENT_ID } : options.currentEvent,
      error: null,
    },
    selectOrderResult: options.selectOrderResult,
    insertSingleResult: options.insertResult ?? { data: baseEvent, error: null },
    updateSingleResult: options.updateResult ?? { data: baseEvent, error: null },
    deleteEqResult: options.deleteResult ?? { error: null },
  })
  const checkAdmin = vi.fn().mockReturnValue(options.adminOk ?? true)

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))
  vi.doMock('@/lib/api-auth', () => ({ checkAdmin }))
  vi.doMock('@/lib/event-publishing', () => ({ publishDueDraftEvents: vi.fn().mockResolvedValue(undefined) }))

  const route = await import('@/app/api/admin/events/route')
  return { GET: route.GET, POST: route.POST, PATCH: route.PATCH, DELETE: route.DELETE, supabase, mocks: { checkAdmin } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/admin/events', () => {
  it('returns current and archived events together for grouped list loading', async () => {
    const archivedEvent = { ...baseEvent, id: '22222222-2222-4222-8222-222222222222', status: 'archived' }
    const { GET, supabase } = await loadRoute({
      selectOrderResult: { data: [baseEvent, archivedEvent], error: null },
    })

    const req = emptyRequest({
      url: 'https://example.test/api/admin/events?grouped=1',
    })
    Object.defineProperty(req, 'nextUrl', {
      value: new URL('https://example.test/api/admin/events?grouped=1'),
    })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.events).toHaveLength(1)
    expect(body.archivedEvents).toHaveLength(1)
    expect(body.events[0].id).toBe(baseEvent.id)
    expect(body.archivedEvents[0].id).toBe(archivedEvent.id)
    expect(supabase.spies.selectOrder).toHaveBeenCalledTimes(1)
  })

  it('rejects requests without an admin session on the ?id= path before touching Supabase', async () => {
    const { GET, supabase } = await loadRoute({ adminOk: false })

    const req = emptyRequest({ url: `https://example.test/api/admin/events?id=${EVENT_ID}` })
    Object.defineProperty(req, 'nextUrl', { value: new URL(`https://example.test/api/admin/events?id=${EVENT_ID}`) })
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('returns the event and its participants for the ?id= path', async () => {
    const participant = { id: 'p1', event_id: EVENT_ID, status: 'confirmed', slot_number: 1 }
    const { GET, supabase } = await loadRoute({
      selectOrderResult: { data: [participant], error: null },
    })

    const req = emptyRequest({ url: `https://example.test/api/admin/events?id=${EVENT_ID}` })
    Object.defineProperty(req, 'nextUrl', { value: new URL(`https://example.test/api/admin/events?id=${EVENT_ID}`) })
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.event.id).toBe(EVENT_ID)
    expect(body.participants).toEqual([participant])
    expect(supabase.spies.selectNeq).toHaveBeenCalledWith('status', 'cancelled')
  })

  it('rejects a malformed id on the ?id= path', async () => {
    const { GET, supabase } = await loadRoute()

    const req = emptyRequest({ url: 'https://example.test/api/admin/events?id=bad-id' })
    Object.defineProperty(req, 'nextUrl', { value: new URL('https://example.test/api/admin/events?id=bad-id') })
    const res = await GET(req)

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('returns 404 on the ?id= path when the event does not exist', async () => {
    const { GET } = await loadRoute({ currentEvent: null })

    const req = emptyRequest({ url: `https://example.test/api/admin/events?id=${EVENT_ID}` })
    Object.defineProperty(req, 'nextUrl', { value: new URL(`https://example.test/api/admin/events?id=${EVENT_ID}`) })
    const res = await GET(req)

    expect(res.status).toBe(404)
  })

  it('applies the archived filter when ?archived=1 is set', async () => {
    const { GET, supabase } = await loadRoute({ selectOrderResult: { data: [], error: null } })

    const req = emptyRequest({ url: 'https://example.test/api/admin/events?archived=1' })
    Object.defineProperty(req, 'nextUrl', { value: new URL('https://example.test/api/admin/events?archived=1') })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(supabase.spies.selectEq).toHaveBeenCalledWith('status', 'archived')
    expect(supabase.spies.selectNeq).not.toHaveBeenCalled()
  })

  it('applies the non-archived filter when ?archived is not set', async () => {
    const { GET, supabase } = await loadRoute({ selectOrderResult: { data: [], error: null } })

    const req = emptyRequest({ url: 'https://example.test/api/admin/events' })
    Object.defineProperty(req, 'nextUrl', { value: new URL('https://example.test/api/admin/events') })
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(supabase.spies.selectNeq).toHaveBeenCalledWith('status', 'archived')
    expect(supabase.spies.selectEq).not.toHaveBeenCalled()
  })
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

  it('rejects an invalid status value on create', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ ...validCreateBody, status: 'bogus' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('rejects unparsable event_date and event_end_date strings', async () => {
    const dateCase = await loadRoute()
    const dateRes = await dateCase.POST(jsonRequest({ ...validCreateBody, event_date: 'not-a-date' }))
    expect(dateRes.status).toBe(400)
    expect(dateCase.supabase.spies.insert).not.toHaveBeenCalled()

    const endDateCase = await loadRoute()
    const endDateRes = await endDateCase.POST(jsonRequest({ ...validCreateBody, event_end_date: 'not-a-date' }))
    expect(endDateRes.status).toBe(400)
    expect(endDateCase.supabase.spies.insert).not.toHaveBeenCalled()
  })

  it('rejects zero, negative, or non-integer max_participants and threshold', async () => {
    for (const max_participants of [0, -1, 1.5]) {
      const { POST, supabase } = await loadRoute()
      const res = await POST(jsonRequest({ ...validCreateBody, max_participants }))
      expect(res.status).toBe(400)
      expect(supabase.spies.insert).not.toHaveBeenCalled()
    }

    for (const threshold of [0, -1, 1.5]) {
      const { POST, supabase } = await loadRoute()
      const res = await POST(jsonRequest({ ...validCreateBody, threshold }))
      expect(res.status).toBe(400)
      expect(supabase.spies.insert).not.toHaveBeenCalled()
    }
  })

  it('returns an error when event insertion fails', async () => {
    const { POST, supabase } = await loadRoute({ insertResult: { data: null, error: { message: 'insert failed' } } })

    const res = await POST(jsonRequest(validCreateBody))

    expect(res.status).toBe(500)
    expect(supabase.spies.insert).toHaveBeenCalled()
  })

  it('allows creating an event directly with status archived', async () => {
    // EVT-11/ADM-23: archivedへの変更・archivedのDELETEは許容仕様
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ ...validCreateBody, status: 'archived' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }))
  })
})

describe('PATCH /api/admin/events', () => {
  it('rejects requests without an admin session before touching Supabase', async () => {
    const { PATCH, supabase } = await loadRoute({ adminOk: false })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'closed' }, { method: 'PATCH' }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('rejects malformed id before loading the current event', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: 'bad-id', status: 'closed' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('returns 404 when patching a nonexistent event', async () => {
    const { PATCH, supabase } = await loadRoute({ currentEvent: null })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, title: 'New title' }, { method: 'PATCH' }))

    expect(res.status).toBe(404)
    expect(supabase.spies.update).not.toHaveBeenCalled()
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

  it('rejects editing or status changes for archived events', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, status: 'archived' },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, title: 'Renamed' }, { method: 'PATCH' }))

    expect(res.status).toBe(409)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects reopening an archived event', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, status: 'archived' },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'accepting' }, { method: 'PATCH' }))

    expect(res.status).toBe(409)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid status value', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'bogus' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects a title that becomes empty after trimming', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, title: '   ' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects a location that becomes empty after trimming', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, location: '   ' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid location_url', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, location_url: 'javascript:alert(1)' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects event_end_date set before the current event_date', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, event_end_date: '2020-01-01T00:00:00.000Z' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid publishes_at', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, publishes_at: 'not-a-date' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.update).not.toHaveBeenCalled()
  })

  it('returns an error when the update fails', async () => {
    const { PATCH, supabase } = await loadRoute({ updateResult: { data: null, error: { message: 'update failed' } } })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, title: 'New title' }, { method: 'PATCH' }))

    expect(res.status).toBe(500)
    expect(supabase.spies.update).toHaveBeenCalled()
  })

  it('allows patching from accepting to archived and resets is_manual_close', async () => {
    // EVT-11/ADM-23: archivedへの変更・archivedのDELETEは許容仕様
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'archived' }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({
      status: 'archived',
      is_manual_close: false,
    })
  })

  it('resets is_manual_close when publishing a draft to accepting', async () => {
    const { PATCH, supabase } = await loadRoute({
      currentEvent: { ...baseEvent, status: 'draft', is_manual_close: false },
    })

    const res = await PATCH(jsonRequest({ id: EVENT_ID, status: 'accepting' }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({
      status: 'accepting',
      is_manual_close: false,
    })
  })
})

describe('DELETE /api/admin/events', () => {
  it('rejects malformed id before deleting an event', async () => {
    const { DELETE, supabase } = await loadRoute()

    const res = await DELETE(jsonRequest({ id: 'bad-id' }, { method: 'DELETE' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('rejects requests without an admin session before touching Supabase', async () => {
    const { DELETE, supabase } = await loadRoute({ adminOk: false })

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('allows deleting an archived event', async () => {
    // EVT-11/ADM-23: archivedへの変更・archivedのDELETEは許容仕様
    const { DELETE, supabase } = await loadRoute({ currentEvent: { ...baseEvent, status: 'archived' } })

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.deleteFn).toHaveBeenCalledTimes(1)
  })

  it('deletes only the event and relies on database cascade for participants', async () => {
    const { DELETE, supabase } = await loadRoute()

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockFrom).toHaveBeenCalledTimes(2)
    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('events')
    expect(supabase.spies.deleteFn).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when deleting a valid but nonexistent event id', async () => {
    const { DELETE, supabase } = await loadRoute({ currentEvent: null })

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(404)
    expect(supabase.spies.deleteFn).not.toHaveBeenCalled()
  })

  it('returns an error when event deletion fails', async () => {
    const { DELETE, supabase } = await loadRoute({ deleteResult: { error: { message: 'delete failed' } } })

    const res = await DELETE(jsonRequest({ id: EVENT_ID }, { method: 'DELETE' }))

    expect(res.status).toBe(500)
    expect(supabase.spies.mockFrom).toHaveBeenCalledTimes(2)
    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('events')
  })
})
