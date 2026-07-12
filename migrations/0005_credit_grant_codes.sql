-- 招待コードで「クレジットを◯回分付与する」タイプに対応するための列
ALTER TABLE redemption_codes ADD COLUMN credit_amount INTEGER NOT NULL DEFAULT 0;
