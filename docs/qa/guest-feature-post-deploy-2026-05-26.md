# 友達臨時ID機能 デプロイ後テスト: 2026-05-26

対象: https://basketball-circle.vercel.app/events/6defef7b-59e2-4ade-8943-4c51487118e6

## 実行結果

| ID | 観点 | 結果 | メモ |
| --- | --- | --- | --- |
| GF-01 | 本番反映 | OK | 一覧に `ニックネーム変更` が表示され、一覧の会場はリンクではなく通常テキスト |
| GF-02 | イベント詳細内Google Mapリンク | OK | 詳細画面の会場リンクは維持 |
| GF-03 | 本人参加後の友達追加UI | OK | `友達を呼ぶ`、友達名入力、追加ボタン、`0 / 3 名発行済み` を確認 |
| GF-04 | 友達3名まで追加 | OK | `Guest Friend 1` から `Guest Friend 3` まで追加、臨時ID表示を確認 |
| GF-05 | 3名到達時の制御 | OK | `3 / 3 名発行済み` となり、入力欄と追加ボタンが disabled |
| GF-06 | 参加者一覧への反映 | OK | 友達3名が参加者リストに入り、各行に臨時IDが表示 |
| GF-07 | 友達取消 | OK | 3名すべて取消後、`0 / 3 名発行済み` に戻る |
| GF-08 | 後片付け | OK | 本人参加もキャンセルし、参加者数は `1 / 40` に戻った |
| GF-09 | ブラウザコンソール | OK | アプリ由来の warning/error なし |

## 証跡

保存先: `docs/qa/evidence/2026-05-26-guest-feature/`

- `01-before-join.png`
- `02-after-join-guest-ui.png`
- `03-after-three-guests.png`
- `04-after-guest-cleanup.png`
- `05-after-all-cleanup.png`

## 後片付け

- `Guest Friend 1` / `Guest Friend 2` / `Guest Friend 3` はキャンセル済み。
- テストユーザー `No.008 検証 太郎(PD)` の本人参加もキャンセル済み。
