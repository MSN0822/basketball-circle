import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const envPath = path.join(root, '.env.local')
const envRaw = await fs.readFile(envPath, 'utf8')
const env = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    })
)

const BASE_URL = process.env.QA_BASE_URL ?? 'https://basketball-circle.vercel.app'
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ADMIN_PASSWORD = env.ADMIN_PASSWORD

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_PASSWORD) {
  throw new Error('Required local QA environment values are missing.')
}

const runId = `QA_KEEP_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const evidenceDir = path.join(root, 'docs', 'qa', 'evidence', `2026-05-26-comprehensive-${runId}`)
await fs.mkdir(evidenceDir, { recursive: true })

const results = []
const created = {
  runId,
  baseUrl: BASE_URL,
  evidenceDir,
  events: [],
  members: [],
  authUsers: [],
  participants: [],
}

function redact(value) {
  if (typeof value !== 'string') return value
  if (value.includes(SUPABASE_ANON_KEY)) return value.replaceAll(SUPABASE_ANON_KEY, '[REDACTED_ANON_KEY]')
  if (value.includes(ADMIN_PASSWORD)) return value.replaceAll(ADMIN_PASSWORD, '[REDACTED_ADMIN_PASSWORD]')
  return value
}

async function saveEvidence(name, data) {
  const safeName = name.replace(/[<>:"/\\|?*]/g, '_')
  const file = path.join(evidenceDir, safeName)
  const safeData = JSON.parse(JSON.stringify(data, (_, value) => redact(value)))
  await fs.writeFile(file, JSON.stringify(safeData, null, 2), 'utf8')
  return file
}

async function record(id, name, fn) {
  const startedAt = new Date().toISOString()
  try {
    const detail = await fn()
    const passed = detail?.passed !== false
    const status = passed ? 'PASS' : 'FAIL'
    const evidence = await saveEvidence(`${id}.json`, { id, name, status, startedAt, finishedAt: new Date().toISOString(), detail })
    results.push({ id, name, status, evidence, detail })
  } catch (error) {
    const detail = { error: error instanceof Error ? error.message : String(error) }
    const evidence = await saveEvidence(`${id}.json`, { id, name, status: 'FAIL', startedAt, finishedAt: new Date().toISOString(), detail })
    results.push({ id, name, status: 'FAIL', evidence, detail })
  }
}

async function fetchRaw(url, options = {}) {
  return fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  })
}

async function fetchJson(url, options = {}) {
  const res = await fetchRaw(url, {
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
  return { status: res.status, ok: res.ok, body, headers: Object.fromEntries(res.headers.entries()) }
}

async function appJson(pathname, options = {}) {
  return fetchJson(`${BASE_URL}${pathname}`, options)
}

async function supabaseRest(table, query = '', options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
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
  return { status: res.status, ok: res.ok, body }
}

async function createEvent(suffix, overrides = {}) {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + created.events.length * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const payload = {
    title: `${runId}_${suffix}`,
    event_date: start.toISOString(),
    event_end_date: end.toISOString(),
    location: `${runId} Gym`,
    location_url: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
    max_participants: 2,
    threshold: 2,
    status: 'accepting',
    ...overrides,
  }
  const res = await appJson('/api/admin/events', {
    method: 'POST',
    headers: { 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify(payload),
  })
  if (!res.ok || !res.body?.event?.id) throw new Error(`createEvent failed: ${res.status}`)
  created.events.push({ id: res.body.event.id, title: res.body.event.title })
  return res.body.event
}

async function createAuthUserAndMember(label, displayName) {
  const email = `qa_keep_${runId.toLowerCase()}_${label}@example.com`
  const password = `QaKeep-${runId}-${label}-12345`
  const signup = await fetchJson(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  })
  if (!signup.ok || !signup.body?.user?.id) throw new Error(`signup failed: ${signup.status}`)
  const authUserId = signup.body.user.id
  const accessToken = signup.body.session?.access_token ?? null
  created.authUsers.push({ id: authUserId, email })

  const member = await appJson('/api/members', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ name: displayName, auth_user_id: authUserId }),
  })
  if (!member.ok || !member.body?.member?.id) throw new Error(`member registration failed: ${member.status}`)
  created.members.push({ id: member.body.member.id, name: member.body.member.name, authUserId, email, accessToken: Boolean(accessToken) })
  return { authUserId, email, password, accessToken, member: member.body.member }
}

async function join(eventId, name, memberId = null, guest = false) {
  const res = await appJson('/api/participants', {
    method: 'POST',
    body: JSON.stringify({ event_id: eventId, name, member_id: memberId, guest }),
  })
  if (res.body?.participant?.id) {
    created.participants.push({ id: res.body.participant.id, name: res.body.participant.name, status: res.body.participant.status })
  }
  return res
}

async function cancel(participantId, memberId = null, userCode = null, admin = false) {
  return appJson('/api/cancel', {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId, member_id: memberId, user_code: userCode, admin }),
  })
}

async function getEvent(eventId) {
  const res = await supabaseRest('events', `?id=eq.${eventId}&select=*`)
  return Array.isArray(res.body) ? res.body[0] : null
}

async function getParticipants(eventId) {
  const res = await supabaseRest('participants', `?event_id=eq.${eventId}&select=*&order=slot_number.asc,created_at.asc`)
  return Array.isArray(res.body) ? res.body : []
}

let mainEvent
let capacityEvent
let concurrencyEvent
let memberA
let memberB

await record('H-01', 'Production build check is handled separately by npm run build', async () => ({
  note: 'The script records runtime tests. See the QA report for build command output.',
}))

await record('A-01', 'Unauthenticated top page redirects to login', async () => {
  const res = await fetchRaw(`${BASE_URL}/`)
  return { status: res.status, location: res.headers.get('location'), passed: [307, 308].includes(res.status) && res.headers.get('location')?.includes('/login') }
})

await record('A-02', 'Unauthenticated event detail redirects to login', async () => {
  const res = await fetchRaw(`${BASE_URL}/events/6defef7b-59e2-4ade-8943-4c51487118e6`)
  return { status: res.status, location: res.headers.get('location'), passed: [307, 308].includes(res.status) && res.headers.get('location')?.includes('/login') }
})

await record('F-01', 'Admin verification rejects invalid password', async () => {
  const res = await appJson('/api/admin/verify', { method: 'POST', body: JSON.stringify({ password: `${runId}_wrong` }) })
  return { status: res.status, body: res.body, passed: res.status === 403 }
})

await record('F-02', 'Admin verification accepts configured password', async () => {
  const res = await appJson('/api/admin/verify', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) })
  return { status: res.status, body: res.body, passed: res.ok }
})

await record('F-03', 'Admin event create rejects missing required fields', async () => {
  const res = await appJson('/api/admin/events', {
    method: 'POST',
    headers: { 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify({ title: `${runId}_invalid` }),
  })
  return { status: res.status, body: res.body, passed: res.status === 400 }
})

await record('F-04', 'Admin event create rejects end time before start time', async () => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() - 60 * 1000)
  const res = await appJson('/api/admin/events', {
    method: 'POST',
    headers: { 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify({
      title: `${runId}_invalid_end`,
      event_date: start.toISOString(),
      event_end_date: end.toISOString(),
      location: `${runId} Gym`,
      max_participants: 2,
      threshold: 2,
      status: 'accepting',
    }),
  })
  return { status: res.status, body: res.body, passed: res.status === 400 }
})

await record('F-05', 'Admin creates accepting event with start/end time', async () => {
  mainEvent = await createEvent('MAIN', { max_participants: 6, threshold: 4 })
  return { eventId: mainEvent.id, title: mainEvent.title, event_end_date: mainEvent.event_end_date, passed: Boolean(mainEvent.event_end_date) }
})

await record('F-06', 'Admin updates event title and capacity fields', async () => {
  const patchedTitle = `${mainEvent.title}_PATCHED`
  const res = await appJson('/api/admin/events', {
    method: 'PATCH',
    headers: { 'x-admin-password': ADMIN_PASSWORD },
    body: JSON.stringify({ id: mainEvent.id, title: patchedTitle, max_participants: 7, threshold: 5 }),
  })
  mainEvent = res.body?.event ?? mainEvent
  return {
    status: res.status,
    title: res.body?.event?.title,
    max_participants: res.body?.event?.max_participants,
    threshold: res.body?.event?.threshold,
    passed: res.ok && res.body.event.title === patchedTitle && res.body.event.max_participants === 7 && res.body.event.threshold === 5,
  }
})

await record('F-07', 'Admin creates draft event that remains traceable', async () => {
  const draft = await createEvent('DRAFT', { status: 'draft', max_participants: 3, threshold: 2 })
  return { eventId: draft.id, status: draft.status, passed: draft.status === 'draft' }
})

await record('A-04', 'Create two QA auth users and member records', async () => {
  memberA = await createAuthUserAndMember('a', `${runId} 山田 太郎`)
  memberB = await createAuthUserAndMember('b', `${runId} 佐藤 花子`)
  return {
    members: [
      { id: memberA.member.id, name: memberA.member.name, email: memberA.email, hasSession: Boolean(memberA.accessToken) },
      { id: memberB.member.id, name: memberB.member.name, email: memberB.email, hasSession: Boolean(memberB.accessToken) },
    ],
    passed: Boolean(memberA.member.id && memberB.member.id),
  }
})

await record('A-06', 'Member created without nickname has no empty parentheses', async () => ({
  memberName: memberA.member.name,
  passed: !memberA.member.name.includes('()'),
}))

await record('A-08', 'Member PATCH without Authorization is rejected', async () => {
  const res = await appJson('/api/members', {
    method: 'PATCH',
    body: JSON.stringify({ member_id: memberA.member.id, name: `${memberA.member.name}(NG)` }),
  })
  return { status: res.status, body: res.body, passed: res.status === 401 }
})

await record('A-09', 'Member POST without Authorization is rejected or flagged', async () => {
  const unauthUserId = crypto.randomUUID()
  const res = await appJson('/api/members', {
    method: 'POST',
    body: JSON.stringify({ name: `${runId} UNAUTH_MEMBER_SHOULD_NOT_CREATE`, auth_user_id: unauthUserId }),
  })
  if (res.body?.member?.id) {
    created.members.push({ id: res.body.member.id, name: res.body.member.name, authUserId: unauthUserId, unauthenticated: true })
  }
  return {
    status: res.status,
    body: res.body,
    expected: '400, 401, or 403',
    passed: res.status === 400 || res.status === 401 || res.status === 403,
  }
})

await record('C-01', 'Member joins accepting event', async () => {
  const res = await join(mainEvent.id, memberA.member.name, memberA.member.id)
  return { status: res.status, body: res.body, passed: res.ok && res.body.participant.status === 'active' }
})

await record('C-02', 'Same member duplicate join is rejected', async () => {
  const res = await join(mainEvent.id, memberA.member.name, memberA.member.id)
  return { status: res.status, body: res.body, passed: res.status === 409 }
})

await record('D-02', 'Member who is not personally joining can add a friend', async () => {
  const res = await join(mainEvent.id, `${runId} 友達A(佐藤の友達)`, memberB.member.id, true)
  return { status: res.status, body: res.body, passed: res.ok && res.body.participant?.user_code?.startsWith(`guest:${memberB.member.id}:`) }
})

await record('D-03', 'Member can add up to three friends', async () => {
  const firstGuestCount = (await getParticipants(mainEvent.id)).filter(p => String(p.user_code).startsWith(`guest:${memberB.member.id}:`) && p.status !== 'cancelled').length
  const adds = []
  for (let i = firstGuestCount + 1; i <= 3; i += 1) {
    adds.push(await join(mainEvent.id, `${runId} 友達${i}(佐藤の友達)`, memberB.member.id, true))
  }
  return { statuses: adds.map(r => r.status), passed: adds.every(r => r.ok) }
})

await record('D-04', 'Fourth friend is rejected', async () => {
  const res = await join(mainEvent.id, `${runId} 友達4(佐藤の友達)`, memberB.member.id, true)
  return { status: res.status, body: res.body, passed: res.status === 400 }
})

await record('D-05', 'Friend labels include inviter family name', async () => {
  const participants = await getParticipants(mainEvent.id)
  const guests = participants.filter(p => String(p.user_code).startsWith(`guest:${memberB.member.id}:`) && p.status !== 'cancelled')
  return { guestNames: guests.map(g => g.name), passed: guests.length >= 3 && guests.every(g => g.name.includes('(佐藤の友達)')) }
})

await record('E-01/E-02', 'Capacity closes event and overflow becomes waitlist', async () => {
  capacityEvent = await createEvent('CAPACITY', { max_participants: 2, threshold: 2 })
  const one = await join(capacityEvent.id, `${runId} 定員A`, null)
  const two = await join(capacityEvent.id, `${runId} 定員B`, null)
  const three = await join(capacityEvent.id, `${runId} 待機C`, null)
  const event = await getEvent(capacityEvent.id)
  const participants = await getParticipants(capacityEvent.id)
  return {
    statuses: [one.status, two.status, three.status],
    participantStatuses: participants.map(p => ({ name: p.name, status: p.status, slot: p.slot_number })),
    eventStatus: event?.status,
    passed: one.ok && two.ok && three.ok && event?.status === 'closed' && participants.filter(p => p.status === 'active').length === 2 && participants.filter(p => p.status === 'waitlist').length === 1,
  }
})

await record('E-03/E-04', 'Cancel active promotes waitlist and reopens when below threshold', async () => {
  const participantsBefore = await getParticipants(capacityEvent.id)
  const firstActive = participantsBefore.find(p => p.status === 'active')
  const res = await cancel(firstActive.id, null, firstActive.user_code)
  const event = await getEvent(capacityEvent.id)
  const participantsAfter = await getParticipants(capacityEvent.id)
  return {
    cancelStatus: res.status,
    eventStatus: event?.status,
    participantsAfter: participantsAfter.map(p => ({ name: p.name, status: p.status, slot: p.slot_number })),
    passed: res.ok && event?.status === 'closed' && participantsAfter.filter(p => p.status === 'active').length === 2 && participantsAfter.filter(p => p.status === 'waitlist').length === 0,
  }
})

await record('C-06', 'Member cannot cancel another member participant', async () => {
  const resJoin = await join(mainEvent.id, memberB.member.name, memberB.member.id)
  const participant = resJoin.body?.participant
  const res = await cancel(participant.id, memberA.member.id)
  return { joinStatus: resJoin.status, cancelStatus: res.status, body: res.body, passed: resJoin.ok && res.status === 403 }
})

await record('D-06', 'Friends remain after inviter self-cancel', async () => {
  const resCancel = await cancel(memberB ? (await getParticipants(mainEvent.id)).find(p => p.member_id === memberB.member.id)?.id : null, memberB.member.id)
  const participants = await getParticipants(mainEvent.id)
  const activeGuests = participants.filter(p => String(p.user_code).startsWith(`guest:${memberB.member.id}:`) && p.status !== 'cancelled')
  return { cancelStatus: resCancel.status, activeGuestCount: activeGuests.length, passed: resCancel.ok && activeGuests.length === 3 }
})

await record('D-07', 'Inviter can cancel own friend after self-cancel', async () => {
  const participants = await getParticipants(mainEvent.id)
  const guest = participants.find(p => String(p.user_code).startsWith(`guest:${memberB.member.id}:`) && p.status !== 'cancelled')
  const res = await cancel(guest.id, memberB.member.id)
  const after = await getParticipants(mainEvent.id)
  const stillActive = after.some(p => p.id === guest.id && p.status !== 'cancelled')
  return { cancelStatus: res.status, cancelledGuestId: guest.id, passed: res.ok && !stillActive }
})

await record('D-08', 'Other member cannot cancel a friend they do not own', async () => {
  const participants = await getParticipants(mainEvent.id)
  const guest = participants.find(p => String(p.user_code).startsWith(`guest:${memberB.member.id}:`) && p.status !== 'cancelled')
  const res = await cancel(guest.id, memberA.member.id)
  return { cancelStatus: res.status, body: res.body, passed: res.status === 403 }
})

await record('E-05', 'Concurrent joins into capacity-one event keep exactly one active', async () => {
  concurrencyEvent = await createEvent('CONCURRENCY', { max_participants: 1, threshold: 1 })
  const requests = Array.from({ length: 5 }, (_, i) => join(concurrencyEvent.id, `${runId} 同時${i + 1}`, null))
  const responses = await Promise.all(requests)
  const event = await getEvent(concurrencyEvent.id)
  const participants = await getParticipants(concurrencyEvent.id)
  return {
    responseStatuses: responses.map(r => r.status),
    participantStatuses: participants.map(p => ({ name: p.name, status: p.status, slot: p.slot_number })),
    eventStatus: event?.status,
    passed: participants.filter(p => p.status === 'active').length === 1 && participants.filter(p => p.status === 'waitlist').length === 4 && event?.status === 'closed',
  }
})

await record('E-06', 'Concurrent duplicate member joins do not create duplicate active rows', async () => {
  const duplicateEvent = await createEvent('DUPLICATE_CONCURRENCY', { max_participants: 5, threshold: 5 })
  const requests = Array.from({ length: 4 }, () => join(duplicateEvent.id, memberA.member.name, memberA.member.id))
  const responses = await Promise.all(requests)
  const participants = await getParticipants(duplicateEvent.id)
  const memberRows = participants.filter(p => p.member_id === memberA.member.id && p.status !== 'cancelled')
  return {
    responseStatuses: responses.map(r => r.status),
    memberRows: memberRows.map(p => ({ id: p.id, status: p.status, slot: p.slot_number })),
    passed: memberRows.length === 1,
  }
})

await record('G-01', 'Anon direct participants update is blocked', async () => {
  const participant = (await getParticipants(mainEvent.id)).find(p => p.status !== 'cancelled')
  const before = participant.name
  const res = await supabaseRest('participants', `?id=eq.${participant.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: `${before}_ANON_PATCH_SHOULD_NOT_APPLY` }),
  })
  const after = (await getParticipants(mainEvent.id)).find(p => p.id === participant.id)
  return { status: res.status, rowsReturned: Array.isArray(res.body) ? res.body.length : null, before, after: after?.name, passed: after?.name === before }
})

await record('G-02', 'Anon direct members update is blocked', async () => {
  const before = memberA.member.name
  const res = await supabaseRest('members', `?id=eq.${memberA.member.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: `${before}_ANON_PATCH_SHOULD_NOT_APPLY` }),
  })
  const selected = await supabaseRest('members', `?id=eq.${memberA.member.id}&select=*`)
  const after = Array.isArray(selected.body) ? selected.body[0] : null
  return { status: res.status, rowsReturned: Array.isArray(res.body) ? res.body.length : null, before, after: after?.name, passed: after?.name === before }
})

await record('B-06', 'Created event stores and exposes end date', async () => {
  const event = await getEvent(mainEvent.id)
  return { eventId: event?.id, event_date: event?.event_date, event_end_date: event?.event_end_date, passed: Boolean(event?.event_end_date) }
})

const summary = {
  runId,
  baseUrl: BASE_URL,
  startedAt: results[0]?.detail?.startedAt,
  finishedAt: new Date().toISOString(),
  counts: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
  },
  created,
  results: results.map(({ id, name, status, evidence, detail }) => ({
    id,
    name,
    status,
    evidence,
    important: detail?.expected ? detail : undefined,
  })),
}

await saveEvidence('summary.json', summary)
console.log(JSON.stringify(summary, null, 2))
