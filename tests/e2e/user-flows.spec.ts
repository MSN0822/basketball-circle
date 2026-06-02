import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'

const ADMIN_SESSION_COOKIE = 'basketball_admin_session'
const runId = `QA_E2E_USER_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const tokyoDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const evidenceDir = path.join(process.cwd(), 'docs', 'qa', 'evidence', `${tokyoDate}-${runId}`)

type LocalEnv = Record<string, string>
type JsonResult<T = unknown> = {
  ok: boolean
  status: number
  body: T
  headers: Headers
}
type MemberRow = {
  id: string
  name: string
  auth_user_id: string
}

async function readLocalEnv(): Promise<LocalEnv> {
  const raw = await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8')
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]
      })
  )
}

async function screenshot(page: Page, name: string) {
  await fs.mkdir(evidenceDir, { recursive: true })
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true })
}

async function appJson<T = unknown>(baseURL: string, pathname: string, options: RequestInit = {}): Promise<JsonResult<T>> {
  const res = await fetch(`${baseURL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  return { ok: res.ok, status: res.status, body: body as T, headers: res.headers }
}

async function loginAdmin(baseURL: string, password: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  expect(res.status).toBe(200)
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  const sessionCookie = setCookies.find(cookie => cookie.startsWith(`${ADMIN_SESSION_COOKIE}=`))
  expect(sessionCookie).toBeTruthy()
  return (sessionCookie as string).split(';')[0]
}

async function createAdminEvent(baseURL: string, cookie: string, suffix: string, overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const title = `${runId}_${suffix}`
  const res = await appJson<{ event?: { id: string; title: string } }>(baseURL, '/api/admin/events', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({
      title,
      event_date: start.toISOString(),
      event_end_date: end.toISOString(),
      location: `${runId} Gym`,
      location_url: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
      max_participants: 8,
      threshold: 3,
      status: 'accepting',
      ...overrides,
    }),
  })
  expect(res.status).toBe(200)
  expect(res.body.event?.id).toBeTruthy()
  return { id: res.body.event!.id, title: res.body.event!.title }
}

async function cleanupRunEvents(supabase: SupabaseClient) {
  const { data: events, error } = await supabase
    .from('events')
    .select('id,title')
    .like('title', `${runId}%`)
  if (error) throw error
  const ids = (events ?? []).map(event => event.id as string)
  if (ids.length === 0) return

  const { error: participantError } = await supabase
    .from('participants')
    .delete()
    .in('event_id', ids)
  if (participantError) throw participantError

  const { error: eventError } = await supabase
    .from('events')
    .delete()
    .in('id', ids)
  if (eventError) throw eventError
}

async function loginQaUser(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button').last().click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('user-flows E2E', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminCookieHeader = ''
  let qaEmail = ''
  let qaPassword = ''
  let qaToken = ''
  let qaReady = false
  let testEventId = ''
  let testEventTitle = ''
  let closedEventId = ''
  let qaMember: MemberRow | null = null
  let originalMemberName = ''
  let supabaseAdmin: SupabaseClient

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    baseURL = process.env.QA_BASE_URL ?? baseURL
    qaEmail = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL ?? ''
    qaPassword = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD ?? ''
    supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (!qaEmail || !qaPassword) return

    const supabaseAuth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: session, error: loginError } = await supabaseAuth.auth.signInWithPassword({
      email: qaEmail,
      password: qaPassword,
    })
    expect(loginError).toBeNull()
    expect(session.session?.access_token).toBeTruthy()
    qaToken = session.session!.access_token

    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('id,name,auth_user_id')
      .eq('auth_user_id', session.user!.id)
      .maybeSingle<MemberRow>()
    expect(memberError).toBeNull()
    expect(member?.id).toBeTruthy()
    qaMember = member
    originalMemberName = member!.name

    adminCookieHeader = await loginAdmin(baseURL, env.ADMIN_PASSWORD)
    const mainEvent = await createAdminEvent(baseURL, adminCookieHeader, 'USER_FLOW')
    testEventId = mainEvent.id
    testEventTitle = mainEvent.title

    const closedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'CLOSED_WARNING', {
      max_participants: 5,
      threshold: 2,
    })
    closedEventId = closedEvent.id

    const joinRes = await appJson(baseURL, '/api/participants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${qaToken}` },
      body: JSON.stringify({
        event_id: closedEventId,
        name: qaMember!.name,
        member_id: qaMember!.id,
        guest: false,
      }),
    })
    expect(joinRes.status).toBe(200)

    const { error: fillerError } = await supabaseAdmin.from('participants').insert([
      {
        event_id: closedEventId,
        name: `${runId} Filler 1`,
        user_code: `${runId}-filler-1`,
        status: 'active',
        slot_number: 2,
        member_id: null,
      },
      {
        event_id: closedEventId,
        name: `${runId} Filler 2`,
        user_code: `${runId}-filler-2`,
        status: 'active',
        slot_number: 3,
        member_id: null,
      },
    ])
    expect(fillerError).toBeNull()

    const closeRes = await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: closedEventId, status: 'closed' }),
    })
    expect(closeRes.status).toBe(200)
    qaReady = true
  })

  test.afterAll(async () => {
    if (qaReady && qaMember && qaToken && originalMemberName) {
      await appJson(baseURL, '/api/members', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${qaToken}` },
        body: JSON.stringify({ member_id: qaMember.id, name: originalMemberName }),
      }).catch(() => null)
    }
    if (supabaseAdmin) await cleanupRunEvents(supabaseAdmin)
  })

  test('[GAP-08] home page shows event list for authenticated user', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto('/')

    for (let i = 0; i < 5; i += 1) {
      if (await page.getByText(testEventTitle).isVisible().catch(() => false)) break
      await page.waitForTimeout(6_000)
      await page.reload()
    }

    await expect(page.getByText(testEventTitle)).toBeVisible({ timeout: 10_000 })
    await page.getByText(testEventTitle).click()
    await expect(page).toHaveURL(new RegExp(`/events/${testEventId}`))
    await screenshot(page, 'gap08-event-detail-from-list.png')
  })

  test('[GAP-01] authenticated user can invite a guest and cancel the invite', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${testEventId}`)

    const guestName = `${runId} Guest`
    await expect(page.locator('input[placeholder*="友達"]')).toHaveCount(0)
    await page.getByRole('button', { name: '友達入力欄を追加' }).click()
    const guestInput = page.locator('input[placeholder*="友達"]').first()
    await expect(guestInput).toBeVisible({ timeout: 10_000 })
    await guestInput.fill(guestName)
    await guestInput.locator('xpath=..').getByRole('button', { name: '追加' }).click()

    await expect(page.locator('main')).toContainText('臨時ID', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText(guestName)
    await screenshot(page, 'gap01-after-guest-add.png')

    await page.getByRole('button', { name: '取消' }).first().click()
    await expect(page.locator('main')).toContainText('友達の臨時ID発行済み: 0 名', { timeout: 10_000 })
    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('participants')
        .select('id')
        .eq('event_id', testEventId)
        .like('name', `${guestName}%`)
        .in('status', ['active', 'waitlist'])
      if (error) throw error
      return data?.length ?? 0
    }, { timeout: 10_000 }).toBe(0)
    await screenshot(page, 'gap01-after-guest-cancel.png')
  })

  test('[GAP-07] cancelling from a closed event shows threshold warning in dialog', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${closedEventId}`)

    await expect(page.getByRole('button', { name: 'キャンセル' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'キャンセル' }).click()

    await expect(page.getByRole('dialog')).toContainText('参加者数が2人を下回るまで', { timeout: 10_000 })
    await expect(page.getByRole('dialog')).toContainText('キャンセルしてもよろしいですか')
    await screenshot(page, 'gap07-threshold-warning-dialog.png')

    await page.getByRole('button', { name: 'キャンセルしない' }).click()
  })

  test('[GAP-13] authenticated user can change their nickname', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'ニックネーム変更' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'ニックネーム変更' }).click()

    const nickname = `E2E${runId.slice(-6)}`
    await page.locator('input[placeholder="ニックネーム"]').fill(nickname)
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.locator('main')).toContainText(nickname, { timeout: 10_000 })
    await screenshot(page, 'gap13-after-nickname-save.png')
  })
})
