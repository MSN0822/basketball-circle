# 定員締切仕様 本番反映後テスト 2026-05-27

対象環境: https://basketball-circle.vercel.app

対象コミット: `4d61c1e fix: close full events without waitlist`

## 結果

| 項目 | 結果 | 補足 |
| --- | --- | --- |
| lint | OK | `npm.cmd run lint` |
| build | OK | `npm.cmd run build` |
| 本番スモーク | OK | 31件中31件 PASS |
| 定員超過 | OK | 追加申請は409で拒否され、waitlistは作成されない |
| キャンセル後再受付 | OK | active数が閾値未満になるとacceptingへ戻る |
| 同時申請 | OK | 定員1に5件同時申請してactiveは1件、残りは409 |
| デモ掃除 | OK | QAイベントを削除し、運営確認用3件のみ残した |

## エビデンス

- 総合テスト: `docs/qa/evidence/2026-05-26-comprehensive-QA_KEEP_20260527035813/summary.json`
- デモ掃除: `docs/qa/evidence/2026-05-27-demo-cleanup/summary.json`

## 残した運営確認用イベント

| イベント | ステータス | 用途 |
| --- | --- | --- |
| `【運営確認用】 受付中バスケ体験会` | accepting | 通常の受付中表示 |
| `【運営確認用】 満員・締切例` | closed | 満員時にキャンセル待ちを作らない表示 |
| `【運営確認用】 下書きイベント` | draft | 管理者向け下書き確認 |

## 注意

Supabase SQLを直接実行する接続情報はローカルにないため、DB関数更新は `supabase/migrations/20260527_close_full_events_without_waitlist.sql` として保存した。
本番挙動はアプリ側APIガードで確認済み。
