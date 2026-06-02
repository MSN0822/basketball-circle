# Codex 実装タスク — basketball-circle（2026-06-02 v2）

> **9エージェント・81ツール呼び出しによるWorkflow多角監査**で実コードを全精査した結果を反映。
> 前回版（v1）からの主な変更: タスクA/B/C が実装済みと判明、新規問題A〜Pを整理。proxy.ts は Next.js 16 の正式なルート前処理ファイルとして確認済み。

---

## 0. 必読事項（着手前）

### 0-1. この Next.js は通常版と異なる
- `next@16.2.6` / `react@19.2.4` / `@base-ui/react@^1.5.0` を使用。
- **コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを読むこと。**
- 既存の実装パターン（route handler の書き方、`NextRequest`/`NextResponse` の使い方）に必ず合わせる。

### 0-2. 運用ルール
- 秘密情報をコードに書かない（パスワード等は環境変数から読む）
- **git commit / push / deploy は人間（まっすん）承認後のみ。** 実装と差分提示まで。コミットしない。
- **ファイル削除は AI 不可。** 削除候補はまっすんに報告するだけ。
- 既存ファイルを確認せずに上書きしない。

---

## 1. 完了済み確認（Workflow実コード精査で証拠あり）

| 項目 | 確認内容 | 根拠 |
|---|---|---|
| [C-1] members POST 認証 | `getBearerUser` → 401/403 | `app/api/members/route.ts` L52-58 |
| [C-2] service_role_key フォールバック削除 | key未設定でthrow | `lib/supabase-server.ts` L9-16 |
| [C-3][H-2][H-5][H-6] 管理者認証クッキー化 | HMAC-SHA256署名付きトークン、httpOnly/SameSite=Strict | `lib/api-auth.ts` L62-64 |
| [H-1][C-4] safeCompare・checkAdmin 集約 | タイミングセーフ比較・管理者認証を同ファイルに集約 | `lib/api-auth.ts` |
| [H-3][H-7] キャンセルTOCTOU・ロック順 | イベント行→参加者行→全参加者の順でロック | `cancel_participant_lock_order_fix.sql` |
| [H-8] slot_number UNIQUE制約 | partial index（active/waitlist のみ）・事前重複チェックあり | `20260602_participants_slot_unique_index.sql` L34-36 |
| [M-4][M-8] セキュリティヘッダー | X-Frame-Options/CSP等すべて設定済み | `next.config.ts` |
| [L-1] CancelModal typeof window 比較 | `'undefined'`（引用符あり）で正しい | `components/CancelModal.tsx` L25 |
| [C-5] waitlistデッドコード削除 | join_event RPCは `waitlist:false` 固定、分岐は削除済み | `app/api/participants/route.ts` |
| SECURITY DEFINER search_path | 全RPC関数で `SET search_path = public` 設定済み | 全マイグレーション |
| RLS mutationポリシー | events/members/participantsのINSERT/UPDATE/DELETEを全封鎖 | `20260527_harden_public_mutation_policies.sql` |
| localStorage完全廃止 | LEGACY_KEY を removeItem。全adminページで読み書きなし | `admin/page.tsx` L60 ほか |
| マイグレーション重複の実害なし | 2ファイルの関数本体は完全同一。辞書順でlock_order_fixが後適用 | diff確認済み |
| **[旧タスクA]** DELETE id UUID検証 + participantsエラーチェック | `UUID_RE` 定義・検証済み、`participantsError` チェック済み | `app/api/admin/events/route.ts` L8, L167, L171-175 |
| **[旧タスクB]** title/location最大長 + location_url スキーム検証 | 定数・`validateStringLength`・`validateLocationUrl` がPOST/PATCH両方に適用済み | `app/api/admin/events/route.ts` L9-11, L17-40 |
| **[旧タスクC]** .env.local.example に CRON_SECRET 追記 | 説明コメント付きで記載済み | `.env.local.example` L17-18 |
| **[新タスク2]** cancel user_code safeCompare | レガシー本人確認コード比較を `safeCompare` に変更済み | `app/api/cancel/route.ts` |
| **[新タスク3]** UUID形式検証の横展開 | 共通 `isValidUuid()` を追加し、cancel/participants/admin PATCH/members PATCH に適用済み | `lib/validators.ts` |
| **[新タスク4]** members name最大長 | POST/PATCH とも100文字制限を追加済み | `app/api/members/route.ts` |
| **[新タスク5]** handleDelete エラーハンドリング | 削除API失敗時はトースト表示し、`/admin` 遷移を中断 | `app/admin/events/[id]/page.tsx` |
| **[新タスク1/E-1]** proxy.ts | Next.js 16 docs で `proxy.ts` が正式規約。ビルド出力でもルート前処理として検出済みのため現状維持 | `proxy.ts` |

---

## 2. ⚠️ 要再確認：完了済み記載と実態のズレ

### 【解消済み】proxy.ts の扱い

**確認結果**:
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` で、Next.js 16 は `proxy.ts` をプロジェクトルートに置く規約であることを確認済み。
- ローカル/本番ビルド出力でもルート前処理として検出済み。
- 本番スモークテストで未ログイン `/admin/create` が `/admin` へリダイレクトすることを確認済み。

**結論**: 現行 `proxy.ts` 維持が最も安定。リネームや re-export ファイル追加は不要。

---

## 3. Codex 実装タスク（新規）

### 優先度：最高（先行対応）

#### 【新タスク9】participants の anon 直接削除を許す開放ポリシーを削除 🔴 [新規発見]

**発見経緯**: 2026-06-02 Supabase Dashboard 実機確認（まっすん＋Claude Code）。

**問題**: `participants` テーブルに、コード（`schema.sql`・全マイグレーション）のどこにも定義されていない **`participants_delete`** ポリシーが本番DBに存在する。中身は以下:

```sql
-- 本番DBの実態（Dashboard で確認）
create policy "participants_delete" on "public"."participants"
  as permissive for delete
  to public           -- anon 含む全ロール
  using ( true );     -- 無条件許可
```

`anon` キーは `NEXT_PUBLIC_SUPABASE_ANON_KEY` でブラウザに露出しているため、**第三者が `participants` 行を直接 DELETE 可能**。`participants_delete_none`（`using (false)`）と併存しているが、RLS は同一コマンドの複数 PERMISSIVE ポリシーを **OR 評価**するため封鎖が無効化されている。Supabase の DELETE テンプレート適用の残骸とみられ、ハードニング時に消し損ねたもの。

**削除して安全な根拠**: クライアント側の `participants` アクセスは全て select のみ。`.delete()` はサーバーAPI（`app/api/cron/cleanup/route.ts` / `app/api/admin/events/route.ts`、いずれも service_role＝RLSバイパス）だけ。このポリシーを消しても正規フローに影響なし。

**修正**: 新規マイグレーションで開放ポリシーを DROP する。
```sql
-- supabase/migrations/20260602_drop_participants_delete_open_policy.sql
drop policy if exists "participants_delete" on participants;
-- 封鎖ポリシー participants_delete_none は残す（schema.sql 由来）
```

**適用**: DBマイグレーションのためまっすんが Supabase に適用する。Codex は SQL ファイル作成まで。

---

### 優先度：高

#### 【新タスク1】proxy.ts の扱い（対応不要）

Next.js 16 docs に従い、`proxy.ts` を現状維持する。追加ファイル作成は不要。

---

#### 【新タスク2】cancel/route.ts の user_code を safeCompare に変更 [新規-A]（対応済み）

**ファイル**: `app/api/cancel/route.ts`

**問題**: レガシー本人確認コードの平文比較はタイミング攻撃で5桁数字コード（90,000通り）を推測される余地があった。

**対応**: `safeCompare` は `lib/api-auth.ts` に実装済み。`app/api/cancel/route.ts` で import し、以下の形に置換済み。

```ts
} else if (!participant.member_id && !participant.user_code.startsWith('guest:') && safeCompare(user_code, participant.user_code)) {
```

import 追加:
```ts
import { checkAdmin, getAuthenticatedMember, getBearerToken, safeCompare } from '@/lib/api-auth'
```

---

#### 【新タスク3】UUID形式検証の横展開 [新規-C/D/E/F]（対応済み）

`admin/events/route.ts` の DELETE には `UUID_RE` 検証が実装済みだが、以下のエンドポイントで欠落している。`UUID_RE` を共通ユーティリティに切り出すか、同じ正規表現を各ファイルに追加する。

| 対象 | ファイル | 該当行 | 修正内容 |
|---|---|---|---|
| [新規-C] cancel: participant_id | `app/api/cancel/route.ts` | L9-13 | `!participant_id` チェックの後に UUID_RE 検証を追加 |
| [新規-D] participants: event_id | `app/api/participants/route.ts` | L16 | `!event_id` チェックの後に UUID_RE 検証を追加 |
| [新規-E] admin/events PATCH: id | `app/api/admin/events/route.ts` | L188付近 | DELETE と同様の UUID_RE 検証を追加 |
| [新規-F] members PATCH: member_id | `app/api/members/route.ts` | L92付近 | UUID_RE 検証を追加 |

共通パターン（各ファイルの先頭に定義、または `lib/api-auth.ts` / 新規 `lib/validators.ts` に切り出し）:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
```

---

#### 【新タスク4】members の name 最大長チェック [新規-G]（対応済み）

**ファイル**: `app/api/members/route.ts`

**問題**: POST（L47）・PATCH（L95）の両方で `name` に最大長チェックなし。

**修正**: `admin/events/route.ts` の `validateStringLength` パターンと同様に追加。

```ts
const MAX_NAME_LENGTH = 100

// POST (trimmedName チェックの後)
if (trimmedName.length > MAX_NAME_LENGTH) {
  return NextResponse.json({ error: `name は ${MAX_NAME_LENGTH} 文字以内で入力してください` }, { status: 400 })
}

// PATCH も同様
```

---

#### 【新タスク5】handleDelete が削除失敗時も /admin へ遷移 [新規-M]（対応済み）

**ファイル**: `app/admin/events/[id]/page.tsx`

**現状**（L124-129付近）:
```ts
// 削除APIが500を返しても router.replace('/admin') が実行される
```

**修正**:
```ts
async function handleDelete() {
  const res = await fetch('/api/admin/events', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: event.id }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: '削除に失敗しました' }))
    alert(error ?? '削除に失敗しました')  // またはトースト通知
    return
  }
  router.replace('/admin')
}
```

---

### 優先度：高（まっすん判断済み・着手可）

#### 【新タスク6】レート制限を Supabase テーブルで永続化 [新規-B]（方針決定済み）

**ファイル**: `lib/admin-rate-limit.ts` / `app/api/admin/verify/route.ts` ＋ 新規マイグレーション

**問題**: `lib/admin-rate-limit.ts` の `const attempts = new Map<string, AttemptState>()` がプロセス内メモリのみ。Vercelコールドスタート／複数インスタンスで各々が独立カウンターを持ち、`MAX_ATTEMPTS=5` の制限が実質無効。

**まっすん判断（2026-06-02）**: **Supabase テーブルで永続化**に決定（外部依存追加なし）。Upstash Redis 案は不採用。

**実装方針**:
- 新規マイグレーションで `admin_login_attempts` テーブルを作成（例: `key text primary key`, `count int`, `reset_at timestamptz`, `locked_until timestamptz`）。RLS を有効化し anon/authenticated の直接アクセスは全封鎖（API の service_role のみ操作）。
- `lib/admin-rate-limit.ts` の `getAttemptState`/`isLocked`/`recordFailure`/`clearFailure` を、テーブル読み書き（service_role 経由）に置き換える。**既存のユニットテスト（`ATTEMPT_WINDOW_MS`/`LOCK_MS`/`MAX_ATTEMPTS` のロジック）が壊れないよう、純ロジックとI/Oを分離**して移行する。
- `verify/route.ts` 側は呼び出しを `await` 化する必要がある点に注意。

**適用**: マイグレーション適用はまっすん作業。Codex は SQL ＋コード改修まで。

---

#### 【新タスク7】register_member RPC の anon 権限見直し [新規-I]

**ファイル**: `supabase/migrations/20260526_register_member_rpc.sql` L39

**現状**: `grant execute on function public.register_member(text, uuid) to anon, authenticated`

**問題**: 未認証ユーザーが任意の `auth_user_id` で RPC を直接呼び出せる（API 層バリデーション依存）。

**修正案**: `authenticated` のみに制限するマイグレーション追加。
```sql
revoke execute on function public.register_member(text, uuid) from anon;
```

**注意**: この変更でブラウザ側の未ログイン状態でのサインアップフローが壊れないか要確認。

---

#### 【新タスク8】participants レスポンスから user_code を除外 [新規-H]（露出確定・着手可）

**ファイル**: `app/api/participants/route.ts`（POST のレスポンス）

**確認結果（2026-06-02）**: 露出を確定。`join_event` RPC は `row_to_json(v_participant)`（`20260527_allow_guest_invites_until_capacity.sql:114`）で **participants 全カラムを返却** → `user_code` を含む。API は `result.participant` をそのまま返却（`app/api/participants/route.ts:64-68`）。ゲスト参加時は `user_code = guest:${canonicalMemberId}:${code}` で **会員IDがレスポンスに露出**する。

**修正**: レスポンスの `participant` から `user_code` を除外して返す。`temporary_code` は別途返しているので本人確認用コードはそちらで足りる。
```ts
const { user_code: _omit, ...safeParticipant } = result.participant ?? {}
return NextResponse.json({
  participant: safeParticipant,
  waitlist: false,
  temporary_code: temporaryCode,
})
```

**注意**: フロント側（`JoinForm.tsx` ほか）が `participant.user_code` を参照していないか確認し、参照していれば `temporary_code` 利用に寄せる。

---

### 優先度：低（記録・将来対応）

| 識別子 | 内容 | ファイル |
|---|---|---|
| [新規-J] | RLS が実際に有効化されているかマイグレーションから確認不能 | Supabase Dashboardで確認（E-2参照） |
| [新規-K] | cron cleanup で大量ids時のバッチ処理なし | `app/api/cron/cleanup/route.ts` |
| [新規-L] | レガシーキャンセルの user_code に長さ制限なし | `app/api/cancel/route.ts` L43-45 |
| [新規-N] | getServerSupabase() をモジュールトップレベルで呼び出し（CI環境でのコールドスタートリスク） | 複数route.ts L6 |
| [新規-O] | `add_is_manual_close.sql` にタイムスタンププレフィックスなし（適用順が偶然依存） | `supabase/migrations/add_is_manual_close.sql` |
| [新規-P] | HMAC署名実装が `proxy.ts`（Web Crypto API）と `lib/api-auth.ts`（Node.js crypto）で二重実装 | 両ファイル |

---

## 4. まっすんへの判断依頼

### E-1【解消済み】proxy.ts のリネーム

Next.js 16 docs とビルド/本番スモーク確認により、`proxy.ts` が正式に機能していることを確認済み。現状維持。

### E-2【確認済み・クローズ】RLS 有効化 ＋ 開放ポリシー発見

2026-06-02 Supabase Dashboard 実機確認の結果:
- events/members/participants の **3テーブルとも RLS 有効**（Policies 画面に「Disable RLS」ボタン＝有効状態）。`schema.sql:40-42` の `enable row level security` が本番に反映済み。
- ただし **`participants_delete`（`to public` / `using(true)`）の開放ポリシーを発見** → **新タスク9**として削除対応。

### E-3【確認済み・クローズ】participants レスポンスの user_code 露出

露出を確定（`join_event` RPC が全カラム返却・API がそのまま返却）。**新タスク8**でレスポンスから `user_code` を除外する。

### H-9【確認済み・クローズ】CRON_SECRET

Vercel 環境変数に `CRON_SECRET` 設定済み（2026-06-02 Dashboard 確認）。自動クリーンアップは稼働可能。コード対応不要。

### E-4【対応済み】重複マイグレーションファイル

`20260602_cancel_participant_rpc.sql`（中間版）と `20260602_cancel_participant_lock_order_fix.sql`（最終版）は関数本体が完全同一だったため、まっすん判断により中間版 `20260602_cancel_participant_rpc.sql` を削除済み。

**残存ファイル**: `supabase/migrations/20260602_cancel_participant_lock_order_fix.sql`

### E-5【判断済み】レート制限の外部ストア移行

**まっすん判断（2026-06-02）: Supabase テーブルで永続化に決定**（追加依存なし）。Upstash Redis・現状維持は不採用。→ **新タスク6**で実装。

---

## 5. 検証手順

各タスク実装後：

```bash
# 型チェック
npx tsc --noEmit

# E2E テスト
npm run test:e2e
```

手動確認：
- **新タスク1（proxy.ts）**: `/admin/create` を未ログイン状態でアクセス → `/admin` にリダイレクトされること
- **新タスク2（safeCompare）**: キャンセルフローが従来通り動作すること
- **新タスク3（UUID検証）**: 不正な id/event_id で 400 が返ること
- **新タスク4（name長さ）**: 101文字以上の name で 400 が返ること
- **新タスク5（削除エラー）**: 削除失敗時にエラーが表示され、/admin に遷移しないこと

コミット・デプロイはまっすん承認後のみ。

---

## 6. タスク優先度と依存関係

```
【判断すべて完了（2026-06-02）】
E-2 RLS有効確認済み＋開放ポリシー発見 → 新タスク9
E-3 user_code露出 確定 → 新タスク8
E-5 レート制限 = Supabaseテーブルに決定 → 新タスク6
H-9 CRON_SECRET 設定済み確認 → クローズ

【今回 Codex が着手するタスク（着手可・並列OK）】
🔴 新タスク9: participants_delete 開放ポリシー DROP（最優先・DB / まっすん適用）
   新タスク6: レート制限 Supabaseテーブル永続化（DB+コード / まっすん適用）
   新タスク8: participants レスポンスから user_code 除外（コードのみ）
   新タスク7: register_member anon権限剥奪（DB / サインアップ要検証 / まっすん適用）

【対応済み（前回まで）】
E-1 proxy.ts 現状維持 / E-4 マイグレーション重複削除
新タスク2: safeCompare / 新タスク3: UUID検証横展開
新タスク4: members name長さ / 新タスク5: handleDelete エラー

【共通ルール】
- DBマイグレーションの適用はまっすん。Codex は SQL／コード作成と差分提示まで。
- コミット・push・デプロイはまっすん承認後のみ。ファイル削除は AI 不可。
```
