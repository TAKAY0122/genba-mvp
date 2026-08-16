const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, h3, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("API仕様書"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(worker/index.js 全38エンドポイントを記録)"],
  ["v1.1", "2026年8月", "Googleログイン(/auth/google/*, /auth/handoff)・2段階認証(/login/2fa, /2fa/*)のエンドポイントとAUTH-003/004エラーコードを追加"],
]));

sections.push(h1("1. 共通仕様"));
sections.push(makeTable(
  [{ text: "項目", width: 2400 }, { text: "内容", width: 8000 }],
  [
    ["ベースURL", "/api/v1/"],
    ["データ形式", "JSON(UTF-8)"],
    ["認証方式", "Authorization: Bearer トークン。アカウントはセッショントークン(s_...)、ゲストは参加トークン(pt_...)"],
    ["成功レスポンス", "{ success: true, data: {...} }"],
    ["失敗レスポンス", "{ success: false, errorCode: ..., message: ... }"],
    ["主なHTTPステータス", "400=入力不正 401=未認証 402=課金要件不足 403=権限不足 404=対象なし 409=競合・重複 500=サーバーエラー 503=機能未設定"],
  ],
));

sections.push(h1("2. エラーコード一覧"));
sections.push(makeTable(
  [{ text: "コード", width: 2400 }, { text: "意味", width: 8000 }],
  [
    ["AUTH-001", "未ログイン・認証情報不正(2FAコード不正含む)"],
    ["AUTH-002", "権限不足(ロール・サイト管理者権限等)"],
    ["AUTH-003", "2FA/Googleログインの一時トークンが期限切れ、または見つからない"],
    ["AUTH-004", "2FAコードの試行回数上限に達した"],
    ["VAL-001", "入力値不正・必須項目未入力"],
    ["DATA-001", "対象データが見つからない"],
    ["DATA-002", "重複(メールアドレス重複、コード再利用等)"],
    ["DATA-003", "状態競合(締切済み・上限到達等)"],
    ["BILL-001", "課金要件不足(プラン未契約・クレジット不足等)"],
    ["SYS-001", "サーバー内部エラー"],
    ["SYS-002", "決済機能など外部連携が未設定"],
  ],
));

const ep = (method, path, auth, desc, req, res) => {
  sections.push(h3(method + " " + path));
  sections.push(p("認証: " + auth + " / " + desc));
  if (req) sections.push(p("リクエスト例: " + req, { italics: true, color: "666666" }));
  if (res) sections.push(p("レスポンス例: " + res, { italics: true, color: "666666" }));
};

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("3. 認証・アカウント"));
ep("POST", "/register", "不要", "アカウント登録。成功時セッショントークンとisSiteAdminを返す",
  '{ email, password, name }', '{ token, user, isSiteAdmin }');
ep("POST", "/login", "不要", "ログイン。2FA有効アカウントはセッションを発行せず、require2fa: trueとpendingTokenを返す",
  '{ email, password }', '{ token, user, isSiteAdmin } または { require2fa: true, pendingToken }');
ep("POST", "/login/2fa", "不要", "ログイン/Google連携が2FAコード入力待ちの状態から、TOTPコードかバックアップコードで本セッションを発行する(pendingTokenは5分・最大8回試行で失効)",
  '{ pendingToken, code }', '{ token, user, isSiteAdmin }');
ep("GET", "/auth/google/start", "不要", "Googleの認可画面へリダイレクトする(302)。GOOGLE_CLIENT_ID未設定時はエラーメッセージ付きでトップへ戻す");
ep("GET", "/auth/google/callback", "不要", "Googleからのコールバック。ユーザーの特定/新規作成を行い、2FA未設定なら/?oauthHandoff=、2FA設定済みなら/?g2fa=を付けてトップへリダイレクトする(302)");
ep("POST", "/auth/handoff", "不要", "Googleログイン後のワンタイム引換コードを実セッショントークンに交換する(60秒・単発で失効。セッショントークンをURLに直接載せないための仲介)",
  '{ code }', '{ token, user, isSiteAdmin }');
ep("POST", "/logout", "必要", "ログアウト(セッション破棄)");
ep("GET", "/me", "必要", "自分の情報・サイト管理者フラグ取得");
ep("GET", "/mypage", "必要", "累計実績・獲得バッジ・過去現場履歴の取得(チーム非依存)");
ep("POST", "/2fa/setup", "必要", "2段階認証の秘密鍵を新規発行しQRコード用URIを返す(verify-setupで確認するまでtotp_enabledはfalseのまま)",
  null, '{ secret, otpauthUri }');
ep("POST", "/2fa/verify-setup", "必要", "setupで発行した秘密鍵を6桁コードで確認し、2段階認証を有効化する。バックアップコード8個をこの時だけ平文で返す",
  '{ code }', '{ backupCodes: [...] }');
ep("POST", "/2fa/disable", "必要", "2段階認証を無効化する。現在有効なTOTPコードかバックアップコードの入力を必須とする",
  '{ code }');

sections.push(h1("4. チーム"));
ep("POST", "/teams", "必要", "チーム作成。課金判定(1日1件・月15件無料枠、超過はクレジット消費)を行う",
  '{ siteName, venueName, section, date, aiEnabled }', '{ team: { id, code, aiEnabled, usedCredit } }');
ep("GET", "/teams", "必要", "自分の所属チーム一覧");
ep("GET", "/teams/by-code/:code", "不要", "コードからチーム情報取得(参加画面用)");
ep("POST", "/teams/:code/join", "任意", "チーム参加。未ログインはゲストとして参加",
  '{ name, planStart, planEnd }', '{ teamId, participantId, participantToken, role }');
ep("DELETE", "/teams/:id", "必要(オーナー)", "チーム論理削除");
ep("GET", "/teams/:id/state", "必要", "チーム状態一括取得。5秒間隔でポーリングされる");

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("5. 勤務・休憩・配置"));
ep("POST", "/teams/:id/breaks/start", "必要", "休憩開始(本人 or 管理者代理)");
ep("POST", "/teams/:id/breaks/end", "必要", "休憩終了");
ep("POST", "/teams/:id/checkout", "必要", "退勤(代理退勤時は監査ログに記録)");
ep("PATCH", "/teams/:id/participants/:pid/records", "必要(管理者)", "勤務・休憩履歴の事後修正",
  '{ planStart, planEnd, checkOut, breaks:[{start,end}] }');
ep("POST", "/teams/:id/assignments", "必要(管理者)", "配置登録", '{ pid, start, end, name, note }');
ep("PATCH", "/teams/:id/assignments/:aid", "必要(管理者)", "配置変更");
ep("DELETE", "/teams/:id/assignments/:aid", "必要(管理者)", "配置削除");
ep("POST", "/teams/:id/participants/:pid/role", "必要(オーナー)", "管理者権限の付与・解除");
ep("PATCH", "/teams/:id/display-badge", "必要", "表示バッジの選択", '{ badge }');

sections.push(h1("6. 投票・チャット・通知"));
ep("POST", "/teams/:id/vote", "必要", "投票(1人1票)", '{ targetId }');
ep("POST", "/teams/:id/close-voting", "必要(管理者)", "投票締切・順位確定・ポイント/バッジ付与・累計加算");
ep("POST", "/teams/:id/chat", "必要", "チャット送信", '{ text }');
ep("POST", "/teams/:id/notifications", "必要(管理者)", "一斉・緊急連絡送信", '{ type, text }');
ep("POST", "/teams/:id/notifications/read", "必要", "通知既読化", '{ ids:[1,2,3] }');

sections.push(h1("7. AI・監査"));
ep("PATCH", "/teams/:id/ai-enabled", "必要(管理者)", "AI提案ON/OFF切替。ONには課金要件を満たす必要あり", '{ enabled }');
ep("POST", "/teams/:id/ai-suggest", "必要(管理者)", "AI提案の実行。クレジット制の場合は1消費",
  null, '{ suggestions:[...], source: "ai"|"rule" }');
ep("GET", "/teams/:id/audit", "必要(管理者)", "監査ログ閲覧");

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("8. 課金・コード"));
ep("GET", "/billing", "必要", "課金状態・チーム作成クォータ・決済準備状況の取得");
ep("POST", "/billing/checkout", "必要", "Stripe Checkoutセッション発行", '{ type: "subscription"|"credits", bundle }', '{ url }');
ep("POST", "/billing/portal", "必要", "Stripe Billing Portalセッション発行(契約管理・解約)");
ep("POST", "/billing/webhook", "不要(署名検証)", "Stripe Webhook受信。checkout.session.completed等を処理");
ep("POST", "/redeem", "必要", "招待コード利用", '{ code }');
ep("POST", "/points/exchange", "必要", "ポイント150P消費→AI1日パス交換");

sections.push(h1("9. サイト管理(サイト管理者専用)"));
ep("GET", "/admin/overview", "必要(サイト管理者)", "全体統計・累計売上・入金履歴");
ep("GET", "/admin/codes", "必要(サイト管理者)", "招待コード一覧");
ep("POST", "/admin/codes", "必要(サイト管理者)", "招待コード発行", '{ kind, creditAmount, maxUses, expiresInDays, note }');
ep("PATCH", "/admin/codes/:code", "必要(サイト管理者)", "招待コードの有効/無効切替", '{ active }');
ep("GET", "/admin/users", "必要(サイト管理者)", "全ユーザー一覧(最大200件)");

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム API仕様書 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "API仕様書.docx"), buf);
  console.log("done");
});
