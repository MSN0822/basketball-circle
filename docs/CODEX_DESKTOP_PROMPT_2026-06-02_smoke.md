# Codexデスクトップアプリ用プロンプト — 本番スモークテスト（2026-06-02）

---

## プロンプト本文（コピペ用）

このリポジトリは Next.js 16.2.6 / React 19 / Supabase のバスケサークル参加管理アプリです。
必読: `AGENTS.md` の通り、このバージョンの Next.js は通常版と異なります。ただし今回の作業はスモークテストの実行とスクリプト1箇所の修正のみです。

---

### 背景

2026-06-02 付のセキュリティ修正（Phase4 まで）を本番 Vercel にデプロイ済み。
そのうちの新タスク8（`participants` APIレスポンスから `user_code` を除外）を適用したことで、既存の本番スモークスクリプト `scripts/qa-production-smoke.mjs` の **D-02 テスト** に既知の回帰がある。修正してからスモークを走らせてほしい。

---

### やってほしいこと

#### Step 1: D-02 テストを修正

`scripts/qa-production-smoke.mjs` の **D-02** ケースを修正する。

**現状（FAIL する）**:
```js
await record('D-02', 'Member who is not personally joining can add a friend', async () => {
  const res = await join(mainEvent.id, `${runId} 友達A(佐藤の友達)`, memberB.member.id, true, memberB.accessToken)
  return { status: res.status, body: res.body, passed: res.ok && res.body.participant?.user_code?.startsWith(`guest:${memberB.member.id}:`) }
})
```

**修正後（PASS させる）**:

`app/api/participants/route.ts` が `temporary_code` で `guest:${canonicalMemberId}:${temporaryCode}` の `temporaryCode` 部分を返すように変わった（`user_code` はレスポンスから除外済み）。
よって、ゲスト参加の確認は次のように変更する：
- `user_code` の代わりに `temporary_code` でゲスト招待が成功したことを確認する
- 合わせて D-04 も同じパターンで `user_code` を参照しているか確認し、あれば同様に直す

**修正方針**（`temporary_code` がゲスト参加時にセットされているかで判定）:
```js
await record('D-02', 'Member who is not personally joining can add a friend', async () => {
  const res = await join(mainEvent.id, `${runId} 友達A(佐藤の友達)`, memberB.member.id, true, memberB.accessToken)
  return { status: res.status, body: res.body, passed: res.ok && Boolean(res.body.temporary_code) && res.body.participant?.user_code === undefined }
})
```

> ※ `user_code` がレスポンスに**出ていない**（`undefined`）ことも確認に加えること（新タスク8 のセキュリティ保証）。

#### Step 2: D-04 を確認・修正

`D-04` テストも同様に `user_code` を参照していれば同じ修正を適用する。

#### Step 3: スモークを実行

```
node scripts/qa-production-smoke.mjs
```

接続先は `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ADMIN_PASSWORD` を使う。
本番 API への HTTP アクセスと、本番 Supabase への DB アクセスを伴う（QA_KEEP_ プレフィックスのテストデータが作成される）。

#### Step 4: 結果を報告

stdout の JSON (`summary.json` 相当) を返す。特に以下を確認：
- `counts.failed` が 0（または D-02/D-04 以外の想定外 FAIL がない）こと
- **A-09** (`Member POST without Authorization is rejected`) が PASS ＝ 401/403 を返すこと（セキュリティ修正 [C-1] の確認）
- **G-01〜G-05** (`Anon direct * is blocked`) が全 PASS ＝ RLS が有効なこと
- **F-01/F-02** (`Admin verification`) が PASS ＝ 管理者認証クッキーが動いていること
- **A-04** (`Create QA auth users`) が PASS ＝ サインアップ動線（`register_member` RPC）が壊れていないこと（anon 権限剥奪 [新タスク7] の影響確認）

---

### 厳守ルール

- `git commit` / `git push` はしない（差分提示のみ）
- `apply-migration.mjs` は実行しない
- ファイル削除しない
- `ADMIN_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` などを出力にハードコードしない（スクリプト内で redact 済みなので問題ないが、追加で外に出さない）
- スモーク実行によって本番 DB に `QA_KEEP_*` のテストイベント・会員が作られるのは想定内（クリーンアップは別スクリプト `scripts/reset-demo-events.mjs` で実施するため今回は対象外）

---

### 参考：チェック観点（セキュリティ修正との対応）

| テストID | 修正との対応 |
|---|---|
| A-09 | [C-1] Bearer トークンなしで members POST → 401 |
| A-04 | [新タスク7] anon 権限剥奪後もサインアップが通る |
| D-02 | [新タスク8] user_code がレスポンスに出ない（修正後 temporary_code で代替確認） |
| F-01/F-02 | [C-3][H-6] 管理者認証クッキー化が本番で動く |
| G-01〜G-05 | [新タスク9] participants_delete 開放ポリシーが封鎖済み |
