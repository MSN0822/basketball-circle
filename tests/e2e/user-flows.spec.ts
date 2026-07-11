import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cleanupQaEvents, requireProductionE2eAllowed, STALE_QA_EVENT_PREFIXES, staleQaCutoff } from './qa-cleanup'

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

async function loginQaUser(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button').last().click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })
}

async function injectAdminCookie(context: BrowserContext, cookieHeader: string, url: string) {
  const token = cookieHeader.slice(cookieHeader.indexOf('=') + 1)
  await context.addCookies([{
    name: ADMIN_SESSION_COOKIE,
    value: token,
    url,
    httpOnly: true,
    secure: url.startsWith('https'),
    sameSite: 'Strict',
  }])
}

async function insertActiveParticipants(
  supabase: SupabaseClient,
  eventId: string,
  entries: { name: string; slot: number; userCode: string }[]
) {
  const { error } = await supabase.from('participants').insert(
    entries.map(entry => ({
      event_id: eventId,
      name: entry.name,
      user_code: entry.userCode,
      status: 'active',
      slot_number: entry.slot,
      member_id: null,
    }))
  )
  expect(error).toBeNull()
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
  let capacityEventId = ''
  let capacityEventTitle = ''
  let qaMember: MemberRow | null = null
  let originalMemberName = ''
  let supabaseAdmin: SupabaseClient

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    baseURL = process.env.QA_BASE_URL ?? baseURL
    requireProductionE2eAllowed(baseURL)
    qaEmail = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL ?? ''
    qaPassword = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD ?? ''
    supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await cleanupQaEvents(supabaseAdmin, STALE_QA_EVENT_PREFIXES, { olderThanIso: staleQaCutoff() })

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
    if (supabaseAdmin) await cleanupQaEvents(supabaseAdmin, [runId])
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
    // 本人は参加していない状態なので、Googleカレンダーへのリンクは表示されない仕様。
    await expect(page.getByRole('link', { name: /Google/ })).toHaveCount(0)
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

  test('[定員E2E-1] event auto-closes and shows the closed badge once it fills up', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const capacityEvent = await createAdminEvent(baseURL, adminCookieHeader, 'CAPACITY', {
      max_participants: 2,
      threshold: 1,
    })
    capacityEventId = capacityEvent.id
    capacityEventTitle = capacityEvent.title

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${capacityEventId}`)

    // QA本人が1枠目に参加する
    await page.getByRole('button', { name: '参加申請する' }).click()
    await expect(page.locator('main')).toContainText('参加登録が完了しました。', { timeout: 10_000 })

    // 友達招待でちょうど定員(2)まで埋める → join_event RPC が自動的にstatus='closed'にする
    await page.getByRole('button', { name: '友達入力欄を追加' }).click()
    const guestInput = page.locator('input[placeholder*="友達"]').first()
    await guestInput.fill(`${runId} Capacity Filler`)
    await guestInput.locator('xpath=..').getByRole('button', { name: '追加' }).click()
    await expect(page.locator('main')).toContainText('友達を追加しました', { timeout: 10_000 })

    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('events')
        .select('status')
        .eq('id', capacityEventId)
        .single()
      if (error) throw error
      return data?.status
    }, { timeout: 20_000 }).toBe('closed')

    await expect(page.getByText('締め切り済み')).toBeVisible({ timeout: 15_000 })
    await screenshot(page, 'capacity-e2e-1-detail-closed.png')

    await page.goto('/')
    const listCard = page.locator('div.cursor-pointer', { hasText: capacityEventTitle })
    await expect(listCard.getByText('締め切り済み')).toBeVisible({ timeout: 15_000 })
    await screenshot(page, 'capacity-e2e-1-list-closed.png')
  })

  test('[定員E2E-2] cancelling below the threshold auto-reopens with max_participants set to threshold', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')
    test.skip(!capacityEventId, '定員E2E-1 が未実行のためスキップ')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${capacityEventId}`)

    // 1人目（本人）キャンセル: active 2→1。閾値(1)をまだ下回らないので締切のまま。
    await page.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page.getByRole('dialog')).toContainText('キャンセルしてもよろしいですか', { timeout: 10_000 })
    await page.getByRole('button', { name: 'キャンセルする' }).click()
    await expect(page.locator('main')).toContainText('キャンセルしました。', { timeout: 10_000 })

    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('events')
        .select('status')
        .eq('id', capacityEventId)
        .single()
      if (error) throw error
      return data?.status
    }, { timeout: 10_000 }).toBe('closed')

    // 2人目（友達）キャンセル: active 1→0。閾値(1)を下回るので自動再開する。
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.locator('main')).toContainText('さんをキャンセルしました。', { timeout: 10_000 })

    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('events')
        .select('status,max_participants')
        .eq('id', capacityEventId)
        .single()
      if (error) throw error
      return data
    }, { timeout: 20_000 }).toMatchObject({ status: 'accepting', max_participants: 1 })

    await expect(page.getByText('申請受付中')).toBeVisible({ timeout: 15_000 })
    await screenshot(page, 'capacity-e2e-2-reopened.png')
  })

  test('[定員E2E-3] a manually closed event does not auto-reopen when cancellations drop below threshold', async () => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const manualCloseEvent = await createAdminEvent(baseURL, adminCookieHeader, 'MANUAL_CLOSE', {
      max_participants: 5,
      threshold: 3,
    })

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('participants')
      .insert([1, 2, 3].map(slot => ({
        event_id: manualCloseEvent.id,
        name: `${runId} ManualClose ${slot}`,
        user_code: `${runId}-manual-close-${slot}`,
        status: 'active',
        slot_number: slot,
        member_id: null,
      })))
      .select('id')
    expect(insertError).toBeNull()

    const closeRes = await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: manualCloseEvent.id, status: 'closed' }),
    })
    expect(closeRes.status).toBe(200)

    const { data: beforeCancel } = await supabaseAdmin
      .from('events')
      .select('is_manual_close')
      .eq('id', manualCloseEvent.id)
      .single()
    expect(beforeCancel?.is_manual_close).toBe(true)

    // active を 3→2 に落とす（閾値3を下回るが、手動締切なので再開しないはず）
    const cancelRes = await appJson(baseURL, '/api/cancel', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ participant_id: inserted![0].id, admin: true }),
    })
    expect(cancelRes.status).toBe(200)

    const { data: afterCancel, error: afterError } = await supabaseAdmin
      .from('events')
      .select('status,is_manual_close,max_participants')
      .eq('id', manualCloseEvent.id)
      .single()
    expect(afterError).toBeNull()
    expect(afterCancel?.status).toBe('closed')
    expect(afterCancel?.is_manual_close).toBe(true)
    expect(afterCancel?.max_participants).toBe(5)
  })

  test('[繰上E2E-1] cancelling the first participant renumbers the remaining slots', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const renumberEvent = await createAdminEvent(baseURL, adminCookieHeader, 'RENUMBER', {
      max_participants: 5,
      threshold: 2,
    })

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('participants')
      .insert([1, 2, 3].map(slot => ({
        event_id: renumberEvent.id,
        name: `${runId} Renumber ${slot}`,
        user_code: `${runId}-renumber-${slot}`,
        status: 'active',
        slot_number: slot,
        member_id: null,
      })))
      .select('id,slot_number')
    expect(insertError).toBeNull()

    const firstParticipant = inserted!.find(p => p.slot_number === 1)
    const cancelRes = await appJson(baseURL, '/api/cancel', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ participant_id: firstParticipant!.id, admin: true }),
    })
    expect(cancelRes.status).toBe(200)

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${renumberEvent.id}`)

    await expect(page.locator('main')).toContainText(`1.${runId} Renumber 2`, { timeout: 15_000 })
    await expect(page.locator('main')).toContainText(`2.${runId} Renumber 3`, { timeout: 15_000 })
    await screenshot(page, 'renumber-e2e-1-after-cancel.png')
  })

  test('[並行E2E-1] concurrent joins for the last remaining slot let exactly one request succeed', async () => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const raceEvent = await createAdminEvent(baseURL, adminCookieHeader, 'RACE', {
      max_participants: 5,
      threshold: 2,
    })

    await insertActiveParticipants(supabaseAdmin, raceEvent.id, [1, 2, 3, 4].map(slot => ({
      name: `${runId} Race Filler ${slot}`,
      slot,
      userCode: `${runId}-race-filler-${slot}`,
    })))

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => appJson(baseURL, '/api/participants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${qaToken}` },
        body: JSON.stringify({
          event_id: raceEvent.id,
          name: `${runId} Race Guest ${i}`,
          member_id: qaMember!.id,
          guest: true,
        }),
      }))
    )

    const successCount = attempts.filter(res => res.status === 200).length
    const conflictCount = attempts.filter(res => res.status === 409).length
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(4)

    const { data: activeParticipants, error: countError } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('event_id', raceEvent.id)
      .eq('status', 'active')
    expect(countError).toBeNull()
    expect(activeParticipants?.length).toBe(5)
  })

  test('[並行E2E-2] a join made in one browser context appears in another within the polling window', async ({ page, browser }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const realtimeEvent = await createAdminEvent(baseURL, adminCookieHeader, 'REALTIME')
    const guestName = `${runId} Realtime Guest`

    const secondContext = await browser.newContext()
    const secondPage = await secondContext.newPage()
    try {
      await loginQaUser(secondPage, qaEmail, qaPassword)
      await secondPage.goto(`/events/${realtimeEvent.id}`)
      await expect(secondPage.locator('main')).not.toContainText(guestName)

      await loginQaUser(page, qaEmail, qaPassword)
      await page.goto(`/events/${realtimeEvent.id}`)
      await page.getByRole('button', { name: '友達入力欄を追加' }).click()
      const guestInput = page.locator('input[placeholder*="友達"]').first()
      await guestInput.fill(guestName)
      await guestInput.locator('xpath=..').getByRole('button', { name: '追加' }).click()
      await expect(page.locator('main')).toContainText('友達を追加しました', { timeout: 10_000 })

      await expect(secondPage.locator('main')).toContainText(guestName, { timeout: 20_000 })
      await screenshot(secondPage, 'concurrent-e2e-2-second-context-sees-join.png')
    } finally {
      await secondContext.close()
    }
  })

  test('[名前E2E-1] renaming a member propagates to the event roster', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const nameChangeEvent = await createAdminEvent(baseURL, adminCookieHeader, 'NAME_CHANGE')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${nameChangeEvent.id}`)
    await page.getByRole('button', { name: '参加申請する' }).click()
    await expect(page.locator('main')).toContainText('参加登録が完了しました。', { timeout: 10_000 })

    const newNickname = `NameE2E${runId.slice(-6)}`
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'ニックネーム変更' })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'ニックネーム変更' }).click()
    await page.locator('input[placeholder="ニックネーム"]').fill(newNickname)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('main')).toContainText(newNickname, { timeout: 10_000 })

    // members.name は「本名(ニックネーム)」の複合形式で保存される（components/MemberHeader.tsx:69）。
    // participants.name も update_member_name RPC 経由で同じ複合値がセットされるため、完全一致ではなく含有で確認する。
    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('participants')
        .select('name')
        .eq('event_id', nameChangeEvent.id)
        .eq('status', 'active')
        .maybeSingle()
      if (error) throw error
      return data?.name ?? ''
    }, { timeout: 15_000 }).toContain(newNickname)

    await page.goto(`/events/${nameChangeEvent.id}`)
    await expect(page.locator('main')).toContainText(newNickname, { timeout: 15_000 })
    await screenshot(page, 'name-e2e-1-roster-updated.png')
  })

  test('[draft-E2E-1] admin can see a draft event in the drafts section and publish it immediately', async ({ page, context }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const draftEvent = await createAdminEvent(baseURL, adminCookieHeader, 'DRAFT_VISIBILITY', {
      status: 'draft',
    })

    await injectAdminCookie(context, adminCookieHeader, baseURL)
    await page.goto('/admin')

    const draftSection = page.locator('h2', { hasText: '下書き' }).locator('xpath=..')
    await expect(draftSection).toContainText(draftEvent.title, { timeout: 10_000 })
    await screenshot(page, 'draft-e2e-1-listed-in-drafts.png')

    await page.getByText(draftEvent.title).click()
    await expect(page).toHaveURL(new RegExp(`/admin/events/${draftEvent.id}`))
    await expect(page.getByText('下書き')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '今すぐ公開' })).toBeVisible()

    await page.getByRole('button', { name: '今すぐ公開' }).click()
    await expect(page.getByRole('button', { name: '締め切る' })).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'draft-e2e-1-published.png')

    await page.goto('/admin')
    const draftHeading = page.locator('h2', { hasText: '下書き' })
    if (await draftHeading.count() > 0) {
      await expect(draftHeading.locator('xpath=..')).not.toContainText(draftEvent.title)
    }
    await expect(page.getByText(draftEvent.title)).toBeVisible({ timeout: 10_000 })
  })

  test('[draft-E2E-2] a due publishes_at auto-promotes a draft when a member visits the site', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const pastPublishAt = new Date(Date.now() - 60_000).toISOString()
    const scheduledEvent = await createAdminEvent(baseURL, adminCookieHeader, 'DUE_PUBLISH', {
      status: 'draft',
      publishes_at: pastPublishAt,
    })

    const { data: beforeVisit } = await supabaseAdmin
      .from('events')
      .select('status')
      .eq('id', scheduledEvent.id)
      .single()
    expect(beforeVisit?.status).toBe('draft')

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto('/')

    await expect.poll(async () => {
      const { data, error } = await supabaseAdmin
        .from('events')
        .select('status')
        .eq('id', scheduledEvent.id)
        .single()
      if (error) throw error
      return data?.status
    }, { timeout: 10_000 }).toBe('accepting')

    await expect(page.getByText(scheduledEvent.title)).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'draft-e2e-2-auto-published.png')
  })

  test('[draft-E2E-3] visiting a draft event detail URL directly returns 404', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const hiddenDraft = await createAdminEvent(baseURL, adminCookieHeader, 'DRAFT_404', {
      status: 'draft',
    })

    await loginQaUser(page, qaEmail, qaPassword)
    const response = await page.goto(`/events/${hiddenDraft.id}`)
    expect(response?.status()).toBe(404)
    await screenshot(page, 'draft-e2e-3-direct-url-404.png')
  })

  test('[分岐E2E-1] a non-participant sees a disabled join button and guidance text on a closed event', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const closedNoJoinEvent = await createAdminEvent(baseURL, adminCookieHeader, 'CLOSED_NO_JOIN', {
      status: 'closed',
      max_participants: 3,
      threshold: 2,
    })

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${closedNoJoinEvent.id}`)

    await expect(page.getByRole('button', { name: '参加申請する' })).toBeDisabled({ timeout: 10_000 })
    await expect(page.locator('main')).toContainText(
      '現在は参加申請を受け付けていません。参加済みの友達がいる場合は、この画面からキャンセルできます。'
    )
    await screenshot(page, 'branch-e2e-1-disabled-join.png')
  })

  test('[分岐E2E-2] joining an event twice via the API directly returns 409', async () => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const res = await appJson(baseURL, '/api/participants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${qaToken}` },
      body: JSON.stringify({
        event_id: closedEventId,
        name: qaMember!.name,
        member_id: qaMember!.id,
        guest: false,
      }),
    })
    expect(res.status).toBe(409)
  })

  test('[分岐E2E-3] the guest input add button is capped at the remaining slot count', async ({ page }) => {
    test.skip(!qaReady, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    const oneSlotLeftEvent = await createAdminEvent(baseURL, adminCookieHeader, 'ONE_SLOT_LEFT', {
      max_participants: 3,
      threshold: 2,
    })
    await insertActiveParticipants(supabaseAdmin, oneSlotLeftEvent.id, [1, 2].map(slot => ({
      name: `${runId} OneSlot Filler ${slot}`,
      slot,
      userCode: `${runId}-one-slot-filler-${slot}`,
    })))

    await loginQaUser(page, qaEmail, qaPassword)
    await page.goto(`/events/${oneSlotLeftEvent.id}`)

    const addButton = page.getByRole('button', { name: '友達入力欄を追加' })
    await expect(addButton).toBeEnabled({ timeout: 10_000 })
    await addButton.click()
    await expect(page.locator('input[placeholder*="友達"]')).toHaveCount(1)
    await expect(addButton).toBeDisabled()
    await screenshot(page, 'branch-e2e-3-guest-input-capped.png')
  })
})
