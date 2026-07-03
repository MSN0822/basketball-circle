# メール確認方式 切替 Runbook

> **目的**: 会員登録時のメール確認（6桁OTP・Supabase 内蔵メールは無料枠 1時間2通）を
> 「やめる」または「上限だけ解消して続ける」と決めた日に、この手順書の上から順に実行するだけで
> 安全に切り替えられる状態を保つ。living doc として実装変更時に追従させる。

---

## 0. 意思決定（どちらかを選ぶ）

| | 案A: 独自 SMTP へ移行（Resend 等） | 案B: メール確認を OFF |
|---|---|---|
| 何が変わるか | 送信元が Supabase 内蔵メール → Resend に変わるだけ。登録フロー（6桁コード）は今のまま | 登録ボタンを押すと確認メールなしで即登録完了 |
| 送信上限 | 解消（Resend 無料枠 約3,000通/月） | 解消（そもそも送らない） |
| コード変更 | 不要（ダッシュボード設定のみ） | 不要（ダッシュボード設定のみ。文言等は対応済み） |
| セキュリティ | 現状維持（メール到達性を検証） | **他人のメールアドレスで登録可能になる**。ゴミ会員が会員番号を消費しうる |
| 将来の制約 | なし | パスワードリセット機能を将来入れる場合、未検証メールが障害になる |
| 事前準備 | ドメイン検証（DNS 操作） | §2 の未確認ユーザー救済が**必須** |
| 推奨 | **第一候補**（上限問題だけを低リスクで解消） | 登録の手間を最小化したい場合 |

どちらもロールバックはダッシュボード設定を戻すだけ（デプロイ不要・即時反映）。

---

## 1. 設定マトリクス（現状の依存関係）

登録フローの挙動は「Confirm email トグル × メールテンプレ × SMTP」の組合せで決まる。

| Confirm email | テンプレに `{{ .Token }}` | 挙動 |
|---|---|---|
| ON | あり（現行） | 6桁コード入力で登録完了（現行仕様） |
| ON | **なし**（テンプレが剥がれた場合） | メールにコードが載らず**全新規登録が詰む**。リンク（`{{ .ConfirmationURL }}`）経由のみ可 |
| OFF | （無関係・メール送信なし） | signUp が即 session を返し登録完了。`app/login/page.tsx` の直接登録パスが処理（コード変更不要） |

- テンプレは `supabase/email-templates/confirm-signup.html` を Supabase Studio へ**手貼り**する運用
  （手順: `docs/supabase-email-templates.md`）。剥がれても自動検知の仕組みは**ない**。
  メール確認 ON を続ける限り、Auth 設定を触った後はテンプレに `{{ .Token }}` が残っているか目視確認する。
- **本番 URL Configuration**（Dashboard → Authentication → URL Configuration）:
  Site URL / Redirect URLs に本番オリジン（`https://<本番ドメイン>` と `https://<本番ドメイン>/auth/callback`）が
  登録されていることがメール内リンク確認の前提。`supabase/config.toml` の `site_url` は
  ローカル専用（127.0.0.1）で本番には無関係。未設定だとリンク確認が redirect mismatch で失敗する。

---

## 2. 案B: メール確認 OFF への即時切替手順

### 2-1. 事前準備 — 未確認ユーザーの救済（必須）

切替は新規登録にしか効かない。**切替前に OTP 未入力のまま残ったユーザーは、切替後も
「Email not confirmed」でログインできないまま取り残される**ため、先に一括 confirm する。

```
# 1) dry-run（表示のみ）で対象を確認
node scripts/list-unconfirmed-auth-users.mjs

# 2) 一覧を目視確認のうえ一括 confirm（不可逆・二重ガード付き）
#    PowerShell:
$env:CONFIRM_APPLY='1'; node scripts/list-unconfirmed-auth-users.mjs --apply
#    Bash:
CONFIRM_APPLY=1 node scripts/list-unconfirmed-auth-users.mjs --apply
```

- `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` が**本番**を
  指していることを実行前に確認する。
- 「未確認ユーザーはいません」と出れば confirm 不要。そのまま 2-2 へ。

### 2-2. ダッシュボード切替

1. Supabase Dashboard → Authentication → Providers → Email
2. **Confirm email** を **OFF**
3. 保存（即時反映・デプロイ不要）

### 2-3. 実機検証

1. 未使用のメールアドレスで新規登録 → 確認コード画面を経由せず**即トップページへ遷移**することを確認
2. 参加者一覧等に会員として表示されること（members 行の作成）を確認
3. 2-1 で confirm した既存ユーザーが通常ログインできることを確認

### 2-4. あと片付け（同日でなくてよい）

- `supabase/config.toml` の `enable_confirmations` を `false` に変更してコミット
  （将来 config 同期を導入した場合に本番 OFF が上書きされる罠の防止。同ファイルのコメント参照）
- `docs/operations-spec.md` の「3. 会員登録・ログイン」内のメール確認・送信上限の記述を実態に合わせて更新
- `docs/DEPLOY_RUNBOOK.md` §9 の OTP 長・メール上限チェック項目に「メール確認 OFF 運用中は不要」と注記

### 2-5. ロールバック

Confirm email を ON に戻すだけ。confirm 済みユーザーはそのまま有効。
（ON に戻した後はテンプレの `{{ .Token }}` が残っているか §1 のとおり目視確認）

---

## 3. 案A: Resend 等の独自 SMTP への移行手順

1. Resend（https://resend.com）でアカウント作成 → Domains で送信ドメインを追加し、
   表示される DNS レコード（SPF/DKIM）をドメイン側に登録 → Verified になるまで待つ
2. Resend → API Keys → SMTP 資格情報を取得
3. Supabase Dashboard → Project Settings → Authentication → **SMTP Settings** で
   Custom SMTP を有効化し、Resend の host / port / user / password と送信元アドレスを設定
4. 実機検証: 新規メールで登録 → 確認コードメールが**送信元 Resend** で届き、6桁コードで登録完了できること
5. ロールバック: Custom SMTP を無効化（内蔵メール・1時間2通制限に戻る）

- コード・テンプレ・登録フローの変更は一切不要（送信経路が変わるだけ）
- Supabase 側のレート制限設定（Auth → Rate Limits）が別途かかっている場合は合わせて緩和する

---

## 4. 関連ファイル

- `app/login/page.tsx` — 登録・ログイン・確認コード入力の実装（Confirm OFF 時は signUp が
  即 session を返し、直接登録パスで完結する）
- `app/auth/callback/page.tsx` — メール内リンク確認の受け口（Confirm OFF ではメール自体が飛ばず未使用化）
- `scripts/list-unconfirmed-auth-users.mjs` — 未確認ユーザーの洗い出し＋一括 confirm
- `supabase/config.toml` — ローカル専用 Auth 設定（罠コメントあり）
- `supabase/email-templates/confirm-signup.html` / `docs/supabase-email-templates.md` — 確認メールテンプレ（Studio 手貼り）
- `docs/operations-spec.md` 「3. 会員登録・ログイン」 — 利用者向け仕様記述
