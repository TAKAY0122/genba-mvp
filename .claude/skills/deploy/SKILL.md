---
name: deploy
description: genba-mvpを本番環境へデプロイする。マイグレーション未適用分があれば先に適用してからデプロイする。
disable-model-invocation: true
allowed-tools: Bash(npm run *) Bash(npx wrangler *) Bash(git *)
---

# 本番デプロイ手順

`/deploy` で明示的に呼び出された時のみ実行する。Claude自身の判断で自動実行しない。

1. `migrations/` フォルダに、前回デプロイ以降に追加された `.sql` ファイルがないか確認する。

2. 新しいマイグレーションがある場合、本番DBに適用する:
   ```bash
   npm run db:migrate:remote
   ```
   出力の一覧で対象ファイルがすべて✅になっていることを確認する。マイグレーションが無い場合はこの手順を飛ばしてよい。

3. デプロイを実行する:
   ```bash
   npm run deploy
   ```

4. `Deployed genba-mvp triggers` のメッセージと本番URLが表示されることを確認する。

5. 本番URL(https://genba-mvp.rb-jigyou2.workers.dev)を開き、今回変更した箇所が正しく動作するか確認するようユーザーに促す。

6. 問題なければコミット・pushする(まだしていない場合):
   ```bash
   git add .
   git commit -m "<変更内容の要約>"
   git push
   ```

## 注意

- `wrangler.toml` の `[vars]` に機密情報(APIキー等)を書き込まない
- デプロイ前に `.claude/skills/update-docs/SKILL.md` の手順でドキュメントが更新済みか確認する
