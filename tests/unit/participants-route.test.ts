import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest, jsonRequest, responseJson } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

async function loadRoute(options: {
  authMemberId?: string | null
  authStatus?: number
  visibleEvent?: ({ id: string; status: 'accepting' | 'closed' | 'draft'; publishes_at: string | null } & Record<string, unknown>) | null
  selectOrderResult?: { data: unknown; error: null | { message: string; code?: string } }
  rpcResult?: { data: unknown; error: null | { message: string; code?: string } }
  updateManyResult?: { error: null | { message: string } }
} = {}) {
  vi.resetModules()

  const supabase = mockSupabaseFrom({
    selectMaybeSingleResult: {
      data: options.visibleEvent === undefined
        ? { id: EVENT_ID, status: 'accepting', publishes_at: null }
        : options.visibleEvent,
      error: null,
    },
    selectOrderResult: options.selectOrderResult,
    updateManyResult: options.updateManyResult,
    rpcResult: options.rpcResult ?? {
      data: {
        participant: {
          id: '44444444-4444-4444-8444-444444444444',
          event_id: EVENT_ID,
          name: 'Member A',
          user_code: `guest:${MEMBER_ID}:55555`,
          member_id: MEMBER_ID,
          status: 'active',
          slot_number: 1,
        },
      },
      error: null,
    },
  })
  const getAuthenticatedMember = vi.fn().mockResolvedValue(
    options.authMemberId === null
      ? { status: options.authStatus ?? 401, error: 'auth failed' }
      : { member: { id: options.authMemberId ?? MEMBER_ID, name: 'Member A' } }
  )

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))
  vi.doMock('@/lib/supabase', () => ({ generateUserCode: () => '55555' }))
  vi.doMock('@/lib/api-auth', () => ({ getAuthenticatedMember }))

  const route = await import('@/app/api/participants/route')
  return { GET: route.GET, POST: route.POST, supabase, mocks: { getAuthenticatedMember } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/participants', () => {
  it('returns the public participant list through the server-side view access', async () => {
    const participant = {
      id: '44444444-4444-4444-8444-444444444444',
      event_id: EVENT_ID,
      name: 'Member A',
      status: 'active',
      slot_number: 1,
      created_at: '2026-06-19T00:00:00.000Z',
      display_code: null,
    }
    const { GET, mocks } = await loadRoute({
      selectOrderResult: { data: [participant], error: null },
    })

    const req = emptyRequest({
      url: `https://example.test/api/participants?event_id=${EVENT_ID}`,
      method: 'GET',
    })
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(`https://example.test/api/participants?event_id=${EVENT_ID}`),
    })
    const res = await GET(req)
    const body = await responseJson<{ participants?: unknown[] }>(res)

    expect(res.status).toBe(200)
    expect(mocks.getAuthenticatedMember).toHaveBeenCalledWith(expect.any(Request), null)
    expect(body.participants).toEqual([participant])
  })

  it('rejects unauthenticated access when no event_id is given', async () => {
    const { GET, mocks } = await loadRoute({ authMemberId: null, authStatus: 401 })

    const url = 'https://example.test/api/participants'
    const req = emptyRequest({ url, method: 'GET' })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    const res = await GET(req)

    expect(res.status).toBe(401)
    expect(mocks.getAuthenticatedMember).toHaveBeenCalledWith(expect.any(Request), null)
  })

  it('returns only the caller\'s own participation list when event_id is omitted', async () => {
    const participation = {
      id: '44444444-4444-4444-8444-444444444444',
      event_id: EVENT_ID,
      name: 'Member A',
      user_code: '55555',
      member_id: MEMBER_ID,
      status: 'active',
      slot_number: 1,
      created_at: '2026-06-19T00:00:00.000Z',
      events: { id: EVENT_ID, status: 'accepting', publishes_at: null },
    }
    const { GET } = await loadRoute({
      authMemberId: MEMBER_ID,
      selectOrderResult: { data: [participation], error: null },
    })

    const url = 'https://example.test/api/participants'
    const req = emptyRequest({ url, method: 'GET' })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    const res = await GET(req)
    const body = await responseJson<{ participations?: { event_id: string; display_code: string | null }[] }>(res)

    expect(res.status).toBe(200)
    expect(body.participations).toHaveLength(1)
    expect(body.participations?.[0].event_id).toBe(EVENT_ID)
    expect(body.participations?.[0].display_code).toBeNull()
  })

  it('returns the caller\'s own participation plus their guests for an event', async () => {
    // selectMaybeSingleResult is shared by both the visibility check and the
    // own-participation lookup, so this row doubles as both.
    const ownRow = {
      status: 'accepting' as const,
      publishes_at: null,
      id: '44444444-4444-4444-8444-444444444444',
      event_id: EVENT_ID,
      name: 'Member A',
      user_code: '55555',
      member_id: MEMBER_ID,
      slot_number: 1,
    }
    const guestRow = {
      id: '66666666-6666-4666-8666-666666666666',
      event_id: EVENT_ID,
      name: 'Guest of Member A',
      user_code: `guest:${MEMBER_ID}:54321`,
      member_id: MEMBER_ID,
      status: 'active',
      slot_number: 2,
    }
    const { GET } = await loadRoute({
      authMemberId: MEMBER_ID,
      visibleEvent: ownRow,
      selectOrderResult: { data: [guestRow], error: null },
    })

    const url = `https://example.test/api/participants?event_id=${EVENT_ID}&member_id=${MEMBER_ID}`
    const req = emptyRequest({ url, method: 'GET' })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    const res = await GET(req)
    const body = await responseJson<{
      participation?: { event_id: string; user_code?: string }
      guests?: { display_code: string | null }[]
    }>(res)

    expect(res.status).toBe(200)
    expect(body.participation?.event_id).toBe(EVENT_ID)
    expect(body.participation?.user_code).toBeUndefined()
    expect(body.guests).toHaveLength(1)
    expect(body.guests?.[0].display_code).toBe('54321')
  })

  it('returns 404 when the event is not visible to members', async () => {
    const { GET } = await loadRoute({ authMemberId: MEMBER_ID, visibleEvent: null })

    const url = `https://example.test/api/participants?event_id=${EVENT_ID}&member_id=${MEMBER_ID}`
    const req = emptyRequest({ url, method: 'GET' })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    const res = await GET(req)

    expect(res.status).toBe(404)
  })

  it('returns 500 when publishDueDraftEvents fails', async () => {
    const { GET } = await loadRoute({
      authMemberId: MEMBER_ID,
      updateManyResult: { error: { message: 'connection terminated' } },
    })

    const url = 'https://example.test/api/participants'
    const req = emptyRequest({ url, method: 'GET' })
    Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
    const res = await GET(req)
    const body = await responseJson<{ error?: string }>(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('connection terminated')
  })
})

describe('POST /api/participants', () => {
  it('rejects malformed event_id before calling join_event', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ event_id: 'bad-id', name: 'Guest', member_id: MEMBER_ID, guest: true }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects guest names over 100 characters before calling join_event', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({
      event_id: EVENT_ID,
      name: 'a'.repeat(101),
      member_id: MEMBER_ID,
      guest: true,
    }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects a spoofed member_id via getAuthenticatedMember', async () => {
    const { POST, supabase, mocks } = await loadRoute({ authMemberId: null, authStatus: 403 })

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: 'Guest', member_id: OTHER_MEMBER_ID, guest: true }))

    expect(res.status).toBe(403)
    expect(mocks.getAuthenticatedMember).toHaveBeenCalledWith(expect.any(Request), OTHER_MEMBER_ID)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects draft events before calling join_event', async () => {
    const { POST, supabase } = await loadRoute({ visibleEvent: null })

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: 'Guest', member_id: MEMBER_ID, guest: true }))

    expect(res.status).toBe(404)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('promotes due drafts before loading the event and calling join_event', async () => {
    const { POST, supabase } = await loadRoute({
      visibleEvent: {
        id: EVENT_ID,
        status: 'accepting',
        publishes_at: '2026-06-07T00:00:00.000Z',
      },
    })

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: 'Guest', member_id: MEMBER_ID, guest: true }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({ status: 'accepting', is_manual_close: false })
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('join_event', expect.objectContaining({
      p_event_id: EVENT_ID,
      p_member_id: MEMBER_ID,
    }))
  })

  it('uses the authenticated member id as the canonical RPC member id', async () => {
    const { POST, supabase, mocks } = await loadRoute({ authMemberId: MEMBER_ID })

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: ' Guest B ', member_id: MEMBER_ID, guest: true }))

    expect(res.status).toBe(200)
    expect(mocks.getAuthenticatedMember).toHaveBeenCalledWith(expect.any(Request), MEMBER_ID)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('join_event', expect.objectContaining({
      p_event_id: EVENT_ID,
      p_name: 'Guest B',
      p_user_code: `guest:${MEMBER_ID}:55555`,
      p_member_id: MEMBER_ID,
      p_is_guest: true,
    }))
  })

  it('omits user_code from the response while returning temporary_code', async () => {
    const { POST } = await loadRoute()

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: 'Guest', member_id: MEMBER_ID, guest: true }))
    const body = await responseJson<{ participant: { user_code?: string }; temporary_code?: string }>(res)

    expect(res.status).toBe(200)
    expect(body.temporary_code).toBe('55555')
    expect(body.participant.user_code).toBeUndefined()
  })

  it('returns the status supplied by the join_event RPC error payload', async () => {
    const { POST } = await loadRoute({
      rpcResult: {
        data: { error: 'event is full', status: 409, participant_status: 'waitlist' },
        error: null,
      },
    })

    const res = await POST(jsonRequest({ event_id: EVENT_ID, name: 'Guest', member_id: MEMBER_ID, guest: true }))
    const body = await responseJson<{ error?: string; status?: string }>(res)

    expect(res.status).toBe(409)
    expect(body.error).toBe('event is full')
    expect(body.status).toBe('waitlist')
  })

  it('joins as the authenticated member (not a guest) when guest is omitted', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ event_id: EVENT_ID, member_id: MEMBER_ID }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('join_event', expect.objectContaining({
      p_event_id: EVENT_ID,
      p_name: 'Member A',
      p_user_code: '55555',
      p_member_id: MEMBER_ID,
      p_is_guest: false,
    }))
  })

  it('joins as the authenticated member (not a guest) when guest is explicitly false', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ event_id: EVENT_ID, member_id: MEMBER_ID, guest: false }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('join_event', expect.objectContaining({
      p_event_id: EVENT_ID,
      p_name: 'Member A',
      p_user_code: '55555',
      p_member_id: MEMBER_ID,
      p_is_guest: false,
    }))
  })
})
