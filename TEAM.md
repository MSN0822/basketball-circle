# TEAM.md — 03_basketball-circle 編成表

> 役割定義の正は `10_company/roles/`・依頼種別ルーティングの正は `10_company/ROUTING_MATRIX.md`。
> 本ファイルは「このプロジェクトに誰が就いているか（編成）」のみを持つ。責務の再定義はしない。

## Status

- プロジェクト状態: active
- Owner（一次トリアージ担当）: CTO
- 最終承認者: まっすん

## 編成

| ロール | このプロジェクトでの担当 | 招集条件 |
|---|---|---|
| CTO | アーキテクチャ・Supabase/Next.js 設計判断 | 常任 |
| QA Engineer | 受け入れ確認・回帰確認 | 常任 |
| Security Reviewer | Supabase 認証・環境変数・権限まわり | 認証/権限変更時 |
| Codex Auditor | 実装レビュー・根本原因調査 | 実装レビュー時 |
| Operations Manager | 運用移管・定期処理の整備 | 運用フェーズ移行時 |

## レビュー・監査ライン

- 実装レビュー: Codex Auditor
- リリース前: QA Engineer ＋ Security Reviewer

## プロジェクト固有の注意（最大5行）

なし

## 更新規則

- 編成の変更は「ロールの変更」に準じ Plan Mode＋まっすん承認
- 見直しタイミング: 大きな体制変更時＋四半期レビュー（CO-26・次回 2026-10-12 頃）
