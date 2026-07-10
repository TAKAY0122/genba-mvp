-- AI提案のON/OFF設定をチームごとに保存(デフォルトはOFF)
ALTER TABLE teams ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
