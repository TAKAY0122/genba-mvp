const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("サービス構成図"));
sections.push(...revisionHistory([["v1.0", "2026年7月", "初版発行"]]));

sections.push(h1("1. 本書の位置づけ"));
sections.push(p("システム構成図がインフラ・技術要素間の接続を示すのに対し、本書は「誰が・何のために・どう利用するか」というサービスとしての利用者フローと収益フローを示す。"));

sections.push(h1("2. 利用者フロー"));
sections.push(diagramBox("オーナー(現場責任者)", { width: 4600, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("チーム作成・QR/URL配布"));
sections.push(diagramBox(["管理者(任命制)", "オーナーを補助し配置・通知等を操作"], { width: 4600 }));
sections.push(diagramArrow("参加"));
sections.push(diagramBox(["メンバー(アカウント保有者) / ゲスト(当日限り)", "勤務・休憩・投票・チャットを行う現場スタッフ"], { width: 6200 }));

sections.push(h1("3. 収益フロー"));
sections.push(diagramBox(["オーナー(課金主体)"], { width: 4600, bold: true, fill: "FCEFD0" }));
sections.push(diagramArrow("契約・購入"));
sections.push(makeTable(
  [{ text: "経路", width: 3000 }, { text: "内容", width: 6800 }],
  [
    ["月額プラン", "¥980/月。AI提案使い放題+チーム作成1日1件・月15件無料"],
    ["クレジット購入", "10/50/100回分。AI提案・チーム作成超過分に消費"],
    ["招待コード(サイト管理者発行)", "友人向け無制限、またはクレジット付与。金銭のやり取りを伴わない"],
    ["ポイント交換", "現場での活躍(投票)を貯めたポイントで1日パスと交換。金銭のやり取りを伴わない"],
    ["毎月無料クレジット", "決済準備期間中、全アカウントに自動付与(暫定措置)"],
  ],
));
sections.push(diagramArrow("入金(Stripe経由)"));
sections.push(diagramBox(["株式会社Aster Systems", "billing_ledgerに記帳・管理ページで集計"], { width: 5200, bold: true }));

sections.push(h1("4. 広告フロー"));
sections.push(diagramBox("広告主(直接スポンサー / アフィリエイトASP)", { width: 5600 }));
sections.push(diagramArrow("枠設定(src/ads.js)"));
sections.push(diagramBox(["チーム一覧・マイページ画面下部に表示", "業務画面(Command Center等)には非表示"], { width: 5600 }));

sections.push(h1("5. 運営フロー"));
sections.push(diagramBox("サイト管理者(株式会社Aster Systems)", { width: 5600, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("管理ページ"));
[
  "全体統計(利用者数・チーム数・売上)の把握",
  "友人向け招待コード・クレジット付与コードの発行",
  "全ユーザーの契約状況確認",
].forEach((t) => sections.push(bullet(t)));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム サービス構成図 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "サービス構成図.docx"), buf);
  console.log("done");
});
