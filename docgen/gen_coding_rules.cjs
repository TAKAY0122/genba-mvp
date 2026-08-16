const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("コーディングルール"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行"],
  ["v1.1", "2026年8月", "通知(トースト)の一元化・二重送信防止・aria-label付与に関する規約を追加"],
]));

sections.push(h1("1. 目的"));
sections.push(p("本書は、今後の機能追加・修正を既存コードと一貫性のある形で行うための規約を定める。既存実装(worker/index.js、src/App.jsx、src/api.js)から抽出した実際の慣習を規約化したものである。"));

sections.push(h1("2. ディレクトリ構成"));
sections.push(makeTable(
  [{ text: "パス", width: 3200 }, { text: "役割", width: 6800 }],
  [
    ["worker/index.js", "バックエンドAPI全体(Hono)。1ファイルに全エンドポイントを実装"],
    ["src/App.jsx", "フロントエンド全画面コンポーネント"],
    ["src/api.js", "APIクライアント、トークン管理"],
    ["src/ads.js", "広告枠設定(データのみ、ロジックなし)"],
    ["migrations/000N_*.sql", "D1マイグレーション。連番・説明的なファイル名を付与し、既存ファイルは変更しない(追加のみ)"],
    ["docgen/", "開発ドキュメント一式(16種類)の生成スクリプト"],
  ],
));

sections.push(h1("3. バックエンド(worker/index.js)規約"));
sections.push(h2("3.1 レスポンス形式"));
sections.push(bullet("成功時は ok(c, data) で { success:true, data } を返す"));
sections.push(bullet("失敗時は ng(c, errorCode, message, status) で { success:false, errorCode, message } を返す"));
sections.push(bullet("errorCodeは分類プレフィックス(AUTH-/VAL-/DATA-/BILL-/SYS-)+連番の命名とする"));
sections.push(h2("3.2 権限チェック"));
sections.push(bullet("各エンドポイントの先頭で resolveParticipant() から isAdmin() 等により権限確認を行い、不足時は即座にng()を返す(早期リターン)"));
sections.push(bullet("サイト管理者専用APIは isSiteAdmin(env, user) を用いる(SITE_ADMIN_EMAILS環境変数との照合)"));
sections.push(h2("3.3 DB操作"));
sections.push(bullet("D1へのクエリは必ずbind()によるプレースホルダを使用し、文字列結合によるSQL生成を行わない"));
sections.push(bullet("同時実行で不整合が起きうる更新(クレジット消費等)は「WHERE credit_balance > 0」等の条件付きUPDATEとし、meta.changesで成否判定する"));
sections.push(bullet("マイグレーション未適用等のDBエラーは、管理系・課金系エンドポイントではtry/catchで捕捉し、原因が推測できるメッセージを返す"));
sections.push(h2("3.4 監査ログ・通知"));
sections.push(bullet("管理操作(配置変更・権限変更・履歴修正・チーム削除等)は必ず audit() を呼び、変更前後をテキストで記録する"));
sections.push(bullet("参加者への周知が必要な事象は notify() で通知を生成する"));
sections.push(h2("3.5 時刻"));
sections.push(bullet("保存・比較は常にUTC epochミリ秒(now()関数)を用いる"));
sections.push(bullet("JST日付・月の境界計算が必要な場合は jstDateParts 等の既存関数を再利用する(独自に計算しない)"));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("4. フロントエンド(src/App.jsx)規約"));
sections.push(h2("4.1 コンポーネント設計"));
sections.push(bullet("画面コンポーネントは関数コンポーネントとし、状態はuseStateで画面ローカルに保持する(グローバル状態管理ライブラリは使用しない)"));
sections.push(bullet("チーム内画面はTeamAppが親となり、5秒ポーリング(refresh)・APIラッパー(run)・トークン管理を集約する。個別画面はTeamAppからpropsで操作関数を受け取る"));
sections.push(h2("4.2 API呼び出し"));
sections.push(bullet("APIは必ずsrc/api.jsのapiオブジェクト経由で呼び出す(fetchの直接記述をしない)"));
sections.push(bullet("状態を変更する操作はTeamApp内のrun(fn, okMsg)でラップし、成功時トースト表示・失敗時fail()・完了後refresh()を統一する。runはbusyRefで多重実行を防止しているため、二重送信防止のためにボタン側で個別に対応する必要はない"));
sections.push(bullet("say()/fail()によるトースト通知はApp直下のToastコンポーネントで一元描画する(画面個別に実装しない)。成功はslate、エラーはroseで色分けする"));
sections.push(bullet("アイコンのみ(絵文字のみ)のボタンには必ずaria-labelを付与する(見た目のtitle属性だけに頼らない)"));
sections.push(h2("4.3 スタイリング"));
sections.push(bullet("Tailwind CSSのユーティリティクラスを直接JSX内に記述する(CSSファイルの追加は行わない)"));
sections.push(bullet("任意値記法は使用しない。固定値が必要な場合はstyle属性を用いる"));
sections.push(bullet("色は indigo(主操作)/emerald(肯定・完了)/amber(注意・休憩)/rose(危険・不足)/violet(AI関連)/slate(補助)を用途別に統一して使用する"));
sections.push(h2("4.4 レスポンシブ対応"));
sections.push(bullet("PC向けは lg: プレフィックスで明示的に指定し、既定(無印)はスマートフォン向けを基準とする(モバイルファースト)"));
sections.push(bullet("ヘッダー等、幅の制約が強い箇所に複数ボタンを配置する場合は、スマートフォンでアイコンのみ(テキストをhidden sm:inlineで隠す)にしてはみ出しを防止する"));

sections.push(h1("5. データベース(migrations)規約"));
sections.push(bullet("既存のマイグレーションファイルは変更せず、新しい変更は必ず新規ファイル(0007_*.sql等)として追加する"));
sections.push(bullet("列追加は ALTER TABLE ... ADD COLUMN を用い、既存データに影響しないデフォルト値を必ず設定する"));
sections.push(bullet("本番反映は npm run db:migrate:remote を実行する(未適用分のみ自動適用される)"));

sections.push(h1("6. ドキュメント更新ルール"));
sections.push(p("機能追加・修正を行った際は、影響する開発ドキュメント一式(見積書・提案依頼書・要件定義書・基本設計書・詳細設計書・画面設計書・サイトマップ・コンポーネント一覧・コーディングルール・機能一覧書(仕様書)・API仕様書・テーブル定義書ER図・システム構成図・サービス構成図・操作説明書・リリース手順書)も同時に更新する。表紙の署名は株式会社Aster Systems(担当: 吉崎天晴)のみとし、依頼先であるRB事業2課の署名は入れない。"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム コーディングルール v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "コーディングルール.docx"), buf);
  console.log("done");
});
