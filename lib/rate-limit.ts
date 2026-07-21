import { NextResponse, type NextRequest } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

export type AttemptState = {
  count: number
  resetAt: number
  lockedUntil: number
}

export type RateLimitPolicy = {
  windowMs: number
  lockMs: number
  maxAttempts: number
  // 原子的なカウントアップに使う RPC。管理者ログイン用の既存 RPC とは引数名が違うため、
  // 呼び出す関数名と引数の組み立てをポリシー側に持たせている。
  rpcName: string
  buildRpcArgs: (key: string, policy: RateLimitPolicy) => Record<string, unknown>
}

type AttemptRow = {
  key: string
  count: number
  reset_at: string
  locked_until: string | null
}

type AttemptStore = {
  get(key: string): Promise<AttemptState | null>
  set(key: string, state: AttemptState): Promise<void>
  increment?(key: string, policy: RateLimitPolicy): Promise<AttemptState>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

// 管理者ログイン用に作ったテーブルを汎用カウンタとして流用する。
// 改名すると既存 migration・pgTAP・DEPLOY_RUNBOOK の3箇所へ波及するため見送った（2026-07-21）。
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
    async increment(key, policy) {
      const { data, error } = await getServerSupabase()
        .rpc(policy.rpcName, policy.buildRpcArgs(key, policy))

      if (error) throw error
      return rowToState(data as AttemptRow)
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

// 会員向け API 用のポリシーを作る。DB 側は汎用 RPC record_rate_limit_hit を使う。
export function createPolicy(options: { windowMs: number; lockMs: number; maxAttempts: number }): RateLimitPolicy {
  return {
    ...options,
    rpcName: 'record_rate_limit_hit',
    buildRpcArgs: (key, policy) => ({
      p_key: key,
      p_window_ms: policy.windowMs,
      p_lock_ms: policy.lockMs,
      p_max_attempts: policy.maxAttempts,
    }),
  }
}

export function normalizeAttemptState(
  current: AttemptState | null,
  policy: RateLimitPolicy,
  now = Date.now(),
): AttemptState {
  if (!current) {
    return { count: 0, resetAt: now + policy.windowMs, lockedUntil: 0 }
  }
  // ロック中は、集計ウィンドウが過ぎていてもロックを維持する。
  if (current.lockedUntil > now) {
    return current
  }
  if (current.resetAt <= now) {
    return { count: 0, resetAt: now + policy.windowMs, lockedUntil: 0 }
  }
  return current
}

export async function getAttemptState(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<AttemptState> {
  return normalizeAttemptState(await store.get(key), policy, now)
}

export async function isLocked(key: string, policy: RateLimitPolicy, now = Date.now()): Promise<boolean> {
  const current = await getAttemptState(key, policy, now)
  return current.lockedUntil > now
}

export async function recordAttempt(key: string, policy: RateLimitPolicy, now = Date.now()) {
  if (store.increment && process.env.NODE_ENV !== 'test') {
    await store.increment(key, policy)
    return
  }

  const current = await getAttemptState(key, policy, now)
  const nextCount = current.count + 1
  await store.set(key, {
    count: nextCount,
    resetAt: current.resetAt,
    lockedUntil: nextCount >= policy.maxAttempts ? now + policy.lockMs : current.lockedUntil,
  })
}

export async function clearAttempts(key: string) {
  await store.delete(key)
}

export async function __resetAttempts() {
  await store.clear()
}

export function retryAfterSeconds(state: AttemptState, now = Date.now()): number {
  return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000))
}

// Vercel は x-real-ip を実 IP で上書きするため、本番ではこれが信頼できる値になる。
// x-forwarded-for はクライアントが自由に付けられるので保険にすぎない。
export function clientIdentifier(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)

  return forwardedFor?.at(-1) ?? 'unknown'
}

// 上限に達していれば 429 を返し、達していなければ試行を1回数えて null を返す。
//
// 会員IDをキーにする場合は必ず「認証に成功したあと」に呼ぶこと。
// 認証前に数えると、第三者が他人の会員IDを投げるだけで正規会員をロックできてしまう。
export async function enforceRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<NextResponse | null> {
  const state = await getAttemptState(key, policy, now)

  if (state.lockedUntil > now) {
    return NextResponse.json(
      { error: '短時間に操作が集中しています。しばらく時間をおいてからお試しください' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(state, now)) } },
    )
  }

  await recordAttempt(key, policy, now)
  return null
}
