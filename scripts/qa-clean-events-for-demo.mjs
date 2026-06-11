import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const envPath = path.join(root, '.env.local')
const raw = await fs.readFile(envPath, 'utf8')
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      const key = line.slice(0, index)
      const value = line.slice(index + 1).replace(/^['"]|['"]$/g, '')
      return [key, value]
    })
)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const now = new Date()
const evidenceDir = path.join(root, 'docs', 'qa', 'evidence', '2026-05-27-demo-cleanup')
const DEMO_EVENT_TITLE_PREFIX = '【運営確認用】'

function currentJstDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

function jstDateAtOffset(days, hourJst, minuteJst = 0) {
  const { year, month, day } = currentJstDateParts()
  return new Date(Date.UTC(year, month - 1, day + days, hourJst - 9, minuteJst, 0, 0)).toISOString()
}

function daysFromNow(days, hourJst, minuteJst) {
  return jstDateAtOffset(days, hourJst, minuteJst)
}

function daysAgo(days, hourJst, minuteJst) {
  return jstDateAtOffset(-days, hourJst, minuteJst)
}

async function listEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, status, event_date, event_end_date, max_participants, threshold, created_at')
    .like('title', `${DEMO_EVENT_TITLE_PREFIX}%`)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

async function deleteEventWithParticipants(event) {
  const { error: participantsError } = await supabase
    .from('participants')
    .delete()
    .eq('event_id', event.id)

  if (participantsError) throw participantsError

  const { error: eventError } = await supabase
    .from('events')
    .delete()
    .eq('id', event.id)

  if (eventError) throw eventError
}

async function createEventWithParticipants(definition) {
  const { participants, ...payload } = definition
  const { data: event, error } = await supabase
    .from('events')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error

  if (participants.length > 0) {
    const rows = participants.map(participant => ({
      event_id: event.id,
      member_id: null,
      ...participant,
    }))

    const { error: participantsError } = await supabase
      .from('participants')
      .insert(rows)

    if (participantsError) throw participantsError
  }

  return event
}

const demoEvents = [
  {
    title: '【運営確認用】受付中・参加申請デモ',
    event_date: daysFromNow(10, 19, 0),
    event_end_date: daysFromNow(10, 21, 0),
    location: '市民体育館 メインアリーナ',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E5%B8%82%E6%B0%91%E4%BD%93%E8%82%B2%E9%A4%A8',
    closes_at: null,
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'accepting',
    participants: [
      { name: '佐藤 太郎(たろちゃん)', user_code: 'demo-active-001', status: 'active', slot_number: 1 },
      { name: '鈴木 花子', user_code: 'demo-active-002', status: 'active', slot_number: 2 },
      { name: '山田 一郎', user_code: 'demo-active-003', status: 'active', slot_number: 3 },
      { name: '田中 友人(佐藤の友達)', user_code: 'guest:demo-sato:FRD001', status: 'active', slot_number: 4 },
    ],
  },
  {
    title: '【運営確認用】満員締切デモ',
    event_date: daysFromNow(17, 19, 0),
    event_end_date: daysFromNow(17, 21, 0),
    location: '中央スポーツセンター',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E4%B8%AD%E5%A4%AE%E3%82%B9%E3%83%9D%E3%83%BC%E3%83%84%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC',
    closes_at: null,
    publishes_at: null,
    max_participants: 3,
    threshold: 3,
    status: 'closed',
    participants: [
      { name: '高橋 健太', user_code: 'demo-full-001', status: 'active', slot_number: 1 },
      { name: '伊藤 美咲', user_code: 'demo-full-002', status: 'active', slot_number: 2 },
      { name: '渡辺 大輔', user_code: 'demo-full-003', status: 'active', slot_number: 3 },
    ],
  },
  {
    title: '【運営確認用】締切日時超過デモ',
    event_date: daysFromNow(24, 19, 0),
    event_end_date: daysFromNow(24, 21, 0),
    location: '東区体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E6%9D%B1%E5%8C%BA%E4%BD%93%E8%82%B2%E9%A4%A8',
    closes_at: daysAgo(1, 23, 59),
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    participants: [
      { name: '小林 亮', user_code: 'demo-deadline-001', status: 'active', slot_number: 1 },
      { name: '加藤 真由', user_code: 'demo-deadline-002', status: 'active', slot_number: 2 },
    ],
  },
  {
    title: '【運営確認用】下書きデモ',
    event_date: daysFromNow(31, 19, 0),
    event_end_date: daysFromNow(31, 21, 0),
    location: '南小学校 体育館',
    location_url: null,
    closes_at: null,
    publishes_at: daysFromNow(5, 9, 0),
    max_participants: 35,
    threshold: 30,
    status: 'draft',
    participants: [],
  },
]

const before = await listEvents()

for (const event of before) {
  await deleteEventWithParticipants(event)
}

const created = []
for (const definition of demoEvents) {
  created.push(await createEventWithParticipants(definition))
}

const finalEvents = await listEvents()
const { data: finalParticipants, error: participantError } = await supabase
  .from('participants')
  .select('id, event_id, name, user_code, status, slot_number')
  .in('event_id', finalEvents.map(event => event.id))
  .order('event_id', { ascending: true })
  .order('slot_number', { ascending: true })

if (participantError) throw participantError

const summary = {
  beforeCount: before.length,
  deletedCount: before.length,
  deleted: before.map(event => ({ id: event.id, title: event.title, status: event.status })),
  created: created.map(event => ({
    id: event.id,
    title: event.title,
    status: event.status,
    max_participants: event.max_participants,
    threshold: event.threshold,
  })),
  visibleToUsersCount: finalEvents.filter(event => event.status !== 'draft').length,
  finalEventCount: finalEvents.length,
  finalEvents: finalEvents.map(event => ({
    id: event.id,
    title: event.title,
    status: event.status,
    event_date: event.event_date,
    event_end_date: event.event_end_date,
    max_participants: event.max_participants,
    threshold: event.threshold,
  })),
  participants: (finalParticipants ?? []).map(participant => ({
    event_id: participant.event_id,
    name: participant.name,
    status: participant.status,
    slot_number: participant.slot_number,
    is_guest: String(participant.user_code).startsWith('guest:'),
  })),
}

await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
await fs.writeFile(path.join(evidenceDir, 'final-events.json'), JSON.stringify(finalEvents, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
