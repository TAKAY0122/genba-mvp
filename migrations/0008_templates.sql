-- 持ち場テンプレート(オーナー単位で配置構成を保存し、別のチーム作成時に再利用する)
CREATE TABLE assignment_templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_templates_owner ON assignment_templates(owner_user_id, created_at);

CREATE TABLE assignment_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL REFERENCES assignment_templates(id),
  start_hm TEXT NOT NULL,   -- "HH:MM"(現場当日の時刻。テンプレート適用時に対象チームのevent_dateへ変換する)
  end_hm TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_template_items_template ON assignment_template_items(template_id, sort_order);

-- 休憩未取得の自動通知(重複送信防止用)。手動送信の通知はNULLのまま
ALTER TABLE notifications ADD COLUMN target_participant_id TEXT;
ALTER TABLE notifications ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notifications_auto ON notifications(team_id, target_participant_id, type, created_at);
