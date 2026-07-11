import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest, jsonRequest, responseJson } from './helpers/route'
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
  participantError?: { message: string; code?: string } | null
  event?: { status: 'accepting' | 'closed' | 'draft' | 'archived'; publishes_at: string | null } | null
  bearerToken?: string | null
  authMemberId?: string | null
  authStatus?: number
  adminOk?: boolean
  rpcResult?: { data: unknown; error: null | { message: string } }
  updateManyResult?: { error: null | { message: string } }
} = {}) {
  vi.resetModules()

  const participant = options.participant === undefined
    ? { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' }
    : options.participant

  const supabase = mockSupabaseFrom({
    selectSingleResult: { data: participant, error: options.participantError ?? null },
    selectMaybeSingleResult: {
      data: options.event === undefined ? { status: 'accepting', publishes_at: null } : options.event,
      error: null,
    },
    rpcResult: options.rpcResult ?? { data: null, error: null },
    updateManyResult: options.updateManyResult,
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

  it('returns 500 (not 404) when the participant lookup fails with a real DB error', async () => {
    const { POST, supabase } = await loadRoute({
      participant: null,
      participantError: { message: 'connection terminated', code: '08006' },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))
    const body = await responseJson(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('connection terminated')
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('keeps returning 404 when the participant row does not exist (PGRST116)', async () => {
    const { POST, supabase } = await loadRoute({
      participant: null,
      participantError: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))

    expect(res.status).toBe(404)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
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
      event: { status: 'draft', publishes_at: null },
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
      event: { status: 'accepting', publishes_at: '2026-06-07T00:00:00.000Z' },
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

  it('rejects admin cancellation for archived events', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      event: { status: 'archived', publishes_at: null },
      adminOk: true,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, admin: true }))
    const body = await responseJson(res)

    expect(res.status).toBe(409)
    expect(String(body.error)).toBeTruthy()
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('allows admin cancellation for non-archived events', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      event: { status: 'closed', publishes_at: null },
      adminOk: true,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, admin: true }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('cancel_participant', { p_participant_id: PARTICIPANT_ID })
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

  it('rejects admin cancellation when checkAdmin fails', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      adminOk: false,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, admin: true }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('returns 500 when the cancel_participant RPC itself errors', async () => {
    const { POST } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      rpcResult: { data: null, error: { message: 'connection terminated' } },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))
    const body = await responseJson(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('connection terminated')
  })

  it('propagates cancel_participant domain errors with the RPC-provided status', async () => {
    const { POST } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      rpcResult: { data: { error: '定員が変更されました', status: 409 }, error: null },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))
    const body = await responseJson(res)

    expect(res.status).toBe(409)
    expect(body.error).toBe('定員が変更されました')
  })

  it('returns 500 when publishing due draft events fails', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'active' },
      updateManyResult: { error: { message: '公開処理に失敗しました' } },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))
    const body = await responseJson(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('公開処理に失敗しました')
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('allows cancelling a waitlisted participant', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: '12345', status: 'waitlist' },
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, user_code: '12345' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('cancel_participant', { p_participant_id: PARTICIPANT_ID })
  })

  it('returns 404 for a bearer-authenticated member cancelling a participant in an archived event', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: MEMBER_ID, user_code: '12345', status: 'active' },
      event: { status: 'archived', publishes_at: null },
      bearerToken: 'token',
      authMemberId: MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(404)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects cancelling another member\'s guest participant', async () => {
    const { POST, supabase } = await loadRoute({
      participant: { id: PARTICIPANT_ID, member_id: null, user_code: `guest:${OTHER_MEMBER_ID}:12345`, status: 'active' },
      bearerToken: 'token',
      authMemberId: MEMBER_ID,
    })

    const res = await POST(jsonRequest({ participant_id: PARTICIPANT_ID, member_id: MEMBER_ID }, {
      headers: { Authorization: 'Bearer token' },
    }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })
})

// H-3: 上のテストは vi.doMock で api-auth 全体を偽実装に差し替えているため、
// なりすまし防止比較（requestedMemberId !== member.id）を含む実物のロジックが
// 一度も実行されない。ここでは api-auth.ts を実物のまま使い、Supabase クライアント
// 部分だけをモックして getAuthenticatedMember の分岐を実コードパスで固定する。
async function loadRealAuth(options: {
  getUserResult?: { data: { user: { id: string } | null }; error: { message: string } | null }
  member?: { id: string } | null
  memberError?: { message: string } | null
} = {}) {
  vi.resetModules()

  const getUser = vi.fn().mockResolvedValue(
    options.getUserResult ?? { data: { user: { id: 'auth-user-1' } }, error: null }
  )
  const supabase = mockSupabaseFrom({
    selectSingleResult: {
      data: options.member === undefined ? { id: MEMBER_ID, name: 'Member' } : options.member,
      error: options.memberError ?? null,
    },
  })

  vi.doMock('@/lib/supabase-server', () => ({
    getServerSupabase: () => supabase.client,
    getAuthSupabase: () => ({ auth: { getUser } }),
  }))

  const apiAuth = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth')
  return { getAuthenticatedMember: apiAuth.getAuthenticatedMember, supabase, mocks: { getUser } }
}

describe('getAuthenticatedMember (real api-auth implementation)', () => {
  it('returns 401 when the request has no bearer token', async () => {
    const { getAuthenticatedMember } = await loadRealAuth()

    const result = await getAuthenticatedMember(emptyRequest(), null)

    expect(result.status).toBe(401)
  })

  it('returns 401 when Supabase auth.getUser fails', async () => {
    const { getAuthenticatedMember } = await loadRealAuth({
      getUserResult: { data: { user: null }, error: { message: 'invalid token' } },
    })

    const req = jsonRequest({}, { headers: { Authorization: 'Bearer token' } })
    const result = await getAuthenticatedMember(req, null)

    expect(result.status).toBe(401)
  })

  it('returns 403 when no member row matches the authenticated user', async () => {
    const { getAuthenticatedMember } = await loadRealAuth({ member: null })

    const req = jsonRequest({}, { headers: { Authorization: 'Bearer token' } })
    const result = await getAuthenticatedMember(req, null)

    expect(result.status).toBe(403)
  })

  it('rejects impersonation when requestedMemberId does not match the authenticated member', async () => {
    const { getAuthenticatedMember } = await loadRealAuth({ member: { id: MEMBER_ID } })

    const req = jsonRequest({}, { headers: { Authorization: 'Bearer token' } })
    const result = await getAuthenticatedMember(req, OTHER_MEMBER_ID)

    expect(result.status).toBe(403)
    expect(result.error).toBe('本人確認に失敗しました')
  })

  it('returns the authenticated member when requestedMemberId matches', async () => {
    const { getAuthenticatedMember } = await loadRealAuth({ member: { id: MEMBER_ID } })

    const req = jsonRequest({}, { headers: { Authorization: 'Bearer token' } })
    const result = await getAuthenticatedMember(req, MEMBER_ID)

    expect(result.member?.id).toBe(MEMBER_ID)
  })
})
