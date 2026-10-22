# バックエンド規約(`worker/` を編集するとき)

- APIレスポンスは `ok(c, data)` / `ng(c, code, message, status)` で統一する
- DB操作は必ず `bind()` でプレースホルダを使う。同時実行で不整合が起きうる更新は、`WHERE credit_balance > 0` のような条件付きUPDATE + `meta.changes` で成否判定する
- 管理操作は必ず `audit()` で監査ログに記録する(監査ログの更新・削除APIは存在しない=追記専用)
- 時刻はUTC epochミリ秒で保存する。JST変換が必要な箇所は既存の `jstDateParts` 等の関数を再利用する(独自に計算しない)
- `wrangler.toml` の `[vars]` に機密情報を書かない。機密は `npx wrangler secret put <NAME>` で設定する
- `FREE_MODE = "true"`(`wrangler.toml`)の間は課金判定を全面スキップする一時スイッチ。通常運用時は `"false"` にする
