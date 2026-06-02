import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonRequest, responseJson } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

async function loadRoute(options: {
  authMemberId?: string | null
  authStatus?: number
  rpcResult?: { data: unknown; error: null | { message: string; code?: string } }
} = {}) {
  vi.resetModules()

  const supabase = mockSupabaseFrom({
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
  return { POST: route.POST, supabase, mocks: { getAuthenticatedMember } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/participants', () => {
  it('rejects malformed event_id before calling join_event', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ event_id: 'bad-id', name: 'Guest', member_id: MEMBER_ID, guest: true }))

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
})
