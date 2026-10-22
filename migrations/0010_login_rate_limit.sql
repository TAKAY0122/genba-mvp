-- パスワードログインの総当たり対策。メールアドレス単位で失敗回数を記録し、
-- 一定回数失敗したら一時的にロックする(2段階認証の試行回数制限と同じ考え方)
CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);
