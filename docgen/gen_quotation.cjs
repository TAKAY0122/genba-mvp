const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("見積書"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(実績工数に基づく参考見積)"],
  ["v1.1", "2026年8月", "2026年時点の受託開発市場相場調査に基づき金額を改定。UI/UX改善(通知表示・二重送信防止・アクセシビリティ対応)分の工数を追加"],
]));

sections.push(h1("1. 見積概要"));
sections.push(makeTable(
  [{ text: "項目", width: 2600 }, { text: "内容", width: 7800 }],
  [
    ["件名", "現場運営支援システム(genba-mvp)開発一式"],
    ["提出先", "RB事業2課 御中"],
    ["提出元", "株式会社Aster Systems"],
    ["見積有効期限", "発行日より3ヶ月間"],
    ["前提", "本見積は、実際に開発・本番稼働した内容に基づく参考見積(実績ベース)である。仕様変更・追加開発は別途見積とする"],
  ],
));

sections.push(h1("2. 工程別見積内訳"));
sections.push(p("単価は2026年時点の受託開発market相場(要件定義・設計を担うSEクラスで月額70万〜100万円、React等を用いるフルスタックエンジニアで月額60万〜100万円程度)を参考に、blended単価としてSE相当80万円/月・実装担当75万円/月を用いて算定した。"));
sections.push(makeTable(
  [{ text: "工程", width: 2200 }, { text: "内容", width: 3900 }, { text: "工数", width: 1300 }, { text: "金額(税別)", width: 2400 }],
  [
    ["要件確認・基本設計", "要件ヒアリング、機能スコープ確定、基本設計書作成", "0.7人月", "560,000円"],
    ["詳細設計・DB設計", "課金ロジック・API設計、テーブル定義", "0.5人月", "400,000円"],
    ["開発(フロントエンド)", "React/Vite/Tailwindによる全画面実装、UI/UX改善対応", "1.8人月", "1,350,000円"],
    ["開発(バックエンド)", "Hono API、D1スキーマ、Stripe/Claude連携", "1.9人月", "1,430,000円"],
    ["結合・受入テスト", "wrangler devによるE2E検証、不具合修正", "0.5人月", "380,000円"],
    ["リリース・ドキュメント整備", "本番デプロイ、開発ドキュメント一式作成", "0.4人月", "300,000円"],
    ["小計", "", "5.8人月", "4,420,000円"],
    ["消費税(10%)", "", "", "442,000円"],
    ["合計", "", "", "4,862,000円"],
  ],
));

sections.push(h1("3. 運用・保守費用(参考)"));
sections.push(p("定額保守プランは、システム保守費用の市場相場である「初期開発費の年15〜20%」を基準に算定した(開発費4,420,000円 × 17.5% ÷ 12ヶ月)。都度対応の軽微修正は、実働時間ベースの下限額として別途設定する。"));
sections.push(makeTable(
  [{ text: "項目", width: 3200 }, { text: "金額(税別)", width: 2800 }, { text: "備考", width: 3800 }],
  [
    ["定額保守プラン(月額・任意)", "64,000円/月", "初期開発費の年15〜20%が市場相場。問い合わせ対応・軽微な不具合修正・監視を含む"],
    ["軽微修正対応(都度・保守プラン非加入時)", "30,000円〜/件", "実働時間に応じて別途見積"],
    ["Cloudflare Workers/D1利用料", "実費(通常は無料枠内)", "利用量に応じた従量課金"],
    ["Anthropic API利用料", "実費(1回あたり1円未満)", "AI提案の利用回数に応じる"],
    ["Stripe決済手数料", "決済額の3.6%程度", "Stripe公式料金による"],
  ],
));

sections.push(h1("4. 見積前提条件"));
sections.push(bullet("本見積は現行仕様(機能一覧書 v1.1)を対象範囲とする"));
sections.push(bullet("単価は2026年時点の受託開発市場相場の調査結果を参考に算定した参考値であり、実際の契約条件により変動する場合がある"));
sections.push(bullet("Stripeアカウントの開設・本人確認・セキュリティ対策申告等、決済事業者側の手続きに要する期間は含まない"));
sections.push(bullet("ロゴ・ブランド素材は貸与されたものを使用し、新規デザイン費用は含まない"));
sections.push(bullet("追加機能(複数日イベント対応、CSV入出力等)は別途見積とする"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム 見積書 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "見積書.docx"), buf);
  console.log("done");
});
