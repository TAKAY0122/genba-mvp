const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  h1, h2, h3, p, bullet, makeTable, makeCover, revisionHistory, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("機能一覧書(仕様書)"));
sections.push(...revisionHistory([
  ["v1.0", "2026年7月", "初版発行(勤務・休憩・配置・投票のMVPに加え、Command Center・AI提案・チャット・課金・広告・管理ページまでを含む現行仕様として記録)"],
  ["v1.1", "2026年8月", "UI/UX改善(全画面共通の完了/エラー通知表示、多重送信防止、アクセシビリティ対応)に伴い非機能要件を更新"],
  ["v1.2", "2026年8月", "Googleアカウントログイン・2段階認証(TOTP)を追加"],
]));

sections.push(h1("1. 本書の目的"));
sections.push(p("本書は、現場運営支援システム(開発コード名: genba-mvp)の機能仕様を定義するものである。本システムは、イベント・コンサート等の現場運営における「勤務・休憩・配置・ポイント投票」を中核機能とし、これに現場責任者向けの一画面把握機能(Command Center)、AIによる運営提案、チーム内コミュニケーション、および運営を継続するための課金・広告機能を加えたWebアプリケーションである。"));
sections.push(p("開発・運用主体は株式会社Aster Systems RB事業2課であり、自社のイベントスタッフ運営で利用することを主目的とする。"));

sections.push(h1("2. システム概要"));
sections.push(makeTable(
  [{ text: "項目", width: 2400 }, { text: "内容", width: 8000 }],
  [
    ["システム名", "現場運営支援システム(開発コード名: genba-mvp)"],
    ["対象業務", "イベント・コンサート等における現場スタッフの勤務・休憩・配置・当日運営"],
    ["利用者", "現場オーナー・管理者・一般メンバー・ゲスト(アカウント登録不要の当日参加者)"],
    ["提供形態", "Webブラウザで利用するSPA(スマートフォン・PC対応)"],
    ["ホスティング", "Cloudflare Workers(サーバーレス)"],
    ["現在の状態", "本番稼働中(https://genba-mvp.rb-jigyou2.workers.dev)。決済機能は準備中(後述)"],
  ],
));

sections.push(h1("3. 用語定義"));
sections.push(makeTable(
  [{ text: "用語", width: 2200 }, { text: "定義", width: 8200 }],
  [
    ["チーム", "1つの現場(イベント)を表す単位。作成者がオーナーとなる"],
    ["参加者", "チームに参加したメンバー。アカウント保有者またはゲスト"],
    ["オーナー", "チームの作成者。チーム削除・権限変更ができる最上位権限"],
    ["管理者", "オーナーが任命した、配置・休憩・通知などの運営操作ができる権限"],
    ["ゲスト", "アカウントを作らずQRコード・URL・チームコードで参加した当日限りの参加者"],
    ["クレジット", "AI提案の利用やチーム作成に消費する従量課金の単位"],
    ["招待コード", "友人向け無制限利用、またはクレジット付与を行う管理者発行コード"],
    ["デイパス", "ポイント交換で得られる24時間限定のAI提案使い放題権"],
    ["サイト管理者", "本システム全体の運営者(作成者)。管理ページにアクセスできる特別な立場"],
  ],
));

sections.push(h1("4. 利用者ロールと権限"));
sections.push(makeTable(
  [{ text: "ロール", width: 1800 }, { text: "付与方法", width: 3000 }, { text: "できること", width: 5400 }],
  [
    ["オーナー", "チーム作成時に自動付与", "チームの全操作、管理者の任命・解任、チーム削除、決済契約"],
    ["管理者", "オーナーが任命", "配置登録・変更、休憩・勤怠の代理操作、通知送信、AI提案利用、投票締切、監査ログ閲覧"],
    ["メンバー", "アカウントで参加", "自分の勤務・休憩操作、投票、チャット、マイページ閲覧"],
    ["ゲスト", "QR/URL/コードで参加", "メンバーと同様の当日操作。アカウントに紐づく累計実績は残らない"],
    ["サイト管理者", "運営者のメールアドレスを設定で指定", "全チーム横断の統計閲覧、招待コードの発行・管理、全ユーザー一覧閲覧"],
  ],
));

sections.push(h1("5. 業務フロー(現場当日までの流れ)"));
[
  "オーナーがアカウントを作成し、ログインする",
  "「チーム作成」で現場(現場名・会場名・開催日)を登録する",
  "QRコードまたは共有URL・チームコードをスタッフに配布する",
  "スタッフはアカウント登録またはゲストとして、表示名・予定勤務時間を入力して参加する",
  "管理者が持ち場ごとに配置(開始・終了時刻、配置名)を登録する",
  "当日、予定勤務開始時刻になると自動的に「勤務中」になる",
  "スタッフは休憩開始・終了を自分で操作する(必要休憩は自動計算)",
  "管理者はCommand Centerで現場全体の状況・アラートを一画面で確認する",
  "退勤はスタッフ本人、または管理者が代理で記録する",
  "現場終了後、管理者が投票を締め切り、ポイント・バッジを確定する",
].forEach((t, i) => sections.push(bullet(`${i + 1}. ${t}`)));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("6. 機能仕様"));

sections.push(h2("6.1 認証・参加"));
sections.push(bullet("メールアドレス・パスワードによるアカウント登録/ログイン(パスワードは8文字以上、PBKDF2でハッシュ化)"));
sections.push(bullet("Googleアカウントによるログイン/登録(サーバー主導のOAuth 2.0 Authorization Codeフロー)。同じメールアドレスの既存アカウントがあれば自動的に連携する"));
sections.push(bullet("2段階認証(TOTP): 認証アプリ(Google Authenticator等)で生成する6桁コードによるログイン時の追加確認。登録直後に設定を案内(スキップ可)し、マイページからいつでも有効化/無効化できる。認証アプリが使えない場合のバックアップコード(1回限り使用、8個発行)にも対応"));
sections.push(bullet("セッションは30日間有効。次回アクセス時は前回開いていたチームへ自動的に入る"));
sections.push(bullet("ゲスト参加: QRコード・共有URL・チームコードのいずれかから、アカウント登録なしで参加可能"));
sections.push(bullet("参加時に表示名・予定勤務開始/終了時刻を入力する"));

sections.push(h2("6.2 勤務管理"));
sections.push(bullet("予定勤務開始時刻になると、操作不要で自動的に「勤務中」ステータスになる"));
sections.push(bullet("退勤はボタン操作で記録。管理者は本人に代わって代理退勤を記録できる(監査ログに記録)"));
sections.push(bullet("状態は「開始前」「勤務中」「休憩中」「退勤済み」の4種"));

sections.push(h2("6.3 休憩管理"));
sections.push(bullet("休憩の開始・終了は本人操作。分割取得に対応"));
sections.push(bullet("必要休憩時間を予定勤務時間から自動算出: 6時間以上勤務で45分、8時間以上勤務で60分"));
sections.push(bullet("必要休憩に対して取得済み時間が不足している場合、責任者側にアラート表示"));
sections.push(bullet("管理者は勤務・休憩の実績時刻を事後修正できる(変更前後を監査ログに記録)"));

sections.push(h2("6.4 配置管理"));
sections.push(bullet("管理者が参加者ごとに、開始・終了時刻(分単位)と配置名を登録・編集・削除する"));
sections.push(bullet("タイムライン画面で、勤務予定・配置・実休憩・現在時刻をPCは横型ガント、スマホはカード形式で表示"));

sections.push(h2("6.5 ポイント投票"));
sections.push(bullet("参加者は現場終了後、自分以外の1名に投票する(1人1票)"));
sections.push(bullet("管理者が投票を締め切ると、得票数の順位に応じてポイントを付与: 1位3P・2位2P・3位1P(同数は同順位)"));
sections.push(bullet("獲得ポイントはアカウントに累計加算される(ゲストは累計されない)"));

sections.push(h2("6.6 バッジ制度"));
sections.push(makeTable(
  [{ text: "バッジ", width: 1600 }, { text: "獲得条件", width: 8400 }],
  [
    ["🏆 MVP", "投票締切時に現場内1位(得票1票以上)"],
    ["⚡ 初ポイント獲得", "投票でポイントを獲得したのが初めての場合"],
    ["☕ 休憩マスター", "必要休憩を満たした状態で退勤した場合"],
    ["💎 累計10P到達", "累計ポイントが10の倍数に到達した場合"],
  ],
));
sections.push(p("獲得したバッジは、マイページから「名前の前に表示するバッジ」として1つ選択できる。"));

sections.push(h2("6.7 Command Center(現場責任者向け一画面把握)"));
sections.push(bullet("KPI: 勤務中・休憩中・開始前・退勤済み・休憩不足の人数を一目で確認"));
sections.push(bullet("アラート: 休憩不足、配置の空き、勤務終了間近の3種を自動検出して一覧表示"));
sections.push(bullet("AI提案欄、現在の配置サマリー、スタッフ状況、チーム内チャット・通知の最新をまとめて表示"));

sections.push(h2("6.8 AI提案"));
sections.push(bullet("現在の勤務・休憩・配置状況をAnthropic Claude APIに送信し、休憩不足の解消や配置の空き埋めなどを提案する"));
sections.push(bullet("AI接続に失敗した場合はルールベースの自動提案に切り替わる"));
sections.push(bullet("チームごとにON/OFFを切り替え可能。ON化には課金プラン(後述)が必要"));
sections.push(bullet("提案は「配置として適用」ボタンで即座に配置登録に反映できる"));

sections.push(h2("6.9 チャット・通知"));
sections.push(bullet("チーム単位のチャット(スタンプ機能あり)"));
sections.push(bullet("管理者からの一斉連絡・緊急連絡、システムからの自動通知(休憩終了・バッジ獲得等)"));
sections.push(bullet("通知は参加者ごとに既読管理される"));

sections.push(h2("6.10 マイページ"));
sections.push(bullet("チーム内マイページ: その現場での実績、バッジ選択"));
sections.push(bullet("チームに依存しない全体マイページ: 累計ポイント・勤務時間・参加現場数・獲得バッジ一覧・過去の現場履歴をログイン直後から確認可能"));

sections.push(h2("6.11 監査ログ"));
sections.push(bullet("配置変更、勤務・休憩の事後修正、権限変更、チーム削除、投票締切、AI設定切替などの管理操作を記録"));
sections.push(bullet("記録の削除・変更を行うAPIは存在せず、追記のみ(改ざん防止)"));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h2("6.12 課金"));
sections.push(p("AI提案の利用、および1日1件・月15件を超えるチーム作成には、以下いずれかの利用枠が必要である。決済手段としてクレジットカードおよびPayPay(都度払いのみ)への対応を予定している。"));
sections.push(makeTable(
  [{ text: "プラン", width: 2400 }, { text: "価格", width: 2000 }, { text: "内容", width: 5600 }],
  [
    ["月額プラン", "¥980 / 月", "AI提案が使い放題。チーム作成は1日1件・月15件まで無料(超過分はクレジット消費)"],
    ["クレジット 10回分", "¥300", "AI提案1回、または無料枠超過分のチーム作成1件につき1クレジット消費"],
    ["クレジット 50回分", "¥1,200", "同上"],
    ["クレジット 100回分", "¥2,000", "同上(最もお得)"],
  ],
));
sections.push(h3("決済準備期間中の暫定措置"));
sections.push(bullet("決済機能(Stripe)は法令上必要なセキュリティ対策申告手続きのため現在準備中"));
sections.push(bullet("準備が整うまでの措置として、全アカウントに毎月クレジット50回分を自動付与する"));
sections.push(bullet("プラン・課金画面は料金表・プラン選択まで閲覧・操作でき、実際の決済に進む操作をした場合のみ「準備中」の案内を表示する"));
sections.push(h3("招待コード・ポイント交換"));
sections.push(bullet("サイト管理者は「友人向け無制限コード」(AI提案・チーム作成が無期限で無料になる)、または「クレジット付与コード」(指定回数分のクレジットを付与)を発行できる。いずれも複数人が利用可能(1人1回まで)"));
sections.push(bullet("参加者は貯めた累計ポイント150Pを消費して、24時間有効なAI提案使い放題の「デイパス」と交換できる(本人専用・再利用不可)"));

sections.push(h2("6.13 広告"));
sections.push(bullet("直接スポンサー枠: 契約企業のバナーを常時表示"));
sections.push(bullet("アフィリエイト枠: 登録した案件からランダムに1件表示"));
sections.push(bullet("いずれも「チーム一覧」「マイページ」画面の下部のみに表示し、Command Center等の業務画面には表示しない"));

sections.push(h2("6.14 管理ページ(サイト管理者専用)"));
sections.push(bullet("概要: 登録ユーザー数・作成チーム数・有効サブスク数・未消化クレジット合計・累計売上・入金履歴"));
sections.push(bullet("招待コード管理: 発行・利用状況確認・無効化"));
sections.push(bullet("ユーザー一覧: 全ユーザーの契約状況・クレジット残高・累計ポイント"));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("7. 非機能要件"));
sections.push(makeTable(
  [{ text: "分類", width: 2400 }, { text: "内容", width: 8000 }],
  [
    ["対応端末", "スマートフォン・タブレット・PC(レスポンシブ対応)"],
    ["リアルタイム性", "チーム内の状態は5秒間隔のポーリングで更新"],
    ["データ削除方針", "チームは論理削除。監査ログ・投票結果は削除不可"],
    ["セキュリティ", "パスワードはハッシュ化して保存。Stripe Webhookは署名検証を実施"],
    ["決済", "Stripe Checkout(ホスティング型決済ページ)を利用し、カード情報は自社サーバーで保持しない"],
    ["UI/UX", "操作結果(完了/エラー)は全画面共通のトーストで色分け表示。連続タップによる操作の二重送信を防止。アイコンのみのボタンにはaria-labelを付与しスクリーンリーダーに対応"],
  ],
));

sections.push(h1("8. 対象外機能"));
sections.push(p("以下は現行仕様には含まれない。将来検討の対象とする。"));
sections.push(bullet("複数日開催イベントへの対応(現状は1チーム=1開催日)"));
sections.push(bullet("持ち場テンプレートの保存・再利用"));
sections.push(bullet("勤務・休憩実績のCSVエクスポート、配置のCSV一括登録"));
sections.push(bullet("遅刻・休憩未取得の自動プッシュ通知(現状はCommand Center上のアラート表示のみ)"));
sections.push(bullet("Apple(iCloud)アカウントでのログイン(Sign in with Apple)。Apple Developer Programへの加入後に対応予定"));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム 機能一覧書(仕様書) v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "機能一覧書_仕様書.docx"), buf);
  console.log("done");
});
