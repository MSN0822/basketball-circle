import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const envRaw = await fs.readFile(path.join(root, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]
    })
)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const prefixes = [
  'QA_E2E_ADMIN_',
  'QA_E2E_USER_',
  'QA_E2E_UI_',
  'QA_E2E_API_',
  'QA_KEEP_UI_',
  'QA_KEEP_',
]
const confirm = process.env.CONFIRM_QA_CLEANUP === '1'
const minAgeHours = Number(process.env.QA_CLEANUP_MIN_AGE_HOURS ?? '1')
if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
  throw new Error('QA_CLEANUP_MIN_AGE_HOURS must be a non-negative number.')
}
const olderThanIso = new Date(Date.now() - minAgeHours * 60 * 60 * 1000).toISOString()

const events = []
for (const prefix of prefixes) {
  const { data, error } = await supabase
    .from('events')
    .select('id,title,status,event_date,created_at')
    .like('title', `${prefix}%`)
    .lt('created_at', olderThanIso)
    .order('created_at', { ascending: true })

  if (error) throw error
  events.push(...(data ?? []))
}

const uniqueEvents = [...new Map(events.map(event => [event.id, event])).values()]
const summary = {
  mode: confirm ? 'delete' : 'dry-run',
  minAgeHours,
  olderThanIso,
  matched: uniqueEvents.length,
  events: uniqueEvents.map(event => ({
    id: event.id,
    title: event.title,
    status: event.status,
    event_date: event.event_date,
    created_at: event.created_at,
  })),
}

if (!confirm || uniqueEvents.length === 0) {
  console.log(JSON.stringify(summary, null, 2))
  if (!confirm && uniqueEvents.length > 0) {
    console.log('Set CONFIRM_QA_CLEANUP=1 to delete these QA events and their participants.')
    console.log('Set QA_CLEANUP_MIN_AGE_HOURS=0 only when you intentionally want to include fresh QA events.')
  }
  process.exit(0)
}

const ids = uniqueEvents.map(event => event.id)
const { error: participantsError } = await supabase
  .from('participants')
  .delete()
  .in('event_id', ids)
if (participantsError) throw participantsError

const { error: eventsError } = await supabase
  .from('events')
  .delete()
  .in('id', ids)
if (eventsError) throw eventsError

console.log(JSON.stringify({ ...summary, deleted: ids.length }, null, 2))
