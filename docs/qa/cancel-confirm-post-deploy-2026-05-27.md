# キャンセル確認ダイアログ 本番反映後テスト 2026-05-27

対象環境: https://basketball-circle.vercel.app

対象コミット: `8d759bc fix: confirm member cancellation`

## 結果

| 項目 | 結果 | 補足 |
| --- | --- | --- |
| lint | OK | `npm.cmd run lint` |
| build | OK | `npm.cmd run build` |
| Playwright UI | OK | 7件中7件 PASS |
| API総合スモーク | OK | 33件中33件 PASS |
| キャンセル確認表示 | OK | キャンセルボタン押下で確認ダイアログを表示 |
| キャンセルしない | OK | ダイアログが閉じ、参加状態は維持される |
| キャンセルする | OK | 確認後にキャンセルされ、完了メッセージが表示される |
| デモ掃除 | OK | QAイベントを削除し、運営確認用3件のみ残した |

## エビデンス

- Playwright UI: `docs/qa/evidence/2026-05-27-playwright-QA_KEEP_UI_20260527043759/`
- API総合テスト: `docs/qa/evidence/2026-05-26-comprehensive-QA_KEEP_20260527043838/summary.json`
- デモ掃除: `docs/qa/evidence/2026-05-27-demo-cleanup/summary.json`

## 確認した表示

キャンセル確認ダイアログで、イベントの閾値を使って以下の文言が表示されることを確認した。

`参加者数が3人を下回るまで追加の参加申請はできません。キャンセルしてもよろしいですか？`
