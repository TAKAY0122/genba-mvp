# 現場運営支援システム MVP

勤務・休憩・配置・ポイント投票を核にした現場運営支援Webアプリ。

- **フロントエンド**: React + Vite + Tailwind CSS v4
- **バックエンド**: Cloudflare Workers + Hono
- **DB**: Cloudflare D1 (SQLite)
- **AI提案**: Anthropic API(任意。未設定時はルールベース提案に自動フォールバック)
- **リアルタイム**: 5秒ポーリング(将来Durable Objects/WebSocketに拡張可能)

## 機能

| 分類 | 内容 |
|---|---|
| 認証 | メール+パスワード(アカウント) / QR・URL・コードによるゲスト参加 |
| 勤務 | 予定開始時刻で自動「勤務中」、退勤ボタン、管理者による代理退勤 |
| 休憩 | 開始/終了、分割取得、必要休憩自動計算(6h→45分/8h→60分)、不足アラート |
| 配置 | 分単位の配置登録・変更・削除(管理者)、タイムライン表示 |
| 投票 | 1人1票、得票順位でポイント(1位3P/2位2P/3位1P)、締切後に結果公開 |
| バッジ | 🏆MVP / ⚡初ポイント / ☕休憩マスター / 💎累計10P。名前の前に表示選択可 |
| その他 | Command Center、AI提案、チームチャット、通知、削除不可の監査ログ、マイページ累計 |

## セットアップ(GitHub Codespaces / ローカル共通)

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Cloudflareへログイン

```bash
npx wrangler login
# Codespacesの場合はブラウザ認証URLが表示されるので開いて許可
```

### 3. D1データベース作成

```bash
npm run db:create
```

出力される `database_id = "xxxx-xxxx..."` を **wrangler.toml の `REPLACE_WITH_YOUR_D1_ID` に貼り付ける**。

### 4. マイグレーション適用

```bash
# ローカル開発用
npm run db:migrate:local

# 本番(リモート)用
npm run db:migrate:remote
```

### 5. AI提案を使う場合(任意)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# → Anthropic ConsoleのAPIキーを貼り付け
```

未設定でも動作します(AI提案はルールベースに自動フォールバック)。

## 開発

```bash
# フロントをビルドしてから wrangler dev(API+静的配信を一体で確認)
npm run build && npm run dev
# → http://localhost:8787

# フロントだけホットリロードしたい場合(別ターミナルで wrangler dev を起動しておく)
npm run dev:front
# → http://localhost:5173 (APIは8787へプロキシ)
```

## デプロイ

```bash
npm run deploy
```

初回デプロイ後、`https://genba-mvp.<あなたのサブドメイン>.workers.dev` でアクセスできます。
カスタムドメインは Cloudflareダッシュボード → Workers → 設定 → ドメイン から追加してください。

## 運用メモ

- **最初のユーザー**: アプリを開いて「新規登録」→「チーム作成」でオーナーになります。
- **招待**: チームの「QR/URLで招待」画面のURLをLINE等で共有。スタッフはアカウント不要(ゲスト)で参加できます。
- **ゲストの端末**: 参加トークンはブラウザのlocalStorageに保存されます。同じ端末・同じブラウザなら再アクセスで復帰できます。
- **監査ログ**: UPDATE/DELETEするAPIが存在しないため、アプリからは削除できません。
- **投票締切**: 管理者が「投票を締め切り結果を確定する」を押すと、順位・ポイント・バッジ・累計加算が一括で確定します(取り消し不可)。

## 構成

```
genba-mvp/
├── wrangler.toml          # Workers設定(D1バインディング)
├── migrations/            # D1マイグレーション
│   └── 0001_init.sql
├── worker/
│   └── index.js           # Hono API(認証/勤務/休憩/配置/投票/AI/監査)
├── src/
│   ├── main.jsx
│   ├── api.js             # APIクライアント(トークン管理)
│   ├── App.jsx            # 全画面
│   └── styles.css
├── index.html
└── vite.config.js
```

## API一覧(抜粋)

| Method | Path | 権限 |
|---|---|---|
| POST | /api/v1/register, /login, /logout | - |
| POST | /api/v1/teams | ログイン必須 |
| GET | /api/v1/teams/by-code/:code | 公開 |
| POST | /api/v1/teams/:code/join | 任意(未ログイン=ゲスト) |
| GET | /api/v1/teams/:id/state | 参加者(5秒ポーリング) |
| POST | /api/v1/teams/:id/breaks/start, /end | 本人 or 管理者 |
| POST | /api/v1/teams/:id/checkout | 本人 or 管理者(代理は監査ログ) |
| PATCH | /api/v1/teams/:id/participants/:pid/records | 管理者(監査ログ必須) |
| POST/PATCH/DELETE | /api/v1/teams/:id/assignments | 管理者(監査ログ必須) |
| POST | /api/v1/teams/:id/vote | 参加者(1人1票) |
| POST | /api/v1/teams/:id/close-voting | 管理者 |
| POST | /api/v1/teams/:id/ai-suggest | 管理者 |
| GET | /api/v1/teams/:id/audit | 管理者(閲覧のみ・削除API無し) |
