import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envRaw = await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await supabase
  .from('events')
  .select('id,title,status,event_date,event_end_date,max_participants,threshold,publishes_at,created_at')
  .like('title', '【運営展開用】%')
  .order('event_date', { ascending: true })

if (error) throw error

const eventIds = (data ?? []).map(event => event.id)
const { data: participants, error: participantError } = await supabase
  .from('participants')
  .select('event_id,status')
  .in('event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000'])

if (participantError) throw participantError

console.log(JSON.stringify({
  count: data?.length ?? 0,
  events: (data ?? []).map(event => ({
    id: event.id,
    title: event.title,
    status: event.status,
    event_date: event.event_date,
    event_end_date: event.event_end_date,
    max_participants: event.max_participants,
    threshold: event.threshold,
    publishes_at: event.publishes_at,
    activeParticipants: (participants ?? []).filter(p => p.event_id === event.id && p.status === 'active').length,
  })),
}, null, 2))
