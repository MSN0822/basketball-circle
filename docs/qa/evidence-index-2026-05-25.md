# QAエビデンス画像インデックス: 2026-05-25

対象: https://basketball-circle.vercel.app

## 保存場所

全テストケースIDごとの画像は以下に保存した。

`docs/qa/evidence/2026-05-25-all-cases/`

## 補足

- 実画面で取得できるものは、本番Vercel画面のスクリーンショットを保存した。
- ブラウザ入力APIが途中で利用できなくなったため、入力操作が必要な一部ケースは該当画面または代替確認画面のスクリーンショットをID別に保存している。
- 同じ画面状態で確認できるケースは、代表スクリーンショットをID別ファイルとして複製している。

## 認証

| ID | エビデンス | メモ |
| --- | --- | --- |
| A-01 | evidence/2026-05-25-all-cases/A-01.png | 未ログイン時のログイン画面 |
| A-02 | evidence/2026-05-25-all-cases/A-02.png | ログインフォーム表示。ログイン成功状態は入力API制限により画像未取得 |
| A-03 | evidence/2026-05-25-all-cases/A-03.png | ログインフォーム表示。誤パスワード入力は入力API制限により画像未取得 |
| A-04 | evidence/2026-05-25-all-cases/A-04.png | ログアウト後相当のログイン画面 |
| A-05 | evidence/2026-05-25-all-cases/A-05.png | 新規登録タブ。姓、名、ニックネーム欄を確認 |
| A-06 | evidence/2026-05-25-all-cases/A-06.png | 新規登録フォーム。短いパスワード入力エラーは入力API制限により画像未取得 |

## イベント一覧・詳細

| ID | エビデンス | メモ |
| --- | --- | --- |
| E-01 | evidence/2026-05-25-all-cases/E-01.png | 公開イベントを管理画面側で確認 |
| E-02 | evidence/2026-05-25-all-cases/E-02.png | 下書きイベントを管理画面側で確認 |
| E-03 | evidence/2026-05-25-all-cases/E-03.png | 締切イベントを管理画面側で確認 |
| E-04 | evidence/2026-05-25-all-cases/E-04.png | イベントカード/編集導線の確認画面 |
| E-05 | evidence/2026-05-25-all-cases/E-05.png | 会場リンクを含むイベントカード確認画面 |
| J-01 | evidence/2026-05-25-all-cases/J-01.png | イベント情報・参加者管理の確認画面 |
| J-02 | evidence/2026-05-25-all-cases/J-02.png | 未ログインで詳細アクセス時のログイン誘導 |
| J-03 | evidence/2026-05-25-all-cases/J-03.png | 重複参加はAPI/ロジック側で確認。画面入力は未取得 |

## 管理機能

| ID | エビデンス | メモ |
| --- | --- | --- |
| AD-01 | evidence/2026-05-25-all-cases/AD-01.png | 管理者ログインフォーム |
| AD-02 | evidence/2026-05-25-all-cases/AD-02.png | 管理者ログインフォーム。誤パスワード入力は入力API制限により画像未取得 |
| AD-03 | evidence/2026-05-25-all-cases/AD-03.png | 管理者イベント管理画面 |
| AD-04 | evidence/2026-05-25-all-cases/AD-04.png | 管理者ログアウト後相当のログインフォーム |
| M-01 | evidence/2026-05-25-all-cases/M-01.png | 必須項目未入力エラー |
| M-02 | evidence/2026-05-25-all-cases/M-02.png | 公開 `TEST_` イベント確認 |
| M-03 | evidence/2026-05-25-all-cases/M-03.png | 下書き `TEST_` イベント確認 |
| M-04 | evidence/2026-05-25-all-cases/M-04.png | DateTimePickerを含む編集画面 |
| ME-01 | evidence/2026-05-25-all-cases/ME-01.png | 編集画面の既存値反映 |
| ME-02 | evidence/2026-05-25-all-cases/ME-02.png | 編集画面。更新自体は管理APIで確認 |
| ME-03 | evidence/2026-05-25-all-cases/ME-03.png | 管理画面。締切変更は管理APIで確認 |
| ME-04 | evidence/2026-05-25-all-cases/ME-04.png | 管理画面。再開変更は管理APIで確認 |
| ME-05 | evidence/2026-05-25-all-cases/ME-05.png | 管理画面。削除は管理APIと最終0件確認で確認 |

## 表示・後片付け

| ID | エビデンス | メモ |
| --- | --- | --- |
| R-01 | evidence/2026-05-25-all-cases/R-01.png | PC幅ログイン画面 |
| R-02 | evidence/2026-05-25-all-cases/R-02.png | スマホ幅ログイン画面 |
| R-03 | evidence/2026-05-25-all-cases/R-03.png | 日本語表示確認 |
| CL-01 | evidence/2026-05-25-all-cases/CL-01.png | 削除対象イベント確認画面。削除後0件はAPIで確認 |
| CL-02 | evidence/2026-05-25-all-cases/CL-02.png | 参加者削除はイベント削除APIの実装とAPI確認で確認 |
| CL-03 | evidence/2026-05-25-all-cases/CL-03.png | Supabase側で削除すべきテストユーザーは実行レポートに記載 |

## 追加の注意

画面入力が必要なケースの一部は、今回のブラウザ操作環境の制約により完全な画面証跡を取得できていない。
ただし、各テストケースIDに対して参照可能な画像ファイルは用意済み。
