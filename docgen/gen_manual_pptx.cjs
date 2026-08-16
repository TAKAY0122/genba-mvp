const pptxgen = require("pptxgenjs");
const path = require("path");

const NAVY = "1B2333";
const BLUE = "1E5AC8";
const GOLD = "C9A227";
const GRAY = "666666";
const LGRAY = "F4F5F8";
const WHITE = "FFFFFF";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
const W = 13.33, H = 7.5;

function titleSlide(title, subtitle) {
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addImage({ path: path.join(__dirname, "logo_cropped.png"), x: 0.7, y: 0.6, w: 2.2, h: 2.2 * (293 / 898) });
  s.addText(title, { x: 0.7, y: 2.8, w: 11.5, h: 1.4, fontSize: 40, bold: true, color: WHITE, fontFace: "Meiryo" });
  if (subtitle) s.addText(subtitle, { x: 0.7, y: 4.05, w: 11.5, h: 0.6, fontSize: 18, color: "AEB8D4", fontFace: "Meiryo" });
  s.addText("株式会社 Aster Systems　担当: 吉崎 天晴", { x: 0.7, y: H - 0.9, w: 8, h: 0.4, fontSize: 12, color: "8892B0", fontFace: "Meiryo" });
  return s;
}

function sectionSlide(no, title) {
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText(no, { x: 0.7, y: 2.6, w: 3, h: 1, fontSize: 22, color: GOLD, bold: true, fontFace: "Meiryo" });
  s.addText(title, { x: 0.7, y: 3.1, w: 11.8, h: 1.4, fontSize: 34, bold: true, color: NAVY, fontFace: "Meiryo" });
  return s;
}

function contentSlide(kicker, title) {
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText(kicker, { x: 0.7, y: 0.45, w: 8, h: 0.4, fontSize: 13, color: GOLD, bold: true, fontFace: "Meiryo" });
  s.addText(title, { x: 0.7, y: 0.8, w: 11.9, h: 0.8, fontSize: 26, bold: true, color: NAVY, fontFace: "Meiryo" });
  s.addImage({ path: path.join(__dirname, "logo_cropped.png"), x: W - 1.9, y: 0.45, w: 1.2, h: 1.2 * (293 / 898) });
  return s;
}

function card(s, x, y, w, h, opts = {}) {
  s.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: opts.fill || LGRAY }, line: { color: opts.line || "E2E5EE", width: 1 } });
}
function bulletsBox(s, items, x, y, w, h, opts = {}) {
  s.addText(
    items.map((t, i) => ({ text: t, options: { bullet: { code: "25CF", indent: 18 }, breakLine: i < items.length - 1, color: opts.color || "333333", fontSize: opts.fontSize || 15, paraSpaceAfter: 10 } })),
    { x, y, w, h, fontFace: "Meiryo", valign: "top", margin: 0 }
  );
}

/* ================= 表紙 ================= */
titleSlide("現場運営支援システム 操作説明書", "genba-mvp / Version 1.0 / 2026年7月");

/* ================= 目次 ================= */
{
  const s = contentSlide("CONTENTS", "目次");
  const items = [
    "1. システム概要", "2. ログイン・チーム参加", "3. チーム作成(オーナー向け)",
    "4. Command Center(管理者向け)", "5. 勤務・休憩", "6. 配置管理(管理者向け)",
    "7. ポイント投票・バッジ", "8. AI提案", "9. チャット・通知",
    "10. マイページ", "11. プラン・課金", "12. 管理ページ(サイト管理者向け)", "13. よくある質問",
  ];
  const half = Math.ceil(items.length / 2);
  bulletsBox(s, items.slice(0, half), 0.9, 1.9, 5.6, 4.8, { fontSize: 16 });
  bulletsBox(s, items.slice(half), 6.9, 1.9, 5.6, 4.8, { fontSize: 16 });
}

/* ================= 1. 概要 ================= */
sectionSlide("01", "システム概要");
{
  const s = contentSlide("概要", "現場運営支援システムとは");
  s.addText("イベント・コンサート等の現場スタッフの「勤務・休憩・配置・ポイント投票」を、スマートフォンひとつで管理できるWebアプリです。", { x: 0.7, y: 1.9, w: 11.9, h: 0.7, fontSize: 16, color: "333333", fontFace: "Meiryo" });
  const roles = [
    ["オーナー", "チームの作成者。全操作・課金契約が可能"],
    ["管理者", "オーナーが任命。配置・通知等を操作"],
    ["メンバー", "アカウントで参加するスタッフ"],
    ["ゲスト", "QR/URL/コードで参加(登録不要)"],
  ];
  roles.forEach(([t, d], i) => {
    const x = 0.7 + i * 3.05;
    card(s, x, 2.8, 2.85, 2.6);
    s.addText(t, { x: x + 0.2, y: 3.0, w: 2.45, h: 0.5, fontSize: 17, bold: true, color: NAVY, fontFace: "Meiryo" });
    s.addText(d, { x: x + 0.2, y: 3.55, w: 2.45, h: 1.7, fontSize: 13, color: "444444", fontFace: "Meiryo" });
  });
}

/* ================= 2. ログイン・参加 ================= */
sectionSlide("02", "ログイン・チーム参加");
{
  const s = contentSlide("使い方", "アカウント登録とゲスト参加");
  bulletsBox(s, [
    "アカウントを作る場合:「新規登録」タブから名前・メール・パスワード(8文字以上)を入力",
    "現場に招待された場合: 共有されたQRコードを読み取るか、URLを開く",
    "アカウントを作らずに「ゲスト」として参加することも可能(その場合、実績は累計されません)",
    "参加時に表示名と予定勤務時間を入力すると、必要休憩時間が自動計算されます",
    "一度ログインすると、次回は前回開いていたチームに自動的に入ります",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 3. チーム作成 ================= */
sectionSlide("03", "チーム作成(オーナー向け)");
{
  const s = contentSlide("使い方", "現場(チーム)を作る");
  bulletsBox(s, [
    "「チーム一覧」画面の「＋チーム作成」から、現場名・会場名・開催日を入力",
    "AI提案を使いたい場合はスイッチをON(課金プランが必要です)",
    "作成すると、参加用のQRコードと共有URLが発行されます",
    "URLをLINE等でスタッフに共有するだけで、相手はアカウント不要ですぐ参加できます",
    "チーム作成には利用回数の制限があります(プラン・課金画面で確認できます)",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 4. Command Center ================= */
sectionSlide("04", "Command Center(管理者向け)");
{
  const s = contentSlide("使い方", "現場全体を一画面で把握する");
  bulletsBox(s, [
    "KPIカード: 勤務中・休憩中・開始前・退勤済み・休憩不足の人数が一目でわかる",
    "アラート: 休憩不足や配置の空きを自動で検出して知らせる",
    "AI提案: 状況を分析したおすすめの対応が表示され、「適用」で即反映できる",
    "配置サマリー・スタッフ状況・チャット・通知の最新も同じ画面で確認できる",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 5. 勤務・休憩 ================= */
sectionSlide("05", "勤務・休憩");
{
  const s = contentSlide("使い方", "自分の勤務・休憩を記録する");
  bulletsBox(s, [
    "「マイ勤務」画面が本人操作の中心。ボタン操作は不要で、予定時刻になると自動的に「勤務中」になる",
    "休憩は「休憩開始」ボタンを押すだけ。何度でも分割して取得できる",
    "必要休憩時間は勤務予定に応じて自動計算(6時間以上で45分、8時間以上で60分)",
    "休憩が足りない場合は責任者側に自動でアラートが届く",
    "勤務が終わったら「退勤する」ボタンを押す(管理者が代わりに記録することも可能)",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 6. 配置管理 ================= */
sectionSlide("06", "配置管理(管理者向け)");
{
  const s = contentSlide("使い方", "持ち場にスタッフを配置する");
  bulletsBox(s, [
    "「配置管理」画面で、スタッフごとに開始・終了時刻と配置名(持ち場)を登録",
    "配置はよく使う持ち場名から選択、または自由入力ができる",
    "「タイムライン」画面で、全員の勤務・配置・休憩を時系列でまとめて確認できる",
    "配置の変更・削除はすべて監査ログに記録され、後から確認できる",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 7. 投票・バッジ ================= */
sectionSlide("07", "ポイント投票・バッジ");
{
  const s = contentSlide("使い方", "現場の活躍を称え合う");
  bulletsBox(s, [
    "現場終了後、自分以外の1名に「ポイント投票」で投票する(1人1回)",
    "管理者が投票を締め切ると、得票順に1位3P・2位2P・3位1Pが確定する",
    "獲得ポイントはアカウントに累計され、マイページでいつでも確認できる",
    "MVPバッジ・初ポイント・休憩マスター・累計10P到達などのバッジが自動で付与される",
    "獲得したバッジは、マイページから「名前の前に表示するバッジ」として選べる",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 8. AI提案 ================= */
sectionSlide("08", "AI提案");
{
  const s = contentSlide("使い方", "AIに現場運営のヒントをもらう");
  bulletsBox(s, [
    "Command Centerまたは「AI提案」画面で「再分析」を押すと、現在の状況をAIが分析",
    "休憩不足の解消案や、配置が空いている持ち場への提案が表示される",
    "「この提案を配置に適用する」を押すと、そのまま配置として登録される",
    "AI未接続時は自動でルールベースの提案に切り替わるため、機能が止まることはない",
    "利用には課金プラン(月額またはクレジット)が必要です",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 9. チャット・通知 ================= */
sectionSlide("09", "チャット・通知");
{
  const s = contentSlide("使い方", "現場内のやり取り");
  bulletsBox(s, [
    "「チャット」画面はチーム全員が参加できる現場内チャット",
    "スタンプで素早く返信できる",
    "管理者は「通知」画面から一斉連絡・緊急連絡を全員に送信できる",
    "システムからの自動通知(休憩終了・バッジ獲得など)も同じ画面に届く",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 10. マイページ ================= */
sectionSlide("10", "マイページ");
{
  const s = contentSlide("使い方", "自分の実績を確認する");
  bulletsBox(s, [
    "ヘッダーの「マイページ」から、チームに参加しなくても実績を確認できる",
    "累計ポイント・累計勤務時間・参加現場数・獲得バッジの一覧が見られる",
    "過去に参加した現場の履歴(順位・獲得ポイント)も確認できる",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 11. プラン・課金 ================= */
sectionSlide("11", "プラン・課金");
{
  const s = contentSlide("使い方", "プランの確認と利用枠の管理");
  bulletsBox(s, [
    "「プラン」画面で、月額プラン(¥980/月)とクレジット(10/50/100回分)を比較・選択できる",
    "決済機能の準備が整うまでの間は、毎月クレジット50回分が全アカウントに自動付与される",
    "貯めたポイントを150P消費して、AI提案が1日使い放題になる「デイパス」と交換できる",
    "招待コードをお持ちの場合は、同画面の入力欄からコードを利用できる",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 12. 管理ページ ================= */
sectionSlide("12", "管理ページ(サイト管理者向け)");
{
  const s = contentSlide("使い方", "サービス全体の運営");
  bulletsBox(s, [
    "ヘッダーの「管理」は、指定されたメールアドレスでログインした場合のみ表示される",
    "「概要」タブ: 登録ユーザー数・チーム数・売上・入金履歴を確認",
    "「招待コード」タブ: 友人向け無制限コード、またはクレジット付与コードを発行・管理",
    "「ユーザー」タブ: 全ユーザーの契約状況・残高・実績を一覧で確認",
  ], 0.7, 1.9, 11.9, 4.8, { fontSize: 16 });
}

/* ================= 13. FAQ ================= */
sectionSlide("13", "よくある質問");
{
  const s = contentSlide("FAQ", "困ったときは");
  const qa = [
    ["Q. 「プランを見る」が反応しない", "A. スマートフォンのブラウザキャッシュが古い可能性があります。一度タブを閉じて開き直してください"],
    ["Q. チームを作成できない", "A. 無料枠(1日1件・月15件)を使い切っている可能性があります。プラン・課金画面で状況を確認してください"],
    ["Q. AI提案が使えない", "A. チームの管理者設定でAI提案がOFFになっているか、利用枠が不足している可能性があります"],
    ["Q. 招待されたのにチームが開けない", "A. QRコード・URLの有効期限切れ、またはチームが削除された可能性があります。発行者に確認してください"],
  ];
  qa.forEach(([q, a], i) => {
    const y = 1.9 + i * 1.25;
    card(s, 0.7, y, 11.9, 1.05);
    s.addText(q, { x: 0.95, y: y + 0.08, w: 11.4, h: 0.4, fontSize: 14, bold: true, color: NAVY, fontFace: "Meiryo" });
    s.addText(a, { x: 0.95, y: y + 0.5, w: 11.4, h: 0.45, fontSize: 13, color: "444444", fontFace: "Meiryo" });
  });
}

/* ================= 終了 ================= */
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addImage({ path: path.join(__dirname, "logo_cropped.png"), x: (W - 3) / 2, y: 2.6, w: 3, h: 3 * (293 / 898) });
  s.addText("ご不明な点はAster Systems(吉崎)までご連絡ください", { x: 0.7, y: 4.2, w: 11.9, h: 0.6, align: "center", fontSize: 16, color: "AEB8D4", fontFace: "Meiryo" });
}

pres.writeFile({ fileName: path.join(__dirname, "操作説明書.pptx") }).then(() => console.log("done"));
