const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("リリース手順書"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行"],
  ["v1.1", "2026年8月", "Googleログイン用シークレット(GOOGLE_CLIENT_ID/SECRET)の設定手順・確認項目を追加"],
]));

sections.push(h1("1. 前提環境"));
sections.push(bullet("Node.js、npm がインストールされたPC(Windows/Mac問わず)"));
sections.push(bullet("Cloudflareアカウント(wrangler loginで認証済み、またはAPIトークンをCLOUDFLARE_API_TOKEN環境変数に設定済み)"));
sections.push(bullet("プロジェクトフォルダ(genba-mvp)が最新のソースコードで更新済みであること"));

sections.push(h1("2. 通常のリリース手順(コード変更のみ、DB変更なし)"));
sections.push(makeTable(
  [{ text: "手順", width: 1000 }, { text: "コマンド / 操作", width: 8800 }],
  [
    ["1", "変更ファイルを genba-mvp フォルダ内の該当パスに上書きする"],
    ["2", "npm run deploy を実行する(内部で vite build から wrangler deploy が実行される)"],
    ["3", "デプロイ完了メッセージ(Deployed genba-mvp triggers)とURLが表示されることを確認する"],
    ["4", "本番URLをブラウザで開き、変更箇所の動作を確認する"],
    ["5", "問題なければ git add . / git commit / git push でリポジトリに反映する"],
  ],
));

sections.push(h1("3. データベース変更を伴うリリース手順"));
sections.push(p("migrations フォルダに新しい .sql ファイルを追加する変更(テーブル・列の追加等)を行った場合は、通常手順の前に以下を実施する。"));
sections.push(makeTable(
  [{ text: "手順", width: 1000 }, { text: "コマンド / 操作", width: 8800 }],
  [
    ["1", "migrations フォルダに新しい連番のマイグレーションファイルが追加されていることを確認する"],
    ["2", "npm run db:migrate:remote を実行する(未適用のマイグレーションのみ自動的に適用される。何度実行しても安全)"],
    ["3", "適用結果の一覧に追加した .sql ファイルが完了マークで表示されることを確認する"],
    ["4", "上記「2. 通常のリリース手順」の2〜5を実施する"],
  ],
));
sections.push(p("注意: マイグレーション適用を忘れてデプロイすると、新しいテーブル・列を参照する機能がエラーになる(存在しないテーブル/列エラー)。手順の順序を必ず守ること。"));

sections.push(h1("4. 環境変数・シークレットの設定"));
sections.push(makeTable(
  [{ text: "種別", width: 2600 }, { text: "設定方法", width: 6800 }],
  [
    ["非機密設定(vars)", "wrangler.toml の [vars] ブロックを直接編集し、npm run deploy で反映"],
    ["機密情報(secret)", "npx wrangler secret put 変数名 を実行し、対話プロンプトで値を入力(即時反映、再デプロイ不要)"],
  ],
));
sections.push(p("設定済みシークレット一覧の確認: npx wrangler secret list"));
sections.push(p("Googleログインを有効化する場合は GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET をこの方法で設定する(未設定の間はログイン画面の「Googleでログイン」がエラーメッセージを表示するのみで、他機能には影響しない。設定後の再デプロイは不要)。詳細はCLAUDE.mdの「Googleログインの設定」を参照。"));

sections.push(h1("5. ロールバック手順"));
sections.push(bullet("コードのみの変更は、Gitで直前のコミットに戻し、再度 npm run deploy を実行することで復旧できる"));
sections.push(bullet("D1のマイグレーションはロールバック用のDOWNスクリプトを用意していないため、列追加等の可逆性の低い変更を行う際は事前にバックアップ(wrangler d1 export)を取得することが望ましい"));

sections.push(h1("6. リリース後の確認項目"));
sections.push(bullet("トップページ(ログイン画面)が正常に表示されること"));
sections.push(bullet("既存アカウントでログインでき、前回のチームに正しく遷移すること"));
sections.push(bullet("変更対象機能が意図通り動作すること"));
sections.push(bullet("ブラウザの開発者ツールでコンソールエラーが出ていないこと"));
sections.push(bullet("スマートフォン実機での表示崩れがないこと"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム リリース手順書 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "リリース手順書.docx"), buf);
  console.log("done");
});
