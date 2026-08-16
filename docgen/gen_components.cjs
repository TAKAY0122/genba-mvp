const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("コンポーネント一覧"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(src/App.jsx 全コンポーネントを記録)"],
  ["v1.1", "2026年8月", "共通Toastコンポーネントを追加(全画面共通の通知表示に統一)"],
]));

sections.push(h1("1. 構成方針"));
sections.push(p("本システムは単一チームアプリの性質上、画面数は多いが相互依存が強いため、全コンポーネントを src/App.jsx 1ファイルに実装している(モジュール分割によるimport管理コストより、一覧性・grep容易性を優先)。App.js内で定義順に上から「共通UI部品」「トップレベル画面」「チーム内画面」「モーダル」の順に並んでいる。"));
sections.push(p("補助ファイルとして src/api.js(APIクライアント)、src/ads.js(広告設定)を分離している。"));

sections.push(h1("2. 共通UI部品"));
sections.push(makeTable(
  [{ text: "コンポーネント", width: 2600 }, { text: "役割", width: 7800 }],
  [
    ["Card", "白背景・角丸・枠線付きの共通カード"],
    ["Btn", "共通ボタン(色・サイズバリエーション)"],
    ["Modal", "画面下部からせり上がるモーダルダイアログ"],
    ["Toast", "App直下で一元描画する完了/エラー通知。成功はslate、エラーはrose+⚠️で色分け(role=\"status\" aria-live=\"polite\")"],
    ["Field", "ラベル付き入力欄のラッパー"],
    ["Badge", "勤務ステータス(勤務中/休憩中/開始前/退勤済み)バッジ"],
    ["RoleTag", "ロール(オーナー/管理者/メンバー/ゲスト)バッジ"],
    ["Shell", "戻るボタン・タイトル・右側ボタン群を持つ共通ヘッダー+本文レイアウト"],
    ["QR", "qrcodeライブラリでQRコード画像を生成して表示"],
    ["AdCard / AdSection", "広告1件の表示、スポンサー枠+アフィリエイト枠の組み合わせ表示"],
    ["Splash", "起動時のローディング表示"],
  ],
));

sections.push(h1("3. トップレベル画面コンポーネント"));
sections.push(makeTable(
  [{ text: "コンポーネント", width: 2600 }, { text: "対応画面", width: 7800 }],
  [
    ["AuthScreen", "ログイン/新規登録/コード参加タブ"],
    ["TeamsScreen", "チーム一覧"],
    ["CreateTeamForm", "チーム作成フォーム(TeamsScreen内)"],
    ["ShareCard", "QR/URL共有カード"],
    ["JoinScreen", "チーム参加"],
    ["GlobalMyPageScreen", "マイページ(チーム非依存・全体版)"],
    ["BillingScreen", "プラン・課金"],
    ["AdminScreen", "管理ページ(サイト管理者専用)"],
  ],
));

sections.push(h1("4. チーム内画面コンポーネント(TeamApp配下)"));
sections.push(p("TeamAppが状態管理・5秒ポーリング・API呼び出しラッパー(run関数)を担い、routeに応じて以下を出し分ける。"));
sections.push(makeTable(
  [{ text: "コンポーネント", width: 2600 }, { text: "対応画面", width: 7800 }],
  [
    ["CommandCenter", "Command Center"],
    ["AIScreen", "AI提案"],
    ["ChatScreen", "チャット"],
    ["MemberScreen", "マイ勤務"],
    ["Dashboard", "参加者一覧(詳細)"],
    ["AssignScreen", "配置管理"],
    ["Timeline", "タイムライン"],
    ["Vote", "ポイント投票"],
    ["VoteResult", "ポイント結果"],
    ["NotifyScreen", "通知"],
    ["MyPage", "マイページ(チーム内版)"],
    ["Audit", "監査ログ"],
  ],
));

sections.push(h1("5. モーダルコンポーネント"));
sections.push(makeTable(
  [{ text: "コンポーネント", width: 2600 }, { text: "用途", width: 7800 }],
  [
    ["EditRecordModal", "勤務・休憩履歴の事後修正(管理者)"],
    ["AssignFormModal", "配置の登録・編集フォーム"],
  ],
));

sections.push(h1("6. 補助ファイル"));
sections.push(makeTable(
  [{ text: "ファイル", width: 2600 }, { text: "内容", width: 7800 }],
  [
    ["src/api.js", "APIクライアント。セッション/参加トークンの保存(store)、call()による共通fetchラッパー、機能別APIメソッド群"],
    ["src/ads.js", "広告枠設定(SPONSOR_SLOTS / AFFILIATE_SLOTS)。値を追加するだけで表示に反映される"],
  ],
));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム コンポーネント一覧 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "コンポーネント一覧.docx"), buf);
  console.log("done");
});
