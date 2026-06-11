import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonRequest, responseJson } from './helpers/route'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const AUTH_USER_ID = 'auth-user-1'
const OTHER_AUTH_USER_ID = 'auth-user-2'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

async function loadRoute(options: {
  userId?: string | null
  rpcResult?: { data: unknown; error: null | { message: string; code?: string } }
} = {}) {
  vi.resetModules()

  const supabase = mockSupabaseFrom({
    rpcResult: options.rpcResult ?? {
      data: {
        member: {
          id: MEMBER_ID,
          member_number: '001',
          name: 'Member A',
          auth_user_id: AUTH_USER_ID,
        },
      },
      error: null,
    },
  })
  const getBearerUser = vi.fn().mockResolvedValue(
    options.userId === null ? null : { id: options.userId ?? AUTH_USER_ID }
  )

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))
  vi.doMock('@/lib/api-auth', () => ({ getBearerUser }))

  const route = await import('@/app/api/members/route')
  return { POST: route.POST, PATCH: route.PATCH, supabase, mocks: { getBearerUser } }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/members', () => {
  it('validates required fields before bearer authentication', async () => {
    const { POST, supabase, mocks } = await loadRoute({ userId: null })

    const res = await POST(jsonRequest({ name: '   ', auth_user_id: AUTH_USER_ID }))

    expect(res.status).toBe(400)
    expect(mocks.getBearerUser).not.toHaveBeenCalled()
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects names longer than 100 characters', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ name: 'a'.repeat(101), auth_user_id: AUTH_USER_ID }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects non-string names without throwing', async () => {
    const { POST, supabase, mocks } = await loadRoute()

    const res = await POST(jsonRequest({ name: 123, auth_user_id: AUTH_USER_ID }))

    expect(res.status).toBe(400)
    expect(mocks.getBearerUser).not.toHaveBeenCalled()
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('allows a 100 character name and calls register_member', async () => {
    const { POST, supabase } = await loadRoute()

    const res = await POST(jsonRequest({ name: 'a'.repeat(100), auth_user_id: AUTH_USER_ID }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('register_member', {
      p_name: 'a'.repeat(100),
      p_auth_user_id: AUTH_USER_ID,
    })
  })

  it('rejects bearer users that do not match auth_user_id', async () => {
    const { POST, supabase } = await loadRoute({ userId: OTHER_AUTH_USER_ID })

    const res = await POST(jsonRequest({ name: 'Member A', auth_user_id: AUTH_USER_ID }))

    expect(res.status).toBe(403)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy inserts when register_member is missing', async () => {
    const { POST, supabase } = await loadRoute({
      rpcResult: {
        data: null,
        error: { code: 'PGRST202', message: 'register_member not found' },
      },
    })

    const res = await POST(jsonRequest({ name: 'Member A', auth_user_id: AUTH_USER_ID }))
    const body = await responseJson<{ error?: string }>(res)

    expect(res.status).toBe(500)
    expect(body.error).toBe('会員登録RPCが未適用です')
    expect(supabase.spies.insert).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/members', () => {
  it('requires bearer authentication before updating a member name', async () => {
    const { PATCH, supabase } = await loadRoute({ userId: null })

    const res = await PATCH(jsonRequest({ member_id: MEMBER_ID, name: 'New Name' }, { method: 'PATCH' }))

    expect(res.status).toBe(401)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects malformed member_id before calling update_member_name', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ member_id: 'bad-id', name: 'New Name' }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects PATCH names longer than 100 characters', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ member_id: MEMBER_ID, name: 'a'.repeat(101) }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('rejects non-string PATCH names without throwing', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ member_id: MEMBER_ID, name: 123 }, { method: 'PATCH' }))

    expect(res.status).toBe(400)
    expect(supabase.spies.mockRpc).not.toHaveBeenCalled()
  })

  it('updates member names through the atomic update_member_name RPC', async () => {
    const { PATCH, supabase } = await loadRoute()

    const res = await PATCH(jsonRequest({ member_id: MEMBER_ID, name: ' New Name ' }, { method: 'PATCH' }))

    expect(res.status).toBe(200)
    expect(supabase.spies.mockRpc).toHaveBeenCalledWith('update_member_name', {
      p_member_id: MEMBER_ID,
      p_auth_user_id: AUTH_USER_ID,
      p_name: 'New Name',
    })
  })

  it('propagates RPC domain errors with the RPC-provided status', async () => {
    const { PATCH } = await loadRoute({
      rpcResult: {
        data: { error: 'not owner', status: 403 },
        error: null,
      },
    })

    const res = await PATCH(jsonRequest({ member_id: MEMBER_ID, name: 'New Name' }, { method: 'PATCH' }))
    const body = await responseJson<{ error?: string }>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('not owner')
  })
})
