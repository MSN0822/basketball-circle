import { getServerSupabase } from '@/lib/supabase-server'

export type AttemptState = {
  count: number
  resetAt: number
  lockedUntil: number
}

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const LOCK_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5

type AttemptRow = {
  key: string
  count: number
  reset_at: string
  locked_until: string | null
}

type AttemptStore = {
  get(key: string): Promise<AttemptState | null>
  set(key: string, state: AttemptState): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

const TABLE = 'admin_login_attempts'
const testAttempts = new Map<string, AttemptState>()

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

function fromIso(value: string | null): number {
  return value ? Date.parse(value) : 0
}

function rowToState(row: AttemptRow): AttemptState {
  return {
    count: row.count,
    resetAt: fromIso(row.reset_at),
    lockedUntil: fromIso(row.locked_until),
  }
}

function createSupabaseStore(): AttemptStore {
  return {
    async get(key) {
      const { data, error } = await getServerSupabase()
        .from(TABLE)
        .select('key,count,reset_at,locked_until')
        .eq('key', key)
        .maybeSingle<AttemptRow>()

      if (error) throw error
      return data ? rowToState(data) : null
    },
    async set(key, state) {
      const { error } = await getServerSupabase()
        .from(TABLE)
        .upsert({
          key,
          count: state.count,
          reset_at: toIso(state.resetAt),
          locked_until: state.lockedUntil > 0 ? toIso(state.lockedUntil) : null,
        })

      if (error) throw error
    },
    async delete(key) {
      const { error } = await getServerSupabase()
        .from(TABLE)
        .delete()
        .eq('key', key)

      if (error) throw error
    },
    async clear() {
      const { error } = await getServerSupabase()
        .from(TABLE)
        .delete()
        .neq('key', '')

      if (error) throw error
    },
  }
}

function createMemoryStore(): AttemptStore {
  return {
    async get(key) {
      return testAttempts.get(key) ?? null
    },
    async set(key, state) {
      testAttempts.set(key, state)
    },
    async delete(key) {
      testAttempts.delete(key)
    },
    async clear() {
      testAttempts.clear()
    },
  }
}

const store = process.env.NODE_ENV === 'test' ? createMemoryStore() : createSupabaseStore()

export function normalizeAttemptState(current: AttemptState | null, now = Date.now()): AttemptState {
  if (!current) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  // Keep an active lock until lockedUntil even if the attempt window has elapsed.
  if (current.lockedUntil > now) {
    return current
  }
  if (current.resetAt <= now) {
    return { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
  }
  return current
}

export async function getAttemptState(key: string, now = Date.now()): Promise<AttemptState> {
  return normalizeAttemptState(await store.get(key), now)
}

export async function isLocked(key: string, now = Date.now()): Promise<boolean> {
  const current = await getAttemptState(key, now)
  return current.lockedUntil > now
}

export async function recordFailure(key: string, now = Date.now()) {
  const current = await getAttemptState(key, now)
  const nextCount = current.count + 1
  await store.set(key, {
    count: nextCount,
    resetAt: current.resetAt,
    lockedUntil: nextCount >= MAX_ATTEMPTS ? now + LOCK_MS : current.lockedUntil,
  })
}

export async function clearFailure(key: string) {
  await store.delete(key)
}

export async function __resetAttempts() {
  await store.clear()
}
