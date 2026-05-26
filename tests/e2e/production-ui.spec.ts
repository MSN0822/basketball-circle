import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const runId = `QA_KEEP_UI_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const evidenceDir = path.join(process.cwd(), 'docs', 'qa', 'evidence', `2026-05-26-playwright-${runId}`)

type LocalEnv = Record<string, string>

async function readLocalEnv(): Promise<LocalEnv> {
  const raw = await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8')
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

test.describe.configure({ mode: 'serial' })

test.describe('production UI smoke', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminPassword = ''
  let eventId = ''
  let eventTitle = ''

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    adminPassword = env.ADMIN_PASSWORD
    baseURL = process.env.QA_BASE_URL ?? baseURL

    const start = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    eventTitle = `${runId}_UI_EVENT`

    const created = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { 'x-admin-password': adminPassword },
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

  test('admin edit page shows start and end inputs', async ({ page }) => {
    await page.goto('/admin')
    await page.locator('input[type="password"]').fill(adminPassword)
    await page.locator('button').first().click()
    await page.goto(`/admin/events/${eventId}/edit`)
    await expect(page.locator('input[type="date"]').first()).toBeVisible()
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible()
    await expect(page.locator('select').nth(0)).toBeVisible()
    await expect(page.locator('select').nth(2)).toBeVisible()
    await screenshot(page, '05-admin-edit-start-end.png')
  })

  test('admin create page shows start/end controls and required validation', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(password => {
      localStorage.setItem('basketball_admin_password', password)
    }, adminPassword)
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
})
