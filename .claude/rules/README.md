# .claude/rules/ について

ここには「特定のパスや作業内容を扱うときだけ」必要な詳細ルールを置く。常時読み込まれるルート `CLAUDE.md` を軽量に保つための条件付きルール層。

作業対象に応じて、該当するファイルを読んでから作業する。

| 作業対象 | 参照ファイル |
| --- | --- |
| `src/`(フロントエンド)を編集する | [`frontend.md`](frontend.md) |
| `worker/`(バックエンド・API)を編集する | [`backend.md`](backend.md) |
| `migrations/`(DBスキーマ)を編集する | [`database.md`](database.md) |
| ログイン・2段階認証・Google連携を編集する | [`auth.md`](auth.md) |
