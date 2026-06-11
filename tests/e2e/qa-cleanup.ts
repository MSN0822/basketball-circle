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
