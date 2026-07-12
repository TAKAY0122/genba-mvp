-- 毎月の無料クレジット自動付与のため、最後に付与した年月(例: "2026-07")を記録する
ALTER TABLE users ADD COLUMN credits_month_key TEXT;
