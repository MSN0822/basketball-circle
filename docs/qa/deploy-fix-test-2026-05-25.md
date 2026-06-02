# デプロイ後スモークテスト: 2026-05-25

対象: https://basketball-circle.vercel.app

## デプロイ

- ブランチ: `main`
- コミット: `63878a1 fix: renumber participants after cancellation`
- デプロイ方法: GitHub main へ push し、Vercel のProduction自動デプロイを起動

## テスト内容

一時イベント `TEST_DeployFix_*` を本番環境に作成し、以下の状態を再現した。

初期状態:

| 名前 | status | slot_number |
| --- | --- | --- |
| QA_A | active | 1 |
| QA_B | active | 2 |
| QA_C | active | 3 |
| QA_D | waitlist | 1 |
| QA_E | waitlist | 2 |

## 結果

Bをキャンセル後:

| 名前 | status | slot_number |
| --- | --- | --- |
| QA_A | active | 1 |
| QA_C | active | 2 |
| QA_D | active | 3 |
| QA_E | waitlist | 1 |

Aをキャンセル後:

| 名前 | status | slot_number |
| --- | --- | --- |
| QA_C | active | 1 |
| QA_D | active | 2 |
| QA_E | active | 3 |

## 判定

Pass。

前回発生していた `1, 3, 3` や `待2` の残留は再現しなかった。

## 後片付け

- `TEST_DeployFix_*` イベントは削除済み
- 最終確認で `TEST_DeployFix_*` イベントは0件
