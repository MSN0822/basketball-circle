-- eventsテーブルに is_manual_close カラムを追加
-- 手動で締め切ったイベントを区別するためのフラグ
-- false（デフォルト）: 定員到達・日時超過による締切 → 閾値未満で自動再開あり
-- true: 運営が手動で締め切り → 自動再開しない
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_manual_close boolean DEFAULT false NOT NULL;
