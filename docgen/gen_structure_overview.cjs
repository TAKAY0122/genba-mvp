const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  h1, h2, p, bullet, makeTable, makeCover, revisionHistory, diagramBox, diagramArrow, headerFooter, fs,
} = require("./common.cjs");
const path = require("path");

const sections = [];
sections.push(...makeCover("システム構造 図解説明資料", "Version 1.0", "2026年8月"));
sections.push(...revisionHistory([
  ["v1.0", "2026年8月", "初版発行。開発ドキュメント一式(16種類)を補う、非エンジニア向けの図解サマリーとして新規作成(Googleログイン・2段階認証を含む現行仕様を反映)"],
]));

sections.push(h1("1. この資料について"));
sections.push(p("本書は、現場運営支援システム(genba-mvp)が「どんな仕組みで動いているか」を、専門知識がなくても一目で把握できるように図解したものである。技術的な詳細は、システム構成図・基本設計書・詳細設計書等の各技術ドキュメントを参照されたい。"));

sections.push(h1("2. システム全体像"));
sections.push(p("利用者は、スマートフォンやPCのブラウザから直接アクセスするだけでよく、アプリのインストールは不要である。"));
sections.push(diagramBox(["① 利用者", "現場スタッフ(オーナー・管理者・メンバー・ゲスト)"], { width: 5600, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow("スマートフォン / PC のブラウザで開くだけ(インストール不要)"));
sections.push(diagramBox(["② 現場運営支援システム(genba-mvp)", "Cloudflare Workers 上で24時間稼働"], { width: 5600, bold: true }));
sections.push(diagramArrow("裏側で自動的にやり取りする外部サービス"));
sections.push(makeTable(
  [{ text: "連携先", width: 2600 }, { text: "何をしているか(平易な説明)", width: 7800 }],
  [
    ["③ データの保管庫(Cloudflare D1)", "勤務・休憩・配置・投票などの記録を保存しておく場所"],
    ["④ AI(Anthropic Claude)", "現場の状況を見て「休憩が足りない人」「配置の空き」を提案する頭脳役"],
    ["⑤ 決済(Stripe)", "月額プラン・クレジット購入のクレジットカード決済を代行する"],
    ["⑥ Google", "Googleアカウントでのログイン時に本人確認を行う"],
  ],
));
sections.push(p("③〜⑥はいずれも実績豊富な大手クラウドサービスであり、自社で決済情報やサーバーを直接管理する必要がない構成になっている(その分、自社での運用負荷とセキュリティリスクを抑えている)。"));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("3. 現場スタッフの1日の流れ(利用イメージ)"));
sections.push(diagramBox("① QRコードを読む、またはURLを開く(アカウント登録は任意)", { width: 6200 }));
sections.push(diagramArrow());
sections.push(diagramBox(["② 予定の勤務開始時刻になると、", "操作しなくても自動的に「勤務中」になる"], { width: 6200, bold: true, fill: "E8ECFB" }));
sections.push(diagramArrow());
sections.push(diagramBox("③ 「休憩開始」ボタンを押すだけで休憩を記録(必要休憩時間は自動計算)", { width: 6200 }));
sections.push(diagramArrow());
sections.push(diagramBox("④ 「退勤する」ボタンを押して勤務終了", { width: 6200 }));
sections.push(diagramArrow());
sections.push(diagramBox(["⑤ 現場の活躍を1人1票で投票し合い、", "ポイント・バッジを獲得する"], { width: 6200 }));
sections.push(p("この一連の流れの中で、スタッフ自身が入力する操作は「休憩開始」「退勤する」「投票」の3回のボタン操作のみで、勤務開始そのものは時刻に応じて自動化されている点が本システムの中心的な特徴である。"));

sections.push(h1("4. 現場責任者(オーナー・管理者)の操作の流れ"));
sections.push(diagramBox("① 現場(チーム)を作成し、QRコード・URLでスタッフを招集", { width: 6200, bold: true, fill: "FCEFD0" }));
sections.push(diagramArrow());
sections.push(diagramBox("② 参加してきたスタッフを持ち場ごとに配置", { width: 6200 }));
sections.push(diagramArrow());
sections.push(diagramBox(["③ Command Center(管理者用ダッシュボード)で", "現場全体の状況を一画面で監視"], { width: 6200, bold: true, fill: "FCEFD0" }));
sections.push(diagramArrow("必要に応じて"));
sections.push(diagramBox(["④ AIが「休憩が足りない人」「配置の空き」を提案", "→ ワンタップで配置に反映"], { width: 6200 }));
sections.push(diagramArrow());
sections.push(diagramBox("⑤ 現場終了後、投票を締め切って順位・ポイントを確定", { width: 6200 }));

sections.push(new Paragraph({ children: [new PageBreak()] }));
sections.push(h1("5. ログインの仕組み(認証まわり)"));
sections.push(p("2026年8月の機能追加により、ログイン方法は以下の3系統になっている。"));
sections.push(diagramBox(["A. メール+パスワード", "従来からの標準的なログイン方法"], { width: 5000 }));
sections.push(diagramBox(["B. Googleアカウント", "パスワード入力なしでワンタップログイン"], { width: 5000 }));
sections.push(diagramBox(["C. ゲスト参加(QR/URL/コード)", "アカウント登録なしで当日限り参加"], { width: 5000 }));
sections.push(diagramArrow("A・Bを選んだ場合のみ"));
sections.push(diagramBox(["任意設定: 2段階認証(TOTP)", "有効化すると、ログインのたびに認証アプリの6桁コード入力が追加で必要になり、", "パスワードが漏れても第三者はログインできなくなる"], { width: 6600, bold: true, fill: "E8ECFB" }));
sections.push(p("A〜Cのいずれの方法でログイン・参加しても、その後にできること(勤務・休憩・配置・投票など)は基本的に同じであり、ログイン方法の違いは「入口」だけの違いである。"));

sections.push(h1("6. データの流れと保管方針"));
sections.push(makeTable(
  [{ text: "情報の種類", width: 2800 }, { text: "保管方針(平易な説明)", width: 7600 }],
  [
    ["パスワード", "そのままの形(平文)では一切保存せず、元に戻せない形式に変換してから保存する"],
    ["2段階認証のコード生成用の鍵・バックアップコード", "パスワードと同様、外部に漏れても悪用されにくい形式で保存する"],
    ["クレジットカード情報", "自社では一切保持せず、決済代行会社(Stripe)側でのみ管理する"],
    ["勤務・休憩・配置・投票の記録", "現場ごとに保存し、責任者による修正操作はすべて「誰が・いつ・何を」変更したか記録(監査ログ)に残す"],
    ["通知・メッセージ", "チーム内メンバーのみ閲覧可能で、外部には公開されない"],
  ],
));

sections.push(h1("7. まとめ: 使用している技術(参考)"));
sections.push(makeTable(
  [{ text: "分野", width: 2600 }, { text: "採用技術", width: 3600 }, { text: "選定理由(平易な説明)", width: 4200 }],
  [
    ["画面(フロントエンド)", "React + Vite + Tailwind CSS", "スマートフォンでの表示崩れが起きにくく、動作が軽快"],
    ["処理(バックエンド)", "Hono(Cloudflare Workers)", "サーバーの保守(OS更新等)が不要で、低コストかつ止まりにくい"],
    ["データ保管", "Cloudflare D1", "バックエンドと同じ基盤上で完結し、構成がシンプル"],
    ["AI", "Anthropic Claude", "未接続・障害時も自動的に簡易ロジックへ切り替わり、機能が止まらない"],
    ["決済", "Stripe", "国内外で広く使われる決済代行サービス。カード情報を自社で持たずに済む"],
    ["ログイン連携", "Google OAuth 2.0", "パスワード管理の手間と漏えいリスクを減らす、標準的な連携方式"],
  ],
));

const doc = new Document({
  sections: [{ properties: {}, ...headerFooter("現場運営支援システム システム構造 図解説明資料 v1.0"), children: sections }],
});
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, "システム構造_図解説明資料.docx"), buf);
  console.log("done");
});
