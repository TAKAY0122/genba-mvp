-- 友人・知人向け無制限コード、ポイント交換の記録、売上台帳を追加

-- ユーザーごとの特別フラグ
ALTER TABLE users ADD COLUMN comp_unlimited INTEGER NOT NULL DEFAULT 0; -- 招待コードで付与される永続無料フラグ
ALTER TABLE users ADD COLUMN day_pass_expires_at INTEGER; -- ポイント交換で付与される1日パスの有効期限

-- 招待コード本体(①友人・知人向け 何人でも使える / ②ポイント交換で内部的に1回だけ発行)
CREATE TABLE redemption_codes (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'friend_unlimited' | 'point_day_pass'
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER,                -- NULL = 無制限(友人コード用)。1 = 単発(ポイント交換用)
  used_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

-- コードの利用履歴(同じ人が同じコードを2回使えないようにする)
CREATE TABLE redemption_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE(code, user_id)
);

-- 実際の入金を記録する売上台帳(管理ページの集計用)
CREATE TABLE billing_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'subscription' | 'credits'
  amount_yen INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ledger_created ON billing_ledger(created_at);
