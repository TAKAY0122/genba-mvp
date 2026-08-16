const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("システム構成図"));
sections.push(...revisionHistory([["v1.0", "2026年7月", "初版発行"]]));

sections.push(h1("1. インフラ構成図"));
sections.push(diagramBox(["利用者端末", "(スマートフォン / PC ブラウザ)"], { width: 5200 }));
sections.push(diagramArrow("HTTPS"));
sections.push(diagramBox(["Cloudflare Workers", "genba-mvp.rb-jigyou2.workers.dev"], { width: 5200, bold: true, fill: "E8ECFB" }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 },
  children: [new TextRun({ text: "静的アセット配信(Assets): ビルド済みSPA(React)", size: 18, color: "666666" })] }));
sections.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
  children: [new TextRun({ text: "APIルート(/api/*): Honoアプリケーション", size: 18, color: "666666" })] }));
sections.push(diagramArrow());
sections.push(makeTable(
  [{ text: "接続先", width: 3400 }, { text: "プロトコル", width: 2000 }, { text: "用途", width: 4400 }],
  [
    ["Cloudflare D1", "SQL(バインディング)", "業務データ永続化"],
    ["Anthropic API", "HTTPS(fetch)", "AI提案生成(claude-haiku-4-5)"],
    ["Stripe API", "HTTPS(fetch)", "決済(Checkout/Portal/Webhook)"],
  ],
));

sections.push(h1("2. デプロイ構成"));
sections.push(diagramBox(["開発者PC", "(genba-mvp フォルダ)"], { width: 4600 }));
sections.push(diagramArrow("vite build"));
sections.push(diagramBox(["dist/(静的アセット)"], { width: 4600 }));
sections.push(diagramArrow("wrangler deploy"));
sections.push(diagramBox(["Cloudflare Workers 本番環境"], { width: 4600, bold: true }));
sections.push(p(""));
sections.push(diagramBox(["migrations/*.sql"], { width: 4600 }));
sections.push(diagramArrow("wrangler d1 migrations apply --remote"));
sections.push(diagramBox(["Cloudflare D1 本番データベース"], { width: 4600, bold: true }));

sections.push(h1("3. 環境変数・シークレットの管理"));
sections.push(bullet("非機密の設定値(価格ID、管理者メールアドレス、FREE_MODEスイッチ)は wrangler.toml の [vars] に平文で管理する"));
sections.push(bullet("機密情報(APIキー、Stripeシークレットキー、Webhook署名シークレット)は wrangler secret put コマンドでCloudflare側にのみ保存し、リポジトリには含めない"));

sections.push(h1("4. ネットワーク・セキュリティ"));
sections.push(bullet("全通信はHTTPS(Cloudflareが自動的にTLS終端)"));
sections.push(bullet("Stripe Webhookエンドポイントは認証不要だが、HMAC-SHA256による署名検証で正当性を確認する"));
sections.push(bullet("パスワードはサーバー側でPBKDF2ハッシュ化して保存し、平文は保持しない"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム システム構成図 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "システム構成図.docx"), buf);
  console.log("done");
});
