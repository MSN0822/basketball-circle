import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

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
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const baseURL = process.env.QA_BASE_URL ?? 'https://basketball-circle.vercel.app'
const evidenceDir = path.join(root, 'docs', 'qa', 'evidence', '2026-05-27-rollout-demo-events')
const now = new Date()

function daysFromNow(days, hourJst, minuteJst = 0) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() + days)
  date.setUTCHours(hourJst - 9, minuteJst, 0, 0)
  return date.toISOString()
}

function daysAgo(days, hourJst, minuteJst = 0) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hourJst - 9, minuteJst, 0, 0)
  return date.toISOString()
}

function demoParticipants(prefix, count, label) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${label} ${String(index + 1).padStart(2, '0')}`,
    user_code: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    status: 'active',
    slot_number: index + 1,
    member_id: null,
  }))
}

async function listEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id,title,status,event_date,event_end_date,max_participants,threshold,closes_at,publishes_at,created_at')
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
      ...participant,
      event_id: event.id,
    }))

    const { error: participantsError } = await supabase
      .from('participants')
      .insert(rows)

    if (participantsError) throw participantsError
  }

  return event
}

const rolloutEvents = [
  {
    title: '【運営展開用】受付中・参加/友達追加デモ',
    event_date: daysFromNow(10, 19),
    event_end_date: daysFromNow(10, 21),
    location: '市民体育館 メインアリーナ',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E5%B8%82%E6%B0%91%E4%BD%93%E8%82%B2%E9%A4%A8',
    closes_at: null,
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'accepting',
    participants: [
      { name: '佐藤 太郎(たろちゃん)', user_code: 'rollout-open-001', status: 'active', slot_number: 1, member_id: null },
      { name: '鈴木 花子', user_code: 'rollout-open-002', status: 'active', slot_number: 2, member_id: null },
      { name: '山田 一郎', user_code: 'rollout-open-003', status: 'active', slot_number: 3, member_id: null },
      { name: '田中 友人(佐藤の友達)', user_code: 'guest:rollout-sato:FRD001', status: 'active', slot_number: 4, member_id: null },
    ],
  },
  {
    title: '【運営展開用】定員35名締切デモ',
    event_date: daysFromNow(17, 19),
    event_end_date: daysFromNow(17, 21),
    location: '中央スポーツセンター',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E4%B8%AD%E5%A4%AE%E3%82%B9%E3%83%9D%E3%83%BC%E3%83%84%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC',
    closes_at: null,
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    participants: demoParticipants('rollout-full', 35, '満員デモ'),
  },
  {
    title: '【運営展開用】閾値30名・再開待ちデモ',
    event_date: daysFromNow(24, 19),
    event_end_date: daysFromNow(24, 21),
    location: '東区体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E6%9D%B1%E5%8C%BA%E4%BD%93%E8%82%B2%E9%A4%A8',
    closes_at: null,
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    participants: demoParticipants('rollout-threshold', 30, '閾値デモ'),
  },
  {
    title: '【運営展開用】締切日時超過デモ',
    event_date: daysFromNow(31, 19),
    event_end_date: daysFromNow(31, 21),
    location: '西区体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E8%A5%BF%E5%8C%BA%E4%BD%93%E8%82%B2%E9%A4%A8',
    closes_at: daysAgo(1, 23, 59),
    publishes_at: null,
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    participants: demoParticipants('rollout-deadline', 2, '締切デモ'),
  },
  {
    title: '【運営展開用】下書き公開予約デモ',
    event_date: daysFromNow(38, 19),
    event_end_date: daysFromNow(38, 21),
    location: '南小学校 体育館',
    location_url: null,
    closes_at: null,
    publishes_at: daysFromNow(5, 9),
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
for (const definition of rolloutEvents) {
  created.push(await createEventWithParticipants(definition))
}

const finalEvents = await listEvents()
const { data: finalParticipants, error: participantError } = await supabase
  .from('participants')
  .select('event_id,name,user_code,status,slot_number')
  .order('slot_number', { ascending: true })

if (participantError) throw participantError

const summary = {
  replacedAt: new Date().toISOString(),
  baseURL,
  beforeCount: before.length,
  deleted: before.map(event => ({
    title: event.title,
    status: event.status,
  })),
  createdCount: created.length,
  visibleToUsersCount: finalEvents.filter(event => event.status !== 'draft').length,
  finalEvents: finalEvents
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    .map(event => {
      const participants = (finalParticipants ?? []).filter(participant => participant.event_id === event.id)
      return {
        title: event.title,
        status: event.status,
        max_participants: event.max_participants,
        threshold: event.threshold,
        activeParticipants: participants.filter(participant => participant.status === 'active').length,
        guestParticipants: participants.filter(participant => String(participant.user_code).startsWith('guest:')).length,
        closes_at: event.closes_at,
        publishes_at: event.publishes_at,
      }
    }),
}

await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1100 } })
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(evidenceDir, '01-user-top-rollout-events.png'), fullPage: true })

  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
  await page.evaluate(password => {
    localStorage.setItem('basketball_admin_password', password)
  }, env.ADMIN_PASSWORD)
  await page.goto(`${baseURL}/admin`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(evidenceDir, '02-admin-rollout-events.png'), fullPage: true })
} finally {
  await browser.close()
}

console.log(JSON.stringify(summary, null, 2))
