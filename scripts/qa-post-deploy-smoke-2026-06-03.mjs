/**
 * Post-deploy smoke for the 2026-06-03 hardening rollout.
 *
 * This script is intended to be run manually by massun against production after:
 *   1. all DB migrations are applied
 *   2. the app is deployed
 *
 * It creates QA_* rows and cleans them up. It also snapshots/restores
 * admin_login_attempts around rate-limit checks.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const envRaw = await fs.readFile(path.join(root, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    })
)

const BASE_URL = process.env.QA_BASE_URL ?? 'https://basketball-circle.vercel.app'
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_PASSWORD = env.ADMIN_PASSWORD

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD) {
  throw new Error('Required QA environment values are missing.')
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = `QA_POST_DEPLOY_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const created = {
  eventId: null,
  memberId: null,
}
const results = []

function publicDetail(detail) {
  return JSON.parse(JSON.stringify(detail, (key, value) => {
    if (key.toLowerCase().includes('cookie')) return '[REDACTED_COOKIE]'
    if (typeof value === 'string' && value.includes(ADMIN_PASSWORD)) return '[REDACTED_ADMIN_PASSWORD]'
    if (typeof value === 'string' && value.includes(SUPABASE_ANON_KEY)) return '[REDACTED_ANON_KEY]'
    if (typeof value === 'string' && value.includes(SUPABASE_SERVICE_ROLE_KEY)) return '[REDACTED_SERVICE_ROLE_KEY]'
    return value
  }))
}

async function record(id, name, fn) {
  try {
    const detail = await fn()
    const passed = detail?.passed !== false
    results.push({ id, name, status: passed ? 'PASS' : 'FAIL', detail: publicDetail(detail) })
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      detail: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

async function fetchJson(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    redirect: 'manual',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers }
}

async function snapshotAdminAttempts() {
  const { data, error } = await supabaseAdmin
    .from('admin_login_attempts')
    .select('key,count,reset_at,locked_until')
  if (error) throw error
  return data ?? []
}

async function restoreAdminAttempts(snapshot) {
  const beforeKeys = new Set(snapshot.map(row => row.key))
  const { data: afterRows, error: afterError } = await supabaseAdmin
    .from('admin_login_attempts')
    .select('key')
  if (afterError) throw afterError

  const createdKeys = (afterRows ?? [])
    .map(row => row.key)
    .filter(key => !beforeKeys.has(key))

  if (createdKeys.length > 0) {
    const { error } = await supabaseAdmin
      .from('admin_login_attempts')
      .delete()
      .in('key', createdKeys)
    if (error) throw error
  }

  if (snapshot.length > 0) {
    const { error } = await supabaseAdmin
      .from('admin_login_attempts')
      .upsert(snapshot, { onConflict: 'key' })
    if (error) throw error
  }
}

async function withAdminAttemptRestore(fn) {
  const snapshot = await snapshotAdminAttempts()
  try {
    return await fn()
  } finally {
    await restoreAdminAttempts(snapshot)
  }
}

async function wrongAdminAttempts(headersForAttempt) {
  const statuses = []
  for (let i = 0; i < 6; i++) {
    const headers = typeof headersForAttempt === 'function'
      ? headersForAttempt(i)
      : headersForAttempt
    const res = await fetchJson('/api/admin/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: `${runId}_wrong_password_${i}` }),
    })
    statuses.push(res.status)
  }
  return statuses
}

async function setupData() {
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .insert({
      title: `${runId} public view`,
      event_date: start.toISOString(),
      event_end_date: end.toISOString(),
      location: `${runId} Gym`,
      max_participants: 5,
      threshold: 3,
      status: 'accepting',
    })
    .select('id')
    .single()
  if (eventError || !event?.id) throw new Error(eventError?.message ?? 'event creation failed')
  created.eventId = event.id

  const { data: member, error: memberError } = await supabaseAdmin
    .from('members')
    .insert({
      member_number: `QA${Date.now().toString().slice(-9)}`,
      name: `${runId} Member`,
      auth_user_id: null,
    })
    .select('id')
    .single()
  if (memberError || !member?.id) throw new Error(memberError?.message ?? 'member creation failed')
  created.memberId = member.id

  const rows = [
    {
      event_id: created.eventId,
      name: `${runId} Guest`,
      user_code: `guest:${created.memberId}:12345`,
      member_id: null,
      status: 'active',
      slot_number: 1,
    },
    {
      event_id: created.eventId,
      name: `${runId} Legacy`,
      user_code: `${runId}_legacy_cancel_code`,
      member_id: null,
      status: 'active',
      slot_number: 2,
    },
  ]

  const { error: participantError } = await supabaseAdmin
    .from('participants')
    .insert(rows)
  if (participantError) throw participantError
}

async function cleanup() {
  if (created.eventId) {
    await supabaseAdmin.from('events').delete().eq('id', created.eventId)
  }
  if (created.memberId) {
    await supabaseAdmin.from('members').delete().eq('id', created.memberId)
  }
}

try {
  await setupData()

  await record('POST-01', 'participants_public exposes public columns only', async () => {
    const { data, error } = await supabaseAnon
      .from('participants_public')
      .select('*')
      .eq('event_id', created.eventId)
      .order('slot_number', { ascending: true })

    const rows = data ?? []
    const hasUserCode = rows.some(row => Object.prototype.hasOwnProperty.call(row, 'user_code'))
    const guest = rows.find(row => row.name.endsWith('Guest'))
    const legacy = rows.find(row => row.name.endsWith('Legacy'))
    const { error: userCodeSelectError } = await supabaseAnon
      .from('participants_public')
      .select('user_code')
      .eq('event_id', created.eventId)

    return {
      errorCode: error?.code ?? null,
      rowCount: rows.length,
      hasUserCode,
      guestDisplayCode: guest?.display_code ?? null,
      legacyDisplayCode: legacy?.display_code ?? null,
      userCodeSelectErrorCode: userCodeSelectError?.code ?? null,
      passed:
        !error &&
        rows.length === 2 &&
        !hasUserCode &&
        guest?.display_code === '12345' &&
        legacy?.display_code === null &&
        Boolean(userCodeSelectError),
    }
  })

  await record('POST-02', 'anon direct participants select remains hidden by RLS', async () => {
    const { data, error } = await supabaseAnon
      .from('participants')
      .select('id,event_id,user_code')
      .eq('event_id', created.eventId)

    return {
      errorCode: error?.code ?? null,
      returnedRows: data?.length ?? 0,
      passed: !error && (data?.length ?? 0) === 0,
    }
  })

  await record('POST-03', 'anon public view returns event participants for public pages', async () => {
    const { data, error } = await supabaseAnon
      .from('participants_public')
      .select('id,event_id,name,status,slot_number,display_code')
      .eq('event_id', created.eventId)

    return {
      errorCode: error?.code ?? null,
      returnedRows: data?.length ?? 0,
      passed: !error && (data?.length ?? 0) === 2,
    }
  })

  await record('POST-04', 'admin login locks after repeated wrong password from one IP', async () => {
    return withAdminAttemptRestore(async () => {
      const statuses = await wrongAdminAttempts({ 'x-real-ip': '198.51.100.203' })
      return {
        statuses,
        passed: statuses.at(-1) === 429 && statuses.slice(0, 5).every(status => status === 403),
      }
    })
  })

  await record('POST-05', 'admin login global limit catches rotating x-forwarded-for attempts', async () => {
    return withAdminAttemptRestore(async () => {
      const statuses = await wrongAdminAttempts(index => ({
        'x-forwarded-for': `198.51.100.${10 + index}, 203.0.113.10`,
      }))
      return {
        statuses,
        passed: statuses.at(-1) === 429,
      }
    })
  })
} finally {
  await cleanup()
}

const summary = {
  runId,
  baseUrl: BASE_URL,
  counts: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
  },
  results,
}

console.log(JSON.stringify(summary, null, 2))

if (summary.counts.failed > 0) {
  process.exit(1)
}
