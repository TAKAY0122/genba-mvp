const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("テーブル定義書・ER図"));
sections.push(...revisionHistory([["v1.0", "2026年7月", "初版発行(migrations 0001〜0006 時点の全14テーブル)"]]));

sections.push(h1("1. ER図(概略)"));
sections.push(p("実線は主要な参照関係を示す(FK制約はD1側では一部のみ明示的に定義。アプリケーション側で整合性を担保している箇所を含む)。"));

sections.push(diagramBox("users(アカウント・課金状態)", { width: 5200, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("1 : N  owner_user_id"));
sections.push(diagramBox("teams(現場)", { width: 5200, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("1 : N  team_id"));
sections.push(diagramBox("participants(参加者)", { width: 5200, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("1 : N  participant_id"));
sections.push(diagramBox(["breaks / assignments"], { width: 5200 }));

sections.push(p(""));
sections.push(diagramBox("teams", { width: 3400 }));
sections.push(diagramArrow("1 : N"));
sections.push(diagramBox("chat_messages / notifications / votes / audit_logs / redemption_codes", { width: 6800 }));

sections.push(p(""));
sections.push(diagramBox("users", { width: 3400 }));
sections.push(diagramArrow("1 : N"));
sections.push(diagramBox("sessions / redemption_uses / billing_ledger", { width: 6800 }));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("2. テーブル定義"));
sections.push(p("時刻列(created_at, start_at 等)はすべてUTCのepochミリ秒(INTEGER)。"));

const tableDef = (name, desc, cols) => {
  sections.push(h2(name));
  sections.push(p(desc));
  sections.push(makeTable(
    [{ text: "列名", width: 2800 }, { text: "型/制約", width: 2200 }, { text: "説明", width: 5000 }],
    cols,
  ));
};

tableDef("users", "アカウント情報。課金状態・累計実績を保持する。", [
  ["id", "TEXT PK", "ユーザーID(u_接頭辞)"],
  ["email", "TEXT UNIQUE", "メールアドレス"],
  ["password_hash", "TEXT", "PBKDF2ハッシュ(salt:hash形式)"],
  ["name", "TEXT", "表示名"],
  ["total_points / total_work_min / sites_count", "INTEGER", "投票締切時に加算される累計実績"],
  ["plan_type", "TEXT DEFAULT 'none'", "'none' / 'subscription' / 'credits'"],
  ["subscription_active", "INTEGER DEFAULT 0", "サブスク有効フラグ"],
  ["subscription_id / subscription_current_period_end", "TEXT / INTEGER", "Stripeサブスク情報"],
  ["credit_balance", "INTEGER DEFAULT 0", "クレジット残高"],
  ["comp_unlimited", "INTEGER DEFAULT 0", "招待コードによる永続無料フラグ"],
  ["day_pass_expires_at", "INTEGER", "ポイント交換1日パスの有効期限"],
  ["credits_month_key", "TEXT", "毎月クレジット付与の最終付与年月"],
  ["stripe_customer_id", "TEXT", "Stripe顧客ID"],
  ["created_at", "INTEGER", "作成日時"],
]);

tableDef("sessions", "アカウントログインセッション(30日間有効)。", [
  ["token", "TEXT PK", "セッショントークン(s_接頭辞)"],
  ["user_id / expires_at", "TEXT / INTEGER", "紐づくユーザーと有効期限"],
]);

tableDef("teams", "1現場(1チーム)を表す単位。", [
  ["id / code", "TEXT PK / UNIQUE", "チームIDと、参加用に共有する8桁の招待コード"],
  ["site_name / venue_name / section / event_date", "TEXT", "現場名・会場名・セクション名・開催日"],
  ["owner_user_id", "TEXT", "作成者(オーナー)のユーザーID。課金判定もこのユーザーに紐づく"],
  ["ai_enabled", "INTEGER DEFAULT 0", "このチームでAI提案がONかどうか"],
  ["voting_closed", "INTEGER DEFAULT 0", "ポイント投票を締め切ったかどうか"],
  ["deleted", "INTEGER DEFAULT 0", "論理削除フラグ"],
  ["created_at", "INTEGER", "作成日時(チーム作成クォータ集計にも使用)"],
]);

tableDef("participants", "チームへの参加者。アカウント保有者はuser_idを持ち、ゲストはtokenを持つ。", [
  ["id / team_id / user_id / token", "TEXT", "参加者ID、所属チーム、アカウント紐付け、ゲスト用参加トークン"],
  ["name / role", "TEXT", "表示名、ロール(owner/admin/member/guest)"],
  ["plan_start / plan_end / check_out", "INTEGER", "予定勤務開始・終了、実退勤時刻"],
  ["badges / display_badge", "TEXT", "獲得バッジ(JSON配列)、名前の前に表示するバッジ"],
  ["today_points / today_rank / today_votes", "INTEGER", "その現場での投票結果"],
]);

tableDef("breaks", "休憩の開始・終了記録(1参加者に複数行、分割取得対応)。", [
  ["id / participant_id", "TEXT", "休憩ID、対象参加者"],
  ["start_at / end_at", "INTEGER", "休憩開始・終了(終了未記録はNULL)"],
]);

tableDef("assignments", "持ち場への配置記録。", [
  ["id / team_id / participant_id", "TEXT", "配置ID、所属チーム、対象参加者"],
  ["start_at / end_at / name / note", "INTEGER/TEXT", "配置の開始・終了時刻、配置名、備考"],
]);

tableDef("chat_messages", "チーム内チャット。", [
  ["id", "INTEGER PK AUTOINCREMENT", "メッセージID"],
  ["team_id / participant_id / text / created_at", "-", "所属チーム、送信者、本文、送信日時"],
]);

tableDef("notifications / notification_reads", "通知本体と既読管理。", [
  ["notifications.id", "INTEGER PK AUTOINCREMENT", "通知ID"],
  ["notifications.type", "TEXT", "休憩不足/一斉連絡/緊急連絡/休憩終了/バッジ獲得"],
  ["notification_reads", "PK(notification_id, participant_id)", "参加者ごとの既読管理"],
]);

tableDef("votes", "ポイント投票。", [
  ["team_id, voter_id", "PK", "1人1票を保証する複合主キー"],
  ["target_id / created_at", "TEXT/INTEGER", "投票先、投票日時"],
]);

tableDef("audit_logs", "管理操作の監査ログ(追記専用)。", [
  ["id / team_id / actor / target / action", "-", "ログID、対象チーム、実行者、対象、操作種別"],
  ["before_text / after_text / created_at", "TEXT/INTEGER", "変更前後内容、日時"],
]);

tableDef("redemption_codes", "招待コード本体。", [
  ["code", "TEXT PK", "コード文字列(FRIEND-/CREDIT-/PX接頭辞)"],
  ["kind", "TEXT", "'friend_unlimited' / 'credit_grant' / 'point_day_pass'"],
  ["credit_amount", "INTEGER DEFAULT 0", "credit_grant時の付与クレジット数"],
  ["max_uses / used_count", "INTEGER", "利用可能人数(NULL=無制限)、利用済み人数"],
  ["created_by / created_at / expires_at / active", "-", "発行者、発行日時、有効期限、有効フラグ"],
]);

tableDef("redemption_uses", "コード利用履歴。", [
  ["code, user_id", "UNIQUE", "同一ユーザーの同一コード再利用を防止"],
  ["used_at", "INTEGER", "利用日時"],
]);

tableDef("billing_ledger", "実入金を記録する売上台帳(管理ページ集計用)。", [
  ["id", "INTEGER PK AUTOINCREMENT", "台帳ID"],
  ["user_id / kind / amount_yen / detail / created_at", "-", "支払者、'subscription'/'credits'、金額(円)、内容、日時"],
]);

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム テーブル定義書・ER図 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "テーブル定義書_ER図.docx"), buf);
  console.log("done");
});
