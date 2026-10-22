# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイドです。セッション開始時に自動で読み込まれます。**全タスクに共通する情報のみ**を置き、詳細は下記の各層に分離しています(このファイルを肥大化させない)。

## プロジェクト概要

現場運営支援システム(genba-mvp)。イベント・コンサート等の現場スタッフの勤務・休憩・配置・ポイント投票を管理するWebアプリ。
- 開発・運営: 株式会社Aster Systems(担当: 吉崎 天晴)
- 依頼元(クライアント): RB事業2課
- 本番URL: https://genba-mvp.rb-jigyou2.workers.dev

## 技術構成

フロントエンド: React 18 + Vite 6 + Tailwind CSS v4 / バックエンド: Hono(`worker/index.js`) / DB: Cloudflare D1 / 決済: Stripe / AI: Anthropic Claude API / ホスティング: Cloudflare Workers

## よく使うコマンド

```bash
npm run build && npm run dev   # ローカル開発 (http://localhost:8787)
npm run deploy                 # 本番デプロイ (vite build → wrangler deploy)
```

## 【絶対厳守】重大な禁止事項・完了条件

- **本番デプロイは `/deploy` で明示的に呼び出された時のみ実行する**(Claude自身の判断で自動実行しない。手順は `.claude/skills/deploy/SKILL.md`)
- **`wrangler.toml` の `[vars]` に機密情報(APIキー等)を書かない**。機密は必ず `npx wrangler secret put <NAME>` で設定する
- **機能追加・修正を行った際は、開発ドキュメント一式(16種類、出力先 `../要件書/`)も同時に更新する**。手順は `.claude/skills/update-docs/SKILL.md`。コミット前に必ず実行する
- ドキュメント表紙の署名は「株式会社Aster Systems 担当: 吉崎 天晴」のみとし、依頼先である**RB事業2課の署名は絶対に入れない**

## 詳細ルール(作業対象に応じて参照)

常時読み込む必要はなく、対応するパスを編集する時にだけ読む。一覧は [`.claude/rules/README.md`](.claude/rules/README.md) を参照。

| 作業対象 | 参照先 |
| --- | --- |
| `src/`(フロントエンド) | `.claude/rules/frontend.md` |
| `worker/`(バックエンド・API) | `.claude/rules/backend.md` |
| `migrations/`(DBスキーマ) | `.claude/rules/database.md` |
| ログイン・2段階認証・Google連携 | `.claude/rules/auth.md` |

## 複数工程の作業手順(スキル)

| いつ使うか | スキル |
| --- | --- |
| 機能追加・修正後のドキュメント一式更新 | `.claude/skills/update-docs/SKILL.md` |
| 本番デプロイ(`/deploy` 呼び出し時) | `.claude/skills/deploy/SKILL.md` |

## その他

- 個人用・Git管理外の設定・作業メモは `CLAUDE.local.md` を参照(存在する場合)
- 破壊的コマンドの拒否など、判断に依存させたくない制約は `.claude/settings.json` で機械的に強制している
