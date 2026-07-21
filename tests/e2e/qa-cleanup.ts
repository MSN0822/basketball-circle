import type { SupabaseClient } from '@supabase/supabase-js'

const PRODUCTION_ORIGINS = new Set([
  'https://basketball-circle.vercel.app',
])

export const STALE_QA_EVENT_PREFIXES = [
  'QA_E2E_ADMIN_',
  'QA_E2E_USER_',
  'QA_E2E_UI_',
  'QA_KEEP_UI_',
]

export function requireProductionE2eAllowed(baseURL: string) {
  const origin = new URL(baseURL).origin
  if (PRODUCTION_ORIGINS.has(origin) && process.env.ALLOW_PRODUCTION_E2E !== '1') {
    throw new Error(
      `Refusing to run E2E against ${origin}. Set ALLOW_PRODUCTION_E2E=1 when intentionally running QA against production.`
    )
  }
}

function isLocalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

// requireProductionE2eAllowed は「アプリの向き先」しか見ないため、
// QA_BASE_URL=http://localhost:3000 にしても .env.local 経由で Supabase は本番のまま、
// という組み合わせを止められない。この関数はアプリ側と DB 側の向き先が食い違っていないかを見る。
//
// - ローカルアプリ × ローカルDB / 本番アプリ × 本番DB: そのまま通す
// - ローカルアプリ × 本番DB: 従来からの QA 運用（テスト専用イベントのみ操作）なので
//   allowProductionDb を明示したときだけ通す
// - 本番アプリ × ローカルDB: 常に拒否（後始末が本番に効かず、ゴミが残る）
//
// 認証まわりのように本番の auth ユーザーを汚しうるテストでは allowProductionDb を渡さないこと。
export function requireEnvMatchesTarget(
  baseURL: string,
  supabaseUrl: string,
  options: { allowProductionDb?: boolean } = {}
) {
  const appIsLocal = isLocalHost(baseURL)
  const dbIsLocal = isLocalHost(supabaseUrl)
  if (appIsLocal === dbIsLocal) return

  if (appIsLocal && !dbIsLocal && options.allowProductionDb) return

  const appLabel = appIsLocal ? 'local' : 'remote'
  const dbLabel = dbIsLocal ? 'local' : 'remote'
  throw new Error(
    `E2E target mismatch: app=${appLabel} (${new URL(baseURL).origin}) / db=${dbLabel}. ` +
      'ローカルのアプリに本番DBを組み合わせる（またはその逆）と本番データを壊すため中止します。' +
      'ローカルDBで実行する場合は E2E_ENV_FILE にローカル用の env ファイルを指定してください。'
  )
}

// E2E が読み込む env ファイル名。ローカル Supabase 向けに切り替えられるようにしている。
export function e2eEnvFileName(): string {
  return process.env.E2E_ENV_FILE ?? '.env.local'
}

export async function cleanupQaEvents(
  supabase: SupabaseClient,
  prefixes: string[],
  options: { olderThanIso?: string } = {}
) {
  const events = []

  for (const prefix of prefixes) {
    let query = supabase
      .from('events')
      .select('id,title,created_at')
      .like('title', `${prefix}%`)

    if (options.olderThanIso) {
      query = query.lt('created_at', options.olderThanIso)
    }

    const { data, error } = await query
    if (error) throw error
    events.push(...(data ?? []))
  }

  const ids = [...new Set(events.map(event => event.id as string))]
  if (ids.length === 0) return { deleted: 0 }

  const { error: participantError } = await supabase
    .from('participants')
    .delete()
    .in('event_id', ids)
  if (participantError) throw participantError

  const { error: eventError } = await supabase
    .from('events')
    .delete()
    .in('id', ids)
  if (eventError) throw eventError

  return { deleted: ids.length }
}

export function staleQaCutoff(hours = 1) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}
