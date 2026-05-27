# 締切日時 本番反映後テスト 2026-05-27

対象環境: https://basketball-circle.vercel.app

対象コミット: `f3184b3 fix: enforce event close deadline on joins`

## 結果

| 項目 | 結果 | 補足 |
| --- | --- | --- |
| lint | OK | `npm.cmd run lint` |
| build | OK | `npm.cmd run build` |
| DB関数適用 | OK | `join_event` に `closes_at` チェックが入っていることを確認 |
| 本番スモーク | OK | 33件中33件 PASS |
| 締切後の参加申請 | OK | 締切日時を過ぎたイベントは409で拒否され、イベントはclosedになる |
| 締切後の再受付 | OK | キャンセルでactive数が閾値未満になっても、締切日時を過ぎていればclosedのまま |
| デモ掃除 | OK | QAイベントを削除し、運営確認用3件のみ残した |

## エビデンス

- 総合テスト: `docs/qa/evidence/2026-05-26-comprehensive-QA_KEEP_20260527042521/summary.json`
- デモ掃除: `docs/qa/evidence/2026-05-27-demo-cleanup/summary.json`

## 補足

締切日時の判定は、詳細画面の参加フォーム表示、参加申請API、Supabase `join_event` 関数、キャンセル後の再受付判定に反映した。
