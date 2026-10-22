# DBスキーマ規約(`migrations/` を編集するとき)

- 新規マイグレーションは `migrations/000N_*.sql` の連番で追加する(既存ファイルは変更しない)
- `migrations/` に新しい `.sql` を追加した場合、デプロイ前に必ず `npm run db:migrate:remote` を実行する(未適用分のみ自動反映される。何度実行しても安全)
- ローカルDBへの適用は `npm run db:migrate:local`
- DB本体はCloudflare D1(SQLite互換)
