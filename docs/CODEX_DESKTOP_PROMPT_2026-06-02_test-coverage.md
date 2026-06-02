# テストカバレッジ補完タスク：73件のギャップへの対応

## このプロンプトの概要

カバレッジ・ギャップ分析の結果に基づき、以下の規模でテストを追加する。

- フェーズ1（最優先）: Critical 8件 + High 11件 = 19件
- フェーズ2（中優先）: Medium の主要 12件
- フェーズ3（記録のみ）: Low 8件（このプロンプトでは実装せず、TODO コメントのみ）

---

## 大前提・作業ルール

1. **コード変更前に必ず既存ファイルを読むこと**
2. **Next.js 16 の API を使う場合は `node_modules/next/dist/docs/` の該当ドキュメントを先に読むこと**
3. **git commit / push はしない（差分提示のみ）**
4. **既存ファイルは削除しない**
5. **既存テストを上書きしない（追記 or 新ファイル作成のみ）**

---

## プロジェクト情報

- リポジトリ: `C:\ClaudeCode\90_projects\03_basketball-circle`
- フレームワーク: Next.js 16.2.6 / React 19 / Supabase
- ユニットテスト: Vitest (`npm run test:unit`)
- E2E テスト: Playwright (`npm run test:e2e`)

---

## ステップ0: 既存テストの把握（作業開始前に必ず実行）

以下のファイルを読んでからテスト実装に進むこと。

```
tests/unit/validators.test.ts
tests/unit/api-auth.test.ts
tests/unit/admin-rate-limit.test.ts
tests/unit/proxy-session.test.ts
tests/e2e/production-ui.spec.ts
```

また、以下の実装ファイルも読むこと（モック設計に必要）。

```
app/api/cancel/route.ts
app/api/participants/route.ts
app/api/members/route.ts
app/api/admin/verify/route.ts
app/api/admin/events/route.ts
lib/api-auth.ts
lib/admin-rate-limit.ts
lib/validators.ts
lib/supabase.ts
lib/supabase-server.ts
```

---

## ステップ1（フェーズ1）: Critical/High ギャップへの対応

### 1-A. 新規ファイル作成: `tests/unit/cancel-route.test.ts`

対象ギャップ: SEC-001, SEC-002, SEC-014, SEC-010

**テストの骨格（Vitest 形式）:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase クライアントのモック
// lib/supabase-server.ts の getServerSupabase をモックし、
// .from('participants').select(...).eq(...).single() が返す値を制御する。
// supabase.rpc('cancel_participant', ...) もモックする。

// lib/api-auth.ts の getAuthenticatedMember, checkAdmin, getBearerToken もモックする。

describe('POST /api/cancel', () => {
  // --- SEC-001: レガシーパス（member_id=null, guestプレフィックスなし）---

  it('[SEC-001] レガシー正常系: member_id=null でguestプレフィックスなし、正しいuser_codeでキャンセルできる', async () => {
    // participant: { id: '...uuid...', member_id: null, user_code: '54321', status: 'active' }
    // getBearerToken → null（未ログイン）
    // supabase.rpc('cancel_participant') → { data: null, error: null }
    // リクエスト: { participant_id: uuid, user_code: '54321' }
    // 期待: status 200, body { success: true }
  })

  it('[SEC-001] レガシー異常系: member_id=null でguestプレフィックスなし、誤ったuser_codeでは401になる', async () => {
    // participant: { id: '...uuid...', member_id: null, user_code: '54321', status: 'active' }
    // getBearerToken → null
    // リクエスト: { participant_id: uuid, user_code: 'wrong' }
    // 期待: status 401
  })

  // --- SEC-002: ゲスト所有者チェック ---

  it('[SEC-002] 他人のゲスト参加者をキャンセルしようとすると403になる', async () => {
    // participant: { id: '...uuid...', member_id: null, user_code: 'guest:memberA:12345', status: 'active' }
    // getAuthenticatedMember → { member: { id: 'memberB', ... }, error: null, status: 200 }
    // getBearerToken → 'valid-token-for-memberB'
    // リクエスト: { participant_id: uuid }
    // 期待: status 403, body.error '本人確認に失敗しました'
  })

  it('[SEC-002] 自分のゲスト参加者は正常にキャンセルできる', async () => {
    // participant: { user_code: 'guest:memberA:12345', member_id: null, status: 'active' }
    // getAuthenticatedMember → { member: { id: 'memberA' }, ... }
    // getBearerToken → 'valid-token-for-memberA'
    // 期待: status 200, body { success: true }
  })

  // --- SEC-014: キャンセル済み参加者への再キャンセル防止 ---

  it('[SEC-014] statusがcancelledの参加者に再キャンセルを試みると400になる', async () => {
    // participant: { status: 'cancelled', ... }
    // 期待: status 400, body.error 'すでにキャンセル済みです'
  })

  // --- SEC-010（cancel パス）: 不正 UUID の拒否 ---

  it('[SEC-010] participant_idが不正なUUID形式のとき400になる', async () => {
    // リクエスト: { participant_id: '../etc/passwd' }
    // 期待: status 400
  })
})
```

### 1-B. 新規ファイル作成: `tests/unit/participants-route.test.ts`

対象ギャップ: SEC-004, SEC-009, BL-002, BL-003

**テストの骨格:**

```typescript
import { describe, it, expect, vi } from 'vitest'

// モック対象:
// - lib/api-auth の getAuthenticatedMember
// - lib/supabase-server の getServerSupabase（supabase.rpc('join_event') を制御）
// - lib/supabase の generateUserCode（固定値 '12345' を返す）

describe('POST /api/participants', () => {
  // --- SEC-004: 他人のmember_idを使った参加申請 ---

  it('[SEC-004] BearerトークンのユーザーAがbody.member_id=userBのIDで申請すると403になる', async () => {
    // getAuthenticatedMember: member_id='userB' を渡すと
    //   auth.member=null, auth.error='本人確認に失敗しました', auth.status=403 を返す想定
    // 期待: status 403
  })

  it('[SEC-004] member_idを省略した場合はBearerトークンのユーザーIDが使われる', async () => {
    // getAuthenticatedMember(req, null) → { member: { id: 'userA', name: 'テスト' }, ... }
    // rpc('join_event') → { data: { participant: { id: uuid, ... } }, error: null }
    // リクエスト: { event_id: valid-uuid, guest: false }
    // 期待: status 200, body.participant が存在する
  })

  // --- SEC-009: user_code がレスポンスに含まれないこと ---

  it('[SEC-009] 成功レスポンスにuser_codeが含まれない', async () => {
    // rpc が user_code: 'secret' を含む participant を返す状況をモック
    // 期待: body.participant に user_code キーが存在しない
    // 期待: body.temporary_code は存在する
  })

  // --- SEC-010（participants パス）: 不正 UUID の拒否 ---

  it('[SEC-010] event_idが不正なUUID形式のとき400になる', async () => {
    // getAuthenticatedMember は成功と仮定
    // リクエスト: { event_id: '1 OR 1=1', name: 'テスト', guest: false }
    // 期待: status 400
  })

  // --- BL-002: 定員到達による自動 closed 遷移（モックで検証）---

  it('[BL-002] RPC がclosed化を返したとき、APIは409相当のエラーを返す', async () => {
    // join_event RPC が { error: '定員に達しています', status: 409 } を返す想定
    // 期待: status 409
  })

  // --- BL-003: closes_at 締切後の参加申請拒否（モックで検証）---

  it('[BL-003] RPC が締切エラーを返したとき、APIは409を返す', async () => {
    // join_event RPC が { error: '締切日時を過ぎたため参加申請を受け付けていません', status: 409 } を返す想定
    // 期待: status 409, body.error に '締切' が含まれる
  })
})
```

### 1-C. 新規ファイル作成: `tests/unit/members-route.test.ts`

対象ギャップ: SEC-003, SEC-008

**テストの骨格:**

```typescript
import { describe, it, expect, vi } from 'vitest'

// モック対象:
// - lib/api-auth の getBearerUser
// - lib/supabase-server の getServerSupabase（rpc 呼び出しを制御）

describe('POST /api/members', () => {
  // --- SEC-008: 認証前バリデーション順序 ---

  it('[SEC-008] Bearerトークンなしかつnameが空のとき400（nameバリデーション先行）が返る', async () => {
    // getBearerUser → null
    // リクエスト: { name: '', auth_user_id: 'some-uuid' }
    // 期待: status 400, body.error に 'name' が含まれる
    // ※ 401 ではなく 400 が先に返ることを確認（情報リーク仕様の明文化）
  })

  it('[SEC-008] Bearerトークンあり・auth_user_idが別ユーザーIDのとき403が返る', async () => {
    // getBearerUser → { id: 'userA' }
    // リクエスト: { name: 'テスト', auth_user_id: 'userB' }
    // 期待: status 403, body.error '本人確認に失敗しました'
  })
})

describe('PATCH /api/members', () => {
  // --- SEC-003: 他人のmemberへの名前変更 ---

  it('[SEC-003] RPC が所有者チェックでエラーを返したとき、APIは500を返す', async () => {
    // getBearerUser → { id: 'userA' }
    // rpc('update_member_name') → { data: null, error: { message: '権限がありません', code: 'P0001' } }
    // リクエスト: { member_id: valid-uuid-of-userB, name: '不正変更' }
    // 期待: status 500
  })

  it('[SEC-003] 自分のmember_idでのPATCHは成功する', async () => {
    // getBearerUser → { id: 'userA' }
    // rpc('update_member_name') → { data: { member: { id: uuid, name: '新名前' } }, error: null }
    // 期待: status 200, body.member.name === '新名前'
  })
})
```

### 1-D. 新規ファイル作成: `tests/unit/admin-verify-route.test.ts`

対象ギャップ: SEC-005, SEC-006, SEC-012

**テストの骨格:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// モック対象:
// - lib/admin-rate-limit の isLocked, recordFailure, clearFailure
// - lib/api-auth の checkAdmin, createAdminSessionToken, safeCompare
//
// 注意: process.env.ADMIN_PASSWORD と process.env.ADMIN_SESSION_SECRET を各テストで設定すること。
// 既存の admin-rate-limit.test.ts は isLocked のロジック単体をテストしており、
// このファイルは route ハンドラ経由の HTTP レイヤーをテストする（重複なし）。

describe('POST /api/admin/verify', () => {
  // --- SEC-005: 5回失敗後に429が返ること ---

  it('[SEC-005] isLocked が true を返すとき 429 Too many attempts になる', async () => {
    // isLocked → resolve(true)
    // リクエスト: { password: 'any' }
    // 期待: status 429, body.error 'Too many attempts'
  })

  it('[SEC-005] 正しいパスワードで200・Cookieが設定される', async () => {
    // isLocked → false, safeCompare → true, createAdminSessionToken → 'valid-token'
    // 期待: status 200, Set-Cookie ヘッダーに basketball_admin_session= が含まれる
  })

  it('[SEC-005] 誤ったパスワードで403・recordFailure が呼ばれる', async () => {
    // isLocked → false, safeCompare → false
    // 期待: status 403, body.error '認証エラー'
    // 期待: recordFailure が1回呼ばれていること（vi.spyOn で確認）
  })

  // --- SEC-012: Cookie 属性の確認 ---

  it('[SEC-012] 成功時のSet-CookieヘッダーにHttpOnly・SameSite=Strict が含まれる', async () => {
    // isLocked → false, safeCompare → true, createAdminSessionToken → 'valid-token'
    // 期待: httpOnly=true, sameSite='strict'
  })
})

describe('GET /api/admin/verify', () => {
  // --- SEC-006: 無効なCookieで401が返ること ---

  it('[SEC-006] 有効なCookieなしでGETすると401になる', async () => {
    // checkAdmin → false
    // 期待: status 401, body.error 'Unauthorized'
  })

  it('[SEC-006] 有効なCookieでGETすると200になる', async () => {
    // checkAdmin → true
    // 期待: status 200, body.ok === true
  })
})
```

### 1-E. 新規ファイル作成: `tests/unit/admin-events-route.test.ts`

対象ギャップ: SEC-007, BL-004, BL-014

**テストの骨格:**

```typescript
import { describe, it, expect, vi } from 'vitest'

// モック対象:
// - lib/api-auth の checkAdmin
// - lib/supabase-server の getServerSupabase

describe('POST /api/admin/events', () => {
  // --- SEC-007: XSS / インジェクション境界値 ---

  it('[SEC-007] location_url が javascript:alert(1) のとき400になる', async () => {
    // checkAdmin → true
    // location_url: 'javascript:alert(1)'
    // 期待: status 400, body.error に 'http または https' が含まれる
  })

  it('[SEC-007] location_url が 2001 文字のとき400になる', async () => {
    // location_url: 'https://example.com/' + 'a'.repeat(1982)
    // 期待: status 400
  })

  it('[SEC-007] title が 201 文字のとき400になる', async () => {
    // title: 'a'.repeat(201)
    // 期待: status 400
  })

  it('[SEC-006] 管理者Cookieなしでのリクエストは403になる', async () => {
    // checkAdmin → false
    // 期待: status 403
  })
})

describe('PATCH /api/admin/events', () => {
  // --- BL-004: is_manual_close フラグの連動 ---

  it('[BL-004] status=closed でPATCHすると is_manual_close=true がDBに書き込まれる', async () => {
    // checkAdmin → true
    // 既存イベント: { id: uuid, status: 'accepting', is_manual_close: false }
    // リクエスト: { id: uuid, status: 'closed' }
    // supabase.from('events').update() の呼び出し引数を vi.spyOn で検証
    // 期待: update() に { status: 'closed', is_manual_close: true } が渡される
  })

  it('[BL-004] status=accepting でPATCHすると is_manual_close=false にリセットされる', async () => {
    // 既存イベント: { status: 'closed', is_manual_close: true }
    // リクエスト: { id: uuid, status: 'accepting' }
    // 期待: update() に { status: 'accepting', is_manual_close: false } が渡される
  })

  // --- BL-014: クロスフィールドバリデーション ---

  it('[BL-014] threshold=30のイベントにmax_participants=25のPATCHを送ると400になる', async () => {
    // 既存イベント: { threshold: 30, max_participants: 35 }
    // リクエスト: { id: uuid, max_participants: 25 }
    // 期待: status 400, body.error '閾値は定員以下にしてください'
  })

  it('[BL-014] max_participants=35のイベントにthreshold=36のPATCHを送ると400になる', async () => {
    // 既存イベント: { threshold: 30, max_participants: 35 }
    // リクエスト: { id: uuid, threshold: 36 }
    // 期待: status 400
  })
})
```

---

## ステップ2（フェーズ2）: Medium ギャップへの対応

### 2-A. `tests/unit/admin-verify-route.test.ts` に追記

対象: SEC-011（IPスプーフィング対策）, GAP-011（ADMIN_SESSION_SECRET 未設定）

```typescript
describe('POST /api/admin/verify - IPキー抽出', () => {
  it('[SEC-011] X-Forwarded-Forに複数IPがある場合、最初のIPがclientKeyになる', async () => {
    // X-Forwarded-For: '203.0.113.1, 10.0.0.1' → isLocked が '203.0.113.1' で呼ばれること
  })

  it('[GAP-011] ADMIN_SESSION_SECRET 未設定時は ADMIN_PASSWORD をシークレットとしてトークンを生成する', async () => {
    // process.env.ADMIN_SESSION_SECRET を削除した状態で createAdminSessionToken → 非 null
    // そのトークンが verifyAdminSessionToken でも検証できること
  })
})
```

### 2-B. `tests/unit/participants-route.test.ts` に追記

対象: SEC-013（ゲスト名長さ）, BL-013（重複申請）, BL-016（ゲスト時 member_id=null）

```typescript
describe('POST /api/participants - 追加ケース', () => {
  it('[SEC-013] ゲスト参加でnameが1000文字のとき現状の動作を記録する', async () => {
    // API 層でのバリデーションがないことを明文化するテスト
    // rpc('join_event') に 1000文字の p_name が渡されること（または400が返ること）を確認
  })

  it('[BL-013] RPC が重複エラー(409)を返したとき、APIは409を返す', async () => {
    // rpc が { error: 'すでにこのイベントに登録済みです', status: 409 } を返す
    // 期待: status 409
  })
})
```

### 2-C. `tests/unit/admin-events-route.test.ts` に追記

対象: GAP-002（location_url の危険スキーム）, GAP-008（同一時刻の event_end_date）, GAP-009（threshold 等値境界）, GAP-012（location_url null クリア）

```typescript
describe('POST /api/admin/events - 境界値', () => {
  it('[GAP-002] location_url が data: スキームのとき400になる', async () => {
    // location_url: 'data:text/html,<h1>x</h1>'
    // 期待: status 400
  })

  it('[GAP-008] event_end_date === event_date（同一時刻）のとき400になる', async () => {
    // event_date: '2025-01-01T10:00:00Z', event_end_date: '2025-01-01T10:00:00Z'
    // 期待: status 400, body.error に 'event_end_date' が含まれる
  })

  it('[GAP-009] threshold === max_participants（等値）のとき400にならない', async () => {
    // threshold: 30, max_participants: 30
    // 期待: status 201（成功）
  })

  it('[GAP-009] threshold === max_participants + 1 のとき400になる', async () => {
    // threshold: 31, max_participants: 30
    // 期待: status 400
  })
})

describe('PATCH /api/admin/events - 境界値', () => {
  it('[GAP-012] location_url=null を PATCH すると location_url が null に更新される', async () => {
    // リクエスト: { id: uuid, location_url: null }
    // update() に { location_url: null } が含まれること
  })
})
```

### 2-D. `tests/unit/cancel-route.test.ts` に追記

対象: GAP-005（レガシーキャンセル境界値）, GAP-006（キャンセル済みの再キャンセル詳細）

```typescript
describe('POST /api/cancel - 追加境界値', () => {
  it('[GAP-005] guest:プレフィックスを持つ参加者に対して Bearerなし・user_code直接指定でキャンセルすると401になる', async () => {
    // participant: { user_code: 'guest:memberA:12345', member_id: null, status: 'active' }
    // getBearerToken → null
    // リクエスト: { participant_id: uuid, user_code: 'guest:memberA:12345' }
    // 期待: status 401（レガシーパスはguestプレフィックスには使えない）
  })

  it('[GAP-006] statusがactiveの参加者はキャンセルが進む（RPC呼び出しまで到達する）', async () => {
    // participant: { status: 'active', member_id: null, user_code: '54321' }
    // getBearerToken → null, user_code: '54321'
    // rpc('cancel_participant') → { data: null, error: null }
    // 期待: status 200
  })
})
```

### 2-E. `tests/unit/members-route.test.ts` に追記

対象: GAP-003（空白のみname）, GAP-004（100文字境界値）

```typescript
describe('POST /api/members - 境界値', () => {
  it('[GAP-003] nameが半角スペースのみのとき400が返る', async () => {
    // リクエスト: { name: '   ', auth_user_id: valid-uuid }
    // 期待: status 400
  })

  it('[GAP-004] nameが100文字のとき400にならない（上限境界の正常系）', async () => {
    // getBearerUser → { id: 'userA' }
    // リクエスト: { name: 'a'.repeat(100), auth_user_id: 'userA' }
    // rpc('register_member') → 成功
    // 期待: status 201
  })

  it('[GAP-004] nameが101文字のとき400になる', async () => {
    // リクエスト: { name: 'a'.repeat(101), auth_user_id: valid-uuid }
    // 期待: status 400
  })
})
```

### 2-F. `tests/unit/admin-rate-limit.test.ts` に追記

対象: GAP-010（MAX_ATTEMPTS 超過後の挙動）

```typescript
describe('admin-rate-limit - MAX_ATTEMPTS 超過後', () => {
  it('[GAP-010] MAX_ATTEMPTS + 3回 recordFailure を呼んでも isLocked が true のまま', async () => {
    // MAX_ATTEMPTS=5 で 8回 recordFailure を呼んでも isLocked===true
    // ※ 既存の admin-rate-limit.test.ts のテストパターンに合わせて追記
  })
})
```

---

## ステップ3（フェーズ3）: Low ギャップへの記録

`tests/unit/__todos__.md` を作成し（テストとして実行されない）、以下を記録する。

```markdown
# テストカバレッジ TODO（Low 優先度）

## [SEC-015] legacyRegister の RACE 条件
- member_number の採番が SELECT→INSERT の非原子操作
- 並行呼び出し時に重複が発生しないことの確認テストが未実装
- 対応方針: DB の unique 制約でのエラーハンドリングを確認するか、register_member RPC 移行後に削除

## [SEC-016] DELETE /api/admin/verify の認証なし Cookie クリア
- SameSite=Strict により CSRF リスクは軽減済み
- Cookie なしで DELETE → 200 になること（仕様確認テスト）が未実装

## [BL-019] publishes_at による非公開イベントの公開制御
- 現在の実装でこのフィールドがフロントエンドで参照されているか未確認
- 実装確認後にテストを追加すること

## [GAP-019] DELETE /api/admin/events: 存在しない event_id の削除
- Supabase は存在しない行の DELETE でもエラーにならず {success:true} を返す仕様
- この動作が意図的であることを確認するテストが未実装

## [GAP-016] verifyAdminSessionToken: expiresAt がちょうど現在時刻と等しい場合
- expiresAt === Math.floor(now / 1000)（同一秒）のとき false を返すことの境界値テスト

## [BL-020] generateUserCode の衝突可能性
- 5桁乱数の衝突発生時に RPC 側 unique 制約エラーのハンドリングを確認するテスト
```

---

## ステップ4: 既存テストとの衝突・重複を避けるための注意事項

| 既存テストファイル | 何をテストしているか | 新テストとの重複を避けるために |
|---|---|---|
| `tests/unit/api-auth.test.ts` | `safeCompare` / `createAdminSessionToken` / `verifyAdminSessionToken` / `getBearerToken` の純粋関数 | 新テストは Route ハンドラをインポートして HTTP レスポンスを検証する（ロジック単体テストは既存がカバー済み） |
| `tests/unit/admin-rate-limit.test.ts` | `isLocked` / `recordFailure` / `clearFailure` のメモリストア動作 | SEC-005 の新テストは `isLocked` をモックして Route ハンドラの挙動を確認（ロジック自体は既存がカバー済み） |
| `tests/unit/validators.test.ts` | `isValidUuid` の純粋関数 | UUID バリデーションの結果（400 レスポンス）を Route ハンドラ経由で確認する |
| `tests/unit/proxy-session.test.ts` | Node 側トークン発行と Edge 側検証の等価性 | `createAdminSessionToken` のモックを使う際は等価性を前提として OK |

---

## ステップ5: モック実装の共通パターン

各テストファイルで Supabase のモックを一から書かず、以下のファクトリ関数を使う（`tests/unit/helpers/mock-supabase.ts` に作成）。

```typescript
// tests/unit/helpers/mock-supabase.ts

import { vi } from 'vitest'

export function mockSupabaseFrom(config: {
  selectSingleResult?: { data: unknown; error: null | { message: string } }
  rpcResult?: { data: unknown; error: null | { message: string; code?: string } }
  updateResult?: { data: unknown; error: null | { message: string } }
  insertResult?: { data: unknown; error: null | { message: string } }
}) {
  const mockSingle = vi.fn().mockResolvedValue(config.selectSingleResult ?? { data: null, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockInsert = vi.fn().mockResolvedValue(config.insertResult ?? { data: null, error: null })
  const mockRpc = vi.fn().mockResolvedValue(config.rpcResult ?? { data: null, error: null })

  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(config.updateResult ?? { data: null, error: null })
        })
      })
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null })
    }),
  })

  return { mockFrom, mockRpc, mockSingle, mockEq }
}
```

---

## ステップ6: 実装後の検証手順

### ユニットテストの実行

```bash
npm run test:unit
```

**期待結果:**
- `tests/unit/cancel-route.test.ts` — すべて pass
- `tests/unit/participants-route.test.ts` — すべて pass
- `tests/unit/members-route.test.ts` — すべて pass
- `tests/unit/admin-verify-route.test.ts` — すべて pass
- `tests/unit/admin-events-route.test.ts` — すべて pass
- 既存テスト（`validators`, `api-auth`, `admin-rate-limit`, `proxy-session`）— すべて pass（回帰なし）

### カバレッジ確認（任意）

```bash
npm run test:unit -- --coverage
```

### E2E テストの非回帰確認

```bash
npm run test:e2e
```

---

## 補足: 統合テストについて（スコープ外）

BL-001 / BL-003 / BL-013 は Supabase RPC（`cancel_participant`, `join_event`）の内部ロジックを検証する必要があり、ローカルの Supabase 環境（`supabase start`）がなければ実行できない。このプロンプトのスコープでは「RPC のモックを使って API 層が RPC 返却値を正しく処理すること」をユニットレベルで確認するにとどめる。RPC 内部の完全な統合テストは別途 `tests/integration/` として実装すること。

---

## 作業順序のまとめ

1. `tests/unit/helpers/mock-supabase.ts` を作成（共通モック）
2. `tests/unit/cancel-route.test.ts` を作成
3. `tests/unit/participants-route.test.ts` を作成
4. `tests/unit/members-route.test.ts` を作成
5. `tests/unit/admin-verify-route.test.ts` を作成
6. `tests/unit/admin-events-route.test.ts` を作成
7. `tests/unit/__todos__.md` を作成（Low ギャップの記録）
8. `npm run test:unit` で全テスト pass を確認
9. `npm run test:e2e` で既存テスト回帰なしを確認
10. 差分を提示（git commit/push はしない）
