/**
 * 既存イベント・参加者を全削除し、運営展開用デモイベントを再作成するスクリプト
 * 使い方: node scripts/reset-demo-events.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const now = new Date()

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

function daysFromNow(days, hourJst, minuteJst = 0) {
  return jstDateAtOffset(days, hourJst, minuteJst)
}

// ------- デモイベント定義 -------
const DEMO_EVENTS = [
  {
    title: '【運営展開用】受付中・参加/友達追加デモ',
    event_date: daysFromNow(10, 19),
    event_end_date: daysFromNow(10, 21),
    location: '市民体育館 メインアリーナ',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E5%B8%82%E6%B0%91%E4%BD%93%E8%82%B2%E9%A4%A8+%E3%83%A1%E3%82%A4%E3%83%B3%E3%82%A2%E3%83%AA%E3%83%BC%E3%83%8A',
    max_participants: 35,
    threshold: 30,
    status: 'accepting',
    is_manual_close: false,
    closes_at: null,
    publishes_at: null,
  },
  {
    title: '【運営展開用】定員35名締切デモ',
    event_date: daysFromNow(17, 19),
    event_end_date: daysFromNow(17, 21),
    location: '中央スポーツセンター',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E4%B8%AD%E5%A4%AE%E3%82%B9%E3%83%9D%E3%83%BC%E3%83%84%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC',
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    is_manual_close: false,
    closes_at: null,
    publishes_at: null,
  },
  {
    title: '【運営展開用】閾値30名・再開待ちデモ',
    event_date: daysFromNow(24, 19),
    event_end_date: daysFromNow(24, 21),
    location: '東区体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E6%9D%B1%E5%8C%BA%E4%BD%93%E8%82%B2%E9%A4%A8',
    max_participants: 30,
    threshold: 30,
    status: 'closed',
    is_manual_close: false,
    closes_at: null,
    publishes_at: null,
  },
  {
    title: '【運営展開用】手動締切デモ',
    event_date: daysFromNow(31, 19),
    event_end_date: daysFromNow(31, 21),
    location: '西区体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E8%A5%BF%E5%8C%BA%E4%BD%93%E8%82%B2%E9%A4%A8',
    max_participants: 35,
    threshold: 30,
    status: 'closed',
    is_manual_close: false,
    closes_at: null,
    publishes_at: null,
  },
  {
    title: '【運営展開用】下書き公開予約デモ',
    event_date: daysFromNow(38, 19),
    event_end_date: daysFromNow(38, 21),
    location: '南小学校 体育館',
    location_url: 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E5%B0%8F%E5%AD%A6%E6%A0%A1+%E4%BD%93%E8%82%B2%E9%A4%A8',
    max_participants: 35,
    threshold: 30,
    status: 'draft',
    is_manual_close: false,
    closes_at: null,
    publishes_at: daysFromNow(5, 9),
  },
]

const DEMO_EVENT_TITLES = DEMO_EVENTS.map(event => event.title)

// ------- 参加者名リスト（35名分） -------
const ALL_NAMES = [
  '佐藤 太郎', '鈴木 花子', '山田 一郎', '田中 次郎', '伊藤 三郎',
  '渡辺 四郎', '中村 五郎', '小林 六郎', '加藤 七郎', '吉田 八郎',
  '山口 九郎', '松本 十郎', '井上 健一', '木村 恵子', '林 美咲',
  '清水 陽子', '山崎 誠', '池田 翔', '橋本 拓海', '阿部 颯太',
  '石川 優斗', '前田 大輝', '小川 蓮', '岡田 悠斗', '後藤 律',
  '長谷川 奏', '近藤 蒼', '斎藤 湊', '藤田 碧', '西村 唯',
  '福田 葵', '青木 凛', '三浦 澪', '藤井 杏', '岡本 結衣',
]

// 追加ゲスト（友達追加デモ用）
const GUEST_MEMBER_ID = 'demo-member-uuid-001'
const GUEST_NAME = '鈴木 花子の友人'

function makeCode(i) {
  return `D${String(i).padStart(4, '0')}`
}

async function insertParticipants(eventId, names, includeGuest = false) {
  let slot = 1
  const rows = names.map((name, i) => ({
    event_id: eventId,
    name,
    user_code: makeCode(slot + i),
    status: 'active',
    slot_number: slot + i,
    member_id: null,
  }))

  if (includeGuest) {
    rows.push({
      event_id: eventId,
      name: GUEST_NAME,
      user_code: `guest:${GUEST_MEMBER_ID}:d9999`,
      status: 'active',
      slot_number: rows.length + 1,
      member_id: null,
    })
  }

  const { error } = await supabase.from('participants').insert(rows)
  if (error) throw error
  return rows.length
}

async function main() {
  console.log('=== デモイベントリセット ===\n')

  // 1. 既存のデモイベントだけ削除
  console.log('① 既存のデモイベント・参加者を削除中...')
  const { data: existing, error: fetchErr } = await supabase
    .from('events')
    .select('id')
    .in('title', DEMO_EVENT_TITLES)
  if (fetchErr) throw fetchErr

  if (existing && existing.length > 0) {
    const ids = existing.map(e => e.id)

    const { error: delParticipants } = await supabase
      .from('participants')
      .delete()
      .in('event_id', ids)
    if (delParticipants) throw delParticipants

    const { error: delEvents } = await supabase
      .from('events')
      .delete()
      .in('id', ids)
    if (delEvents) throw delEvents

    console.log(`  → ${ids.length}件のデモイベント（+ 参加者）を削除しました`)
  } else {
    console.log('  → 既存のデモイベントはありませんでした')
  }

  // 2. デモイベントを再作成
  console.log('\n② デモイベントと参加者を作成中...')

  for (const [index, event] of DEMO_EVENTS.entries()) {
    const { data, error } = await supabase
      .from('events')
      .insert(event)
      .select('id, title, status')
      .single()
    if (error) throw error

    let participantCount = 0

    if (index === 0) {
      // 受付中・参加/友達追加デモ: 4名 active + 1名ゲスト(友達追加) = 計5名
      participantCount = await insertParticipants(data.id, ALL_NAMES.slice(0, 4), true)
    } else if (index === 1) {
      // 定員35名締切デモ: 35名 active（定員到達）
      participantCount = await insertParticipants(data.id, ALL_NAMES.slice(0, 35))
    } else if (index === 2) {
      // 閾値30名・再開待ちデモ: 30名 active（閾値=上限に到達）
      participantCount = await insertParticipants(data.id, ALL_NAMES.slice(0, 30))
    } else if (index === 3) {
      // 手動締切デモ: 20名 active
      participantCount = await insertParticipants(data.id, ALL_NAMES.slice(0, 20))
    }
    // index === 4: 下書きデモは参加者なし

    const participantInfo = participantCount > 0 ? ` (参加者 ${participantCount}名)` : ''
    console.log(`  [${data.status.padEnd(9)}] ${data.title}${participantInfo}`)
  }

  console.log('\n✅ 完了')
}

main().catch(err => {
  console.error('エラー:', err)
  process.exit(1)
})
