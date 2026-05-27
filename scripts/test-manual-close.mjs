/**
 * is_manual_close / 自動再開ロジック テストスクリプト
 *
 * テスト項目:
 *   T1. 管理者が手動締切 → is_manual_close = true になる
 *   T2. 管理者が手動で再開 → is_manual_close = false にリセットされる
 *   T3. 手動締切後にキャンセルで閾値未満 → イベントは締切のまま（自動再開しない）
 *   T4. 自動締切（closes_at 超過）後にキャンセルで閾値未満 → 自動再開する
 *   T5. 定員到達による締切後にキャンセルで閾値未満 → 自動再開する（既存仕様・回帰）
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// .env.local を手動パース
function loadEnv(path) {
  const env = {}
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 0) continue
      const key = trimmed.slice(0, idx).trim()
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      env[key] = val
    }
  } catch (e) {
    console.error('Failed to read .env.local:', e.message)
    process.exit(1)
  }
  return env
}

const env = loadEnv(new URL('../.env.local', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_PASSWORD = env.ADMIN_PASSWORD
const BASE_URL = 'http://localhost:3000'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_PASSWORD) {
  console.error('必要な環境変数が不足しています')
  process.exit(1)
}

if (!SERVICE_ROLE_KEY) {
  console.warn('⚠ SUPABASE_SERVICE_ROLE_KEY が未設定です。T3〜T5 は RLS エラーになる可能性があります。')
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
// 参加者の直接挿入には service_role key が必要（RLS バイパス用）
const dbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)

// ── ユーティリティ ──────────────────────────────────────────

let passed = 0
let failed = 0

function ok(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${extra ? ' — ' + extra : ''}`)
    failed++
  }
}

async function adminPatch(body) {
  const res = await fetch(`${BASE_URL}/api/admin/events`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function cancelParticipant(participantId) {
  const res = await fetch(`${BASE_URL}/api/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ participant_id: participantId, admin: true, user_code: ADMIN_PASSWORD }),
  })
  return res.json()
}

async function getEvent(id) {
  const { data } = await db.from('events').select('*').eq('id', id).single()
  return data
}

async function createTestEvent(overrides = {}) {
  const now = new Date()
  const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const end = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString()
  const res = await fetch(`${BASE_URL}/api/admin/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify({
      title: `[TEST] ${Date.now()}`,
      event_date: start,
      event_end_date: end,
      location: 'テスト会場',
      max_participants: 5,
      threshold: 3,
      status: 'accepting',
      ...overrides,
    }),
  })
  const data = await res.json()
  return data.event
}

async function deleteEvent(id) {
  await fetch(`${BASE_URL}/api/admin/events`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify({ id }),
  })
}

/** 参加者を DB に直接 N 人追加（service_role key で RLS バイパス） */
async function seedParticipants(eventId, count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    event_id: eventId,
    name: `テスト参加者${i + 1}`,
    user_code: `tst${String(i + 1).padStart(5, '0')}`,
    member_id: null,
    status: 'active',
    slot_number: i + 1,
  }))
  const { data, error } = await dbAdmin.from('participants').insert(rows).select()
  if (error) throw new Error('seedParticipants failed: ' + error.message)
  return data
}

// ── テスト本体 ──────────────────────────────────────────────

async function testT1_manualCloseFlag() {
  console.log('\nT1: 手動締切 → is_manual_close = true')
  const event = await createTestEvent()
  try {
    await adminPatch({ id: event.id, status: 'closed' })
    const updated = await getEvent(event.id)
    ok('is_manual_close が true になる', updated.is_manual_close === true)
    ok('status が closed になる', updated.status === 'closed')
  } finally {
    await deleteEvent(event.id)
  }
}

async function testT2_manualReopenResetsFlag() {
  console.log('\nT2: 手動再開 → is_manual_close = false にリセット')
  const event = await createTestEvent()
  try {
    await adminPatch({ id: event.id, status: 'closed' })
    await adminPatch({ id: event.id, status: 'accepting' })
    const updated = await getEvent(event.id)
    ok('is_manual_close が false にリセットされる', updated.is_manual_close === false)
    ok('status が accepting に戻る', updated.status === 'accepting')
  } finally {
    await deleteEvent(event.id)
  }
}

async function testT3_manualCloseNoAutoReopen() {
  console.log('\nT3: 手動締切後のキャンセルで閾値未満 → 再開しない')
  // threshold=3, max=5, 参加者3人を手動締切
  const event = await createTestEvent({ max_participants: 5, threshold: 3 })
  try {
    const participants = await seedParticipants(event.id, 3)
    // 手動締切 (is_manual_close = true)
    await adminPatch({ id: event.id, status: 'closed' })

    // 1人キャンセル → 残2人（閾値3未満）
    const result = await cancelParticipant(participants[0].id)
    ok('キャンセル自体は成功', result.success === true, JSON.stringify(result))

    const updated = await getEvent(event.id)
    ok('手動締切後は閾値未満でも再開しない（closed のまま）', updated.status === 'closed')
    ok('is_manual_close は true のまま', updated.is_manual_close === true)
  } finally {
    await deleteEvent(event.id)
  }
}

async function testT4_deadlineCloseAutoReopen() {
  console.log('\nT4: 日時超過による締切後のキャンセルで閾値未満 → 自動再開する')
  const event = await createTestEvent({ status: 'accepting' })
  try {
    const pastClosesAt = new Date(Date.now() - 60 * 1000).toISOString()
    // 締切日時超過シミュレーション: closed + closes_at=過去 + is_manual_close=false
    await dbAdmin.from('events').update({
      status: 'closed',
      closes_at: pastClosesAt,
      is_manual_close: false,
    }).eq('id', event.id)

    // threshold=3, 参加者3人
    const participants = await seedParticipants(event.id, 3)

    // 1人キャンセル → 残2人（閾値3未満）→ 自動再開するはず
    const result = await cancelParticipant(participants[0].id)
    ok('キャンセル自体は成功', result.success === true, JSON.stringify(result))

    const updated = await getEvent(event.id)
    ok('日時超過締切後は閾値未満で自動再開する（accepting）', updated.status === 'accepting', `status=${updated.status}`)
    ok('closes_at がクリアされる（null）', updated.closes_at === null, `closes_at=${updated.closes_at}`)
  } finally {
    await deleteEvent(event.id)
  }
}

async function testT5_capacityCloseAutoReopen() {
  console.log('\nT5: 定員到達による締切後のキャンセルで閾値未満 → 自動再開する（回帰）')
  // max=5, threshold=3, is_manual_close=false
  const event = await createTestEvent({ max_participants: 5, threshold: 3 })
  try {
    await dbAdmin.from('events').update({
      status: 'closed',
      is_manual_close: false,
    }).eq('id', event.id)

    const participants = await seedParticipants(event.id, 5)

    // 残5→4→3人（閾値ちょうど）→ まだ再開しない
    await cancelParticipant(participants[0].id)
    await cancelParticipant(participants[1].id)
    let updated = await getEvent(event.id)
    ok('残3人（閾値ちょうど）ではまだ再開しない', updated.status === 'closed', `status=${updated.status}`)

    // 残3→2人（閾値未満）→ 再開
    await cancelParticipant(participants[2].id)
    updated = await getEvent(event.id)
    ok('残2人（閾値未満）で自動再開する（accepting）', updated.status === 'accepting', `status=${updated.status}`)
  } finally {
    await deleteEvent(event.id)
  }
}

// ── 実行 ────────────────────────────────────────────────────

console.log('=== is_manual_close / 自動再開ロジック テスト ===')

try {
  await testT1_manualCloseFlag()
  await testT2_manualReopenResetsFlag()
  await testT3_manualCloseNoAutoReopen()
  await testT4_deadlineCloseAutoReopen()
  await testT5_capacityCloseAutoReopen()
} catch (e) {
  console.error('\n予期しないエラー:', e)
}

console.log(`\n=== 結果: ${passed} passed / ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
