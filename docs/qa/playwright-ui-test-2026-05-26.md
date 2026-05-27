# Playwright UIテスト実行結果 2026-05-26

対象環境: https://basketball-circle.vercel.app

実行コマンド:

```bash
npm run test:e2e
```

実行結果:

| 項目 | 結果 |
| --- | --- |
| Playwright | 1.60.0 |
| Browser | Chromium |
| テスト数 | 7 |
| PASS | 6 |
| FAIL | 0 |
| SKIP | 1 |

## 証跡

証跡ディレクトリ:

- `docs/qa/evidence/2026-05-26-playwright-QA_KEEP_UI_20260526143014/`
- `docs/qa/evidence/2026-05-26-playwright-QA_KEEP_UI_20260526143533/`
- `docs/qa/evidence/2026-05-27-playwright-QA_KEEP_UI_20260527031325/`

スクリーンショット:

- `01-login.png` ログイン画面
- `02-register-form.png` 新規登録フォーム
- `03-event-detail-redirect-login.png` 未ログイン時のイベント詳細リダイレクト
- `04-admin-list.png` 管理者ログイン後のイベント一覧
- `05-admin-edit-start-end.png` 管理者イベント編集画面の開始/終了入力
- `06-admin-create-validation.png` 管理者イベント作成画面の開始/終了入力と必須バリデーション
- `07-auth-required-note.png` 認証必須導線の補助証跡

Playwrightレポート:

- `docs/qa/playwright-report/results.json`
- `docs/qa/playwright-report/index.html`

## 作成して残したデータ

Playwrightテストでは、管理画面確認用に以下のプレフィックスを持つイベントを本番環境へ作成し、削除せず残した。

- `QA_KEEP_UI_20260526143014`
- `QA_KEEP_UI_20260526143533`
- `QA_KEEP_UI_20260527031325`

## 消化できたUI観点

- ログイン画面が表示できる。
- 新規登録フォームで姓/名/ニックネーム/メール/パスワードの入力欄が表示される。
- 未ログインでイベント詳細へアクセスするとログイン画面に誘導される。
- 管理者ログイン後、Playwrightで作成したイベントが管理一覧に表示される。
- 管理者編集画面に開始日時と終了日時の入力欄が表示される。
- 管理者作成画面に開始日時と終了日時の入力欄が表示され、必須項目不足時にエラー表示される。

## 残るUI観点

参加者本人としてログインした状態のUI操作は、メール確認設定またはログイン可能な専用テストアカウントに依存するため、今回のPlaywright自動テストでは未消化。

`QA_AUTH_EMAIL` と `QA_AUTH_PASSWORD` を `.env.local` または実行環境変数に設定すると、参加者ログイン後のイベント詳細表示と参加ボタン周辺の証跡取得テストが有効になる。

残る候補:

- 本人ログイン後のイベント一覧表示。
- 参加申請後にキャンセルボタンへ置き換わること。
- 友達追加/削除の完全なブラウザ操作。
- 一覧の場所クリックでGoogle Mapsへ飛ばないこと。
- 詳細画面の場所リンクはGoogle Mapsへ飛ぶこと。
