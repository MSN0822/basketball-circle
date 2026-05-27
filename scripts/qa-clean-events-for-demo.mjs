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
      return [line.slice(0, index), line.slice(index + 1)]
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

const demoPrefix = '【運営確認用】'
const cleanupPrefixes = ['QA_KEEP', 'TEST_', 'DEMO_', demoPrefix]
const cleanupExactTitles = ['aaaaa', 'bbbbb']
const now = new Date()

function hoursFromNow(hours) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString()
}

function userCode(label) {
  return `demo-${label}-${Math.floor(10000 + Math.random() * 90000)}`
}

async function listCleanupTargets() {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, status, event_date')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).filter(event =>
    cleanupPrefixes.some(prefix => String(event.title).startsWith(prefix)) ||
    cleanupExactTitles.includes(String(event.title))
  )
}

async function deleteEvents(events) {
  for (const event of events) {
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
}

async function createEvent(payload, participants) {
  const { data: event, error } = await supabase
    .from('events')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error

  if (participants.length > 0) {
    const rows = participants.map(participant => ({
      event_id: event.id,
      name: participant.name,
      user_code: participant.user_code ?? userCode(participant.name),
      member_id: null,
      status: participant.status,
      slot_number: participant.slot_number,
    }))

    const { error: participantError } = await supabase
      .from('participants')
      .insert(rows)
    if (participantError) throw participantError
  }

  return event
}

const targets = await listCleanupTargets()
await deleteEvents(targets)

const created = []

created.push(await createEvent({
  title: `${demoPrefix} 受付中バスケ体験会`,
  event_date: hoursFromNow(24 * 7),
  event_end_date: hoursFromNow(24 * 7 + 2),
  location: '○○市民体育館 メインコート',
  location_url: 'https://www.google.com/maps/search/?api=1&query=%E5%B8%82%E6%B0%91%E4%BD%93%E8%82%B2%E9%A4%A8',
  closes_at: null,
  publishes_at: null,
  max_participants: 10,
  threshold: 8,
  status: 'accepting',
}, [
  { name: '山田 太郎', status: 'active', slot_number: 1 },
  { name: '佐藤 花子(さとちゃん)', status: 'active', slot_number: 2 },
  { name: '鈴木 健太', status: 'active', slot_number: 3 },
  { name: '田中 友人(佐藤の友達)', status: 'active', slot_number: 4, user_code: `guest:demo-sato:${userCode('friend')}` },
]))

created.push(await createEvent({
  title: `${demoPrefix} 満員・キャンセル待ち例`,
  event_date: hoursFromNow(24 * 14),
  event_end_date: hoursFromNow(24 * 14 + 2),
  location: '△△スポーツセンター',
  location_url: 'https://www.google.com/maps/search/?api=1&query=%E3%82%B9%E3%83%9D%E3%83%BC%E3%83%84%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC',
  closes_at: null,
  publishes_at: null,
  max_participants: 3,
  threshold: 3,
  status: 'closed',
}, [
  { name: '高橋 一郎', status: 'active', slot_number: 1 },
  { name: '伊藤 美咲', status: 'active', slot_number: 2 },
  { name: '渡辺 大輔', status: 'active', slot_number: 3 },
  { name: '小林 直人', status: 'waitlist', slot_number: 1 },
]))

created.push(await createEvent({
  title: `${demoPrefix} 下書きイベント`,
  event_date: hoursFromNow(24 * 21),
  event_end_date: hoursFromNow(24 * 21 + 2),
  location: '□□小学校 体育館',
  location_url: null,
  closes_at: null,
  publishes_at: null,
  max_participants: 20,
  threshold: 15,
  status: 'draft',
}, []))

const remainingTargets = await listCleanupTargets()
const summary = {
  deletedCount: targets.length,
  deleted: targets.map(event => ({ id: event.id, title: event.title, status: event.status })),
  created: created.map(event => ({ id: event.id, title: event.title, status: event.status })),
  remainingDemoOrTestCount: remainingTargets.length,
  remainingDemoOrTest: remainingTargets.map(event => ({ id: event.id, title: event.title, status: event.status })),
}

const evidenceDir = path.join(root, 'docs', 'qa', 'evidence', '2026-05-27-demo-cleanup')
await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
