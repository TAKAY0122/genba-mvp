const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("提案依頼書(RFP)"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行。当初のCommand Center中心の全体構想から、勤務・休憩・配置・ポイント投票を核とするMVPスコープへ絞り込んだ確定版として記録"],
]));

sections.push(h1("1. 本書の目的"));
sections.push(p("本書は、RB事業2課が現場運営支援システムの開発を委託するにあたり、提示した要求事項を記録するものである。開発者は本書および関連ドキュメント一式(要件定義書・基本設計書等)に基づき開発を行う。"));

sections.push(h1("2. プロジェクト概要"));
sections.push(makeTable(
  [{ text: "項目", width: 2600 }, { text: "内容", width: 7800 }],
  [
    ["プロジェクト名", "現場運営支援システム開発プロジェクト(genba-mvp)"],
    ["依頼元", "RB事業2課"],
    ["対象業務", "イベント・コンサート等の現場運営における勤務・休憩・配置・当日運営"],
    ["主な利用者", "現場オーナー、管理者、メンバー、ゲスト参加者"],
    ["重要方針", "「勤務・休憩・配置・ポイント投票」という核を薄めない範囲でのみ機能を追加する。核と無関係な大規模機能(複数日対応、CSV連携等)は初回スコープに含めない"],
  ],
));

sections.push(h1("3. 背景と経緯"));
sections.push(p("当初は「Command Center」を中心とした現場全体の一画面把握を主眼とする広範なシステム構想があったが、開発初期段階で方針を転換し、まずMVP(Minimum Viable Product)として「勤務・休憩・配置・ポイント投票」を核とする実用最小限の機能に絞って本番稼働させることとした。稼働後、AI提案・Command Center・チャット・課金・広告・管理ページ等を段階的に追加した。"));

sections.push(h1("4. 開発対象範囲(確定スコープ)"));
sections.push(makeTable(
  [{ text: "分類", width: 2600 }, { text: "内容", width: 5800 }, { text: "優先度", width: 1400 }],
  [
    ["認証・参加", "アカウント認証、ゲスト参加(QR/URL/コード)", "Must"],
    ["勤務・休憩(核)", "自動勤務開始、休憩管理(必要休憩自動計算)、退勤", "Must"],
    ["配置(核)", "持ち場への配置登録・変更、タイムライン", "Must"],
    ["ポイント投票(核)", "1人1票投票、順位確定、ポイント・バッジ", "Must"],
    ["Command Center", "KPI・アラート・現場一画面把握", "Should"],
    ["AI提案", "Claude APIによる休憩・配置提案", "Should"],
    ["チャット・通知", "チーム内コミュニケーション", "Should"],
    ["課金", "サブスク/クレジット、招待コード、ポイント交換", "Should"],
    ["広告", "スポンサー枠・アフィリエイト枠", "Could"],
    ["管理ページ", "サイト全体運営(サイト管理者専用)", "Should"],
  ],
));

sections.push(h1("5. 対象外範囲"));
sections.push(bullet("複数日開催イベントへの対応"));
sections.push(bullet("持ち場テンプレートの保存・再利用"));
sections.push(bullet("勤務・休憩実績のCSVエクスポート、配置のCSV一括登録"));
sections.push(bullet("遅刻・休憩未取得の自動プッシュ通知"));
sections.push(bullet("給与計算・請求管理等の会計連携"));

sections.push(h1("6. 技術要件"));
sections.push(bullet("クラウド環境で稼働し、月額運用コストを可能な限り低く抑えること(Cloudflare Workers/D1を採用)"));
sections.push(bullet("スマートフォンでの利用を最優先としたレスポンシブUIとすること"));
sections.push(bullet("チーム内の状態変化(勤務・休憩・配置)は数秒程度の遅延で反映されること"));
sections.push(bullet("将来の決済機能追加を見据え、課金判定ロジックを機能追加時点から組み込める設計とすること"));

sections.push(h1("7. 非機能要求"));
sections.push(makeTable(
  [{ text: "分類", width: 2600 }, { text: "要求内容", width: 7800 }],
  [
    ["可用性", "サーバーレス構成により単一障害点を持たないこと"],
    ["セキュリティ", "パスワードのハッシュ化、決済情報を自社で保持しない構成とすること"],
    ["拡張性", "機能追加のたびに開発ドキュメント一式を更新し、仕様の陳腐化を防ぐこと"],
  ],
));

sections.push(h1("8. 納品物"));
sections.push(bullet("ソースコード一式(フロントエンド・バックエンド・マイグレーション)"));
sections.push(bullet("開発ドキュメント一式(見積書・提案依頼書・要件定義書・基本設計書・詳細設計書・画面設計書・サイトマップ・コンポーネント一覧・コーディングルール・機能一覧書・API仕様書・テーブル定義書ER図・システム構成図・サービス構成図・操作説明書・リリース手順書)"));
sections.push(bullet("本番環境へのデプロイ(稼働中システム)"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム 提案依頼書(RFP) v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "提案依頼書.docx"), buf);
  console.log("done");
});
