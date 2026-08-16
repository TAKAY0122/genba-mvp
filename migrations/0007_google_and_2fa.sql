-- Googleログイン連携用
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

-- 2段階認証(TOTP)用
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT; -- JSON配列。各要素はハッシュ済み(平文は保存しない)

-- ログイン時、パスワード/Google認証は成功したが2FAコード入力待ちの状態を一時保持する(5分程度で失効)
CREATE TABLE two_factor_pending (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- Google OAuth認可フローのCSRF対策用state(単発使用、10分で失効)
CREATE TABLE oauth_state (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Googleコールバック(サーバー間リダイレクト)完了後、発行済みセッショントークンをSPA側に
-- URLへ直接載せずに引き渡すためのワンタイム引換コード(60秒・単発使用で失効)
CREATE TABLE oauth_handoff (
  code TEXT PRIMARY KEY,
  session_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
