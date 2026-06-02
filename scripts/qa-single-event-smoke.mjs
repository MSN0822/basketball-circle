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

const BASE_URL = process.env.QA_BASE_URL ?? 'https://basketball-circle.vercel.app'
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_PASSWORD = env.ADMIN_PASSWORD
const QA_AUTH_EMAIL = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL
const QA_AUTH_PASSWORD = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD) {
  throw new Error('Required QA environment values are missing.')
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = `QA_DELETE_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const results = []
const cleanup = {
  eventId: null,
  eventTitle: null,
  deleteApiStatus: null,
  serviceRoleFallbackUsed: false,
  verifiedDeleted: false,
}

let adminCookie = null

async function fetchJson(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
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
    body = { raw: text.slice(0, 500) }
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers }
}

async function record(id, name, fn) {
  try {
    const detail = await fn()
    const passed = detail?.passed !== false
    results.push({ id, name, status: passed ? 'PASS' : 'FAIL', detail })
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      detail: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

async function getEvent(eventId) {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id,title,status,event_date,event_end_date')
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function forceCleanupEvent(eventId) {
  const { error: participantError } = await supabaseAdmin
    .from('participants')
    .delete()
    .eq('event_id', eventId)
  if (participantError) throw participantError

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .delete()
    .eq('id', eventId)
  if (eventError) throw eventError
}

try {
  await record('F-02', 'Admin verification issues session cookie', async () => {
    const res = await fetchJson('/api/admin/verify', {
      method: 'POST',
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })
    const setCookie = res.headers.get('set-cookie')
    adminCookie = setCookie?.split(';')[0] ?? null
    return { status: res.status, hasCookie: Boolean(adminCookie), passed: res.ok && Boolean(adminCookie) }
  })

  await record('F-05', 'Admin creates a bounded QA event', async () => {
    const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const title = `${runId}_SINGLE_EVENT`
    const res = await fetchJson('/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        title,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        location_url: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
        max_participants: 4,
        threshold: 3,
        status: 'accepting',
      }),
    })
    cleanup.eventId = res.body?.event?.id ?? null
    cleanup.eventTitle = res.body?.event?.title ?? title
    return {
      status: res.status,
      eventId: cleanup.eventId,
      eventTitle: cleanup.eventTitle,
      hasEndDate: Boolean(res.body?.event?.event_end_date),
      passed: res.ok && Boolean(cleanup.eventId) && Boolean(res.body?.event?.event_end_date),
    }
  })

  await record('A-10', 'Participant POST without Authorization is rejected', async () => {
    const res = await fetchJson('/api/participants', {
      method: 'POST',
      body: JSON.stringify({
        event_id: cleanup.eventId,
        name: `${runId} Unauth`,
        member_id: '11111111-1111-4111-8111-111111111111',
        guest: false,
      }),
    })
    return { status: res.status, passed: res.status === 401 }
  })

  await record('D-02', 'Authenticated join omits user_code and returns temporary_code', async () => {
    if (!QA_AUTH_EMAIL || !QA_AUTH_PASSWORD) {
      return { skipped: true, reason: 'QA_AUTH_EMAIL/QA_AUTH_PASSWORD are not configured', passed: false }
    }

    const { data: session, error: loginError } = await supabaseAuth.auth.signInWithPassword({
      email: QA_AUTH_EMAIL,
      password: QA_AUTH_PASSWORD,
    })
    if (loginError || !session.session?.access_token || !session.user?.id) {
      throw new Error(`QA auth login failed: ${loginError?.message ?? 'missing session'}`)
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('id,name,auth_user_id')
      .eq('auth_user_id', session.user.id)
      .maybeSingle()
    if (memberError || !member) throw new Error(memberError?.message ?? 'QA member was not found')

    const res = await fetchJson('/api/participants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.session.access_token}` },
      body: JSON.stringify({
        event_id: cleanup.eventId,
        name: member.name,
        member_id: member.id,
        guest: false,
      }),
    })

    return {
      status: res.status,
      participantId: res.body?.participant?.id,
      hasTemporaryCode: Boolean(res.body?.temporary_code),
      userCodeVisible: res.body?.participant?.user_code !== undefined,
      passed: res.ok && Boolean(res.body?.temporary_code) && res.body?.participant?.user_code === undefined,
    }
  })
} finally {
  if (cleanup.eventId) {
    const apiDelete = await fetchJson('/api/admin/events', {
      method: 'DELETE',
      headers: adminCookie ? { Cookie: adminCookie } : {},
      body: JSON.stringify({ id: cleanup.eventId }),
    }).catch(error => ({ status: 0, ok: false, body: { error: error.message } }))
    cleanup.deleteApiStatus = apiDelete.status

    if (!apiDelete.ok) {
      cleanup.serviceRoleFallbackUsed = true
      await forceCleanupEvent(cleanup.eventId)
    }

    cleanup.verifiedDeleted = (await getEvent(cleanup.eventId)) === null
  }
}

const summary = {
  runId,
  baseUrl: BASE_URL,
  counts: {
    total: results.length,
    passed: results.filter(result => result.status === 'PASS').length,
    failed: results.filter(result => result.status === 'FAIL').length,
  },
  cleanup,
  results,
}

console.log(JSON.stringify(summary, null, 2))
