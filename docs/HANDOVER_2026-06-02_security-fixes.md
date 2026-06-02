# HANDOVER 2026-06-02 — セキュリティ・整合性修正タスク（Codex向け）

> このドキュメントは Workflow による多角的システム監査（31エージェント・68件指摘・21件をCritical/Highとして確認）の結果を、Codex が着手できる形に整理したものです。
> Claude Code が各指摘を実ファイルで裏取り済み。監査レポートの誤りは訂正済みです。

---

## 0. 最重要の前提（着手前に必読）

### 0-1. この Next.js は通常版と異なる
`AGENTS.md` の指示：

> This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. **Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.** Heed deprecation notices.

- `package.json`: `next@16.2.6` / `react@19.2.4` / `@base-ui/react@^1.5.0` など**非標準・将来バージョン**を意図的に使用している。
- 学習データの Next.js 14/15 の知識で書くと API が合わない可能性が高い。**コードを書く前に必ず `node_modules/next/dist/docs/` の該当ガイドを読むこと。**
- 既存の実装パターン（route handler の書き方・`NextRequest`/`NextResponse` の使い方）に必ず合わせる。

### 0-2. 運用ルール（このリポジトリ固有）
- **秘密情報をコードに書かない。** パスワード等は必ず環境変数（`.env.local` / Vercel 環境変数）から読む。
- **git commit / push / deploy は人間（まっすん）承認後のみ。** Codex は実装と差分提示まで。コミットはしない。
- **ファイル削除は AI 不可。** 不要ファイルは削除せず、まっすんに削除候補として報告する。
- 既存ファイルを確認せずに上書きしない。

### 0-3. 環境変数の実態（参考）
- `ADMIN_PASSWORD` は **5桁数字ではなく文字列**（`.env.local` に設定済み）。
  → 監査レポートが言う「5桁数字90,000通りのブルートフォース」は**誤り**（参加者の `user_code` と混同したもの）。レート制限・定数時間比較がない事実は正しいので、そこを修正対象とする。
- `SUPABASE_SERVICE_ROLE_KEY` は Vercel 本番環境に設定済み（サーバーサイド限定・`NEXT_PUBLIC_` 接頭辞なし＝ブラウザに露出していない）。
- `CRON_SECRET` の Vercel 設定状況は**要確認**（H-9 参照）。

---

## 1. Phase 1 — 本番公開前に必須

### [C-1] メンバー登録 API が Bearer トークンなしで通過する 🔴
- **ファイル**: `app/api/members/route.ts` POST（L54-65）
- **現状**:
  ```ts
  const user = await getBearerUser(req)
  if (user && user.id !== auth_user_id) {        // ← user が null だとチェックごとスキップ
    return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
  }
  ```
  `Authorization` ヘッダーなしだと `getBearerUser` が `null` を返し、`user &&` の短絡で本人確認が完全にスキップされる。任意の `auth_user_id` を指定して**他人名義のメンバー行を作成可能**。
- **修正**: トークン必須化。`PATCH` 側（L94-97）と同じパターンに揃える。
  ```ts
  const user = await getBearerUser(req)
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }
  if (user.id !== auth_user_id) {
    return NextResponse.json({ error: '本人確認に失敗しました' }, { status: 403 })
  }
  ```
- **注意**: 登録フロー（`/register` ページ）が POST 時に Bearer トークンを送っているか要確認。送っていなければフロント側も合わせて修正が必要（Supabase Auth のサインアップ直後のセッショントークンを付与）。

### [C-3] `/admin` と `/api` が Proxy 認証を完全に回避 🔴
- **ファイル**: `proxy.ts`（Next.js 16 のルート前処理ファイル）
- **現状**: 以前の実装ではパススルーリストに `pathname.startsWith('/admin')` と `pathname.startsWith('/api')` が含まれ、管理画面・管理APIにサーバーサイド認証が一切かからなかった。現行実装は `proxy.ts` で `/admin` 配下をHttpOnlyクッキー検証している。
- **修正方針**（[H-5][H-6] とセットで対応）:
  1. `/api` は API 個別で認証するため、Proxy パススルーのままで可（ただし `/api/admin/*` が個別に守られていることを確認）。
  2. `/admin` ページ群は **HttpOnly セッションクッキー方式**に移行する：
     - `/api/admin/verify` で認証成功時に `Set-Cookie`（HttpOnly / Secure / SameSite=Strict / 有効期限付き）でセッショントークンを発行。
     - `proxy.ts` で `/admin` 配下はクッキー検証 → 失敗時 `/admin`(ログイン) へリダイレクト。
     - これにより各 admin ページの `localStorage` 依存（[H-6]）を廃止できる。
- **注意**: Next.js 16 のクッキー/Proxy API は通常版と異なる可能性大。`node_modules/next/dist/docs/` で `proxy.ts` / Cookie API の正しい使い方を確認してから実装すること。

### [C-4] 管理者パスワード検証にレート制限・定数時間比較がない 🟠（Critリストから降格）
- **ファイル**: `app/api/admin/verify/route.ts`
- **現状**:
  ```ts
  if (password === process.env.ADMIN_PASSWORD) { ... }
  ```
  - レート制限なし → 総当たり試行が無制限。
  - `===` 比較 → タイミング攻撃の理論的余地（実害は低いが定石として修正）。
- **訂正**: パスワードは文字列 `basketball2026` であり「5桁数字90,000通り」ではない。脅威度は監査レポートより低い。ただしレート制限と定数時間比較は実装する価値がある。
- **修正**:
  - `lib/api-auth.ts` に `safeCompare(a, b)`（`crypto.timingSafeEqual` ベース、長さ不一致も安全に処理）を追加し、`verify` / `events` / `cancel` の3箇所の比較を置換（[H-1]）。
  - レート制限: IP単位の簡易制限。外部依存（`@upstash/ratelimit` 等）を増やす前に、まずは**メモリ内の簡易カウンタ or 失敗回数の指数バックオフ**で足りるか検討。依存追加は人間承認が必要。

### [H-1] 管理者パスワードの `===` 比較（3箇所）🟠
- **ファイル**: `app/api/admin/verify/route.ts`(L5) / `app/api/admin/events/route.ts`(L8-11 `checkAdmin`) / `app/api/cancel/route.ts`(L116)
- **修正**: `lib/api-auth.ts` に共通 `checkAdmin(req)` と `safeCompare` を実装し、3箇所を統一。
  - `app/api/admin/events/route.ts` には既に `checkAdmin(req)`（`x-admin-password` ヘッダー方式）がある。これを `lib/api-auth.ts` に移して全箇所から使う形に集約するのが綺麗。

### [H-2] キャンセル API がリクエストボディで管理者パスワードを受け取る 🟠
- **ファイル**: `app/api/cancel/route.ts`（L95 `user_code`、L116 `admin` 分岐）
- **現状**: `{ admin: true, user_code: <ADMIN_PASSWORD> }` を JSON ボディで送る設計。パスワードがアクセスログ/プロキシに平文で残る。`user_code`（参加者の本人確認コード）と管理者パスワードが同一フィールドに混在し監査困難。
- **修正**: 管理者キャンセルは `x-admin-password` ヘッダー方式（= 新設 `checkAdmin`）に統一。フロント側 `app/admin/events/[id]/page.tsx` の `adminCancel`（`body: { ..., user_code: password, admin: true }`）も**ヘッダー送信に変更**する。
  - 併せて [C-3] のクッキー方式に移行するなら、最終的にはクッキー検証で代替するのが理想。段階対応として、まずヘッダー化 → 後でクッキー化でも可。

### [H-5] create/edit ページがパスワード再検証をスキップ 🟠
- **ファイル**: `app/admin/create/page.tsx` / `app/admin/events/[id]/edit/page.tsx`
- **現状**: `localStorage` にキーがあれば即 `ready=true`。`/api/admin/verify` を叩かない（`app/admin/events/[id]/page.tsx` は検証している）。
- **修正**: 両ページの初期化 `useEffect` で `/api/admin/verify` を実行し、失敗時は `/admin` にリダイレクト。
  - ただし [C-3] のクッキー方式に移行すれば Proxy で一括防御でき、この個別対応は不要になる。**[C-3] を先にやるなら本項は自動解決**。

### [H-6] 管理者パスワードを localStorage に平文保存 🟠
- **ファイル**: `app/admin/page.tsx` ほか admin 各ページ（`localStorage.setItem('basketball_admin_password', password)`）
- **修正**: [C-3] の HttpOnly クッキー方式に移行して `localStorage` 依存を全廃。
  - これが Phase 1 の中核。**[C-3][H-2][H-5][H-6] は「管理者認証のクッキー化」という1つの設計変更でまとめて解消できる**ので、一括設計を推奨。

---

## 2. Phase 2 — リリース後1週間以内

### [C-2] service_role_key 未設定時に anon キーへサイレントフォールバック 🔴
- **ファイル**: `lib/supabase-server.ts`（L9）
- **現状**:
  ```ts
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ```
  キー未設定環境では全サーバー操作が anon 権限で走る。RLS で書き込みはブロックされているが、フェイルセーフとして危険。
- **修正**:
  ```ts
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server operations')
  }
  ```
- **注意**: `getAuthSupabase()` は anon キーを使う正当な用途（トークン検証）なのでそのまま。`getServerSupabase()` だけ修正。

### [H-9] Cron が `CRON_SECRET` 未設定だと毎日のクリーンアップが動かない 🟠
- **ファイル**: `app/api/cron/cleanup/route.ts`（L9-12）
- **現状**: `CRON_SECRET` 未設定なら 500 を返す（フェイルクローズ自体は正しい）。問題は**Vercel 環境変数に未設定だと自動削除が一切動かない**こと。
- **修正**: コード変更は不要。**Vercel Dashboard に `CRON_SECRET` を設定**（まっすん作業）＋ `.env.local.example` にドキュメント化。Codex は example ファイルの追記と README 注記のみ。

### [H-3][H-7] キャンセル処理の TOCTOU 競合 🟠
- **ファイル**: `app/api/cancel/route.ts`（`normalizeSlots` / `syncEventStatusAfterActiveCancel`）
- **現状**: キャンセル後のスロット振り直しが独立 N 個の UPDATE を `Promise.all` で発行（トランザクションなし）。再オープン判定もカウント読み取り→更新が非アトミック。並行キャンセルでスロット番号不整合・再オープン誤判定の余地。
- **修正方針**: PostgreSQL RPC（`security definer`）に移行し、`SELECT ... FOR UPDATE` で対象イベントの参加者行をロック → `ROW_NUMBER()` で単一 UPDATE → 再オープン判定まで1トランザクションで実行。
  - 既存 `join_event` RPC（`supabase/migrations/`）と同じ設計思想。新規マイグレーションファイルとして追加。
  - **DB マイグレーション適用はまっすん作業**（Supabase ダッシュボード or CLI）。Codex は SQL とマイグレーションファイルを用意する。

### [H-8] join_event RPC のスロット番号に UNIQUE 制約がない 🟠
- **ファイル**: `supabase/migrations/20260527_allow_guest_invites_until_capacity.sql`（L57-94 付近）
- **現状**: `events` 行に `FOR UPDATE` ロックはあるが `participants` への同時 INSERT は防げず、`slot_number` 重複がサイレント保存され得る。
- **修正**: 新規マイグレーションで `participants(event_id, slot_number)` に部分 UNIQUE 制約を追加（`status IN ('active','waitlist')` を条件にした partial unique index 推奨。cancelled 行は重複可）。
  ```sql
  CREATE UNIQUE INDEX participants_event_slot_active_uq
    ON participants (event_id, slot_number)
    WHERE status IN ('active', 'waitlist');
  ```
  - 既存データに重複がないか先に確認（重複あると index 作成が失敗する）。

### [M-4][M-8] セキュリティヘッダー未設定 🟡
- **ファイル**: `next.config.ts`（実質空）
- **修正**: `headers()` で `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` / `Referrer-Policy` / 最小限の CSP を付与。
  - **Next.js 16 の config 形式を `node_modules/next/dist/docs/` で確認してから書く**こと。

---

## 3. Phase 3 — 継続的改善

### [C-5] participants の waitlist 削除ブロック 🟢（対応済み）
- **ファイル**: `app/api/participants/route.ts`
- **確認結果**: 現行 `join_event` RPC は `waitlist: false` しか返さず、容量超過時はエラーを返す設計。待機リスト成功時の後処理分岐は到達不能だった。
- **対応**: 到達不能分岐と専用メッセージ定数を削除済み。API レスポンスの `waitlist: false` は互換性維持のため残す。

### [M-1] DELETE /api/admin/events が id を UUID 検証していない 🟡
- **ファイル**: `app/api/admin/events/route.ts`（L129-130, `!id` チェックのみ）
- **修正**: UUID 形式バリデーションを追加（不正フォーマットは 400）。

### [M-13] DELETE の participants 削除エラーを未確認 🟡
- **ファイル**: `app/api/admin/events/route.ts`（L132 `await supabase.from('participants').delete()` の戻り `error` を見ていない）
- **修正**: `const { error } = await ...` で受けて、失敗時は 500 を返す（events 削除前に中断）。

### [M-2][M-3] 入力バリデーション強化 🟡
- 文字列フィールド（`title` / `name` / `location` / nickname 等）にサーバー側の最大長チェックを追加。
- `location_url` を URL スキーム検証（`http`/`https` のみ許可、`javascript:` 等を弾く）。`new URL()` でパースし `protocol` をチェック。

### [M-12] 再オープン時に max_participants が threshold で上書きされ元の値が失われる 🟡
- **ファイル**: `app/api/cancel/route.ts`（`syncEventStatusAfterActiveCancel`）
- **状況**: これは**2026-05-29 のまっすん指示による意図的な仕様**（再開時の上限＝閾値）。バグではない。
- **アクション**: 修正不要。ただし「元の max を別カラムに保持して再開後も元定員に戻せるようにする」案があるなら検討材料として残す。**現状維持でOK。**

### [L-1] CancelModal の `typeof window !== undefined` 比較ミス 🟢（要現物確認）
- 監査が `'undefined'`（文字列）との比較が必要と指摘。`components/CancelModal.tsx` を読んで該当箇所を確認 → 誤りなら `typeof window !== 'undefined'` に修正。
  - ※ そもそも該当コードが残っているか（管理画面はカスタムモーダルに移行済み）を先に確認。

### [M-9] lucide-react のバージョン 🟢（要確認・据え置き可）
- `package.json`: `lucide-react: ^1.16.0`。標準 npm では存在しないバージョンに見えるが、**この環境は `next@16.2.6` 等の非標準バージョンを意図的に使用しており、現在 Vercel デプロイは成功している**。
- **アクション**: 安易に変更しない。現在ビルドが通っているなら据え置き。もし将来クリーンビルドで失敗したらその時に対応。Codex は**変更せず報告のみ**。

### その他（軽微）
- `package.json` に `type-check` スクリプト追加（`"type-check": "tsc --noEmit"`）。
- `vercel.json` の Cron にタイムゾーン明記の検討（現状 `0 15 * * *` = 00:00 JST 想定。Vercel Cron は UTC 基準なので現状で正しいが、コメント/ドキュメントで明示）。

---

## 4. 良好な点（維持すべき設計）
- RLS ポリシー（`20260527_harden_public_mutation_policies.sql`）で events/members/participants の anon 直接書き込みを全ブロック済み。
- `SUPABASE_SERVICE_ROLE_KEY` はサーバー限定でブラウザ未露出。
- `lib/api-auth.ts` のメンバー認証パターン（`getAuthenticatedMember`）は適切。**管理者認証もこのファイルに集約するのが望ましい。**
- `app/api/admin/events/route.ts` の入力バリデーション（日付・正整数・容量関係）は良くできている。他のエンドポイントの手本にする。

---

## 5. 推奨着手順（依存関係を考慮）
1. **管理者認証クッキー化**（[C-3]+[H-2]+[H-5]+[H-6] を1設計でまとめる）← 最優先・影響大
2. **[C-1]** メンバー登録のトークン必須化（独立・小さい）
3. **`lib/api-auth.ts` に `checkAdmin`+`safeCompare` 集約**（[H-1]+[C-4]）
4. **[C-2]** service_role_key フォールバック削除（独立・小さい）
5. **[H-9]** CRON_SECRET ドキュメント化（コード変更ほぼなし）
6. DB系（[H-3][H-7][H-8]）はマイグレーション新規作成 → まっすんが適用
7. 残りの Medium/Low を順次

---

## 6. 検証手順
- ローカル: `npm run dev` で起動し、各 API を curl/ブラウザで確認。
  - [C-1]: トークンなしで `POST /api/members` → 401 になること。
  - [C-3]: ログインせず `/admin` 直アクセス → ログインへリダイレクトされること。
  - 管理者操作（締切/再開/削除/強制キャンセル）が認証クッキー経由で従来通り動くこと。
- 型チェック: `npx tsc --noEmit`。
- E2E: `npm run test:e2e`（Playwright）が通ること。
- **コミット・デプロイはしない。** 差分をまっすんに提示して承認を待つ。

---

## 7. 監査メタデータ
- 監査方法: Workflow（6ディメンション並列スキャン → Critical/High を独立エージェントで敵対的検証 → 集約）
- 指摘総数 68 / Critical・High 確認 21 / Medium・Low・Info 44
- 全 Critical・主要 High は Claude Code が実ファイルで再確認済み（本ドキュメントは確認後の訂正を反映）
- 検証日: 2026-06-02
