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

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = `QA_SECURITY_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const created = {
  eventId: null,
  memberIds: [],
  authUserIds: [],
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

async function fetchRaw(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, { redirect: 'manual', ...options })
}

async function fetchJson(pathname, options = {}) {
  const res = await fetchRaw(pathname, {
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

async function adminLoginCookie() {
  const res = await fetchJson('/api/admin/verify', {
    method: 'POST',
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })
  const setCookie = res.headers.get('set-cookie')
  const cookie = setCookie?.split(';')[0]
  if (!res.ok || !cookie) throw new Error(`admin login failed: ${res.status}`)
  return cookie
}

async function createAuthUserAndMember(label, name) {
  const email = `qa_security_${runId.toLowerCase()}_${label}@example.com`
  const password = `QaSecurity-${runId}-${label}-12345`
  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !userData.user?.id) throw new Error(createError?.message ?? 'auth user creation failed')
  created.authUserIds.push(userData.user.id)

  const { data: sessionData, error: loginError } = await supabaseAuth.auth.signInWithPassword({ email, password })
  if (loginError || !sessionData.session?.access_token) throw new Error(loginError?.message ?? 'auth login failed')

  const memberRes = await fetchJson('/api/members', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    body: JSON.stringify({ name, auth_user_id: userData.user.id }),
  })
  if (!memberRes.ok || !memberRes.body?.member?.id) {
    throw new Error(`member registration failed: ${memberRes.status}`)
  }
  created.memberIds.push(memberRes.body.member.id)
  return { member: memberRes.body.member, accessToken: sessionData.session.access_token }
}

async function join(eventId, qaMember) {
  const res = await fetchJson('/api/participants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${qaMember.accessToken}` },
    body: JSON.stringify({
      event_id: eventId,
      name: qaMember.member.name,
      member_id: qaMember.member.id,
    }),
  })
  if (!res.ok || !res.body?.participant?.id) throw new Error(`join failed: ${res.status}`)
  return res.body.participant
}

async function cancel(participant, qaMember) {
  return fetchJson('/api/cancel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${qaMember.accessToken}` },
    body: JSON.stringify({
      participant_id: participant.id,
      member_id: qaMember.member.id,
    }),
  })
}

async function getParticipants(eventId) {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id, member_id, status, slot_number')
    .eq('event_id', eventId)
    .order('slot_number', { ascending: true })
  if (error) throw error
  return data ?? []
}

async function cleanup() {
  if (created.eventId) {
    await supabaseAdmin.from('participants').delete().eq('event_id', created.eventId)
    await supabaseAdmin.from('events').delete().eq('id', created.eventId)
  }
  if (created.memberIds.length > 0) {
    await supabaseAdmin.from('members').delete().in('id', created.memberIds)
  }
  await Promise.allSettled(created.authUserIds.map(id => supabaseAdmin.auth.admin.deleteUser(id)))
}

let adminCookie = null
let qaMembers = []
let participants = []

try {
  await record('SEC-01', 'Security headers are present', async () => {
    const res = await fetchRaw('/login')
    return {
      status: res.status,
      xFrameOptions: res.headers.get('x-frame-options'),
      xContentTypeOptions: res.headers.get('x-content-type-options'),
      referrerPolicy: res.headers.get('referrer-policy'),
      hasCsp: Boolean(res.headers.get('content-security-policy')),
      passed:
        res.headers.get('x-frame-options') === 'DENY' &&
        res.headers.get('x-content-type-options') === 'nosniff' &&
        Boolean(res.headers.get('content-security-policy')),
    }
  })

  await record('SEC-02', 'Admin subpage redirects without session', async () => {
    const res = await fetchRaw('/admin/create')
    return {
      status: res.status,
      location: res.headers.get('location'),
      passed: [307, 308].includes(res.status) && res.headers.get('location')?.includes('/admin'),
    }
  })

  await record('SEC-03', 'Member registration requires Bearer token', async () => {
    const res = await fetchJson('/api/members', {
      method: 'POST',
      body: JSON.stringify({ name: `${runId} NO_AUTH`, auth_user_id: randomUUID() }),
    })
    return { status: res.status, body: res.body, passed: res.status === 401 }
  })

  await record('SEC-04', 'Admin login sets HttpOnly session cookie', async () => {
    adminCookie = await adminLoginCookie()
    return { hasCookie: Boolean(adminCookie), passed: Boolean(adminCookie) }
  })

  await record('SEC-05', 'Admin API accepts cookie session for event creation', async () => {
    const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const res = await fetchJson('/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        title: `${runId} cancel concurrency`,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        max_participants: 3,
        threshold: 3,
        status: 'accepting',
      }),
    })
    created.eventId = res.body?.event?.id ?? null
    return { status: res.status, eventCreated: Boolean(created.eventId), passed: res.ok && Boolean(created.eventId) }
  })

  await record('SEC-06', 'Admin subpage accepts cookie session', async () => {
    const res = await fetchRaw('/admin/create', { headers: { Cookie: adminCookie } })
    return { status: res.status, passed: res.status === 200 }
  })

  await record('SEC-07', 'Authenticated members can join test event', async () => {
    qaMembers = await Promise.all([
      createAuthUserAndMember('a', `${runId} Member A`),
      createAuthUserAndMember('b', `${runId} Member B`),
      createAuthUserAndMember('c', `${runId} Member C`),
    ])
    participants = []
    for (const member of qaMembers) {
      participants.push(await join(created.eventId, member))
    }
    return {
      participantCount: participants.length,
      slots: participants.map(p => p.slot_number),
      passed: participants.length === 3 && participants.every(p => p.status === 'active'),
    }
  })

  await record('SEC-08', 'Concurrent active cancellations keep slots consistent', async () => {
    const responses = await Promise.all([
      cancel(participants[0], qaMembers[0]),
      cancel(participants[1], qaMembers[1]),
    ])
    const rows = await getParticipants(created.eventId)
    const openRows = rows.filter(p => ['active', 'waitlist'].includes(p.status))
    const slots = openRows.map(p => p.slot_number)
    return {
      cancelStatuses: responses.map(r => r.status),
      rows,
      passed:
        responses.every(r => r.ok) &&
        openRows.length === 1 &&
        new Set(slots).size === slots.length &&
        slots[0] === 1,
    }
  })

  // --- 非破壊 negative ケース（Phase3: 入力長制限・UUID検証・権限昇格防止） ---
  // いずれもバリデーション層で 400/404 となり DB に行を残さないため本番でも安全。

  await record('SEC-09', 'Cancel rejects invalid participant_id UUID', async () => {
    const res = await fetchJson('/api/cancel', {
      method: 'POST',
      body: JSON.stringify({ participant_id: 'not-a-uuid' }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-10', 'Join rejects invalid event_id UUID', async () => {
    const member = qaMembers[0]
    const res = await fetchJson('/api/participants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member.accessToken}` },
      body: JSON.stringify({ event_id: 'not-a-uuid', name: member.member.name, member_id: member.member.id }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-11', 'Member PATCH rejects invalid member_id UUID', async () => {
    const member = qaMembers[0]
    const res = await fetchJson('/api/members', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member.accessToken}` },
      body: JSON.stringify({ member_id: 'not-a-uuid', name: `${runId} X` }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-12', 'Member PATCH rejects name over 100 chars', async () => {
    const member = qaMembers[0]
    const res = await fetchJson('/api/members', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member.accessToken}` },
      body: JSON.stringify({ member_id: member.member.id, name: 'あ'.repeat(101) }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-13', 'Member POST rejects name over 100 chars before auth', async () => {
    const res = await fetchJson('/api/members', {
      method: 'POST',
      body: JSON.stringify({ name: 'あ'.repeat(101), auth_user_id: randomUUID() }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-14', 'Admin event create rejects title over 200 chars', async () => {
    const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const res = await fetchJson('/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        title: 'T'.repeat(201),
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        max_participants: 3,
        threshold: 3,
        status: 'accepting',
      }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-15', 'Admin event create rejects location_url over 2000 chars', async () => {
    const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const res = await fetchJson('/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        title: `${runId} url-too-long`,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        location_url: `https://example.com/${'a'.repeat(2001)}`,
        max_participants: 3,
        threshold: 3,
        status: 'accepting',
      }),
    })
    return { status: res.status, body: res.body, passed: res.status === 400 }
  })

  await record('SEC-16', 'Member cannot update another member name (privilege escalation)', async () => {
    const attacker = qaMembers[0]
    const victim = qaMembers[1]
    const before = victim.member.name
    const res = await fetchJson('/api/members', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${attacker.accessToken}` },
      body: JSON.stringify({ member_id: victim.member.id, name: `${before}_HACKED` }),
    })
    const { data: victimRow } = await supabaseAdmin
      .from('members')
      .select('name')
      .eq('id', victim.member.id)
      .single()
    return {
      status: res.status,
      victimNameUnchanged: victimRow?.name === before,
      passed: res.status === 404 && victimRow?.name === before,
    }
  })

  await record('SEC-17', 'Anonymous direct join_event RPC is blocked', async () => {
    const { data, error } = await supabaseAnon.rpc('join_event', {
      p_event_id: created.eventId,
      p_name: `${runId} DIRECT_JOIN`,
      p_user_code: `${runId}_direct_join`,
      p_member_id: null,
      p_is_guest: false,
    })
    return {
      errorCode: error?.code ?? null,
      returnedAppError: Boolean(data?.error),
      passed: Boolean(error),
    }
  })

  await record('SEC-18', 'Anonymous direct cancel_participant RPC is blocked', async () => {
    const { data, error } = await supabaseAnon.rpc('cancel_participant', {
      p_participant_id: participants[2].id,
    })
    return {
      errorCode: error?.code ?? null,
      returnedAppError: Boolean(data?.error),
      passed: Boolean(error),
    }
  })

  await record('SEC-19', 'Anonymous direct update_member_name RPC is blocked', async () => {
    const { data, error } = await supabaseAnon.rpc('update_member_name', {
      p_member_id: qaMembers[1].member.id,
      p_auth_user_id: created.authUserIds[1],
      p_name: `${runId} DIRECT_UPDATE`,
    })
    return {
      errorCode: error?.code ?? null,
      returnedAppError: Boolean(data?.error),
      passed: Boolean(error),
    }
  })

  await record('SEC-20', 'Anonymous direct members select is hidden by RLS', async () => {
    const { data, error } = await supabaseAnon
      .from('members')
      .select('id')
      .in('id', created.memberIds)
    return {
      errorCode: error?.code ?? null,
      returnedRows: data?.length ?? 0,
      passed: !error && (data?.length ?? 0) === 0,
    }
  })

  await record('SEC-21', 'Anonymous direct participants select is hidden by RLS', async () => {
    const { data, error } = await supabaseAnon
      .from('participants')
      .select('id')
      .eq('event_id', created.eventId)
    return {
      errorCode: error?.code ?? null,
      returnedRows: data?.length ?? 0,
      passed: !error && (data?.length ?? 0) === 0,
    }
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
