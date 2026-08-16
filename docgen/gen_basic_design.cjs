const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("基本設計書"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(現行実装 migrations 0001〜0006 時点)"],
]));

sections.push(h1("1. 本書の位置づけ"));
sections.push(p("本書は、要件定義書で定義した機能を、どのような構成・画面・データで実現するかを示す基本設計書である。実装レベルの詳細(関数・アルゴリズム)は詳細設計書に記載する。"));

sections.push(h1("2. システム全体構成"));
sections.push(diagramBox(["利用者(スマートフォン / PC ブラウザ)"], { width: 5200 }));
sections.push(diagramArrow("HTTPS"));
sections.push(diagramBox(["Cloudflare Workers", "(Hono + 静的アセット配信)"], { width: 5200, bold: true }));
sections.push(diagramArrow());
sections.push(makeTable(
  [{ text: "連携先", width: 3000 }, { text: "用途", width: 6800 }],
  [
    ["Cloudflare D1", "業務データの永続化(SQLite互換)"],
    ["Anthropic Claude API", "AI提案の生成(未接続時はルールベースにフォールバック)"],
    ["Stripe API", "決済(Checkout / Billing Portal / Webhook)"],
  ],
));

sections.push(h1("3. 機能構成"));
sections.push(makeTable(
  [{ text: "大分類", width: 2600 }, { text: "含まれる機能", width: 7800 }],
  [
    ["認証・参加", "アカウント登録/ログイン、ゲスト参加(QR/URL/コード)"],
    ["勤務・休憩", "自動勤務開始、休憩開始・終了、退勤、履歴修正"],
    ["配置", "持ち場への配置登録・変更・削除、タイムライン表示"],
    ["投票・バッジ", "ポイント投票、締切・順位確定、バッジ付与"],
    ["現場把握", "Command Center(KPI・アラート・AI提案・配置サマリー)"],
    ["コミュニケーション", "チャット、通知(一斉・緊急・システム自動)"],
    ["実績管理", "マイページ(チーム内/全体)、監査ログ"],
    ["課金", "サブスク/クレジット、チーム作成クォータ、招待コード、ポイント交換"],
    ["広告", "スポンサー枠・アフィリエイト枠"],
    ["サイト運営", "管理ページ(統計・招待コード管理・ユーザー一覧)"],
  ],
));

sections.push(h1("4. 画面一覧と対応機能"));
sections.push(makeTable(
  [{ text: "画面", width: 3200 }, { text: "主な対応機能", width: 3200 }, { text: "権限", width: 3000 }],
  [
    ["ログイン/新規登録", "認証・参加", "全員"],
    ["チーム一覧", "チーム管理、プラン・マイページ・管理ページ導線", "アカウント保有者"],
    ["チーム作成/参加", "チーム管理、課金判定", "アカウント保有者/ゲスト"],
    ["Command Center", "現場把握、AI提案", "オーナー・管理者"],
    ["マイ勤務", "勤務・休憩", "全員"],
    ["参加者一覧(詳細)", "勤務・休憩・配置の代理操作", "オーナー・管理者"],
    ["配置管理", "配置", "オーナー・管理者"],
    ["タイムライン", "配置・勤務・休憩の可視化", "全員"],
    ["ポイント投票/結果", "投票・バッジ", "全員"],
    ["通知", "コミュニケーション", "全員(送信は管理者)"],
    ["マイページ", "実績管理", "アカウント保有者"],
    ["プラン・課金", "課金", "アカウント保有者"],
    ["監査ログ", "実績管理", "オーナー・管理者"],
    ["管理ページ", "サイト運営", "サイト管理者"],
  ],
));

sections.push(h1("5. データ設計方針"));
sections.push(bullet("時刻はUTCのepochミリ秒で保持し、表示時にJST変換する(詳細はテーブル定義書・ER図を参照)"));
sections.push(bullet("チーム・監査ログ等は物理削除せず論理削除または追記のみとし、履歴を保持する"));
sections.push(bullet("課金状態(サブスク・クレジット・招待コード適用状況)はチームではなくユーザー(オーナー)単位で保持し、同一オーナーの全チームに適用する"));

sections.push(h1("6. 外部インターフェース"));
sections.push(makeTable(
  [{ text: "連携先", width: 2600 }, { text: "方式", width: 2600 }, { text: "概要", width: 5200 }],
  [
    ["Anthropic Claude API", "REST(fetch)", "現場状況JSONを送信し、提案(JSON配列)を受信"],
    ["Stripe API", "REST(fetch、SDK不使用)", "Checkout Session発行、Billing Portal発行、Webhook受信"],
    ["ブラウザ localStorage", "クライアント側保存", "セッショントークン・ゲスト参加トークンの保持"],
  ],
));

sections.push(h1("7. 非機能設計"));
sections.push(makeTable(
  [{ text: "項目", width: 2600 }, { text: "方針", width: 7800 }],
  [
    ["可用性", "Cloudflare Workersのサーバーレス構成により、単一障害点を持たない"],
    ["リアルタイム性", "5秒間隔のポーリングで疑似リアルタイム表示を実現(WebSocket等は未使用)"],
    ["対応端末", "スマートフォン優先のレスポンシブ設計。PC(lg以上)ではサイドバー、スマホはボトムナビゲーション"],
    ["セキュリティ", "パスワードはPBKDF2ハッシュ化、Stripe Webhookは署名検証、監査ログは追記のみ"],
  ],
));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム 基本設計書 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "基本設計書.docx"), buf);
  console.log("done");
});
