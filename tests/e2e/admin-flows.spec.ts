import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'

const ADMIN_SESSION_COOKIE = 'basketball_admin_session'
const runId = `QA_E2E_ADMIN_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
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

async function loginAdmin(baseURL: string, password: string): Promise<{ cookieHeader: string; token: string }> {
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
  expect(sessionCookie, 'admin session cookie should be set').toBeTruthy()

  const cookieHeader = (sessionCookie as string).split(';')[0]
  return { cookieHeader, token: cookieHeader.slice(cookieHeader.indexOf('=') + 1) }
}

async function createAdminEvent(baseURL: string, cookie: string, suffix: string, overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
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
      max_participants: 5,
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

async function clearAdminLoginAttempts(supabase: SupabaseClient) {
  const { error } = await supabase
    .from('admin_login_attempts')
    .delete()
    .neq('key', '')
  if (error) throw error
}

test.describe.configure({ mode: 'serial' })

test.describe('admin-flows E2E', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminPassword = ''
  let adminCookieHeader = ''
  let adminToken = ''
  let testEventId = ''
  let testEventTitle = ''
  let supabaseAdmin: SupabaseClient

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    adminPassword = env.ADMIN_PASSWORD
    baseURL = process.env.QA_BASE_URL ?? baseURL
    supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await clearAdminLoginAttempts(supabaseAdmin)

    const session = await loginAdmin(baseURL, adminPassword)
    adminCookieHeader = session.cookieHeader
    adminToken = session.token

    const event = await createAdminEvent(baseURL, adminCookieHeader, 'ADMIN_FLOW')
    testEventId = event.id
    testEventTitle = event.title
  })

  test.afterAll(async () => {
    if (supabaseAdmin) {
      await cleanupRunEvents(supabaseAdmin)
      await clearAdminLoginAttempts(supabaseAdmin)
    }
  })

  async function injectAdminCookie(context: BrowserContext) {
    await context.addCookies([{
      name: ADMIN_SESSION_COOKIE,
      value: adminToken,
      url: baseURL,
      httpOnly: true,
      secure: baseURL.startsWith('https'),
      sameSite: 'Strict',
    }])
  }

  test('[GAP-09] admin subpage redirects to /admin without session cookie', async ({ page }) => {
    await page.goto(`/admin/events/${testEventId}/edit`)
    await expect(page).toHaveURL(/\/admin$/)
    await screenshot(page, 'gap09-subpage-redirect.png')
  })

  test('[GAP-10] admin login shows error message on wrong password', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.locator('input[type="password"]')).toBeVisible()

    await page.locator('input[type="password"]').fill(`wrong-${runId}`)
    await page.getByRole('button').first().click()

    await expect(page.locator('.text-destructive, [role="alert"]')).toBeVisible({ timeout: 5_000 })
    await screenshot(page, 'gap10-login-error.png')
  })

  test('[GAP-06] admin logout clears session and protected pages redirect', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto('/admin')

    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })

    await page.goto(`/admin/events/${testEventId}/edit`)
    await expect(page).toHaveURL(/\/admin$/)
    await screenshot(page, 'gap06-post-logout-redirect.png')
  })

  test('[GAP-04] admin can toggle event status between closed and accepting', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}`)

    await expect(page.getByRole('button', { name: '締め切る' })).toBeVisible()
    await page.getByRole('button', { name: '締め切る' }).click()
    await expect(page.getByRole('button', { name: '再開する' })).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap04-after-close.png')

    await page.getByRole('button', { name: '再開する' }).click()
    await expect(page.getByRole('button', { name: '締め切る' })).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap04-after-reopen.png')
  })

  test('[GAP-05] admin can edit event title and save', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}/edit`)

    const newTitle = `${testEventTitle}_EDITED`
    await page.locator('input').first().fill(newTitle)
    await page.getByRole('button', { name: '保存する' }).click()

    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 })
    await expect(page.getByText(newTitle)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap05-after-save.png')
    testEventTitle = newTitle
  })

  test('[GAP-03] admin can delete an event and it disappears from list', async ({ page, context }) => {
    const target = await createAdminEvent(baseURL, adminCookieHeader, 'DELETE_TARGET', {
      max_participants: 3,
      threshold: 2,
    })

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${target.id}`)
    await expect(page.getByText(target.title)).toBeVisible()

    await page.getByRole('button', { name: 'イベント削除' }).click()
    await expect(page.locator('.fixed')).toContainText(target.title)
    await page.getByRole('button', { name: '実行' }).click()

    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 })
    await expect(page.getByText(target.title)).not.toBeVisible()
    await screenshot(page, 'gap03-after-delete.png')
  })

  test('[GAP-02] admin can force-cancel a participant', async ({ page, context }) => {
    const participantName = `${runId} Force Cancel Target`
    const { error } = await supabaseAdmin.from('participants').insert({
      event_id: testEventId,
      name: participantName,
      user_code: `${runId}-force-cancel`,
      status: 'active',
      slot_number: 1,
      member_id: null,
    })
    expect(error).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}`)
    await expect(page.getByText(participantName)).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: '強制キャンセル' }).first().click()
    await expect(page.locator('.fixed')).toContainText(participantName)
    await page.getByRole('button', { name: '実行' }).click()

    await expect(page.locator('.fixed').filter({ hasText: participantName })).not.toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main span').filter({ hasText: participantName })).not.toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap02-after-force-cancel.png')
  })

  test('[GAP-11] admin delete failure shows error toast', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.route('**/api/admin/events', async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'DB error from test mock' }),
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/admin/events/${testEventId}`)
    await page.getByRole('button', { name: 'イベント削除' }).click()
    await page.getByRole('button', { name: '実行' }).click()

    await expect(page.locator('.fixed.bottom-6')).toContainText('イベント削除に失敗しました', { timeout: 5_000 })
    await expect(page).toHaveURL(new RegExp(`/admin/events/${testEventId}`))
    await screenshot(page, 'gap11-error-toast.png')
  })

  test('[GAP-15] admin can create an event via UI form', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto('/admin/create')

    const uiTitle = `${runId}_UI_CREATE`
    const date = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await page.locator('input').nth(0).fill(uiTitle)
    await page.locator('input[type="date"]').nth(0).fill(date)
    await page.locator('select').nth(0).selectOption('19')
    await page.locator('select').nth(1).selectOption('00')
    await page.locator('input[type="date"]').nth(1).fill(date)
    await page.locator('select').nth(2).selectOption('21')
    await page.locator('select').nth(3).selectOption('00')
    await page.locator('input').nth(3).fill(`${runId} UI Gym`)
    await screenshot(page, 'gap15-create-form-filled.png')

    await page.getByRole('button', { name: '公開して作成' }).click()
    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 })
    await expect(page.getByText(uiTitle)).toBeVisible({ timeout: 10_000 })

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('id,title')
      .eq('title', uiTitle)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    await screenshot(page, 'gap15-after-create.png')
  })

  test('[GAP-14] admin rate limit after 5 failures', async () => {
    await clearAdminLoginAttempts(supabaseAdmin)

    try {
      const firstFailure = await appJson(baseURL, '/api/admin/verify', {
        method: 'POST',
        body: JSON.stringify({ password: `${runId}-wrong` }),
      })
      expect(firstFailure.status).toBe(403)

      const { data: attempts, error } = await supabaseAdmin
        .from('admin_login_attempts')
        .select('key')
      expect(error).toBeNull()
      expect(attempts?.length).toBe(1)

      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      const { error: updateError } = await supabaseAdmin
        .from('admin_login_attempts')
        .update({ count: 5, locked_until: lockedUntil })
        .eq('key', attempts![0].key)
      expect(updateError).toBeNull()

      const locked = await appJson(baseURL, '/api/admin/verify', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      })

      expect(locked.status).toBe(429)
    } finally {
      await clearAdminLoginAttempts(supabaseAdmin)
    }
  })

  test('[GAP-12] new member registration flow', async ({ page }) => {
    const suffix = Date.now()
    const email = `qa-${runId.toLowerCase()}-${suffix}@example.com`
    const password = `Qa-${suffix}-pass`
    let authUserId: string | null = null

    try {
      await page.goto('/login')
      await page.locator('button').nth(1).click()

      await page.locator('input').nth(0).fill('QA')
      await page.locator('input').nth(1).fill(`登録${suffix}`)
      await page.locator('input').nth(2).fill('確認')
      await page.locator('input[type="email"]').fill(email)
      await page.locator('input[type="password"]').fill(password)
      await screenshot(page, 'gap12-register-form-filled.png')

      await page.locator('button').last().click()
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

      const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers()
      expect(authError).toBeNull()
      const createdUser = authUsers.users.find(user => user.email === email)
      expect(createdUser?.id).toBeTruthy()
      authUserId = createdUser!.id

      const { data: member, error: memberError } = await supabaseAdmin
        .from('members')
        .select('id,name,auth_user_id')
        .eq('auth_user_id', authUserId)
        .maybeSingle()
      expect(memberError).toBeNull()
      expect(member?.name).toBe(`QA 登録${suffix}(確認)`)
      await screenshot(page, 'gap12-after-register.png')
    } finally {
      if (authUserId) {
        await supabaseAdmin.from('members').delete().eq('auth_user_id', authUserId)
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
      } else {
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
        const createdUser = authUsers?.users.find(user => user.email === email)
        if (createdUser?.id) {
          await supabaseAdmin.from('members').delete().eq('auth_user_id', createdUser.id)
          await supabaseAdmin.auth.admin.deleteUser(createdUser.id)
        }
      }
    }
  })
})
