import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonRequest, responseJson } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const PARTICIPANT_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_MEMBER_ID = '33333333-3333-4333-8333-333333333333'

type ParticipantInput = {
  id?: string
  member_id?: string | null
  user_code?: string
  status?: string
}

async function loadRoute(options: {
  participant?: ParticipantInput | null
  event?: { status: 'accepting' | 'closed' | 'draft'; publishes_at: string | null; closes_at: string | null } | null
  bearerToken?: string | null
  authMemberId?: string | null
  authStatus?: number
  adminOk?: boolean
  rpcResult?: { data: unknown; error: null | { message: string } }
} = {}) {
  vi.resetModules()

  const participant = options.participant === undefined
    ? { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' }
    : options.participant

  const supabase = mockSupabaseFrom({
    selectSingleResult: { data: participant, error: null },
    selectMaybeSingleResult: {
      data: options.event === undefined ? { status: 'accepting', publishes_at: null, closes_at: null } : options.event,
      error: null,
    },
    rpcResult: options.rpcResult ?? { data: null, error: null },
  })
  const getBearerToken = vi.fn().mockReturnValue(options.bearerToken ?? null)
  const getAuthenticatedMember = vi.fn().mockResolvedValue(
    options.authMemberId
      ? { member: { id: options.authMemberId, name: 'Member' } }
      : { status: options.authStatus ?? 401, error: 'auth failed' }
  )
  const checkAdmin = vi.fn().mockReturnValue(options.adminOk ?? false)
  const safeCompare = vi.fn((a: string | null | undefined, b: string | null | undefined) => a === b && Boolean(a))

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))
  vi.doMock('@/lib/api-auth', () => ({ getBearerToken, getAuthenticatedMember, checkAdmin, safeCompare }))

  const route = await import('@/app/api/cancel/route')
  return { POST: route.POST, supabase, mocks: { getAuthenticatedMember, checkAdmin, safeCompare } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/cancel', () => {
  it('rejects malformed participant_id before touching Supabase', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ participant_id: 'not-a-uuid', user_code: '12345' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('allows legacy non-member cancellation only through safeCompare', async () => {
    const { POST, supabase, mocks } = await loadRoute()

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))

    expect(res.status).toBe(200)
    expect(mocks.safeCompare).toHaveBeenCalledWith('12345', '12345')
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('cancel_participant', { p_participant_id: PARTICIPANT_ID })
  })

  it('rejects an incorrect legacy cancellation code', async () => {
    const { POST, supabase, mocks } = await loadRoute()

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '99999' }))

    expect(res.status).toBe(401)
    expect(mocks.safeCompare).toHaveBeenCalledWith('99999', '12345')
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects direct temporary-code cancellation for guest participants without bearer auth', async () => {
    const { POST, supabase, mocks } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: `guest:${MEMBER_ID}:12345`, status: 'active' },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: `guest:${MEMBER_ID}:12345` }))

    expect(res.status).toBe(401)
    expect(mocks.safeCompare).not.toHaveBeenCalled()
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('allows a bearer-authenticated owner to cancel their guest participant', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: `guest:${MEMBER_ID}:12345`, status: 'active' },
      bearerToken: 'token',
      authMemberId: MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('cancel_participant', { p_participant_id: PARTICIPANT_ID })
  })

  it('rejects member cancellation for draft participants', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: MEMBER_ID, user_code: '12345', status: 'active' },
      event: { status: 'draft', publishes_at: null, closes_at: null },
      bearerToken: 'token',
      authMemberId: MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(404)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('allows member cancellation after due draft promotion', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: MEMBER_ID, user_code: '12345', status: 'active' },
      event: { status: 'accepting', publishes_at: '2026-06-07T00:00:00.000Z', closes_at: null },
      bearerToken: 'token',
      authMemberId: MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(200)
    expect(supabase.spies.update).toHaveBeenCalledWith({ status: 'accepting', is_manual_close: false })
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('cancel_participant', { p_participant_id: PARTICIPANT_ID })
  })

  it('rejects a bearer-authenticated member who does not own the participant', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: MEMBER_ID, user_code: '12345', status: 'active' },
      bearerToken: 'token',
      authMemberId: OTHER_MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: OTHER_MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('does not cancel a participant that is already cancelled', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'cancelled' },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))
    const body = await responseJson(res)

    expect(res.status).toBe(400)
    expect(String(body.error)).toBeTruthy()
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })
})
