import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest } from './helpers/route'

type QueryError = null | { message: string; code?: string }

type DormantMemberRow = { id: string; auth_user_id: string | null }

type BodyMockConfig = {
  // events select (.from('events').select('id').lt(...).in('status', [...]))
  expiredEvents?: { id: string }[]
  eventsFetchError?: QueryError
  // events update (.from('events').update(...).in('id', batch))
  eventsUpdateError?: QueryError
  // members select (.from('members').select('id,auth_user_id').lt(...).limit(...))
  dormantMembers?: DormantMemberRow[]
  dormantFetchError?: QueryError
  // participants update (.from('participants').update({member_id:null}).eq(...))
  participantUpdateError?: QueryError
  // members delete (.from('members').delete().eq('id', ...))
  memberDeleteError?: QueryError
  // auth.admin.deleteUser
  authDeleteError?: QueryError
}

/**
 * Purpose-built Supabase mock for the cleanup route. The shared
 * mock-supabase helper cannot distinguish the events-select (terminal `.in`)
 * from the members-select (terminal `.limit`), nor route `.from()` per table,
 * so we build a tailored client here mirroring the helper's spy style.
 */
function buildSupabase(config: BodyMockConfig) {
  const expiredEventsResult = { data: config.expiredEvents ?? [], error: config.eventsFetchError ?? null }
  const dormantMembersResult = { data: config.dormantMembers ?? [], error: config.dormantFetchError ?? null }

  // --- events select chain: select -> lt -> in (awaited) ---
  const eventsSelectIn = vi.fn().mockResolvedValue(expiredEventsResult)
  const eventsSelectLt = vi.fn().mockReturnValue({ in: eventsSelectIn })
  const eventsSelect = vi.fn().mockReturnValue({ lt: eventsSelectLt })

  // --- events update chain: update -> in (awaited) ---
  const eventsUpdateIn = vi.fn().mockResolvedValue({ error: config.eventsUpdateError ?? null })
  const eventsUpdate = vi.fn().mockReturnValue({ in: eventsUpdateIn })

  // --- members select chain: select -> lt -> limit (awaited) ---
  const membersSelectLimit = vi.fn().mockResolvedValue(dormantMembersResult)
  const membersSelectLt = vi.fn().mockReturnValue({ limit: membersSelectLimit })
  const membersSelect = vi.fn().mockReturnValue({ lt: membersSelectLt })

  // --- members delete chain: delete -> eq (awaited) ---
  const membersDeleteEq = vi.fn().mockResolvedValue({ error: config.memberDeleteError ?? null })
  const membersDelete = vi.fn().mockReturnValue({ eq: membersDeleteEq })

  // --- participants update chain: update -> eq (awaited) ---
  const participantsUpdateEq = vi.fn().mockResolvedValue({ error: config.participantUpdateError ?? null })
  const participantsUpdate = vi.fn().mockReturnValue({ eq: participantsUpdateEq })

  const eventsTable = { select: eventsSelect, update: eventsUpdate }
  const membersTable = { select: membersSelect, delete: membersDelete }
  const participantsTable = { update: participantsUpdate }

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'events') return eventsTable
    if (table === 'members') return membersTable
    if (table === 'participants') return participantsTable
    throw new Error(`unexpected table ${table}`)
  })

  const deleteUser = vi.fn().mockResolvedValue({ error: config.authDeleteError ?? null })

  return {
    client: {
      from,
      auth: { admin: { deleteUser } },
    },
    spies: {
      from,
      eventsSelect,
      eventsSelectLt,
      eventsSelectIn,
      eventsUpdate,
      eventsUpdateIn,
      membersSelect,
      membersSelectLt,
      membersSelectLimit,
      membersDelete,
      membersDeleteEq,
      participantsUpdate,
      participantsUpdateEq,
      deleteUser,
    },
  }
}

async function loadRoute(
  options: {
    safeCompareOk?: boolean
    cronSecret?: string
    body?: BodyMockConfig
  } = {},
) {
  vi.resetModules()
  process.env.CRON_SECRET = options.cronSecret ?? 'cron-secret'

  const supabase = buildSupabase(options.body ?? {})
  const getServerSupabase = vi.fn().mockReturnValue(supabase.client)
  const safeCompare = vi.fn().mockReturnValue(options.safeCompareOk ?? false)

  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase }))
  vi.doMock('@/lib/api-auth', () => ({ safeCompare }))

  const route = await import('@/app/api/cron/cleanup/route')
  return { GET: route.GET, supabase, mocks: { getServerSupabase, safeCompare } }
}

function authorizedRequest() {
  return emptyRequest({ headers: { authorization: 'Bearer cron-secret' } })
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

  describe('body logic (authorized)', () => {
    it('archives expired events instead of deleting them', async () => {
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: { expiredEvents: [{ id: 'event-1' }, { id: 'event-2' }] },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.archived).toBe(2)

      // Only past, still-visible events are selected for archival.
      expect(supabase.spies.eventsSelectLt).toHaveBeenCalledWith('event_end_date', expect.any(String))
      expect(supabase.spies.eventsSelectIn).toHaveBeenCalledWith('status', ['accepting', 'closed'])

      // They are UPDATEd to archived, never deleted.
      expect(supabase.spies.eventsUpdate).toHaveBeenCalledWith({ status: 'archived', is_manual_close: false })
      expect(supabase.spies.eventsUpdateIn).toHaveBeenCalledWith('id', ['event-1', 'event-2'])
    })

    it('does not run an update when there are no expired events', async () => {
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: { expiredEvents: [] },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.archived).toBe(0)
      expect(supabase.spies.eventsUpdate).not.toHaveBeenCalled()
    })

    it('returns 500 when fetching expired events fails', async () => {
      const { GET } = await loadRoute({
        safeCompareOk: true,
        body: { eventsFetchError: { message: 'fetch boom' } },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body.error).toBe('fetch boom')
    })

    it('logs the failure reason to console.error so it appears in Vercel function logs', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { GET } = await loadRoute({
        safeCompareOk: true,
        body: { eventsFetchError: { message: 'fetch boom' } },
      })

      await GET(authorizedRequest())

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cron/cleanup'), 'fetch boom')
    })

    it('nulls participants.member_id BEFORE deleting the dormant member', async () => {
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: {
          dormantMembers: [{ id: 'member-1', auth_user_id: 'auth-1' }],
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.deletedMembers).toBe(1)

      // History is preserved by nulling the FK first...
      expect(supabase.spies.participantsUpdate).toHaveBeenCalledWith({ member_id: null })
      expect(supabase.spies.participantsUpdateEq).toHaveBeenCalledWith('member_id', 'member-1')
      // ...then the member row is deleted.
      expect(supabase.spies.membersDelete).toHaveBeenCalled()
      expect(supabase.spies.membersDeleteEq).toHaveBeenCalledWith('id', 'member-1')

      // Ordering: participant null-out must happen before member delete.
      const participantOrder = supabase.spies.participantsUpdateEq.mock.invocationCallOrder[0]
      const deleteOrder = supabase.spies.membersDeleteEq.mock.invocationCallOrder[0]
      expect(participantOrder).toBeLessThan(deleteOrder)

      // The auth user is removed for members that have one.
      expect(supabase.spies.deleteUser).toHaveBeenCalledWith('auth-1')
    })

    it('selects dormant members by last_accessed_at and skips auth deletion when no auth_user_id', async () => {
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: {
          dormantMembers: [{ id: 'member-1', auth_user_id: null }],
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.deletedMembers).toBe(1)
      expect(supabase.spies.membersSelectLt).toHaveBeenCalledWith('last_accessed_at', expect.any(String))
      // No auth_user_id => no auth.admin.deleteUser call.
      expect(supabase.spies.deleteUser).not.toHaveBeenCalled()
      expect(body.authDeleteErrors).toEqual([])
    })

    it('treats auth.admin.deleteUser failure as non-fatal and collects the error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: {
          dormantMembers: [{ id: 'member-1', auth_user_id: 'auth-1' }],
          authDeleteError: { message: 'auth delete failed' },
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      // Still 200, no throw / no 500.
      expect(res.status).toBe(200)
      // The member row was still deleted.
      expect(body.deletedMembers).toBe(1)
      expect(supabase.spies.membersDeleteEq).toHaveBeenCalledWith('id', 'member-1')
      // The failed auth user id is collected.
      expect(body.authDeleteErrors).toEqual(['auth-1'])
      // The orphaned auth user is logged with its id for manual follow-up.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('cron/cleanup'),
        'auth-1',
        'auth delete failed',
      )
    })

    it('returns 500 when nulling participants fails (before deleting the member)', async () => {
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: {
          dormantMembers: [{ id: 'member-1', auth_user_id: 'auth-1' }],
          participantUpdateError: { message: 'participant boom' },
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body.error).toBe('participant boom')
      // Member must NOT be deleted if history preservation failed.
      expect(supabase.spies.membersDelete).not.toHaveBeenCalled()
    })

    it('returns 500 when deleting the member row fails', async () => {
      const { GET } = await loadRoute({
        safeCompareOk: true,
        body: {
          dormantMembers: [{ id: 'member-1', auth_user_id: 'auth-1' }],
          memberDeleteError: { message: 'member delete boom' },
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body.error).toBe('member delete boom')
    })

    it('returns 500 when fetching dormant members fails (after archiving events)', async () => {
      const { GET } = await loadRoute({
        safeCompareOk: true,
        body: {
          expiredEvents: [{ id: 'event-1' }],
          dormantFetchError: { message: 'dormant boom' },
        },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body.error).toBe('dormant boom')
      expect(body.archived).toBe(1)
    })

    it('archives expired events in batches of CLEANUP_BATCH_SIZE (100)', async () => {
      const expiredEvents = Array.from({ length: 250 }, (_, i) => ({ id: `event-${i}` }))
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: { expiredEvents },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.archived).toBe(250)
      // 250 events => ceil(250 / 100) = 3 update batches.
      expect(supabase.spies.eventsUpdate).toHaveBeenCalledTimes(3)
      const batchSizes = supabase.spies.eventsUpdateIn.mock.calls.map(([, ids]) => (ids as string[]).length)
      expect(batchSizes).toEqual([100, 100, 50])
    })

    it('processes every dormant member returned in one pass', async () => {
      const dormantMembers = [
        { id: 'm1', auth_user_id: 'a1' },
        { id: 'm2', auth_user_id: null },
        { id: 'm3', auth_user_id: 'a3' },
      ]
      const { GET, supabase } = await loadRoute({
        safeCompareOk: true,
        body: { dormantMembers },
      })

      const res = await GET(authorizedRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.deletedMembers).toBe(3)
      expect(supabase.spies.participantsUpdateEq).toHaveBeenCalledTimes(3)
      expect(supabase.spies.membersDeleteEq).toHaveBeenCalledTimes(3)
      // Only members with an auth_user_id trigger auth deletion (m1, m3).
      expect(supabase.spies.deleteUser).toHaveBeenCalledTimes(2)
      expect(body.authDeleteErrors).toEqual([])
    })
  })
})
