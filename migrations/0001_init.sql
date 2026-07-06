-- 現場運営支援システム MVP - 初期スキーマ
-- 時刻はすべて epoch ミリ秒 (INTEGER) で保存

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  total_work_min INTEGER NOT NULL DEFAULT 0,
  sites_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  site_name TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  section TEXT,
  event_date TEXT NOT NULL,          -- YYYY-MM-DD
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  voting_closed INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT REFERENCES users(id), -- NULL = ゲスト
  token TEXT UNIQUE,                 -- ゲスト用参加トークン(pt_...)
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- owner / admin / member / guest
  plan_start INTEGER NOT NULL,
  plan_end INTEGER NOT NULL,
  check_out INTEGER,
  badges TEXT NOT NULL DEFAULT '[]', -- JSON配列 例: ["🏆","💎"]
  display_badge TEXT NOT NULL DEFAULT '',
  today_points INTEGER NOT NULL DEFAULT 0,
  today_rank INTEGER,
  today_votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_participants_team ON participants(team_id);
CREATE INDEX idx_participants_user ON participants(user_id);

CREATE TABLE breaks (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER
);
CREATE INDEX idx_breaks_participant ON breaks(participant_id);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_assignments_team ON assignments(team_id);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_team ON chat_messages(team_id, id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  type TEXT NOT NULL,                -- 休憩不足 / 一斉連絡 / 緊急連絡 / 休憩終了 / バッジ獲得
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_team ON notifications(team_id, id);

CREATE TABLE notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  PRIMARY KEY (notification_id, participant_id)
);

CREATE TABLE votes (
  team_id TEXT NOT NULL REFERENCES teams(id),
  voter_id TEXT NOT NULL REFERENCES participants(id),
  target_id TEXT NOT NULL REFERENCES participants(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, voter_id)    -- 1人1票
);

-- 監査ログ: INSERTのみ。UPDATE/DELETEするAPIは存在しない
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL,
  before_text TEXT NOT NULL DEFAULT '',
  after_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_team ON audit_logs(team_id, id);
