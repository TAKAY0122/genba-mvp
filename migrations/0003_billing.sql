-- AI提案の課金情報(Stripe連携)をユーザーごとに保存
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'none'; -- none / subscription / credits
ALTER TABLE users ADD COLUMN subscription_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_current_period_end INTEGER;
ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 0;
