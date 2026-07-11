import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSupabaseFrom } from './helpers/mock-supabase'

const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000

async function loadServerMember() {
  vi.resetModules()
  const supabase = mockSupabaseFrom()
  vi.doMock('@/lib/supabase-server', () => ({ getServerSupabase: () => supabase.client }))

  const mod = await import('@/lib/server-member')
  return { ...mod, supabase }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('touchMemberLastAccess', () => {
  it('does not update when last_accessed_at is within the last 24 hours', async () => {
    const { touchMemberLastAccess, supabase } = await loadServerMember()
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const recent = new Date(now - 1000).toISOString()

    await touchMemberLastAccess({ id: 'member-1', last_accessed_at: recent })

    expect(supabase.spies.mockFrom).not.toHaveBeenCalled()
  })

  it('updates when last_accessed_at is more than 24 hours old', async () => {
    const { touchMemberLastAccess, supabase } = await loadServerMember()
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const old = new Date(now - TOUCH_INTERVAL_MS - 1000).toISOString()

    await touchMemberLastAccess({ id: 'member-1', last_accessed_at: old })

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('members')
    expect(supabase.spies.update).toHaveBeenCalledWith(expect.objectContaining({ last_accessed_at: expect.any(String) }))
    expect(supabase.spies.updateEq).toHaveBeenCalledWith('id', 'member-1')
  })

  it('updates exactly at the 24 hour boundary (elapsed time is not strictly less than the interval)', async () => {
    const { touchMemberLastAccess, supabase } = await loadServerMember()
    const now = Date.UTC(2026, 0, 2, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const exactlyBoundary = new Date(now - TOUCH_INTERVAL_MS).toISOString()

    await touchMemberLastAccess({ id: 'member-1', last_accessed_at: exactlyBoundary })

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('members')
  })

  it('updates when last_accessed_at is an unparseable string (Number.isFinite guard fails)', async () => {
    const { touchMemberLastAccess, supabase } = await loadServerMember()

    await touchMemberLastAccess({ id: 'member-1', last_accessed_at: 'not-a-date' })

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('members')
  })

  it('updates when last_accessed_at is null', async () => {
    const { touchMemberLastAccess, supabase } = await loadServerMember()

    await touchMemberLastAccess({ id: 'member-1', last_accessed_at: null as unknown as string })

    expect(supabase.spies.mockFrom).toHaveBeenCalledWith('members')
  })
})

describe('getCookieMember', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey
  })

  it('returns null without touching cookies when the Supabase URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'
    const { getCookieMember } = await loadServerMember()

    await expect(getCookieMember()).resolves.toBeNull()
  })

  it('returns null without touching cookies when the Supabase anon key is not configured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dummy.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const { getCookieMember } = await loadServerMember()

    await expect(getCookieMember()).resolves.toBeNull()
  })
})
