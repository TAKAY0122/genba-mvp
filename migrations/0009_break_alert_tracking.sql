-- 休憩未取得の自動通知を、複数の管理者が同時にポーリングしていても重複送信しないよう、
-- 参加者ごとに最終通知時刻を保持し、条件付きUPDATE(WHERE last_break_alert_at IS NULL OR < 締切)で
-- 排他的に「通知してよいか」を判定できるようにする(SELECT→INSERTの非原子的な二重チェックを廃止)
ALTER TABLE participants ADD COLUMN last_break_alert_at INTEGER;
