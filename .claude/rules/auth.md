# 認証まわりの規約(ログイン・2段階認証・Google連携を編集するとき)

- パスワードログインに加え、Googleアカウントログイン(サーバー主導のOAuth 2.0)と2段階認証(TOTP)に対応
  - 実装箇所: `worker/index.js` の「認証」セクション、`src/App.jsx` の `AuthScreen` / `TwoFactorSetupScreen`
- Apple(iCloud)ログインは未対応。Sign in with AppleはApple Developer Program(年額$99)への加入が必須のため、加入後に着手する

## Googleログインの設定(未加入の場合)

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクトを作成(または既存プロジェクトを選択)
2. 「APIとサービス」→「OAuth同意画面」を設定(外部・アプリ名「現場運営支援システム」等)
3. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」→ アプリケーションの種類は「ウェブアプリケーション」
4. 「承認済みのリダイレクトURI」に **`https://genba-mvp.rb-jigyou2.workers.dev/api/v1/auth/google/callback`** を追加(末尾のパスまで完全一致が必要)
5. 発行された「クライアントID」「クライアントシークレット」を、以下のコマンドでWorkerに設定する:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
6. 設定後は追加のコード変更・再デプロイ不要(次回アクセス時から有効)。未設定の間はログイン画面の「Googleでログイン」を押しても安全にエラーメッセージを表示するだけで、他の機能に影響しない
