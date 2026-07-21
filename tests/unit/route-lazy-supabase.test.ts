import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRequest, jsonRequest, responseJson } from './helpers/route'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const SERVICE_ROLE_ERROR = 'SUPABASE_SERVICE_ROLE_KEY is required for server operations'

type RouteHandler = (...args: unknown[]) => Promise<Response>

type RouteCase = {
  name: string
  load: () => Promise<unknown>
  handlers: { method: string; args: () => unknown[] }[]
}

// 環境変数が欠けた状態でも「モジュール読み込み時に落ちない」ことを保証する。
// モジュールトップで getServerSupabase() を呼ぶ実装に戻すと、import の時点で throw して
// ルート自体が起動しなくなる（= 500 すら返せない）ため、5 route すべてを網羅する。
const ROUTE_CASES: RouteCase[] = [
  {
    name: 'app/api/participants/route.ts',
    load: () => import('@/app/api/participants/route'),
    handlers: [
      { method: 'GET', args: () => [emptyRequest()] },
      { method: 'POST', args: () => [jsonRequest({})] },
    ],
  },
  {
    name: 'app/api/cancel/route.ts',
    load: () => import('@/app/api/cancel/route'),
    handlers: [{ method: 'POST', args: () => [jsonRequest({})] }],
  },
  {
    name: 'app/api/members/route.ts',
    load: () => import('@/app/api/members/route'),
    handlers: [
      { method: 'POST', args: () => [jsonRequest({})] },
      { method: 'PATCH', args: () => [jsonRequest({}, { method: 'PATCH' })] },
    ],
  },
  {
    name: 'app/api/admin/events/route.ts',
    load: () => import('@/app/api/admin/events/route'),
    handlers: [
      { method: 'POST', args: () => [jsonRequest({})] },
      { method: 'GET', args: () => [emptyRequest()] },
      { method: 'DELETE', args: () => [jsonRequest({}, { method: 'DELETE' })] },
      { method: 'PATCH', args: () => [jsonRequest({}, { method: 'PATCH' })] },
    ],
  },
  {
    name: 'app/api/events/[id]/ics/route.ts',
    load: () => import('@/app/api/events/[id]/ics/route'),
    handlers: [
      { method: 'GET', args: () => [emptyRequest(), { params: Promise.resolve({ id: EVENT_ID }) }] },
    ],
  },
]

async function loadWithBrokenEnv(load: RouteCase['load']): Promise<Record<string, unknown>> {
  vi.resetModules()

  vi.doMock('@/lib/supabase-server', () => ({
    getServerSupabase: () => {
      throw new Error(SERVICE_ROLE_ERROR)
    },
    getAuthSupabase: () => {
      throw new Error('Supabase environment variables are not configured')
    },
    hasServiceRoleKey: () => false,
  }))
  // 管理者ルートは checkAdmin を通過した先で Supabase を解決するため、403 で早期 return させない。
  vi.doMock('@/lib/api-auth', () => ({
    checkAdmin: () => true,
    getAuthenticatedMember: vi.fn(),
    getBearerToken: vi.fn(),
    getBearerUser: vi.fn(),
    safeCompare: vi.fn(),
  }))

  return (await load()) as Record<string, unknown>
}

beforeEach(() => {
  vi.restoreAllMocks()
  // resolveServerSupabase は初期化失敗を console.error に残す設計なので、出力だけ抑制する。
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe.each(ROUTE_CASES)('$name (Supabase の環境変数が欠落)', (routeCase) => {
  it('import した時点では throw しない', async () => {
    await expect(loadWithBrokenEnv(routeCase.load)).resolves.toBeDefined()
  })

  it.each(routeCase.handlers)('$method は環境変数名を伏せた 500 を返す', async (handlerCase) => {
    const mod = await loadWithBrokenEnv(routeCase.load)
    const handler = mod[handlerCase.method] as RouteHandler

    const res = await handler(...handlerCase.args())

    expect(res.status).toBe(500)
    const body = await responseJson<{ error: string }>(res)
    expect(typeof body.error).toBe('string')
    // 設定情報の露出を防ぐため、env 変数名をそのまま返してはいけない。
    expect(body.error).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(body.error).not.toContain('NEXT_PUBLIC_SUPABASE_URL')
  })
})
