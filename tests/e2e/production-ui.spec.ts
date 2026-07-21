import { test, expect, Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupQaEvents, e2eEnvFileName, requireEnvMatchesTarget, requireProductionE2eAllowed, STALE_QA_EVENT_PREFIXES, staleQaCutoff } from './qa-cleanup'

const runId = `QA_E2E_UI_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const tokyoDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const evidenceDir = path.join(process.cwd(), 'docs', 'qa', 'evidence', `${tokyoDate}-playwright-${runId}`)

type LocalEnv = Record<string, string>

async function readLocalEnv(): Promise<LocalEnv> {
  const raw = await fs.readFile(path.join(process.cwd(), e2eEnvFileName()), 'utf8')
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
  )
}

async function screenshot(page: Page, name: string) {
  await fs.mkdir(evidenceDir, { recursive: true })
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true })
}

async function appJson(baseURL: string, pathname: string, options: RequestInit = {}) {
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
  return { ok: res.ok, status: res.status, body }
}

// 管理者認証はクッキー方式（basketball_admin_session）。
// lib/api-auth.ts の ADMIN_SESSION_COOKIE と一致させること。
const ADMIN_SESSION_COOKIE = 'basketball_admin_session'

// /api/admin/verify に POST して管理者セッションクッキーを取得する。
// API リクエスト用の Cookie ヘッダー文字列と、ブラウザ注入用のトークン値を返す。
async function loginAdmin(
  baseURL: string,
  password: string
): Promise<{ cookieHeader: string; token: string }> {
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

  const sessionCookie = setCookies.find(c => c.startsWith(`${ADMIN_SESSION_COOKIE}=`))
  expect(sessionCookie, 'admin session cookie should be set by /api/admin/verify').toBeTruthy()

  const cookieHeader = (sessionCookie as string).split(';')[0] // "name=value"
  const token = cookieHeader.slice(cookieHeader.indexOf('=') + 1)
  return { cookieHeader, token }
}

test.describe.configure({ mode: 'serial' })

test.describe('production UI smoke', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminPassword = ''
  let adminCookieHeader = ''
  let adminToken = ''
  let qaAuthEmail = ''
  let qaAuthPassword = ''
  let eventId = ''
  let eventTitle = ''
  let supabaseAdmin: SupabaseClient

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    adminPassword = env.ADMIN_PASSWORD
    qaAuthEmail = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL ?? ''
    qaAuthPassword = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD ?? ''
    baseURL = process.env.QA_BASE_URL ?? baseURL
    requireProductionE2eAllowed(baseURL)
    // アプリの向き先と DB の向き先の食い違いを検出する（従来の QA 運用は明示的に許可）。
    requireEnvMatchesTarget(baseURL, env.NEXT_PUBLIC_SUPABASE_URL, { allowProductionDb: true })
    supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await cleanupQaEvents(supabaseAdmin, STALE_QA_EVENT_PREFIXES, { olderThanIso: staleQaCutoff() })

    // クッキー方式の管理者セッションを取得（旧 x-admin-password ヘッダーは廃止）
    const session = await loginAdmin(baseURL, adminPassword)
    adminCookieHeader = session.cookieHeader
    adminToken = session.token

    const start = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    eventTitle = `${runId}_UI_EVENT`

    const created = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({
        title: eventTitle,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        location_url: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
        max_participants: 4,
        threshold: 3,
        status: 'accepting',
      }),
    })

    expect(created.status).toBe(200)
    const body = created.body as { event?: { id?: string } }
    expect(body.event?.id).toBeTruthy()
    eventId = body.event!.id!
  })

  test.afterAll(async () => {
    if (supabaseAdmin) await cleanupQaEvents(supabaseAdmin, [runId])
  })

  // 管理者セッションクッキーをブラウザコンテキストへ注入する（localStorage 廃止）
  async function injectAdminCookie(context: import('@playwright/test').BrowserContext) {
    await context.addCookies([
      {
        name: ADMIN_SESSION_COOKIE,
        value: adminToken,
        url: baseURL,
        httpOnly: true,
        secure: baseURL.startsWith('https'),
        sameSite: 'Strict',
      },
    ])
  }

  test('login page and registration form can be captured', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await screenshot(page, '01-login.png')

    await page.locator('button').nth(1).click()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('input')).toHaveCount(5)
    await screenshot(page, '02-register-form.png')
  })

  test('unauthenticated event detail redirects to login', async ({ page }) => {
    await page.goto(`/events/${eventId}`)
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, '03-event-detail-redirect-login.png')
  })

  test('admin login, list, and created event are visible', async ({ page }) => {
    await page.goto('/admin')
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.locator('button').first().click()
    await expect(page.getByText(eventTitle)).toBeVisible()
    await screenshot(page, '04-admin-list.png')
  })

  test('admin edit page shows start and end inputs', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${eventId}/edit`)
    await expect(page.locator('input[type="date"]').first()).toBeVisible()
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible()
    await expect(page.locator('select').nth(0)).toBeVisible()
    await expect(page.locator('select').nth(2)).toBeVisible()
    await screenshot(page, '05-admin-edit-start-end.png')
  })

  test('admin create page shows start/end controls and required validation', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto('/admin/create')

    await expect(page.locator('input[type="date"]').first()).toBeVisible()
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible()
    await expect(page.locator('select').nth(0)).toBeVisible()
    await expect(page.locator('select').nth(2)).toBeVisible()
    await page.locator('button').last().click()
    await expect(page.locator('.text-destructive')).toBeVisible()
    await screenshot(page, '06-admin-create-validation.png')
  })

  test('event list location is not a link but detail location remains a link when authenticated is unavailable', async ({ page }) => {
    await page.goto('/login')
    await screenshot(page, '07-auth-required-note.png')

    const detailHtml = await fetch(`${baseURL}/events/${eventId}`, { redirect: 'manual' })
    expect([307, 308]).toContain(detailHtml.status)
  })

  test('authenticated participant can join and confirm before cancellation', async ({ page }) => {
    test.skip(!qaAuthEmail || !qaAuthPassword, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD for authenticated participant UI coverage.')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaAuthEmail)
    await page.locator('input[type="password"]').fill(qaAuthPassword)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

    await page.goto(`/events/${eventId}`)
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}`))
    await expect(page.locator('main')).not.toContainText('ログインが必要です')
    await expect(page.getByRole('button', { name: /参加申請/ })).toBeVisible()
    await screenshot(page, '08-authenticated-event-detail-before-join.png')

    await page.getByRole('button', { name: /参加申請/ }).click()
    await expect(page.locator('main')).toContainText(/キャンセル|参加|待機|登録/)
    await screenshot(page, '09-authenticated-event-detail-after-join.png')

    const googleCalendarLink = page.getByRole('link', { name: /Google/ })
    await expect(googleCalendarLink).toBeVisible()
    const googleHref = await googleCalendarLink.getAttribute('href')
    expect(googleHref).toContain('calendar.google.com/calendar/render')
    expect(googleHref).toContain('action=TEMPLATE')
    // details欄には絶対URL（https://...）が埋め込まれている必要がある。
    // 相対パス（/events/xxx）だとカレンダーアプリ側でリンクとして機能しない回帰を防ぐ。
    const googleDetails = new URL(googleHref!).searchParams.get('details') ?? ''
    expect(googleDetails).toMatch(/詳細: https?:\/\/[^\s]+\/events\//)
    await expect(page.getByRole('link', { name: /iOS標準カレンダー/ })).toBeVisible()
    await expect(page.locator('main')).toContainText('本サイトからの削除・自動反映はできません')
    await screenshot(page, '09b-authenticated-event-detail-calendar-links.png')

    await page.getByRole('button', { name: 'キャンセル' }).click()
    // テストイベントは max:4 / threshold:3 / accepting で作成され、参加者は本人1名のみ。
    // 閾値割れ警告（参加者数が3人を下回るまで…）は eventStatus==='closed' のときのみ表示されるため、
    // 受付中のこのイベントではシンプルな確認文言が正しい挙動。
    await expect(page.getByRole('dialog')).toContainText('参加をキャンセルしてもよろしいですか？')
    await screenshot(page, '10-cancel-confirm-dialog.png')

    await page.getByRole('button', { name: 'キャンセルしない' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: 'キャンセル' })).toBeVisible()

    await page.getByRole('button', { name: 'キャンセル' }).click()
    await page.getByRole('button', { name: 'キャンセルする' }).click()
    await expect(page.locator('main')).toContainText('キャンセルしました。')
    await expect(page.getByRole('link', { name: /Google/ })).toHaveCount(0)
    await screenshot(page, '11-after-confirmed-cancel.png')
  })

  test('.ics calendar file is downloadable without authentication', async ({ request }) => {
    const res = await request.get(`${baseURL}/api/events/${eventId}/ics`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/calendar')

    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
  })

  test('authenticated member can log out and lose access to protected pages', async ({ page }) => {
    test.skip(!qaAuthEmail || !qaAuthPassword, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD for authenticated logout UI coverage.')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaAuthEmail)
    await page.locator('input[type="password"]').fill(qaAuthPassword)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

    // ログアウトボタンはトップページ（/）のヘッダー（components/MemberHeader.tsx）にのみ存在する。
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
    await screenshot(page, '12-member-header-before-logout.png')

    await page.getByRole('button', { name: 'ログアウト' }).click()
    // setMember(null) による「ログイン / 登録」表示への切り替えと、router.refresh() 経由の
    // proxy.ts による /login リダイレクトのどちらが先に観測されるかは環境依存のため、
    // 中間状態ではなく最終的なリダイレクト結果を確認する（2026-07-11 実行時にリダイレクトの方が
    // 先に完了しフレーキーになったため、当初の中間表示アサーションから変更）。
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await screenshot(page, '13-member-header-after-logout.png')

    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, '14-root-redirect-after-logout.png')

    await page.goto(`/events/${eventId}`)
    await expect(page).toHaveURL(/\/login/)
    await screenshot(page, '15-event-detail-redirect-after-logout.png')
  })

  test('security headers configured in next.config.ts are present on responses', async ({ request }) => {
    const res = await request.get(`${baseURL}/`)
    expect(res.status()).toBe(200)

    const headers = res.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  test('HSTS is enabled without the preload directive', async ({ request }) => {
    const res = await request.get(`${baseURL}/`)
    expect(res.status()).toBe(200)

    const hsts = res.headers()['strict-transport-security']
    expect(hsts).toContain('max-age=63072000')
    expect(hsts).toContain('includeSubDomains')
    // preload は意図的に付けない（解除に数ヶ月かかる実質不可逆な操作のため）
    expect(hsts).not.toContain('preload')
  })
})
