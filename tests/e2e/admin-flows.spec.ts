import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupQaEvents, e2eEnvFileName, requireEnvMatchesTarget, requireProductionE2eAllowed, STALE_QA_EVENT_PREFIXES, staleQaCutoff } from './qa-cleanup'

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
type SignupRequestBody = {
  email?: string
  password?: string
  data?: { display_name?: string }
}

async function readLocalEnv(): Promise<LocalEnv> {
  const raw = await fs.readFile(path.join(process.cwd(), e2eEnvFileName()), 'utf8')
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
    requireProductionE2eAllowed(baseURL)
    // アプリの向き先と DB の向き先の食い違いを検出する（従来の QA 運用は明示的に許可）。
    requireEnvMatchesTarget(baseURL, env.NEXT_PUBLIC_SUPABASE_URL, { allowProductionDb: true })
    supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await cleanupQaEvents(supabaseAdmin, STALE_QA_EVENT_PREFIXES, { olderThanIso: staleQaCutoff() })
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
      await cleanupQaEvents(supabaseAdmin, [runId])
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

  // CSP の script-src を変更したときの回帰防止。Google Maps Places は管理者の場所入力でのみ使う。
  test('[CSP-01] the admin create page loads Google Maps Places without CSP violations', async ({ page, context }) => {
    const cspViolations: string[] = []
    page.on('console', msg => {
      const text = msg.text()
      if (/Content Security Policy|unsafe-eval|Refused to (load|execute|evaluate)/i.test(text)) {
        cspViolations.push(text)
      }
    })

    await injectAdminCookie(context)
    await page.goto('/admin/create')

    await page.waitForFunction(
      () => {
        const w = window as unknown as { google?: { maps?: { places?: unknown } } }
        return Boolean(w.google?.maps?.places)
      },
      null,
      { timeout: 20_000 },
    )

    expect(cspViolations, `CSP violations:\n${cspViolations.join('\n')}`).toHaveLength(0)
  })

  test('[ADM-19-1] editing rejects a capacity below the current active participant count', async ({ page, context }) => {
    const target = await createAdminEvent(baseURL, adminCookieHeader, 'CAPACITY_GUARD', {
      max_participants: 5,
      threshold: 3,
    })
    const { error } = await supabaseAdmin.from('participants').insert([
      { event_id: target.id, name: `${runId} Cap A`, user_code: `${runId}-cap-a`, status: 'active', slot_number: 1, member_id: null },
      { event_id: target.id, name: `${runId} Cap B`, user_code: `${runId}-cap-b`, status: 'active', slot_number: 2, member_id: null },
    ])
    expect(error).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${target.id}/edit`)

    // 1つ目 = 定員上限、2つ目 = 繰り上げ閾値
    const numberInputs = page.locator('input[type="number"]')
    await numberInputs.nth(0).fill('1')
    await numberInputs.nth(1).fill('1')
    await page.getByRole('button', { name: '保存する' }).click()

    await expect(page.getByText('現在の参加者数（2名）を下回る定員には変更できません')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/edit$/)
    await screenshot(page, 'adm19-capacity-below-active.png')

    const { data: unchanged } = await supabaseAdmin
      .from('events')
      .select('max_participants,status')
      .eq('id', target.id)
      .maybeSingle()
    expect(unchanged).toMatchObject({ max_participants: 5, status: 'accepting' })
  })

  test('[ADM-19-2] reducing capacity to exactly the active count closes the event', async ({ page, context }) => {
    const target = await createAdminEvent(baseURL, adminCookieHeader, 'CAPACITY_EXACT', {
      max_participants: 5,
      threshold: 3,
    })
    const { error } = await supabaseAdmin.from('participants').insert([
      { event_id: target.id, name: `${runId} Exact A`, user_code: `${runId}-exact-a`, status: 'active', slot_number: 1, member_id: null },
      { event_id: target.id, name: `${runId} Exact B`, user_code: `${runId}-exact-b`, status: 'active', slot_number: 2, member_id: null },
    ])
    expect(error).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${target.id}/edit`)

    const numberInputs = page.locator('input[type="number"]')
    await numberInputs.nth(0).fill('2')
    await numberInputs.nth(1).fill('2')
    await page.getByRole('button', { name: '保存する' }).click()

    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 })
    await screenshot(page, 'adm19-capacity-exact.png')

    // 自動締切なので is_manual_close は false のまま（キャンセル時の自動再開を止めない）
    const { data: closed } = await supabaseAdmin
      .from('events')
      .select('max_participants,status,is_manual_close')
      .eq('id', target.id)
      .maybeSingle()
    expect(closed).toMatchObject({ max_participants: 2, status: 'closed', is_manual_close: false })
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

  test('[GAP-16] force-cancel/cancel buttons are hidden for archived events', async ({ page, context }) => {
    const archivedParticipantName = `${runId} Archived Participant`
    const archivedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ARCHIVED_EVENT')
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedEvent.id)
    expect(updateError).toBeNull()
    const { error: insertError } = await supabaseAdmin.from('participants').insert({
      event_id: archivedEvent.id,
      name: archivedParticipantName,
      user_code: `${runId}-archived-participant`,
      status: 'active',
      slot_number: 1,
      member_id: null,
    })
    expect(insertError).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${archivedEvent.id}`)
    // 参加者記録自体は表示されるが、操作ボタンは表示されないことを確認する。
    await expect(page.getByText(archivedParticipantName)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '強制キャンセル' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0)
    await screenshot(page, 'gap16-archived-no-cancel-buttons.png')
  })

  test('[GAP-17] back link from an archived event returns to the archive list', async ({ page, context }) => {
    const archivedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ARCHIVED_BACKLINK')
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedEvent.id)
    expect(updateError).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${archivedEvent.id}`)
    const backLink = page.getByRole('link', { name: /イベント管理へ戻る/ })
    await expect(backLink).toHaveAttribute('href', '/admin?archive=1')

    await backLink.click()
    await expect(page).toHaveURL(/\/admin\?archive=1/)
    await expect(page.getByRole('button', { name: '通常一覧' })).toBeVisible()
    await expect(page.getByText(archivedEvent.title)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap17-archive-backlink.png')
  })

  test('[GAP-18] admin force-cancel API rejects archived events even when called directly', async () => {
    const archivedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ARCHIVED_API_REJECT')
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedEvent.id)
    expect(updateError).toBeNull()

    const participantName = `${runId} Archived API Target`
    const { data: participant, error: insertError } = await supabaseAdmin
      .from('participants')
      .insert({
        event_id: archivedEvent.id,
        name: participantName,
        user_code: `${runId}-archived-api-target`,
        status: 'active',
        slot_number: 1,
        member_id: null,
      })
      .select('id')
      .single()
    expect(insertError).toBeNull()

    // 画面上のボタンだけでなく、APIを直接叩いても拒否されることを確認する（UI/API整合性の担保）。
    const res = await appJson(baseURL, '/api/cancel', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ participant_id: participant!.id, admin: true }),
    })
    expect(res.status).toBe(409)
  })

  test('[GAP-19] edit and status-change buttons are hidden for archived events', async ({ page, context }) => {
    const archivedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ARCHIVED_NO_EDIT')
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedEvent.id)
    expect(updateError).toBeNull()

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${archivedEvent.id}`)
    await expect(page.getByText(archivedEvent.title)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '再開する' })).toHaveCount(0)
    // 削除ボタンはアーカイブ整理用途のため引き続き表示される。
    await expect(page.getByRole('button', { name: 'イベント削除' })).toBeVisible()
    await screenshot(page, 'gap19-archived-no-edit-buttons.png')
  })

  test('[GAP-20] admin edit/status API rejects archived events even when called directly', async () => {
    const archivedEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ARCHIVED_PATCH_REJECT')
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ status: 'archived' })
      .eq('id', archivedEvent.id)
    expect(updateError).toBeNull()

    const editRes = await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: archivedEvent.id, title: `${archivedEvent.title}_edited` }),
    })
    expect(editRes.status).toBe(409)

    const reopenRes = await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: archivedEvent.id, status: 'accepting' }),
    })
    expect(reopenRes.status).toBe(409)
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
      // A single failed verify records two rate-limit rows: the per-IP key and
      // the shared global key (see app/api/admin/verify/route.ts rateLimitKeys).
      // The IP key value is environment-dependent (ip:unknown when no proxy header is
      // present, ip:::1 behind a local `next start`, ip:<addr> on Vercel), so assert the
      // shape — exactly one global key plus one ip: key — rather than the literal address.
      const recordedKeys = (attempts ?? []).map(a => a.key).sort()
      expect(recordedKeys).toHaveLength(2)
      expect(recordedKeys).toContain('global:admin-login')
      expect(recordedKeys.some(key => key.startsWith('ip:'))).toBe(true)

      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      // Lock both rows so the subsequent verify trips anyLocked() regardless of order.
      const { error: updateError } = await supabaseAdmin
        .from('admin_login_attempts')
        .update({ count: 5, locked_until: lockedUntil })
        .neq('key', '')
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

  test('[GAP-12] registration request waits for email code before verification step', async ({ page }) => {
    const suffix = Date.now()
    const email = `qa-${runId.toLowerCase()}-${suffix}@example.com`
    const password = `Qa-${suffix}-pass`
    const displayName = `QA 登録${suffix}(確認)`
    let signupRequest: SignupRequestBody | undefined
    let signupUrl = ''

    await page.route('**/auth/v1/signup**', async route => {
      signupUrl = route.request().url()
      signupRequest = route.request().postDataJSON() as SignupRequestBody
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '11111111-1111-4111-8111-111111111111',
          aud: 'authenticated',
          role: 'authenticated',
          email,
          phone: '',
          confirmation_sent_at: new Date().toISOString(),
          email_confirmed_at: null,
          confirmed_at: null,
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { display_name: displayName },
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        }),
      })
    })

    await page.goto('/login')
    await page.getByRole('button', { name: '新規登録' }).click()

    await page.locator('input').nth(0).fill('QA')
    await page.locator('input').nth(1).fill(`登録${suffix}`)
    await page.locator('input').nth(2).fill('確認')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await screenshot(page, 'gap12-register-form-filled.png')

    await page.getByRole('button', { name: '確認コードを送る' }).click()

    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('main')).toContainText('確認コードを送信しました。')
    await expect(page.getByRole('button', { name: 'コード入力へ進む' })).toBeVisible()
    await expect(page.locator('input[placeholder="123456"]')).toHaveCount(0)
    expect(signupRequest).toBeDefined()
    expect(signupRequest?.email).toBe(email)
    expect(signupRequest?.password).toBe(password)
    expect(signupRequest?.data?.display_name).toBe(displayName)
    expect(decodeURIComponent(signupUrl)).toContain('/auth/callback')
    await screenshot(page, 'gap12-after-signup-request.png')

    await page.getByRole('button', { name: 'コード入力へ進む' }).click()
    await expect(page.locator('main')).toContainText(`${email} に届いた6桁の確認コードを入力してください。`)
    await expect(page.locator('input[placeholder="123456"]')).toBeVisible()

    await page.locator('input[placeholder="123456"]').fill('123')
    await page.getByRole('button', { name: '登録を完了する' }).click()
    await expect(page.locator('main')).toContainText('6桁の確認コードを入力してください')
    await screenshot(page, 'gap12-verification-step-validation.png')
  })
})
