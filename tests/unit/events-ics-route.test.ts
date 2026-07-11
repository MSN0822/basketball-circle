import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

type EventInput = {
  id?: string
  title?: string
  event_date?: string
  event_end_date?: string | null
  location?: string
  location_url?: string | null
  status?: 'accepting' | 'closed' | 'draft' | 'archived'
  publishes_at?: string | null
}

function defaultEvent(overrides: EventInput = {}): EventInput {
  return {
    id: EVENT_ID,
    title: 'テスト大会',
    event_date: '2026-08-01T10:00:00.000Z',
    event_end_date: '2026-08-01T12:00:00.000Z',
    location: '体育館',
    location_url: null,
    status: 'accepting',
    publishes_at: null,
    ...overrides,
  }
}

async function loadRoute(options: {
  event?: EventInput | null
  eventError?: { message: string; code?: string } | null
} = {}) {
  vi.resetModules()

  const event = options.event === undefined ? defaultEvent() : options.event

  const supabase = mockSupabaseFrom({
    selectMaybeSingleResult: { data: event, error: options.eventError ?? null },
  })

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))

  const route = await import('@/app/api/events/[id]/ics/route')
  return { GET: route.GET, supabase }
}

function requestFor(id: string) {
  const req = emptyRequest({ url: `https://example.test/api/events/${id}/ics`, method: 'GET' })
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(`https://example.test/api/events/${id}/ics`),
  })
  return req
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/events/[id]/ics', () => {
  it('rejects a malformed event id before touching Supabase', async () => {
    const { GET, supabase } = await loadRoute()

    const res = await GET(requestFor('not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('returns 500 when the event lookup fails with a DB error', async () => {
    const { GET } = await loadRoute({
      event: null,
      eventError: { message: 'connection terminated', code: '08006' },
    })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('connection terminated')
  })

  it('returns 404 when the event does not exist', async () => {
    const { GET } = await loadRoute({ event: null })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })

    expect(res.status).toBe(404)
  })

  it('returns 404 for a draft event', async () => {
    const { GET } = await loadRoute({ event: defaultEvent({ status: 'draft' }) })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })

    expect(res.status).toBe(404)
  })

  it('returns 404 for an archived event', async () => {
    const { GET } = await loadRoute({ event: defaultEvent({ status: 'archived' }) })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })

    expect(res.status).toBe(404)
  })

  it('returns a downloadable .ics for an accepting event', async () => {
    const { GET } = await loadRoute({ event: defaultEvent({ status: 'accepting' }) })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/calendar')
    expect(res.headers.get('Content-Type')).toContain('method=PUBLISH')
    // iOS Safariがattachmentだとタップ無反応になる既知の癖があるためinlineを使う（2026-07-11実機対応）。
    expect(res.headers.get('Content-Disposition')).toContain('inline')
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('METHOD:PUBLISH')
  })

  it('returns a downloadable .ics for a closed event', async () => {
    const { GET } = await loadRoute({ event: defaultEvent({ status: 'closed' }) })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('BEGIN:VCALENDAR')
  })

  it('returns 500 with a JSON error when the event has an invalid date', async () => {
    const { GET } = await loadRoute({ event: defaultEvent({ event_date: 'not-a-date' }) })

    const res = await GET(requestFor(EVENT_ID), { params: Promise.resolve({ id: EVENT_ID }) })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('不正な日付です')
  })
})
