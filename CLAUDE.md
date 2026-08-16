# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイドです。セッション開始時に自動で読み込まれます。

## プロジェクト概要

現場運営支援システム(genba-mvp)。イベント・コンサート等の現場スタッフの勤務・休憩・配置・ポイント投票を管理するWebアプリ。
- 開発・運営: 株式会社Aster Systems(担当: 吉崎 天晴)
- 依頼元(クライアント): RB事業2課
- 本番URL: https://genba-mvp.rb-jigyou2.workers.dev

## 技術構成

- フロントエンド: React 18 + Vite 6 + Tailwind CSS v4(`src/App.jsx` に全画面コンポーネント)
- バックエンド: Hono(`worker/index.js` に全API、単一ファイル)
- DB: Cloudflare D1(SQLite互換、`migrations/000N_*.sql` で管理)
- 決済: Stripe(Checkout/Billing Portal/Webhook、SDK不使用でREST APIを直接fetch)
- AI: Anthropic Claude API(claude-haiku-4-5。未接続時はルールベースにフォールバック)
- ホスティング: Cloudflare Workers(1つのWorkerでフロント配信+APIの両方を処理)

## よく使うコマンド

```bash
npm run build && npm run dev   # ローカル開発 (http://localhost:8787)
npm run deploy                 # 本番デプロイ (vite build → wrangler deploy)
npm run db:migrate:remote      # 本番DBにマイグレーション適用(未適用分のみ)
npm run db:migrate:local       # ローカルDBにマイグレーション適用
npx wrangler secret put <NAME> # 機密情報(APIキー等)の設定
```

## コーディング規約(詳細は `コーディングルール.docx` を参照)

- APIレスポンスは `ok(c, data)` / `ng(c, code, message, status)` で統一する
- DB操作は必ず `bind()` でプレースホルダを使う。同時実行で不整合が起きうる更新は、`WHERE credit_balance > 0` のような条件付きUPDATE + `meta.changes` で成否判定する
- 管理操作は必ず `audit()` で監査ログに記録する(監査ログの更新・削除APIは存在しない=追記専用)
- 時刻はUTC epochミリ秒で保存する。JST変換が必要な箇所は既存の `jstDateParts` 等の関数を再利用する(独自に計算しない)
- フロントのAPI呼び出しは必ず `src/api.js` 経由で行う。状態を変更する操作はTeamApp内の `run()` でラップする
- Tailwindの任意値記法(`w-[123px]` 等)は使わない。固定値が必要な場合は `style` 属性を使う
- スマホでヘッダーに複数ボタンを置く場合、テキストは `hidden sm:inline` で隠しアイコンのみにする(はみ出し防止)

## 【重要】ドキュメント同時更新ルール

機能追加・修正を行った際は、影響する開発ドキュメント一式(16種類、`docgen/` 配下の `gen_*.cjs` で生成)も同時に更新すること。手順は `.claude/skills/update-docs/SKILL.md` を参照し、コミット前に必ず実行する。

表紙の署名は「株式会社Aster Systems 担当: 吉崎 天晴」のみとし、依頼先である **RB事業2課の署名は絶対に入れない**。

対象文書: 見積書・提案依頼書・要件定義書・基本設計書・詳細設計書・画面設計書・サイトマップ・コンポーネント一覧・コーディングルール・機能一覧書(仕様書)・API仕様書・テーブル定義書ER図・システム構成図・サービス構成図・リリース手順書・操作説明書(pptx)

## デプロイ時の注意

- `migrations/` に新しい `.sql` を追加した場合、デプロイ前に必ず `npm run db:migrate:remote` を実行する(未適用分のみ自動反映される。何度実行しても安全)
- `wrangler.toml` の `[vars]` に機密情報を書かない。機密は `wrangler secret put` で設定する
- `FREE_MODE = "true"` の間は課金判定を全面スキップする一時スイッチ(通常運用時は `"false"`)
- 本番デプロイは `.claude/skills/deploy/SKILL.md` の手順に従う(`/deploy` で明示的に呼び出した時のみ実行する)
