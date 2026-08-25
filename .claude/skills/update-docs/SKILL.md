---
name: update-docs
description: 機能追加・修正後に、影響する開発ドキュメント一式(16種類)を更新・再生成する。コード変更をコミットする前に必ず使う。「ドキュメント更新して」「資料も直して」等でも呼び出される。
---

# ドキュメント一式の更新

このプロジェクトでは、機能追加・修正のたびにリポジトリ外(`genba-mvp/` の一つ上の階層)にある `docgen_export/` 配下のドキュメント生成スクリプト(Node.js + docx/pptxgenjs)も更新し、成果物(Word/PowerPoint、出力先は同じく一つ上の階層の `要件書/`)を再生成する。`docgen_export/` と `要件書/` はアプリのgitリポジトリ(`genba-mvp/`)には含まれない。

## 手順

1. 今回のコード変更内容を確認する(`git diff` または直近の変更内容)。

2. 変更内容が影響するドキュメントを特定する。対応表:

   | 変更の種類 | 更新するスクリプト |
   |---|---|
   | APIの追加・変更 | `../docgen_export/gen_api_spec.cjs` |
   | DBスキーマの変更(テーブル・列の追加等) | `../docgen_export/gen_table_er.cjs`、`../docgen_export/gen_basic_design.cjs` |
   | 画面の追加・変更 | `../docgen_export/gen_screen_design.cjs`、`../docgen_export/gen_sitemap.cjs` |
   | 計算ロジック・アルゴリズムの変更(課金判定等) | `../docgen_export/gen_detail_design.cjs` |
   | Reactコンポーネントの追加・整理 | `../docgen_export/gen_components.cjs` |
   | コーディング規約に関わる変更 | `../docgen_export/gen_coding_rules.cjs` |
   | 操作方法が変わる変更 | `../docgen_export/gen_manual_pptx.cjs` |
   | インフラ構成の変更 | `../docgen_export/gen_system_diagram.cjs`、`../docgen_export/gen_service_diagram.cjs` |
   | デプロイ手順の変更 | `../docgen_export/gen_release.cjs` |
   | 上記以外で機能一覧に影響する変更 | `../docgen_export/gen_spec.cjs`(機能一覧書) |
   | 大規模な機能追加(スコープが変わるレベル) | `../docgen_export/gen_requirements.cjs`、`../docgen_export/gen_rfp.cjs`、`../docgen_export/gen_quotation.cjs` も検討 |

3. 該当する `gen_*.cjs` の中身(テキスト・表の内容)を、実際の変更に合わせて編集する。`../docgen_export/common.cjs` の共通関数(`h1`, `h2`, `h3`, `p`, `bullet`, `makeTable`, `makeCover`, `revisionHistory`, `diagramBox`, `diagramArrow`, `OUT_DIR` 等)は変更せず再利用する。

4. 改訂履歴(`revisionHistory` の呼び出し部分)に、変更内容を表す行を1行追加する(既存行は消さない)。例:
   ```js
   sections.push(...revisionHistory([
     ["v1.0", "2026年7月", "初版発行"],
     ["v1.1", "(今日の日付)", "◯◯機能の追加に伴い更新"],
   ]));
   ```

5. 該当するスクリプトを実行して再生成する:
   ```bash
   node ../docgen_export/gen_XXX.cjs
   ```
   複数該当する場合はすべて実行する。まとめて全部再生成したい場合は:
   ```bash
   cd ../docgen_export && npm run gen
   ```
   (`npm run gen` は全スクリプトの実行 → `要件書/` のカテゴリ別サブフォルダ(`01_企画・見積`〜`05_運用`)への振り分け → PDF書き出し(`要件書/PDF/`)まで一括で行う)

6. 生成された `.docx` / `.pptx` が `要件書/` 配下のカテゴリフォルダに出力される。表紙が以下の通りになっているか確認する:
   - 「株式会社Aster Systems」の社名とロゴが入っている
   - 「担当: 吉崎 天晴」の記載がある
   - **RB事業2課の記載が署名として入っていないこと**(本文中で「依頼元」として言及するのは問題ない)

7. 更新した `gen_*.cjs`(`docgen_export/` 側)をコミットする。再生成済みの `.docx`/`.pptx`(`要件書/` 側)はgitリポジトリの外にあるためコミット対象外。
