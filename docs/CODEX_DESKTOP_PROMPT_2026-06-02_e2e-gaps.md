# E2E テストカバレッジ補完タスク — Playwright（2026-06-02）

## このプロンプトの概要

Workflow カバレッジ監査（73件ギャップ）のうち、**E2E（ブラウザ操作）ギャップ 17件**を Playwright で補完する。
ユニットテストは完了済み（9ファイル / 78テスト PASS）。今回は UI 操作レベルのテストのみ。

| フェーズ | 内容 | 必要な前提 |
|---|---|---|
| フェーズ1（管理者フロー） | GAP-09/10/06/04/05/03/02 — 7件 | 管理者パスワードのみ |
| フェーズ2（ユーザーフロー） | GAP-08/01/07/13 — 4件 | QA 認証情報（QA_AUTH_EMAIL/QA_AUTH_PASSWORD） |
| フェーズ3（複合・記録） | GAP-11/15/16/17 — 4件 | 状況次第（下記参照） |
| スキップ | GAP-12（会員登録）、GAP-14（レート制限） | 本番副作用・本番ロックアウトリスクがあるため保留 |

---

## 大前提・作業ルール

1. **コード変更前に必ず既存ファイルを読むこと**
2. **`tests/e2e/production-ui.spec.ts` を必ず全部読んでから実装すること**（パターン・ヘルパー関数の流用）
3. **`playwright.config.ts` を読んで設定を把握すること**
4. **git commit / push はしない（差分提示のみ）**
5. **既存テストを上書きしない（新ファイル作成のみ）**
6. **テストで作成したデータは afterAll で必ず削除する**
7. **本番 URL: `https://basketball-circle.vercel.app`**

---

## ステップ0: 既存ファイルを読む（必須）

```
tests/e2e/production-ui.spec.ts   ← パターン・ヘルパー全体を把握
playwright.config.ts              ← baseURL / timeout / use 設定を確認
.env.local.example                ← 利用可能な環境変数を確認
```

**把握すべき既存パターン:**
- `loginAdmin(baseURL, password)` → `{ cookieHeader, token }` — 管理者セッション取得
- `injectAdminCookie(context)` — ブラウザに管理者 Cookie を注入
- `appJson(baseURL, pathname, options)` — API を Node.js fetch で呼ぶ
- `readLocalEnv()` — `.env.local` を読む
- `screenshot(page, name)` — エビデンス画像を保存
- `test.describe.configure({ mode: 'serial' })` — テストを直列実行
- `test.skip(!qaAuthEmail || !qaAuthPassword, '...')` — QA 認証情報がない場合はスキップ

---

## ステップ1（フェーズ1）: 管理者フロー

### 新規ファイル作成: `tests/e2e/admin-flows.spec.ts`

**全体構造:**

```typescript
import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

// --- 既存ファイルのヘルパーをそのままコピーして使うこと ---
// readLocalEnv / screenshot / appJson / loginAdmin / ADMIN_SESSION_COOKIE

const runId = `QA_E2E_ADMIN_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
// ...evidenceDir, screenshot, readLocalEnv, appJson, loginAdmin を既存ファイルから複製...

test.describe.configure({ mode: 'serial' })

test.describe('admin-flows E2E', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminPassword = ''
  let adminCookieHeader = ''
  let adminToken = ''
  let testEventId = ''
  let testEventTitle = ''

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    adminPassword = env.ADMIN_PASSWORD
    baseURL = process.env.QA_BASE_URL ?? baseURL

    const session = await loginAdmin(baseURL, adminPassword)
    adminCookieHeader = session.cookieHeader
    adminToken = session.token

    // テスト用イベントを1件作成（全テスト共用）
    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    testEventTitle = `${runId}_ADMIN_FLOW`

    const res = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({
        title: testEventTitle,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        max_participants: 5,
        threshold: 3,
        status: 'accepting',
      }),
    })
    expect(res.status).toBe(200)
    testEventId = (res.body as { event?: { id?: string } }).event!.id!
  })

  test.afterAll(async () => {
    // テストイベントを削除（後始末）
    await appJson(baseURL, '/api/admin/events', {
      method: 'DELETE',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: testEventId }),
    })
  })

  // 管理者 Cookie をブラウザへ注入するヘルパー
  async function injectAdminCookie(context: import('@playwright/test').BrowserContext) {
    await context.addCookies([{
      name: 'basketball_admin_session',
      value: adminToken,
      url: baseURL,
      httpOnly: true,
      secure: baseURL.startsWith('https'),
      sameSite: 'Strict',
    }])
  }

  // =================================================================
  // [GAP-09] 管理者 Cookie なしでサブページにアクセス → /admin にリダイレクト
  // =================================================================
  test('[GAP-09] admin subpage redirects to /admin without session cookie', async ({ page }) => {
    // Cookie を注入しない状態でサブページへアクセス
    await page.goto(`/admin/events/${testEventId}/edit`)
    // proxy.ts が /admin へリダイレクトするはず
    await expect(page).toHaveURL(/\/admin$/)
    await screenshot(page, 'gap09-subpage-redirect.png')
  })

  // =================================================================
  // [GAP-10] 管理者ログイン失敗時のエラーメッセージ表示
  // =================================================================
  test('[GAP-10] admin login shows error message on wrong password', async ({ page }) => {
    await page.goto('/admin')
    // Cookie を注入していないのでログインフォームが表示されるはず
    await expect(page.locator('input[type="password"]')).toBeVisible()

    await page.locator('input[type="password"]').fill('wrong-password-for-gap10-test')
    await page.getByRole('button').first().click()

    // 「パスワードが違います」などのエラーが表示されること
    await expect(page.locator('.text-destructive, [role="alert"]')).toBeVisible({ timeout: 5_000 })
    await screenshot(page, 'gap10-login-error.png')
  })

  // =================================================================
  // [GAP-06] 管理者ログアウト → Cookie クリア → 保護ページにアクセス → リダイレクト
  // =================================================================
  test('[GAP-06] admin logout clears session and protected pages redirect', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto('/admin')

    // ログアウトボタンをクリック
    const logoutBtn = page.getByRole('button', { name: /ログアウト|logout/i })
    await expect(logoutBtn).toBeVisible()
    await logoutBtn.click()
    await screenshot(page, 'gap06-after-logout.png')

    // ログアウト後はパスワード入力フォームが再表示される
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })

    // ログアウト後に保護ページへ直接アクセス → /admin にリダイレクト
    await page.goto(`/admin/events/${testEventId}/edit`)
    await expect(page).toHaveURL(/\/admin$/)
    await screenshot(page, 'gap06-post-logout-redirect.png')
  })

  // =================================================================
  // [GAP-04] 管理者イベントステータス切り替え（締め切る → 再開する）
  // =================================================================
  test('[GAP-04] admin can toggle event status between closed and accepting', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}`)
    await screenshot(page, 'gap04-before-toggle.png')

    // 「締め切る」ボタンをクリック
    const closeBtn = page.getByRole('button', { name: /締め切る/ })
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()

    // status が closed になること（「再開する」ボタンが現れる、またはバッジが変わる）
    await expect(page.getByRole('button', { name: /再開する/ })).toBeVisible({ timeout: 5_000 })
    await screenshot(page, 'gap04-after-close.png')

    // 「再開する」ボタンをクリック
    await page.getByRole('button', { name: /再開する/ }).click()

    // status が accepting に戻ること
    await expect(page.getByRole('button', { name: /締め切る/ })).toBeVisible({ timeout: 5_000 })
    await screenshot(page, 'gap04-after-reopen.png')
  })

  // =================================================================
  // [GAP-05] 管理者イベント編集（タイトル変更 → 保存）
  // =================================================================
  test('[GAP-05] admin can edit event title and save', async ({ page, context }) => {
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}/edit`)

    // タイトル入力欄に新しいタイトルを入力
    // ※ 既存テストより: date/select が複数あるのでタイトル input を特定する
    const titleInput = page.locator('input[type="text"]').first()
    await expect(titleInput).toBeVisible()
    const newTitle = `${testEventTitle}_EDITED`
    await titleInput.fill(newTitle)
    await screenshot(page, 'gap05-before-save.png')

    // 保存ボタンをクリック
    const saveBtn = page.getByRole('button', { name: /保存|更新|作成/ }).last()
    await saveBtn.click()

    // 成功後: 詳細ページへ遷移するか、成功メッセージが表示される
    // パターン1: URL が /admin/events/:id になる
    // パターン2: 変更後のタイトルが画面に表示される
    await expect(
      page.getByText(newTitle).or(page.locator('[role="status"], .text-green, .toast'))
    ).toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap05-after-save.png')

    // testEventTitle を更新（後続テストで参照する場合のため）
    testEventTitle = newTitle
  })

  // =================================================================
  // [GAP-03] 管理者イベント削除フロー（専用イベントを作成 → 削除 → 一覧から消える）
  // =================================================================
  test('[GAP-03] admin can delete an event and it disappears from list', async ({ page, context }) => {
    // 削除専用の別イベントを作成（testEventId を削除しないよう注意）
    const deleteStart = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000)
    const deleteEnd = new Date(deleteStart.getTime() + 2 * 60 * 60 * 1000)
    const deleteTitle = `${runId}_DELETE_TARGET`
    const created = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({
        title: deleteTitle,
        event_date: deleteStart.toISOString(),
        event_end_date: deleteEnd.toISOString(),
        location: `${runId} Gym`,
        max_participants: 3,
        threshold: 2,
        status: 'accepting',
      }),
    })
    expect(created.status).toBe(200)
    const deleteEventId = (created.body as { event?: { id?: string } }).event!.id!

    await injectAdminCookie(context)
    await page.goto(`/admin/events/${deleteEventId}`)
    await expect(page.getByText(deleteTitle)).toBeVisible()

    // 「イベント削除」ボタンをクリック
    const deleteBtn = page.getByRole('button', { name: /イベント削除/ })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()
    await screenshot(page, 'gap03-delete-confirm.png')

    // 確認ダイアログの「実行」をクリック
    const confirmBtn = page.getByRole('button', { name: /実行|削除する|はい/ })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    // /admin にリダイレクトされ、削除したイベントタイトルが消える
    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 })
    await expect(page.getByText(deleteTitle)).not.toBeVisible()
    await screenshot(page, 'gap03-after-delete.png')
  })

  // =================================================================
  // [GAP-02] 管理者強制キャンセルフロー
  // （参加者を API で追加 → 管理者画面で強制キャンセル → 参加者リストから消える）
  // ※ QA_AUTH_EMAIL が設定されている場合のみ実行
  // =================================================================
  test('[GAP-02] admin can force-cancel a participant', async ({ page, context }) => {
    const env = await readLocalEnv()
    const qaEmail = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL ?? ''
    const qaPass = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD ?? ''
    test.skip(!qaEmail || !qaPass, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD to run this test.')

    // QA ユーザーで Supabase Auth にサインインして Bearer トークンを取得
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data: session, error } = await supabase.auth.signInWithPassword({ email: qaEmail, password: qaPass })
    expect(error).toBeNull()
    const token = session.session!.access_token
    const memberId = (await appJson(baseURL, '/api/members', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })).body as { member?: { id: string; name: string } } | null
    // ※ GET /api/members が存在しない場合は supabase.from('members').select() で直接取得する

    // 参加申請
    const joinRes = await appJson(baseURL, '/api/participants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        event_id: testEventId,
        name: 'QA参加者（強制キャンセルテスト用）',
        member_id: (memberId as { member?: { id: string } })?.member?.id ?? null,
        guest: false,
      }),
    })
    // 参加済みの場合は 409 になる可能性があるため、200 か 409 を許容
    expect([200, 409]).toContain(joinRes.status)
    await screenshot(page, 'gap02-before-admin-view.png')

    // 管理者で強制キャンセル
    await injectAdminCookie(context)
    await page.goto(`/admin/events/${testEventId}`)
    await screenshot(page, 'gap02-admin-event-detail.png')

    // 参加者リストに「強制キャンセル」ボタンが表示されること
    const forceCancelBtn = page.getByRole('button', { name: /強制キャンセル/ }).first()
    await expect(forceCancelBtn).toBeVisible({ timeout: 5_000 })
    await forceCancelBtn.click()
    await screenshot(page, 'gap02-force-cancel-confirm.png')

    // 確認ダイアログの「実行」をクリック
    const confirmBtn = page.getByRole('button', { name: /実行|キャンセルする/ })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    // 参加者数が減るか、参加者名が消えること
    await expect(page.getByRole('button', { name: /強制キャンセル/ })).not.toBeVisible({ timeout: 10_000 })
    await screenshot(page, 'gap02-after-force-cancel.png')
  })
})
```

---

## ステップ2（フェーズ2）: ユーザーフロー

### 新規ファイル作成: `tests/e2e/user-flows.spec.ts`

QA 認証情報（`QA_AUTH_EMAIL` / `QA_AUTH_PASSWORD`）が必要なテスト群。

```typescript
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'

// --- 既存ファイルのヘルパーをコピーして使うこと ---
// readLocalEnv / screenshot / appJson / loginAdmin

const runId = `QA_E2E_USER_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
// ...evidenceDir, screenshot 等を既存ファイルから複製...

test.describe.configure({ mode: 'serial' })

test.describe('user-flows E2E', () => {
  let baseURL = 'https://basketball-circle.vercel.app'
  let adminCookieHeader = ''
  let adminToken = ''
  let qaEmail = ''
  let qaPass = ''
  let qaToken = ''
  let testEventId = ''
  let testEventTitle = ''
  // 閾値割れ警告テスト用（status='closed' のイベント）
  let closedEventId = ''

  test.beforeAll(async () => {
    const env = await readLocalEnv()
    qaEmail = process.env.QA_AUTH_EMAIL ?? env.QA_AUTH_EMAIL ?? ''
    qaPass = process.env.QA_AUTH_PASSWORD ?? env.QA_AUTH_PASSWORD ?? ''
    baseURL = process.env.QA_BASE_URL ?? baseURL

    if (!qaEmail || !qaPass) return // QA 認証情報なしの場合は全テストスキップ

    // 管理者セッション取得
    const session = await loginAdmin(baseURL, env.ADMIN_PASSWORD)
    adminCookieHeader = session.cookieHeader
    adminToken = session.token

    // QA ユーザーで Supabase Auth にサインイン
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data, error } = await supabase.auth.signInWithPassword({ email: qaEmail, password: qaPass })
    expect(error).toBeNull()
    qaToken = data.session!.access_token

    // 受付中テストイベント作成（max:4, threshold:3）
    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    testEventTitle = `${runId}_USER_FLOW`
    const created = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({
        title: testEventTitle,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        max_participants: 4,
        threshold: 3,
        status: 'accepting',
      }),
    })
    expect(created.status).toBe(200)
    testEventId = (created.body as { event?: { id?: string } }).event!.id!

    // 閾値割れ警告テスト用: 手動 closed イベント（max:2, threshold:2）
    const closedCreated = await appJson(baseURL, '/api/admin/events', {
      method: 'POST',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({
        title: `${runId}_CLOSED_FOR_WARNING`,
        event_date: start.toISOString(),
        event_end_date: end.toISOString(),
        location: `${runId} Gym`,
        max_participants: 2,
        threshold: 2,
        status: 'closed', // 手動 closed（is_manual_close=true になる）
      }),
    })
    expect(closedCreated.status).toBe(200)
    closedEventId = (closedCreated.body as { event?: { id?: string } }).event!.id!
  })

  test.afterAll(async () => {
    if (!adminCookieHeader) return
    // テストイベントを削除（後始末）
    for (const id of [testEventId, closedEventId].filter(Boolean)) {
      await appJson(baseURL, '/api/admin/events', {
        method: 'DELETE',
        headers: { Cookie: adminCookieHeader },
        body: JSON.stringify({ id }),
      })
    }
  })

  // =================================================================
  // [GAP-08] ホームページ（イベント一覧）の表示
  // =================================================================
  test('[GAP-08] home page shows event list for authenticated user', async ({ page }) => {
    test.skip(!qaEmail || !qaPass, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaEmail)
    await page.locator('input[type="password"]').fill(qaPass)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })
    await screenshot(page, 'gap08-home-page.png')

    // 作成したイベントのタイトルが表示されること
    await expect(page.getByText(testEventTitle)).toBeVisible({ timeout: 10_000 })

    // イベントタイトルをクリック → /events/:id に遷移
    await page.getByText(testEventTitle).click()
    await expect(page).toHaveURL(new RegExp(`/events/${testEventId}`))
    await screenshot(page, 'gap08-event-detail-from-list.png')
  })

  // =================================================================
  // [GAP-01] ゲスト（友達）招待フロー
  // =================================================================
  test('[GAP-01] authenticated user can invite a guest (friend) and cancel the invite', async ({ page }) => {
    test.skip(!qaEmail || !qaPass, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaEmail)
    await page.locator('input[type="password"]').fill(qaPass)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

    await page.goto(`/events/${testEventId}`)
    await expect(page).toHaveURL(new RegExp(`/events/${testEventId}`))
    await screenshot(page, 'gap01-event-detail.png')

    // 「友達を呼ぶ」または「友達の名前」入力欄が表示されること
    // ※ JoinForm.tsx の「友達を追加」UI を探す
    const guestInput = page.locator('input[placeholder*="友達"], input[placeholder*="名前"], input[name*="guest"]').first()
    await expect(guestInput).toBeVisible({ timeout: 5_000 })

    // ゲストの名前を入力して追加ボタンをクリック
    await guestInput.fill(`${runId}_友達テスト`)
    const addBtn = page.getByRole('button', { name: /追加|招待|呼ぶ/ }).first()
    await addBtn.click()
    await screenshot(page, 'gap01-after-guest-add.png')

    // 臨時IDが表示されること（temporary_code の表示）
    await expect(page.locator('main')).toContainText(/臨時|コード|ID/, { timeout: 5_000 })

    // 追加したゲストの「取消」ボタンが表示されること
    const cancelGuestBtn = page.getByRole('button', { name: /取消|キャンセル/ }).first()
    await expect(cancelGuestBtn).toBeVisible()
    await cancelGuestBtn.click()
    await screenshot(page, 'gap01-after-guest-cancel.png')

    // ゲスト招待がキャンセルされ、臨時IDが消えること
    await expect(page.locator('main')).not.toContainText(`${runId}_友達テスト`, { timeout: 5_000 })
  })

  // =================================================================
  // [GAP-07] 閾値割れ警告ダイアログ（closed イベントでのキャンセル）
  // =================================================================
  test('[GAP-07] cancelling from a closed event shows threshold warning in dialog', async ({ page }) => {
    test.skip(!qaEmail || !qaPass, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    // QA ユーザーを closed イベントに参加させる（API 経由）
    // ※ closed イベントなので通常は参加不可。管理者として status='accepting' に戻してから参加 → 再度 closed にする
    // パターン A: 管理者で一時的に accepting に変更 → 参加 → closed に戻す
    await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: closedEventId, status: 'accepting' }),
    })

    const joinRes = await appJson(baseURL, '/api/participants', {
      method: 'POST',
      headers: { Authorization: `Bearer ${qaToken}` },
      body: JSON.stringify({ event_id: closedEventId, guest: false }),
    })
    // 参加済みの場合は 409 も許容
    expect([200, 409]).toContain(joinRes.status)

    // 再度 closed に変更（手動クローズ）
    await appJson(baseURL, '/api/admin/events', {
      method: 'PATCH',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: closedEventId, status: 'closed' }),
    })

    // ブラウザで該当イベントを開く
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaEmail)
    await page.locator('input[type="password"]').fill(qaPass)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

    await page.goto(`/events/${closedEventId}`)
    await screenshot(page, 'gap07-closed-event-detail.png')

    // 「キャンセル」ボタンをクリック
    const cancelBtn = page.getByRole('button', { name: 'キャンセル' })
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 })
    await cancelBtn.click()

    // ダイアログに閾値割れ警告文言が含まれること
    // JoinForm.tsx: 'cancelConfirmDescription' が「参加者数が${threshold}人を下回るまで追加の参加申請はできません。キャンセルしてもよろしいですか？」
    await expect(page.getByRole('dialog')).toContainText('参加者数が', { timeout: 5_000 })
    await expect(page.getByRole('dialog')).toContainText('人を下回るまで追加の参加申請はできません')
    await screenshot(page, 'gap07-threshold-warning-dialog.png')

    // ダイアログを閉じる（テストデータをキャンセルしないようにする）
    const cancelNoBtn = page.getByRole('button', { name: 'キャンセルしない' })
    if (await cancelNoBtn.isVisible()) {
      await cancelNoBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
  })

  // =================================================================
  // [GAP-13] ニックネーム変更フロー（MemberHeader）
  // =================================================================
  test('[GAP-13] authenticated user can change their nickname', async ({ page }) => {
    test.skip(!qaEmail || !qaPass, 'Set QA_AUTH_EMAIL and QA_AUTH_PASSWORD')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(qaEmail)
    await page.locator('input[type="password"]').fill(qaPass)
    await page.locator('button').last().click()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 })

    // ホームページで「ニックネーム変更」ボタンをクリック
    const nicknameBtn = page.getByRole('button', { name: /ニックネーム|nickname/i })
    await expect(nicknameBtn).toBeVisible({ timeout: 5_000 })
    await nicknameBtn.click()
    await screenshot(page, 'gap13-nickname-form.png')

    // ニックネームを入力して保存
    const nicknameInput = page.locator('input[placeholder*="ニックネーム"], input[name*="nickname"]').first()
    await expect(nicknameInput).toBeVisible()
    await nicknameInput.fill(`テストNick${runId.slice(-6)}`)
    await page.getByRole('button', { name: /保存|更新/ }).click()
    await screenshot(page, 'gap13-after-nickname-save.png')

    // 会員名にニックネームが反映されること（括弧付き）
    await expect(page.locator('main')).toContainText(`テストNick${runId.slice(-6)}`, { timeout: 5_000 })
  })
})
```

---

## ステップ3（フェーズ3）: 複合・記録

### 3-A. `tests/e2e/admin-flows.spec.ts` に追記

**[GAP-15] 管理者 UI からイベント作成（完全成功系）**

```typescript
test('[GAP-15] admin can create an event via UI form', async ({ page, context }) => {
  await injectAdminCookie(context)
  await page.goto('/admin/create')

  // 既存テスト（production-ui.spec.ts）でフォームのバリデーションは確認済み
  // ここでは完全成功系（全フィールド入力 → 作成）を確認する

  const uiTitle = `${runId}_UI_CREATE`
  await page.locator('input[type="text"]').first().fill(uiTitle)

  // 日付・時刻入力（date/select を使う）
  // ※ 既存の edit ページと同じ構造のはず
  // event_date の date input
  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  const dateStr = tomorrow.toISOString().slice(0, 10) // YYYY-MM-DD
  await page.locator('input[type="date"]').first().fill(dateStr)
  // event_end_date
  await page.locator('input[type="date"]').nth(1).fill(dateStr)

  await screenshot(page, 'gap15-create-form-filled.png')

  // 作成ボタンをクリック
  const createBtn = page.getByRole('button', { name: /作成|保存/ }).last()
  await createBtn.click()

  // 成功: /admin または /admin/events/:id にリダイレクト
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 })
  await screenshot(page, 'gap15-after-create.png')

  // 作成されたイベントが存在すれば後始末として削除
  // （リダイレクト先の URL から eventId を取得してAPIで削除）
  const currentUrl = page.url()
  const match = currentUrl.match(/\/admin\/events\/([0-9a-f-]{36})/)
  if (match) {
    await appJson(baseURL, '/api/admin/events', {
      method: 'DELETE',
      headers: { Cookie: adminCookieHeader },
      body: JSON.stringify({ id: match[1] }),
    })
  }
})
```

**[GAP-11] 管理者エラートースト（削除失敗時 — route.fulfill によるモック）**

```typescript
test('[GAP-11] admin delete failure shows error toast', async ({ page, context }) => {
  await injectAdminCookie(context)

  // DELETE /api/admin/events を 500 で返すようにモック
  await page.route('**/api/admin/events', async route => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'DB エラー（テストモック）' }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto(`/admin/events/${testEventId}`)
  await screenshot(page, 'gap11-before-delete.png')

  const deleteBtn = page.getByRole('button', { name: /イベント削除/ })
  await expect(deleteBtn).toBeVisible()
  await deleteBtn.click()

  const confirmBtn = page.getByRole('button', { name: /実行|削除する|はい/ })
  if (await confirmBtn.isVisible({ timeout: 2_000 })) {
    await confirmBtn.click()
  }

  // エラートーストが表示されること（画面下部の fixed 要素など）
  await expect(
    page.locator('.fixed, [role="alert"], .toast, .text-destructive').filter({ hasText: /エラー|失敗|削除/ })
  ).toBeVisible({ timeout: 5_000 })
  await screenshot(page, 'gap11-error-toast.png')
})
```

### 3-B. 記録のみ（スキップ指定）

以下は `tests/e2e/admin-flows.spec.ts` の末尾に `test.skip` で記録する。

```typescript
// [GAP-14] 管理者レート制限 E2E テスト
// 本番環境で5回連続失敗 → 15分ロックアウトが発生するため、本番に対しては実施しない。
// ローカル（NEXT_PUBLIC_SUPABASE_URL が localhost の場合）のみ実行する想定。
test.skip('[GAP-14] admin rate limit after 5 failures', async ({ page }) => {
  // ローカル環境のみ: 5回誤ったパスワードで試行 → ロックアウトメッセージが表示されること
})

// [GAP-12] 会員登録フロー（/login → 新規登録 → /）
// 本番に Supabase Auth ユーザーが恒久作成されるため、クリーンアップが必要。
// scripts/qa-production-smoke.mjs の A-04 が同等の API レベル確認をしているため現状は保留。
test.skip('[GAP-12] new member registration flow', async ({ page }) => {
  // 新規メールアドレス・パスワードで登録 → / にリダイレクト → 会員番号が表示される
  // afterAll で supabase.auth.admin.deleteUser() による後始末が必要
})
```

---

## ステップ4: 実行・検証

### 新規スペックのみを実行する（既存テストを混在させない）

```bash
# 管理者フローのみ
npx playwright test tests/e2e/admin-flows.spec.ts --reporter=line

# ユーザーフローのみ（QA_AUTH_EMAIL が必要）
npx playwright test tests/e2e/user-flows.spec.ts --reporter=line
```

### 確認ポイント

| テスト ID | 確認内容 |
|---|---|
| GAP-09 | Cookie なしでサブページ → /admin へリダイレクト |
| GAP-10 | 誤ったパスワード → エラーメッセージが表示 |
| GAP-06 | ログアウト後 → Cookie クリア → 保護ページが /admin へリダイレクト |
| GAP-04 | 「締め切る」→「再開する」のステータストグル |
| GAP-05 | 編集フォームでタイトル変更 → 保存後に反映 |
| GAP-03 | イベント削除 → /admin へリダイレクト → 一覧から消える |
| GAP-02 | 強制キャンセル → 参加者リストから消える |
| GAP-08 | ホーム画面でイベント一覧表示 → クリックで詳細へ |
| GAP-01 | ゲスト招待 → 臨時ID表示 → 取消 |
| GAP-07 | closed イベントのキャンセルダイアログに閾値割れ警告 |
| GAP-13 | ニックネーム変更 → ヘッダーに反映 |
| GAP-11 | 削除APIモック500 → エラートースト表示 |
| GAP-15 | UI フォームからイベント作成 → 成功 |

### 型チェック

```bash
npx tsc --noEmit
```

### 既存テストへの影響確認

```bash
npx playwright test tests/e2e/production-ui.spec.ts --reporter=line
```

---

## 注意事項

1. **セレクター選択**: 実際の DOM 構造は実装ファイルを確認してから書く。`page.locator` の CSS クラスは変わりうるので `getByRole` / `getByText` / `locator('[data-testid=...]')` を優先する。
2. **後始末**: 全テストで作成したデータは afterAll で削除すること。削除 API が 500 を返しても afterAll は続行させる（`catch(() => {})` で握り潰す）。
3. **QA 認証情報の保護**: `qaEmail` / `qaPass` を screenshot 等で出力しない。
4. **テストの独立性**: 各テストは共有テストイベント（testEventId）を「削除しない・参加者を残さない」ように設計する。GAP-02 のように参加者を作る場合は teardown で削除する。
5. **タイムアウト**: 本番 Vercel は応答に数秒かかる場合がある。`expect(...).toBeVisible({ timeout: 10_000 })` を適切に設定する。
