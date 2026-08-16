const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("詳細設計書"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(現行実装 worker/index.js 時点のロジックを記録)"],
]));

sections.push(h1("1. 本書の位置づけ"));
sections.push(p("本書は、基本設計書で定義した機能を実現する具体的な計算ロジック・アルゴリズム・処理順序を記載する。実装ファイルは worker/index.js(バックエンド)、src/App.jsx(フロントエンド)。"));

sections.push(h1("2. 勤務・休憩ロジック"));
sections.push(h2("2.1 勤務状態の判定"));
sections.push(p("勤務状態はDBに保存せず、現在時刻と予定・実績時刻から都度算出する(status = 開始前 / 勤務中 / 休憩中 / 退勤済み)。"));
sections.push(bullet("checkOut(退勤時刻)が記録済み → 退勤済み"));
sections.push(bullet("現在時刻 < plan_start(予定開始) → 開始前"));
sections.push(bullet("breaksに終了未記録(end_at IS NULL)の行がある → 休憩中"));
sections.push(bullet("上記以外 → 勤務中"));

sections.push(h2("2.2 必要休憩時間の算出(requiredBreak)"));
sections.push(makeTable(
  [{ text: "予定勤務時間", width: 4000 }, { text: "必要休憩時間", width: 4000 }],
  [["6時間以上", "45分"], ["8時間以上", "60分"], ["6時間未満", "0分(休憩ルール適用外)"]],
));
sections.push(p("取得済み休憩時間は breaks テーブルの各行の (end_at - start_at) を合算して算出する(終了未記録の行は現在時刻を仮の終了時刻として計算)。"));

sections.push(h1("3. 課金判定ロジック"));
sections.push(h2("3.1 billingOk(利用可否判定)"));
sections.push(p("AI提案の利用可否は、以下を上から順に評価し、いずれか true であれば利用可能とする。"));
sections.push(bullet("① comp_unlimited = 1 → 招待コード(友人向け)による永続無料"));
sections.push(bullet("② day_pass_expires_at > 現在時刻 → ポイント交換の1日パスが有効"));
sections.push(bullet("③ plan_type = 'subscription' かつ subscription_active = 1 → 月額プラン契約中"));
sections.push(bullet("④ plan_type = 'credits' かつ credit_balance > 0 → クレジット残高あり"));
sections.push(p("AI提案実行時(POST /teams/:id/ai-suggest)、③④のいずれでもない場合は402エラーを返す。plan_type = 'credits' の場合は、実行直前に「credit_balance > 0 の場合のみ1減算する」条件付きUPDATEを発行し、同時実行時の二重消費を防止する。"));

sections.push(h2("3.2 getTeamQuotaStatus(チーム作成の無料枠判定)"));
sections.push(p("JST基準で当日・当月のチーム作成件数(削除済みも含む)を集計し、以下の条件を両方満たす場合のみ無料でチームを作成できる。"));
sections.push(bullet("当日作成数 < 1件"));
sections.push(bullet("当月作成数 < 15件"));
sections.push(p("いずれかを満たさない場合、またはサブスク未契約の場合は、クレジット残高から1消費してチームを作成する(残高0の場合は作成を拒否する)。JST日付・月の境界は、UTC時刻に+9時間した壁時計時刻から算出し、そこから-9時間したUTC epochを境界値として用いる(jstDayRangeMs / jstMonthRangeMs関数)。"));

sections.push(h2("3.3 ensureMonthlyCredits(毎月の無料クレジット自動付与)"));
sections.push(p("Cron等の定期実行基盤を用いず、以下の遅延評価方式で実現する。"));
sections.push(bullet("1. users.credits_month_key(最終付与年月、例: \"2026-07\")と現在のJST年月を比較する"));
sections.push(bullet("2. 一致していれば何もしない(同月内の重複付与を防止)"));
sections.push(bullet("3. 一致していなければ、credit_balance に MONTHLY_FREE_CREDITS(50)を加算し、credits_month_key を現在の年月に更新する"));
sections.push(bullet("4. この処理は getBilling() 呼び出し時に必ず実行されるため、GET /billing・チーム作成・AI提案利用など、課金情報を参照するあらゆる操作の入口で自動的に付与判定が行われる"));
sections.push(p("この方式により、何ヶ月アクセスが無かったアカウントでも「その時点の月の50」のみが付与され、未取得分が積み上がることはない。また、既存アカウントへの遡及的な一括付与(バッチ処理)を必要としない。"));

sections.push(h1("4. 投票・ポイント集計ロジック"));
sections.push(p("投票締切(POST /teams/:id/close-voting)時に、以下の手順で確定処理を行う。"));
sections.push(bullet("1. votesテーブルから対象チームの全投票を集計し、参加者ごとの得票数を算出する"));
sections.push(bullet("2. 得票数の降順でソートし、同数の場合は同順位とする(順位スキップ方式)"));
sections.push(bullet("3. 順位に応じてポイントを付与: 1位=3P、2位=2P、3位=1P、それ以外=0P(得票0の場合も0P)"));
sections.push(bullet("4. アカウント保有者は、その時点の実働時間・獲得ポイントをusersテーブルの累計値(total_points, total_work_min, sites_count)に加算する(ゲストは加算されない)"));
sections.push(bullet("5. バッジ付与判定(1位→🏆、初ポイント→⚡、累計10Pの倍数到達→💎)を行う(6章参照)"));

sections.push(h1("5. AI提案生成ロジック"));
sections.push(p("POST /teams/:id/ai-suggest の処理順序は以下の通り。"));
sections.push(bullet("1. 権限確認(オーナー・管理者のみ)、チームのai_enabled確認"));
sections.push(bullet("2. 課金判定(3.1節)。クレジット制の場合はここで1消費"));
sections.push(bullet("3. 現在の全参加者について、状態・休憩取得状況・現在配置・残り勤務時間を集計しJSON化"));
sections.push(bullet("4. ANTHROPIC_API_KEYが設定されていればClaude API(claude-haiku-4-5)へ送信し、休憩不足解消・配置提案をJSON配列で受信"));
sections.push(bullet("5. API未設定・接続失敗・JSON解析失敗のいずれかの場合、ルールベース提案(休憩不足者・空き配置・勤務終了間近者を機械的に抽出)にフォールバックする"));
sections.push(bullet("6. 提案のうち「配置」「休憩」種別は、対象者ID・開始終了時刻を付与してフロントエンドへ返却し、「適用」操作で配置登録APIへそのまま渡せる形にする"));

sections.push(h1("6. バッジ付与ロジック(awardBadge)"));
sections.push(p("付与対象アカウントのbadges(JSON配列)を都度DBから再取得し、未獲得のバッジのみ追加してUPDATEする。同一操作で複数バッジ(例: MVP かつ 初ポイント)が同時に条件を満たす場合でも、逐次再取得することで上書き漏れが起きないようにしている。付与時は通知(バッジ獲得)を自動生成する。"));

sections.push(h1("7. エラーハンドリング方針"));
sections.push(bullet("全APIは成功時 { success:true, data:{...} }、失敗時 { success:false, errorCode, message } の統一形式で返却する"));
sections.push(bullet("課金に起因する拒否は HTTPステータス402、権限不足は403、データ不整合は409を用いる"));
sections.push(bullet("billing・admin系APIはDB例外(マイグレーション未適用等)をtry/catchで捕捉し、「データベースの更新が完了していない可能性があります」という診断的なメッセージを返す(生の例外を露出させない)"));
sections.push(bullet("フロントエンドはAPI呼び出し失敗時、決済関連の操作については常に「決済は現在準備中です」という定型文を表示し、技術的なエラー内容を利用者に見せない"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム 詳細設計書 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "詳細設計書.docx"), buf);
  console.log("done");
});
