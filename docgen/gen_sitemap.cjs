const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("サイトマップ"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行"],
  ["v1.1", "2026年8月", "Googleログイン・2段階認証コード入力・2段階認証設定画面のフェーズ遷移を追加"],
]));

sections.push(h1("1. 画面階層"));
sections.push(p("本システムはSPA(Single Page Application)であり、フェーズ(phase)という状態遷移でトップレベル画面を切り替え、チームに入った後は route という状態遷移で画面を切り替える。URLは /join/:code のみ意味を持ち、それ以外は状態管理で遷移する。"));

sections.push(h2("1.1 トップレベル(チーム非依存)"));
sections.push(diagramBox("ログイン / 新規登録(パスワード or Googleログイン)", { width: 5600, bold: true }));
sections.push(diagramArrow("2段階認証が有効なアカウントのみ"));
sections.push(diagramBox("2段階認証コード入力(2fa-prompt)", { width: 5600 }));
sections.push(diagramArrow());
sections.push(diagramBox("チーム一覧", { width: 5600, bold: true }));
sections.push(diagramArrow("＋チーム作成 / コードで参加 / QR"));
[
  "チーム作成 → 参加用QR/URL共有 → (チーム内画面へ)",
  "コードで参加・QR/URL → チーム参加画面 → (チーム内画面へ)",
  "プラン → プラン・課金画面",
  "マイページ → マイページ(全体版)",
  "管理(サイト管理者のみ) → 管理ページ",
].forEach((t) => sections.push(bullet(t)));

sections.push(h2("1.2 チーム内(route)"));
sections.push(p("ログイン後、前回開いていたチームがあれば自動的にこの階層へ遷移する。オーナー・管理者は既定でCommand Center、それ以外はマイ勤務が初期画面になる。"));
sections.push(makeTable(
  [{ text: "画面(route)", width: 3200 }, { text: "権限", width: 2000 }, { text: "主な遷移元/先", width: 4200 }],
  [
    ["Command Center(cc)", "オーナー・管理者", "ログイン直後の既定画面。全画面への起点"],
    ["マイ勤務(member)", "全員", "メンバーの既定画面。ボトムナビ常設"],
    ["チャット(chat)", "全員", "Command Center・ボトムナビから"],
    ["AI提案(ai)", "オーナー・管理者", "Command Centerから"],
    ["参加者一覧・詳細(dash)", "オーナー・管理者", "Command Centerから"],
    ["タイムライン(timeline)", "全員", "ボトムナビ・Command Centerから"],
    ["配置管理(assign)", "オーナー・管理者", "Command Center・ボトムナビから"],
    ["ポイント投票(vote)", "全員", "マイ勤務(退勤後)・ナビから"],
    ["ポイント結果(voteResult)", "全員", "投票後、または締切後にナビから"],
    ["通知(notify)", "全員", "ヘッダーの通知アイコンから常時アクセス可"],
    ["マイページ(mypage)", "全員", "ナビから。セキュリティ設定→2段階認証設定・管理画面(manageモード)へ遷移可"],
    ["監査ログ(audit)", "オーナー・管理者", "ナビから"],
  ],
));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("2. 画面遷移図(概略)"));
sections.push(diagramBox("ログイン/新規登録", { width: 4200 }));
sections.push(diagramArrow());
sections.push(diagramBox("チーム一覧", { width: 4200, bold: true }));
sections.push(diagramArrow());
sections.push(diagramBox(["Command Center", "(オーナー・管理者)"], { width: 4200, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("ナビゲーションで相互遷移"));
sections.push(diagramBox([
  "マイ勤務 / チャット / AI提案 / 参加者一覧 / 配置管理 /",
  "タイムライン / 投票 / 結果 / 通知 / マイページ / 監査ログ",
], { width: 5600 }));

sections.push(h1("3. 補足"));
sections.push(bullet("ゲスト参加者はマイページ・プラン画面へのアクセス権はあるが、実績はアカウントに累計されない"));
sections.push(bullet("サイト管理者(管理ページ)への導線は、ログイン中のメールアドレスがSITE_ADMIN_EMAILSに一致する場合のみ表示される"));
sections.push(bullet("URLとして意味を持つのは /join/:code のみで、それ以外の画面遷移はブラウザ履歴に残らない(SPA内の状態遷移のため)"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム サイトマップ v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "サイトマップ.docx"), buf);
  console.log("done");
});
