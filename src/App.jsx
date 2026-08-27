import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { api, store } from "./api.js";
import { SPONSOR_SLOTS, AFFILIATE_SLOTS } from "./ads.js";
import {
  Menu, X, Bell, LayoutDashboard, ClipboardCheck, MessageCircle, Sparkles,
  ClipboardList, BarChart3, MapPin, Vote as VoteIcon, Trophy, IdCard, QrCode,
  ScrollText, AlertTriangle, RefreshCw, Coffee, Lightbulb, Users, Bot, LogOut,
  ThumbsUp, Zap, CheckCircle2, HandHeart, Medal, Lock, Gem, Play,
  Wrench, CreditCard, DoorClosed, Award, History, PartyPopper, Gift,
  Construction, Ticket, Megaphone, ArrowLeft, Folder, Hourglass,
} from "lucide-react";

/* ナビ・見出し・ボタンで使うアイコン。絵文字は使わず、この一覧のアウトラインアイコンに統一する */
const NAV_ICON = {
  cc: LayoutDashboard, member: ClipboardCheck, chat: MessageCircle, ai: Sparkles,
  dash: ClipboardList, timeline: BarChart3, assign: MapPin, vote: VoteIcon,
  voteResult: Trophy, notify: Bell, mypage: IdCard, share: QrCode, audit: ScrollText,
};

/* =====================================================================
   現場運営支援システム MVP - フロントエンド (API接続版)
   核: 勤務・休憩・配置・ポイント投票 + Command Center / AI提案 / チャット
   ===================================================================== */

/* ---------- 時刻ユーティリティ ---------- */
const fmtHM = (ts) => {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const minDiff = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? m % 60 + "分" : ""}` : `${m}分`);
const requiredBreak = (planMin) => (planMin >= 480 ? 60 : planMin >= 360 ? 45 : 0);
/* 開催日+HH:MM → epoch ms (JST) */
const dateT = (dateStr, hhmm) => new Date(`${dateStr}T${hhmm}:00+09:00`).getTime();

/* ---------- CSVユーティリティ ---------- */
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function downloadCSV(filename, rows) {
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"); // BOM付き(Excelでの文字化け防止)
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
/* 簡易CSVパーサ(ダブルクォート囲み・カンマ内包に対応。配置一括登録用) */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const ROLE_LABEL = { owner: "オーナー", admin: "管理者", member: "メンバー", guest: "ゲスト" };
const POINT_DAY_PASS_COST = 150;
const MONTHLY_FREE_CREDITS = 50; // 決済準備中の措置: 毎月全アカウントに自動付与されるクレジット数(表示用。実際の付与はサーバー側で判定)
const BADGE_INFO = {
  "🏆": "MVP(現場1位)",
  "💎": "累計10P到達",
  "☕": "休憩マスター(必要休憩を充足)",
  "⚡": "初ポイント獲得",
};
/* バッジは絵文字ではなくアイコン+色で表現する(データ上のキーは既存の互換性のため絵文字のまま) */
const BADGE_ICON = {
  "🏆": { Icon: Trophy, color: "text-amber-500" },
  "💎": { Icon: Gem, color: "text-sky-500" },
  "☕": { Icon: Coffee, color: "text-amber-700" },
  "⚡": { Icon: Zap, color: "text-violet-500" },
};
const BadgeMark = ({ b, className = "w-3.5 h-3.5" }) => {
  const cfg = BADGE_ICON[b];
  if (!cfg) return null;
  const Icon = cfg.Icon;
  return <Icon className={`${className} ${cfg.color} inline-block align-text-bottom mr-1 shrink-0`} />;
};
const POSITION_NAMES = ["入口誘導", "チケット確認", "物販列整理", "関係者受付", "楽屋口確認", "場内巡回"];
const dName = (p) => p?.name || "";

/* ---------- ステータス ---------- */
const onBreak = (p) => p.breaks.some((b) => !b.end);
const statusOf = (p, now) => {
  if (p.checkOut) return "退勤済み";
  if (now < p.planStart) return "開始前";
  if (onBreak(p)) return "休憩中";
  return "勤務中";
};
const ST = {
  勤務中: { bg: "bg-emerald-100", tx: "text-emerald-800", dot: "bg-emerald-500" },
  休憩中: { bg: "bg-amber-100", tx: "text-amber-800", dot: "bg-amber-500" },
  開始前: { bg: "bg-sky-100", tx: "text-sky-700", dot: "bg-sky-400" },
  退勤済み: { bg: "bg-slate-200", tx: "text-slate-500", dot: "bg-slate-400" },
};
const Badge = ({ s }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${ST[s].bg} ${ST[s].tx}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${ST[s].dot}`} />{s}
  </span>
);
const RoleTag = ({ r }) => {
  const m = { owner: "bg-violet-100 text-violet-700", admin: "bg-brand-100 text-brand-700", member: "bg-slate-100 text-slate-600", guest: "bg-teal-100 text-teal-700" };
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${m[r] || ""}`}>{ROLE_LABEL[r] || r}</span>;
};

/* ---------- 共通UI ---------- */
const Card = ({ children, className = "", onClick }) => (
  <div onClick={onClick} className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
);
const Btn = ({ children, onClick, color = "brand", disabled, className = "", big }) => {
  const map = {
    brand: "bg-brand-600 hover:bg-brand-700 text-white",
    emerald: "bg-emerald-600 hover:bg-emerald-700 text-white",
    amber: "bg-amber-500 hover:bg-amber-600 text-white",
    rose: "bg-rose-600 hover:bg-rose-700 text-white",
    slate: "bg-slate-200 hover:bg-slate-300 text-slate-700",
    violet: "bg-violet-600 hover:bg-violet-700 text-white",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${big ? "py-4 text-base" : "py-2.5 text-sm"} px-4 rounded-xl font-bold transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${map[color]} ${className}`}>
      {children}
    </button>
  );
};
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50" onClick={onClose}>
    <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-y-auto" style={{ maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
        <h3 className="font-bold text-slate-800">{title}</h3>
        <button onClick={onClose} aria-label="閉じる" className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);
/* 完了(黒)/エラー(赤)を色で見分けられる通知トースト。全フェーズ共通で App 直下に1つだけ描画する */
const Toast = ({ toast }) => {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div role="status" aria-live="polite"
      className={`fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-lg text-center flex items-center gap-1.5 ${isError ? "bg-rose-600" : "bg-slate-900"}`}
      style={{ zIndex: 60, maxWidth: "90vw" }}>
      {isError && <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}{toast.msg}
    </div>
  );
};
const Field = ({ label, children }) => (
  <div><label className="text-xs font-bold text-slate-500">{label}</label><div className="mt-1">{children}</div></div>
);
const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500";

/* 広告1件分のカード表示 */
function AdCard({ ad, badgeColor }) {
  return (
    <a href={ad.url} target="_blank" rel="noopener noreferrer sponsored"
      className="block bg-white rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition">
      <div className="flex items-center gap-3">
        {ad.imageUrl && <img src={ad.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-bold border rounded px-1 ${badgeColor}`} style={{ fontSize: 10 }}>{ad.label || "広告"}</span>
            <span className="text-sm font-bold truncate">{ad.title}</span>
          </div>
          <div className="text-xs text-slate-500 truncate">{ad.body}</div>
        </div>
      </div>
    </a>
  );
}

/* 広告エリア: 直接スポンサー(常時全件表示)+ アフィリエイト(ランダム1件)。
   どちらも空なら何も表示しない。業務画面(Command Center等)には配置しないこと。 */
function AdSection() {
  const affiliate = AFFILIATE_SLOTS && AFFILIATE_SLOTS.length > 0 ? AFFILIATE_SLOTS[Math.floor(Math.random() * AFFILIATE_SLOTS.length)] : null;
  if ((!SPONSOR_SLOTS || SPONSOR_SLOTS.length === 0) && !affiliate) return null;
  return (
    <div className="space-y-2">
      {(SPONSOR_SLOTS || []).map((ad, i) => <AdCard key={`sp-${i}`} ad={ad} badgeColor="text-brand-500 border-brand-300" />)}
      {affiliate && <AdCard ad={affiliate} badgeColor="text-slate-400 border-slate-300" />}
    </div>
  );
}

function QR({ text, size = 180 }) {
  const [url, setUrl] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { width: size, margin: 1 }).then(setUrl).catch(() => {}); }, [text, size]);
  return url ? <img src={url} width={size} height={size} className="rounded-lg border border-slate-200" alt="参加用QRコード" /> : <div style={{ width: size, height: size }} className="bg-slate-100 rounded-lg" />;
}

/* ================================ ルート ================================ */
export default function App() {
  const [phase, setPhase] = useState("boot"); // boot / login / teams / join / team
  const [user, setUser] = useState(null);
  const [joinCode, setJoinCode] = useState(null);
  const [teamId, setTeamId] = useState(null);
  const [pendingToken, setPendingToken] = useState(null); // Googleログイン経由で2FAコード入力待ちになった場合のトークン
  const [toast, setToast] = useState(null); // { msg, type: "ok" | "error" }
  const toastSeq = useRef(0);
  const say = useCallback((m) => {
    const id = ++toastSeq.current;
    setToast({ msg: m, type: "ok" });
    setTimeout(() => { if (toastSeq.current === id) setToast(null); }, 2800);
  }, []);
  const fail = useCallback((e) => {
    const id = ++toastSeq.current;
    setToast({ msg: e.message || "エラーが発生しました。", type: "error" });
    setTimeout(() => { if (toastSeq.current === id) setToast(null); }, 3800);
  }, []);

  useEffect(() => {
    (async () => {
      // Stripe決済完了後の戻りURL(?billing=success / ?billing=cancel)を検知
      const params = new URLSearchParams(location.search);
      const billingResult = params.get("billing");
      // Googleログインのコールバック(サーバー側リダイレクト)からの戻りを検知
      const oauthHandoffCode = params.get("oauthHandoff");
      const g2faToken = params.get("g2fa");
      const authErrorMsg = params.get("authError");
      if (billingResult || oauthHandoffCode || g2faToken || authErrorMsg) history.replaceState(null, "", location.pathname);

      if (oauthHandoffCode) {
        try {
          const d = await api.oauthHandoff(oauthHandoffCode);
          store.setSession(d.token);
          setUser({ ...d.user, isSiteAdmin: d.isSiteAdmin });
          say("Googleアカウントでログインしました");
          const last = store.getLastTeam();
          if (last) { setTeamId(last); setPhase("team"); } else setPhase("teams");
        } catch (e) { fail(e); setPhase("login"); }
        return;
      }
      if (g2faToken) { setPendingToken(g2faToken); setPhase("login"); return; }
      if (authErrorMsg) { fail({ message: authErrorMsg }); setPhase("login"); return; }

      const m = location.pathname.match(/^\/join\/([A-Za-z0-9-]+)/);
      if (m) { setJoinCode(m[1]); setPhase("join"); return; }
      if (store.getSession()) {
        try {
          const d = await api.me();
          setUser({ ...d.user, isSiteAdmin: d.isSiteAdmin });
          if (billingResult === "success") {
            say("お支払いありがとうございます。反映まで数秒かかる場合があります。");
            setPhase("billing");
            return;
          }
          const last = store.getLastTeam();
          if (last) { setTeamId(last); setPhase("team"); return; } // 続きから(前回開いていたチームへ自動で入る)
          setPhase("teams");
          return;
        } catch (e) { store.setSession(null); }
      }
      // ゲスト: 参加済みチームがあれば復帰
      const pt = store.getPTokens();
      const ids = Object.keys(pt);
      if (ids.length > 0) { setTeamId(ids[ids.length - 1]); setPhase("team"); return; }
      setPhase("login");
    })();
  }, []);

  const openTeam = (id) => { store.setLastTeam(id); setTeamId(id); setPhase("team"); };
  const logout = async () => { await api.logout(); store.setSession(null); store.setLastTeam(null); setUser(null); setTeamId(null); setPhase("login"); };

  let screen;
  if (phase === "boot") screen = <Splash />;
  else if (phase === "login") screen = <AuthScreen say={say} fail={fail} initialPendingToken={pendingToken}
    onLoggedIn={(u, opts) => { setUser(u); setPendingToken(null); setPhase(opts?.justRegistered ? "2fa-prompt" : "teams"); }}
    onGuestCode={(code) => { setJoinCode(code); setPhase("join"); }} />;
  else if (phase === "2fa-prompt") screen = <TwoFactorSetupScreen say={say} fail={fail} mode="prompt" onDone={() => setPhase("teams")} />;
  else if (phase === "join") screen = <JoinScreen code={joinCode} user={user} say={say} fail={fail}
    onJoined={(tid) => openTeam(tid)}
    onBack={() => setPhase(user ? "teams" : "login")} />;
  else if (phase === "teams") screen = <TeamsScreen user={user} say={say} fail={fail} openTeam={openTeam}
    onJoinByCode={(code) => { setJoinCode(code); setPhase("join"); }} logout={logout}
    onOpenMyPage={() => setPhase("mypage")} onOpenBilling={() => setPhase("billing")} onOpenAdmin={() => setPhase("admin")} />;
  else if (phase === "admin") screen = <AdminScreen say={say} fail={fail} onBack={() => setPhase("teams")} />;
  else if (phase === "mypage") screen = <GlobalMyPageScreen user={user} say={say} fail={fail} onBack={() => setPhase("teams")} />;
  else if (phase === "billing") screen = <BillingScreen say={say} fail={fail} onBack={() => setPhase("teams")} />;
  else screen = <TeamApp teamId={teamId} user={user} say={say} fail={fail}
    exitTeam={() => setPhase(user ? "teams" : "login")} logout={logout} openBilling={() => setPhase("billing")} />;

  return <>
    {screen}
    <Toast toast={toast} />
  </>;
}

const Splash = () => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center">
    <div className="text-white font-bold animate-pulse">読み込み中...</div>
  </div>
);

/* ================================ ログイン / 新規登録 ================================ */
/* 公式のGoogleロゴマーク(4色のG)。Sign-inボタンでは絵文字ではなくこの正規マークを使う */
const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
    <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" />
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" />
  </svg>
);

function AuthScreen({ say, fail, onLoggedIn, onGuestCode, initialPendingToken }) {
  const [tab, setTab] = useState("guest"); // 現場スタッフの多くはアカウント不要の「コード参加」で入るため、これを既定表示にする
  const [f, setF] = useState({ email: "", password: "", name: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [pending2fa, setPending2fa] = useState(initialPendingToken || null); // 2FAコード入力待ちのpendingToken
  const [twoFaCode, setTwoFaCode] = useState("");
  const finishLogin = (d, msg, justRegistered) => {
    store.setSession(d.token);
    say(msg);
    onLoggedIn({ ...d.user, isSiteAdmin: d.isSiteAdmin }, { justRegistered });
  };
  const submit = async () => {
    setBusy(true);
    try {
      const d = tab === "login" ? await api.login(f) : await api.register(f);
      if (d.require2fa) { setPending2fa(d.pendingToken); setBusy(false); return; }
      finishLogin(d, tab === "login" ? "ログインしました" : "アカウントを作成しました", tab === "register");
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const submit2fa = async () => {
    setBusy(true);
    try {
      const d = await api.verify2fa({ pendingToken: pending2fa, code: twoFaCode.trim() });
      finishLogin(d, "ログインしました", false);
    } catch (e) { fail(e); setTwoFaCode(""); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-brand-600 text-white items-center justify-center text-2xl font-bold mb-3">◎</div>
          <h1 className="text-xl font-bold text-white">現場運営支援システム</h1>
          <p className="text-xs text-slate-400 mt-1">勤務・休憩・配置・投票をリアルタイムに。</p>
        </div>
        <div className="bg-white rounded-2xl p-5">
          {pending2fa ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-800">2段階認証コードを入力してください</p>
              <p className="text-xs text-slate-500">認証アプリに表示されている6桁のコード、またはバックアップコードを入力してください。</p>
              <Field label="コード">
                <input className={`${inputCls} text-center text-lg tracking-widest`} value={twoFaCode} maxLength={10} autoFocus
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/[^0-9a-z]/gi, ""))}
                  onKeyDown={(e) => e.key === "Enter" && twoFaCode && submit2fa()} placeholder="123456" />
              </Field>
              <Btn className="w-full" big disabled={busy || !twoFaCode} onClick={submit2fa}>{busy ? "確認中..." : "確認してログイン"}</Btn>
              <button className="w-full text-xs text-slate-400 font-bold py-1" onClick={() => { setPending2fa(null); setTwoFaCode(""); }}>ログインをやり直す</button>
            </div>
          ) : tab === "guest" ? (
            /* 参加優先レイアウト: アカウント不要のコード参加を最初の1画面で完結させる(現場の新規参加スタッフが最頻出のため) */
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <QrCode className="w-4 h-4 text-brand-600" />チームコードで参加
              </div>
              <p className="text-xs text-slate-500">QRコードを読み取るか、チームコードを入力して参加します(アカウント不要)。</p>
              <Field label="チームコード">
                <input className={`${inputCls} text-center text-lg tracking-widest uppercase`} value={f.code}
                  onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="A1B2C3D4"
                  onKeyDown={(e) => e.key === "Enter" && f.code && onGuestCode(f.code.trim())} />
              </Field>
              <Btn className="w-full" big disabled={!f.code} onClick={() => onGuestCode(f.code.trim())}>参加画面へ →</Btn>
              <div className="flex items-center gap-2 text-xs text-slate-400 pt-1"><div className="flex-1 h-px bg-slate-200" />アカウントをお持ちの方<div className="flex-1 h-px bg-slate-200" /></div>
              <button className="w-full py-2 text-xs font-bold text-brand-700 hover:underline" onClick={() => setTab("login")}>メール / Googleでログイン</button>
            </div>
          ) : (
            <div className="space-y-3">
              <button className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1" onClick={() => setTab("guest")}>← コードで参加する方はこちら</button>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {[["login", "ログイン"], ["register", "新規登録"]].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-md text-xs font-bold ${tab === k ? "bg-white shadow text-brand-700" : "text-slate-500"}`}>{l}</button>
                ))}
              </div>
              <a href="/api/v1/auth/google/start"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 transition">
                <GoogleMark />Googleで{tab === "login" ? "ログイン" : "登録"}
              </a>
              <div className="flex items-center gap-2 text-xs text-slate-400"><div className="flex-1 h-px bg-slate-200" />または<div className="flex-1 h-px bg-slate-200" /></div>
              {tab === "register" && (
                <Field label="名前 *"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例:山田 太郎" /></Field>
              )}
              <Field label="メールアドレス *"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label={`パスワード *${tab === "register" ? "(8文字以上)" : ""}`}>
                <input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </Field>
              <Btn className="w-full" big disabled={busy || !f.email || !f.password || (tab === "register" && !f.name)} onClick={submit}>
                {busy ? "処理中..." : tab === "login" ? "ログイン" : "アカウントを作成"}
              </Btn>
              {tab === "register" && <p className="text-xs text-slate-400 text-center">登録後、2段階認証(推奨)を設定できます。</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================ 2段階認証(TOTP)の設定 ================================
   mode="prompt": 新規登録直後に案内する場合(スキップ可)。mode="manage": マイページから任意に設定する場合 */
function TwoFactorSetupScreen({ say, fail, mode, onDone, onBack }) {
  const [step, setStep] = useState("loading"); // loading / qr / backup
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.setup2fa().then((d) => { setSetup(d); setStep("qr"); }).catch((e) => { fail(e); (onBack || onDone)?.(); });
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const d = await api.verifySetup2fa(code.trim());
      setBackupCodes(d.backupCodes);
      setStep("backup");
      say("2段階認証を有効にしました");
    } catch (e) { fail(e); setCode(""); }
    setBusy(false);
  };

  return (
    <Shell title="2段階認証の設定" onBack={step === "backup" ? undefined : onBack}>
      <Card className="p-5 space-y-4">
        {step === "loading" && <p className="text-sm text-slate-500 text-center py-6">準備中...</p>}
        {step === "qr" && setup && (
          <>
            <p className="text-sm text-slate-600">Google Authenticator等の認証アプリでQRコードを読み取り、表示された6桁のコードを入力してください。</p>
            <div className="flex justify-center"><QR text={setup.otpauthUri} size={180} /></div>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-bold">QRコードを読み取れない場合</summary>
              <p className="mt-1 break-all font-mono bg-slate-50 p-2 rounded">{setup.secret}</p>
            </details>
            <Field label="6桁のコード">
              <input className={`${inputCls} text-center text-lg tracking-widest`} value={code} maxLength={6} autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && confirm()} placeholder="123456" />
            </Field>
            <Btn className="w-full" big disabled={busy || code.length !== 6} onClick={confirm}>{busy ? "確認中..." : "有効にする"}</Btn>
            {mode === "prompt" && <button className="w-full text-xs text-slate-400 font-bold py-1" onClick={onDone}>あとで設定する</button>}
          </>
        )}
        {step === "backup" && backupCodes && (
          <>
            <p className="text-sm font-bold text-rose-600">バックアップコードを保存してください</p>
            <p className="text-xs text-slate-500">認証アプリの端末が使えなくなった場合に、1回だけ使えるコードです。このコードはこの画面でのみ表示され、あとから確認できません。安全な場所に保存してください。</p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-slate-50 rounded-lg p-3">
              {backupCodes.map((c) => <div key={c}>{c}</div>)}
            </div>
            <Btn className="w-full" big onClick={onDone}>保存しました・完了</Btn>
          </>
        )}
      </Card>
    </Shell>
  );
}

/* ================================ チーム一覧 / 作成 ================================ */
function TeamsScreen({ user, say, fail, openTeam, onJoinByCode, logout, onOpenMyPage, onOpenBilling, onOpenAdmin }) {
  const [teams, setTeams] = useState(null);
  const [view, setView] = useState("list"); // list / create / share
  const [created, setCreated] = useState(null);
  const load = async () => { try { const d = await api.myTeams(); setTeams(d.teams); } catch (e) { fail(e); } };
  useEffect(() => { load(); }, []);

  if (view === "create") return (
    <Shell title="チーム作成" onBack={() => setView("list")}>
      <CreateTeamForm fail={fail} onOpenBilling={onOpenBilling} onCreated={(t) => { setCreated(t); setView("share"); say("チームを作成しました"); load(); }} />
    </Shell>
  );
  if (view === "share" && created) return (
    <Shell title="参加用QR / URL" onBack={() => setView("list")}>
      <ShareCard team={created} onOpenJoin={() => onJoinByCode(created.code)} say={say} />
    </Shell>
  );
  return (
    <Shell title="チーム一覧" right={
      <div className="flex items-center gap-1 shrink-0">
        {user?.isSiteAdmin && (
          <button onClick={onOpenAdmin} className="text-xs font-bold text-amber-200 bg-slate-800 px-2 sm:px-2.5 py-1.5 rounded-lg flex items-center gap-1" title="管理ページ" aria-label="管理ページ">
            <Wrench className="w-4 h-4" /><span className="hidden sm:inline">管理</span>
          </button>
        )}
        <button onClick={onOpenBilling} className="text-xs font-bold text-violet-200 bg-slate-800 px-2 sm:px-2.5 py-1.5 rounded-lg flex items-center gap-1" title="プラン・課金" aria-label="プラン・課金">
          <CreditCard className="w-4 h-4" /><span className="hidden sm:inline">プラン</span>
        </button>
        <button onClick={onOpenMyPage} className="text-xs font-bold text-slate-200 bg-slate-800 px-2 sm:px-2.5 py-1.5 rounded-lg flex items-center gap-1" title="マイページ" aria-label="マイページ">
          <IdCard className="w-4 h-4" /><span className="hidden sm:inline">マイページ</span>
        </button>
        <button onClick={logout} className="text-xs font-bold text-rose-400 px-1.5 sm:px-2 py-1.5 flex items-center" title="ログアウト" aria-label="ログアウト">
          <LogOut className="w-4 h-4 sm:hidden" /><span className="hidden sm:inline">ログアウト</span>
        </button>
      </div>
    }>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={() => setView("create")}>＋ チーム作成</Btn>
          <Btn color="slate" className="flex-1" onClick={() => { const c = prompt("チームコードを入力"); if (c) onJoinByCode(c.trim().toUpperCase()); }}>コードで参加</Btn>
        </div>
        {teams === null && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
        {teams?.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">まだチームがありません。「チーム作成」から始めましょう。</Card>}
        {teams?.map((t) => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-xs text-slate-400 font-mono">{t.event_date}</div>
                <div className="font-bold truncate">{t.site_name}</div>
                <div className="text-xs text-slate-500">{t.venue_name}{t.section ? ` / ${t.section}` : ""}</div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${t.voting_closed ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>
                {t.voting_closed ? "終了" : "開催中"}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <Btn className="flex-1" onClick={() => openTeam(t.id)}>開く</Btn>
              <Btn color="slate" className="flex-1" onClick={() => { setCreated({ id: t.id, code: t.code, siteName: t.site_name, venueName: t.venue_name, section: t.section, date: t.event_date }); setView("share"); }}>QR/URL共有</Btn>
            </div>
          </Card>
        ))}
        <AdSection />
        <p className="text-xs text-slate-400 px-1">ログイン中:{user?.name}({user?.email})</p>
      </div>
    </Shell>
  );
}

const Shell = ({ title, children, onBack, right }) => (
  <div className="min-h-screen bg-slate-100">
    <header className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="max-w-lg mx-auto flex items-center gap-2 px-3 py-3">
        {onBack && <button onClick={onBack} aria-label="戻る" className="w-9 h-9 rounded-lg bg-slate-800 font-bold shrink-0 flex items-center justify-center"><ArrowLeft className="w-4 h-4" /></button>}
        <div className="flex-1 min-w-0 font-bold truncate">{title}</div>
        {right}
      </div>
    </header>
    <main className="max-w-lg mx-auto p-3">{children}</main>
  </div>
);

function CreateTeamForm({ fail, onOpenBilling, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ siteName: "", venueName: "", section: "", date: today, aiEnabled: false });
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState(null);
  useEffect(() => { api.getBilling().then(setBilling).catch(() => {}); }, []);
  const canUseAi = billing?.freeMode || (billing && ((billing.planType === "subscription" && billing.subscriptionActive) || (billing.planType === "credits" && billing.creditBalance > 0)));
  const quota = billing?.teamQuota;
  const canCreateFree = billing?.freeMode || !!quota?.freeAvailable;
  const canCreateWithCredit = !canCreateFree && (billing?.creditBalance || 0) > 0;
  const canCreate = billing === null || canCreateFree || canCreateWithCredit;
  const ok = f.siteName && f.venueName && f.date && canCreate;
  const submit = async () => {
    setBusy(true);
    try { const d = await api.createTeam({ ...f, aiEnabled: f.aiEnabled && canUseAi }); onCreated({ ...d.team, date: f.date }); } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <Card className="p-4 space-y-3">
      {billing && !canCreateFree && (
        <div className={`rounded-lg px-3 py-2.5 text-xs font-bold ${canCreateWithCredit ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
          {canCreateWithCredit
            ? `月額プランの無料枠(1日${quota.dailyLimit}件・月${quota.monthlyLimit}件)を使い切っているため、このチーム作成でクレジットを1消費します(残り${billing.creditBalance}回)。`
            : `月額プランの無料枠を使い切っており、クレジット残高もありません。作成するにはクレジット購入が必要です。`}
          {!canCreateWithCredit && <button onClick={onOpenBilling} className="ml-1 underline">プランを見る →</button>}
        </div>
      )}
      <Field label="現場名 *"><input className={inputCls} value={f.siteName} onChange={(e) => setF({ ...f, siteName: e.target.value })} placeholder="例:AAA LIVE 大阪公演" /></Field>
      <Field label="会場名 *"><input className={inputCls} value={f.venueName} onChange={(e) => setF({ ...f, venueName: e.target.value })} placeholder="例:大阪城ホール" /></Field>
      <Field label="セクション名(任意)"><input className={inputCls} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="例:運営" /></Field>
      <Field label="開催日 *"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-lg px-3 py-3">
        <div>
          <div className="text-sm font-bold text-violet-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4" />AI提案を使う</div>
          <div className="text-xs text-violet-600 mt-0.5">
            {canUseAi ? "休憩不足の解消などをAIが分析して提案します(あとから設定で切り替え可能)" : "利用にはプラン契約またはクレジット購入が必要です"}
          </div>
        </div>
        {canUseAi ? (
          <button onClick={() => setF({ ...f, aiEnabled: !f.aiEnabled })}
            className={`shrink-0 w-12 h-7 rounded-full transition relative ${f.aiEnabled ? "bg-violet-600" : "bg-slate-300"}`}>
            <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all" style={{ left: f.aiEnabled ? 22 : 2 }} />
          </button>
        ) : (
          <button onClick={onOpenBilling} className="shrink-0 text-xs font-bold text-violet-700 bg-white border border-violet-300 rounded-lg px-3 py-2">プランを見る</button>
        )}
      </div>
      <Btn className="w-full" big disabled={!ok || busy} onClick={submit}>
        {busy ? "作成中..." : canCreateWithCredit ? "クレジットを1消費して作成する" : !canCreate ? "作成できません(プランが必要です)" : "チームを作成して共有URLを発行"}
      </Btn>
    </Card>
  );
}

function ShareCard({ team, onOpenJoin, say }) {
  const url = `${location.origin}/join/${team.code}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); say("URLをコピーしました"); } catch (e) {} };
  return (
    <Card className="p-5 text-center space-y-3">
      <div className="font-bold">{team.siteName}</div>
      <div className="text-xs text-slate-500">{team.venueName}{team.section ? ` / ${team.section}` : ""} / {team.date}</div>
      <div className="flex justify-center"><QR text={url} /></div>
      <div className="text-xs font-mono bg-slate-50 rounded-lg px-3 py-2 break-all">{url}</div>
      <div className="text-xs text-slate-500">チームコード:<b className="font-mono">{team.code}</b></div>
      <div className="flex gap-2">
        <Btn color="slate" className="flex-1" onClick={copy}>URLをコピー</Btn>
        <Btn className="flex-1" onClick={onOpenJoin}>自分も参加する</Btn>
      </div>
    </Card>
  );
}

/* ================================ 参加画面 ================================ */
function JoinScreen({ code, user, say, fail, onJoined, onBack }) {
  const [team, setTeam] = useState(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState(user?.name || "");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.teamByCode(code).then((d) => setTeam(d.team)).catch((e) => setErr(e.message));
  }, [code]);
  const planMin = team ? minDiff(dateT(team.event_date, start), dateT(team.event_date, end)) : 0;
  const req = requiredBreak(planMin);
  const submit = async () => {
    setBusy(true);
    try {
      const d = await api.join(code, { name, planStart: dateT(team.event_date, start), planEnd: dateT(team.event_date, end) });
      if (d.participantToken) store.setPToken(d.teamId, d.participantToken);
      history.replaceState(null, "", "/");
      say(`${team.site_name} に参加しました`);
      onJoined(d.teamId);
    } catch (e) {
      if (e.code === "DATA-002") { history.replaceState(null, "", "/"); onJoined(team ? (await api.myTeams()).teams.find((t) => t.code === code)?.id : null); }
      else fail(e);
    }
    setBusy(false);
  };
  return (
    <Shell title="チームに参加" onBack={onBack}>
      {err && <Card className="p-6 text-center text-sm text-rose-600 font-bold">{err}</Card>}
      {!team && !err && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
      {team && (
        <div className="space-y-3">
          <Card className="p-4 text-center">
            <div className="text-xs text-slate-400">このチームに参加します</div>
            <div className="font-bold text-lg">{team.site_name}</div>
            <div className="text-xs text-slate-500">{team.venue_name}{team.section ? ` / ${team.section}` : ""} / {team.event_date}</div>
          </Card>
          <Card className="p-4 space-y-3">
            <Field label="表示名 *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例:渡辺 翔" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="予定勤務開始 *"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="予定勤務終了 *"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <div className="bg-brand-50 rounded-lg px-3 py-2 text-xs text-brand-800">
              予定勤務 <b>{fmtMin(planMin)}</b> → 必要休憩 <b>{req}分</b>
              <div className="mt-0.5 text-brand-500" style={{ fontSize: 10 }}>予定開始時刻になると自動的に「勤務中」になります。</div>
            </div>
            {!user && <p className="text-xs text-teal-700 font-bold">ゲストとして参加します(アカウント不要)。ポイント累計を残したい場合は先にアカウント登録してください。</p>}
            <Btn className="w-full" big disabled={!name || busy || planMin <= 0} onClick={submit}>{busy ? "参加中..." : "参加する"}</Btn>
          </Card>
        </div>
      )}
    </Shell>
  );
}

/* ================================ チーム内アプリ本体 ================================ */
function TeamApp({ teamId, user, say, fail, exitTeam, logout, openBilling }) {
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [fatalErr, setFatalErr] = useState(""); // 初回成功後に致命的エラーが続いた場合
  const [now, setNow] = useState(Date.now());
  const [route, setRoute] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [ai, setAi] = useState({ list: null, loading: false, note: "" });
  const [auditLogs, setAuditLogs] = useState(null);
  const pollRef = useRef(null);
  const routeRef = useRef(null); // routeの最新値をタイマーの再生成なしで参照するため
  routeRef.current = route;
  const failCountRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const d = await api.state(teamId);
      setState(d);
      setLoadErr("");
      failCountRef.current = 0;
      if (routeRef.current === null) setRoute(d.me.role === "owner" || d.me.role === "admin" ? "cc" : "member");
    } catch (e) {
      setLoadErr(e.message);
      // 参加者ではなくなった/チームが見つからない、が3回連続 → 致命的エラーとして案内画面を出す
      if (e.code === "AUTH-002" || e.code === "DATA-001") {
        failCountRef.current += 1;
        if (failCountRef.current >= 3) { setFatalErr(e.message); clearInterval(pollRef.current); }
      }
    }
  }, [teamId]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(clock); };
  }, [refresh]);

  /* API呼び出し共通ラッパ: 実行→即時再取得。busyRefで多重タップ時の二重送信(退勤の二重記録等)を防ぐ */
  const busyRef = useRef(false);
  const run = async (fn, okMsg) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try { await fn(); if (okMsg) say(okMsg); await refresh(); }
    catch (e) { fail(e); await refresh(); }
    finally { busyRef.current = false; }
  };

  const enriched = useMemo(() => {
    if (!state) return [];
    return state.participants.map((p) => {
      const status = statusOf(p, now);
      const planMin = minDiff(p.planStart, p.planEnd);
      const req = requiredBreak(planMin);
      const taken = p.breaks.reduce((a, b) => a + minDiff(b.start, b.end ?? now), 0);
      const remain = Math.max(0, req - taken);
      const workMin = now >= p.planStart ? Math.max(0, minDiff(p.planStart, p.checkOut ?? now) - taken) : 0;
      const leftMin = p.checkOut ? 0 : Math.max(0, minDiff(now, p.planEnd));
      const shortage = !p.checkOut && status !== "開始前" && req > 0 && remain > 0 && minDiff(p.planStart, now) >= 240;
      const myAssigns = state.assignments.filter((a) => a.pid === p.id).sort((x, y) => x.start - y.start);
      const curAssign = myAssigns.find((a) => now >= a.start && now < a.end);
      const nextAssign = myAssigns.find((a) => a.start > now);
      return { ...p, status, planMin, req, taken, remain, workMin, leftMin, shortage, myAssigns, curAssign, nextAssign };
    });
  }, [state, now]);

  if (fatalErr) return (
    <Shell title="アクセスできません">
      <Card className="p-6 text-center space-y-3">
        <DoorClosed className="w-8 h-8 mx-auto text-slate-400" />
        <p className="text-sm text-rose-600 font-bold">{fatalErr}</p>
        <p className="text-xs text-slate-500">チームが削除されたか、参加者情報が確認できなくなりました。</p>
        <Btn className="w-full" onClick={exitTeam}>チーム一覧に戻る</Btn>
      </Card>
    </Shell>
  );
  if (loadErr && !state) return (
    <Shell title="エラー" onBack={exitTeam}>
      <Card className="p-6 text-center space-y-3">
        <p className="text-sm text-rose-600 font-bold">{loadErr}</p>
        <Btn className="w-full" onClick={refresh}>もう一度読み込む</Btn>
      </Card>
    </Shell>
  );
  if (!state || route === null) return <Splash />;

  const team = state.team;
  const me = enriched.find((p) => p.id === state.me.id);
  const isAdmin = state.me.role === "owner" || state.me.role === "admin";
  const isOwner = state.me.role === "owner";
  const unread = state.notifications.filter((n) => !n.read).length;

  const kpi = {
    working: enriched.filter((p) => p.status === "勤務中").length,
    breaking: enriched.filter((p) => p.status === "休憩中").length,
    before: enriched.filter((p) => p.status === "開始前").length,
    done: enriched.filter((p) => p.status === "退勤済み").length,
    short: enriched.filter((p) => p.shortage).length,
  };
  const posSummary = (() => {
    const map = {};
    POSITION_NAMES.forEach((n) => (map[n] = []));
    enriched.forEach((p) => {
      if (p.curAssign && p.curAssign.name !== "休憩予定" && !p.checkOut) {
        if (!map[p.curAssign.name]) map[p.curAssign.name] = [];
        map[p.curAssign.name].push(p);
      }
    });
    return Object.entries(map).map(([name, members]) => ({ name, members }));
  })();

  const runAI = async () => {
    setAi((a) => ({ ...a, loading: true }));
    try {
      const d = await api.aiSuggest(teamId);
      setAi({ list: d.suggestions, loading: false, note: d.source === "ai" ? "AI(Claude)が現場状況を分析した提案です。" : `ルールベースの自動提案です。${d.debug ? `(原因: ${d.debug})` : ""}` });
    } catch (e) { setAi({ list: [], loading: false, note: e.message }); }
  };
  const applySuggestion = (s) => run(
    () => api.addAssign(teamId, { pid: s.pid, start: s.start, end: s.end, name: s.name || "休憩予定", note: "AI提案より適用" }),
    "提案を配置に適用しました"
  ).then(() => setAi((a) => ({ ...a, list: (a.list || []).filter((x) => x !== s) })));
  const toggleAi = () => run(() => api.setAiEnabled(teamId, !team.aiEnabled), team.aiEnabled ? "AI提案をOFFにしました" : "AI提案をONにしました");

  const loadAudit = async () => { try { const d = await api.auditLogs(teamId); setAuditLogs(d.logs); } catch (e) { fail(e); } };

  const NAV = [
    ...(isAdmin ? [{ id: "cc", label: "Command Center" }] : []),
    { id: "member", label: "マイ勤務" },
    { id: "chat", label: "チャット" },
    ...(isAdmin ? [{ id: "ai", label: "AI提案" }] : []),
    ...(isAdmin ? [{ id: "dash", label: "参加者一覧(詳細)" }] : []),
    { id: "timeline", label: "タイムライン" },
    ...(isAdmin ? [{ id: "assign", label: "配置管理" }] : []),
    { id: "vote", label: "ポイント投票" },
    { id: "voteResult", label: "ポイント結果" },
    { id: "notify", label: "通知" },
    { id: "mypage", label: "マイページ・バッジ" },
    ...(isAdmin ? [{ id: "share", label: "QR/URLで招待" }] : []),
    ...(isAdmin ? [{ id: "audit", label: "監査ログ" }] : []),
  ];
  const BOTTOM = isAdmin ? ["cc", "member", "assign", "chat"] : ["member", "timeline", "chat", "vote"];

  const goto = (r) => { setRoute(r); if (r === "audit") loadAudit(); };

  const screens = {
    cc: <CommandCenter team={team} now={now} kpi={kpi} enriched={enriched} posSummary={posSummary} state={state} setRoute={goto}
      ai={ai} runAI={runAI} applySuggestion={applySuggestion} onToggleAi={toggleAi} openBilling={openBilling}
      onBreakEnd={(pid) => run(() => api.breakEnd(teamId, pid), "勤務に戻しました")} />,
    member: me && <MemberScreen p={me} now={now} team={team} setRoute={goto}
      onBreakStart={() => run(() => api.breakStart(teamId, me.id), "休憩を開始しました")}
      onBreakEnd={() => run(() => api.breakEnd(teamId, me.id), "勤務に戻りました")}
      onCheckout={() => run(() => api.checkout(teamId, me.id), "退勤を記録しました")} />,
    chat: <ChatScreen state={state} me={state.me} now={now}
      onSend={(text) => run(() => api.sendChat(teamId, text))} />,
    ai: <AIScreen team={team} ai={ai} runAI={runAI} applySuggestion={applySuggestion} onToggleAi={toggleAi} openBilling={openBilling} />,
    dash: <Dashboard team={team} enriched={enriched} isOwner={isOwner} votingClosed={team.votingClosed} setRoute={goto} setModal={setModal}
      onCheckout={(pid, name) => { if (confirm(`${name} を代理退勤させますか?(監査ログに記録)`)) run(() => api.checkout(teamId, pid), "代理退勤を記録しました"); }}
      onToggleRole={(pid) => run(() => api.toggleRole(teamId, pid), "権限を変更しました")}
      onToggleAi={toggleAi} openBilling={openBilling}
      onNotifyShorts={(shorts) => run(async () => { for (const p of shorts) await api.sendNotify(teamId, { type: "休憩不足", text: `${p.name}さんの休憩が不足しています(残り${p.remain}分)` }); }, "休憩不足通知を送信しました")}
      onCloseVoting={() => { if (confirm("現場を終了し、ポイント投票を締め切りますか?")) run(() => api.closeVoting(teamId), "投票を締め切りました"); }}
      onDeleteTeam={async () => {
        if (!confirm("チームを削除しますか?(監査ログは削除されません)")) return;
        clearInterval(pollRef.current); // 削除後に自分の状態を再取得してエラーになるのを防ぐ
        try { await api.deleteTeam(teamId); say("チームを削除しました"); } catch (e) { fail(e); }
        exitTeam();
      }} />,
    assign: <AssignScreen enriched={enriched} now={now} setModal={setModal} hasAssignments={state.assignments.length > 0}
      onDelete={(aid) => { if (confirm("この配置を削除しますか?")) run(() => api.delAssign(teamId, aid), "配置を削除しました"); }}
      onSaveTemplate={() => {
        const tplName = prompt("テンプレート名を入力してください(例:入場ゲート×5)");
        if (tplName) run(() => api.saveTemplate(teamId, tplName), "テンプレートとして保存しました");
      }} />,
    timeline: <Timeline enriched={enriched} now={now} team={team} />,
    vote: <Vote me={state.me} enriched={enriched} voting={state.voting} setRoute={goto}
      onVote={(target) => run(() => api.vote(teamId, target), "投票しました(1人1回)").then(() => goto("voteResult"))} />,
    voteResult: <VoteResult state={state} enriched={enriched} isAdmin={isAdmin} me={state.me}
      onCloseVoting={() => { if (confirm("投票を締め切りますか?")) run(() => api.closeVoting(teamId), "投票を締め切りました"); }} />,
    notify: <NotifyScreen state={state} isAdmin={isAdmin}
      onSend={(type, text) => run(() => api.sendNotify(teamId, { type, text }), "通知を送信しました")}
      onReadAll={() => run(() => api.readNotify(teamId, state.notifications.filter((n) => !n.read).map((n) => n.id)))}
      onRead={(id) => run(() => api.readNotify(teamId, [id]))} />,
    mypage: me && <MyPage p={me} team={team} hasAccount={state.me.hasAccount}
      onSetBadge={(b) => run(() => api.setDisplayBadge(teamId, b), b ? `名前の前に ${b} を表示します` : "バッジ表示を外しました")} />,
    share: <ShareCard team={{ ...team, siteName: team.siteName, venueName: team.venueName }} onOpenJoin={() => {}} say={say} />,
    audit: <Audit logs={auditLogs} />,
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-40 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto flex items-center gap-2 px-3 lg:px-6 py-2.5 lg:py-3.5">
          <button onClick={() => setMenuOpen(true)} aria-label="メニューを開く" className="lg:hidden w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center"><Menu className="w-5 h-5" /></button>
          <div className="flex-1 min-w-0">
            <div className="text-slate-400 leading-none" style={{ fontSize: 10 }}>現場運営支援システム</div>
            <div className="text-sm font-bold truncate">{team.siteName}</div>
          </div>
          <div className="text-lg font-mono font-bold tabular-nums">{fmtHM(now)}</div>
          <button onClick={() => goto("notify")} aria-label="通知" className="relative w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center">
            <Bell className="w-5 h-5" />
            {unread > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold rounded-full flex items-center justify-center" style={{ fontSize: 10, minWidth: 17, height: 17 }}>{unread}</span>}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        <nav className="hidden lg:block w-64 shrink-0 py-4 pl-4">
          <div className="bg-white rounded-xl border border-slate-200 p-2.5 sticky top-16">
            <div className="px-3 py-2.5 mb-1 border-b border-slate-100">
              <div className="text-base font-bold"><BadgeMark b={me?.displayBadge} />{dName(me)}</div>
              <RoleTag r={state.me.role} />
            </div>
            {NAV.map((n) => {
              const Icon = NAV_ICON[n.id];
              return (
                <button key={n.id} onClick={() => goto(n.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-bold mb-0.5 ${route === n.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  <Icon className="w-4.5 h-4.5 shrink-0" />{n.label}
                </button>
              );
            })}
            <button onClick={exitTeam} className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-slate-500 hover:bg-slate-100 text-left">チーム一覧へ</button>
            {user && <button onClick={logout} className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-rose-600 hover:bg-rose-50 text-left">ログアウト</button>}
          </div>
        </nav>
        <main className="flex-1 min-w-0 p-3 lg:p-6 pb-24 lg:pb-6">{screens[route] || screens.member}</main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {BOTTOM.map((id) => {
          const n = NAV.find((x) => x.id === id);
          if (!n) return null;
          const Icon = NAV_ICON[id];
          return (
            <button key={id} onClick={() => goto(id)} className={`flex-1 py-2 flex flex-col items-center gap-0.5 font-bold ${route === id ? "text-brand-600" : "text-slate-400"}`} style={{ fontSize: 10 }}>
              <Icon className="w-5 h-5" />{n.label.replace("管理", "").replace("ポイント", "").replace("Command Center", "現場")}
            </button>
          );
        })}
        <button onClick={() => setMenuOpen(true)} className="flex-1 py-2 flex flex-col items-center gap-0.5 font-bold text-slate-400" style={{ fontSize: 10 }}>
          <Menu className="w-5 h-5" />メニュー
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50" onClick={() => setMenuOpen(false)}>
          <div className="w-72 h-full bg-white p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 pb-3 mb-2 border-b border-slate-100">
              <span className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold">{me?.name?.[0]}</span>
              <div>
                <div className="text-sm font-bold"><BadgeMark b={me?.displayBadge} />{dName(me)}</div>
                <RoleTag r={state.me.role} />
              </div>
            </div>
            {NAV.map((n) => {
              const Icon = NAV_ICON[n.id];
              return (
                <button key={n.id} onClick={() => { goto(n.id); setMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-bold ${route === n.id ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  <Icon className="w-4.5 h-4.5 shrink-0" />{n.label}
                </button>
              );
            })}
            <button onClick={() => { exitTeam(); setMenuOpen(false); }} className="w-full mt-3 px-3 py-2.5 rounded-lg text-sm font-bold text-slate-600 bg-slate-100">チーム一覧へ</button>
            {user && <button onClick={logout} className="w-full mt-2 px-3 py-2.5 rounded-lg text-sm font-bold text-rose-600 bg-rose-50">ログアウト</button>}
          </div>
        </div>
      )}

      {modal?.type === "editRecord" && (
        <EditRecordModal p={enriched.find((x) => x.id === modal.id)} now={now} team={team} onClose={() => setModal(null)}
          onSave={(patch) => { setModal(null); run(() => api.editRecords(teamId, modal.id, patch), "修正を保存し、監査ログに記録しました"); }} />
      )}
      {modal?.type === "assignForm" && (
        <AssignFormModal init={modal.init} enriched={enriched} team={team} onClose={() => setModal(null)}
          onSave={(f) => {
            setModal(null);
            if (f.id) run(() => api.editAssign(teamId, f.id, f), "配置を保存しました");
            else run(() => api.addAssign(teamId, f), "配置を保存しました");
          }} />
      )}
      {modal?.type === "bulkAssign" && (
        <BulkAssignModal enriched={enriched} team={team} fail={fail} onClose={() => setModal(null)}
          onSubmit={(items) => run(async () => { for (const it of items) await api.addAssign(teamId, it); }, `${items.length}件の配置を登録しました`)} />
      )}
    </div>
  );
}

/* ================================ Command Center ================================ */
function CommandCenter({ team, now, kpi, enriched, posSummary, state, setRoute, ai, runAI, applySuggestion, onBreakEnd, onToggleAi, openBilling }) {
  useEffect(() => { if (team.aiEnabled && !ai.list && !ai.loading) runAI(); }, [team.aiEnabled]); // ONの場合のみ初回自動分析
  const shorts = enriched.filter((p) => p.shortage);
  const alerts = [
    ...shorts.map((p) => ({ level: "High", text: `${dName(p)}さんの休憩が不足(残り${p.remain}分)` })),
    ...posSummary.filter((s) => s.members.length === 0).map((s) => ({ level: "Medium", text: `${s.name} に現在誰も配置されていません` })),
    ...enriched.filter((p) => !p.checkOut && p.leftMin > 0 && p.leftMin <= 60).map((p) => ({ level: "Low", text: `${dName(p)}さんは勤務残り${fmtMin(p.leftMin)}` })),
  ];
  const lvColor = { High: "bg-rose-600 text-white", Medium: "bg-amber-500 text-white", Low: "bg-slate-300 text-slate-700" };
  return (
    <div className="space-y-3">
      <Card className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500">{team.venueName}{team.section ? ` / ${team.section}` : ""} / {team.date}</div>
          <div className="font-bold truncate">{team.siteName}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-slate-400" style={{ fontSize: 10 }}>現在時刻</div>
          <div className="font-mono font-bold text-lg tabular-nums leading-none">{fmtHM(now)}</div>
        </div>
      </Card>

      <div className="grid grid-cols-5 gap-2">
        {[["勤務", kpi.working, "text-emerald-600"], ["休憩", kpi.breaking, "text-amber-600"], ["開始前", kpi.before, "text-sky-600"], ["退勤", kpi.done, "text-slate-500"], ["休憩不足", kpi.short, kpi.short ? "text-rose-600" : "text-slate-300"]].map(([k, v, c]) => (
          <button key={k} onClick={() => setRoute("dash")} className="bg-white rounded-xl border border-slate-200 py-2.5 lg:py-4 text-center active:scale-95 transition">
            <div className={`text-2xl lg:text-3xl font-bold tabular-nums ${c}`}>{v}</div>
            <div className="font-bold text-slate-500" style={{ fontSize: 10 }}>{k}</div>
          </button>
        ))}
      </div>

      {alerts.length > 0 && (
        <Card className="overflow-hidden border-rose-200">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />アラート</h3>
            <span className="text-xs font-bold text-rose-600">{alerts.length}件</span>
          </div>
          <div className="divide-y divide-slate-100">
            {alerts.map((a, i) => (
              <div key={i} className="px-4 py-2 flex items-start gap-2">
                <span className={`mt-0.5 font-bold px-1.5 py-0.5 rounded ${lvColor[a.level]}`} style={{ fontSize: 10 }}>{a.level}</span>
                <span className="text-sm font-medium text-slate-700">{a.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-violet-200">
        {team.aiEnabled ? (
          <>
            <div className="px-4 pt-3 pb-1 flex items-center justify-between bg-violet-50">
              <h3 className="text-sm font-bold text-violet-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4" />AI提案</h3>
              <div className="flex gap-2 items-center pb-1">
                <button onClick={runAI} disabled={ai.loading} className="text-xs font-bold text-violet-700 disabled:opacity-40 flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${ai.loading ? "animate-spin" : ""}`} />{ai.loading ? "分析中..." : "再分析"}</button>
                <button onClick={() => setRoute("ai")} className="text-xs font-bold text-violet-700">すべて見る</button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {ai.loading && <p className="text-xs text-slate-400 px-1">AIが現場状況を分析しています...</p>}
              {!ai.loading && (ai.list || []).slice(0, 3).map((s, i) => {
                const SIcon = s.kind === "break" ? Coffee : s.kind === "assign" ? MapPin : Lightbulb;
                return (
                <div key={i} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2">
                  <SIcon className="w-4 h-4 mt-0.5 text-violet-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold">{s.title}</div>
                    <div className="text-xs text-slate-500">{s.detail}</div>
                  </div>
                  {(s.kind === "break" || s.kind === "assign") && s.pid && (
                    <Btn color="violet" onClick={() => applySuggestion(s)} className="py-1.5 text-xs shrink-0">適用</Btn>
                  )}
                </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="px-4 py-4 bg-violet-50 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-violet-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4" />AI提案は現在OFFです</h3>
              <p className="text-xs text-violet-600 mt-0.5">休憩不足の解消などをAIが分析して提案します。</p>
            </div>
            <div className="shrink-0 flex gap-1.5">
              <button onClick={openBilling} className="py-2 px-2.5 text-xs font-bold text-violet-700 bg-white border border-violet-300 rounded-lg">プランを見る</button>
              <Btn color="violet" onClick={onToggleAi} className="py-2 text-xs">ONにする</Btn>
            </div>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><MapPin className="w-4 h-4" />現在の配置</h3>
            <button onClick={() => setRoute("assign")} className="text-xs font-bold text-brand-600">配置管理へ</button>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            {posSummary.map((s) => (
              <div key={s.name} className={`rounded-lg border p-2.5 ${s.members.length === 0 ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold truncate">{s.name}</span>
                  <span className={`text-sm font-bold tabular-nums ${s.members.length === 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.members.length}名</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.members.map((p) => (
                    <span key={p.id} className={`font-bold px-1.5 py-0.5 rounded ${p.status === "休憩中" ? "bg-amber-200 text-amber-800" : "bg-slate-200 text-slate-700"}`} style={{ fontSize: 10 }}>
                      <BadgeMark b={p.displayBadge} className="w-3 h-3" />{p.name.split(" ")[0]}
                    </span>
                  ))}
                  {s.members.length === 0 && <span className="text-slate-400" style={{ fontSize: 10 }}>空き</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Users className="w-4 h-4" />スタッフ状況</h3>
            <button onClick={() => setRoute("dash")} className="text-xs font-bold text-brand-600">詳細一覧</button>
          </div>
          <div className="p-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: 280 }}>
            {enriched.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
                  <div className="text-slate-400 truncate" style={{ fontSize: 10 }}>{p.curAssign?.name || "配置なし"} / 休憩 {p.taken}/{p.req}分</div>
                </div>
                <Badge s={p.status} />
                {p.status === "休憩中" && <Btn color="emerald" onClick={() => onBreakEnd(p.id)} className="py-1.5 text-xs shrink-0">復帰</Btn>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><MessageCircle className="w-4 h-4" />チャット</h3>
            <button onClick={() => setRoute("chat")} className="text-xs font-bold text-brand-600">開く</button>
          </div>
          <div className="p-3 space-y-1.5">
            {state.chat.slice(-3).map((m) => {
              const p = state.participants.find((x) => x.id === m.pid);
              return (
                <div key={m.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-bold"><BadgeMark b={p?.displayBadge} />{dName(p)}</span>
                  <span className="text-slate-400 ml-2 font-mono" style={{ fontSize: 10 }}>{fmtHM(m.time)}</span>
                  <div className="text-slate-600 mt-0.5">{m.text}</div>
                </div>
              );
            })}
            {state.chat.length === 0 && <p className="text-xs text-slate-400">まだメッセージがありません。</p>}
          </div>
        </Card>
        <Card>
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Bell className="w-4 h-4" />通知</h3>
            <button onClick={() => setRoute("notify")} className="text-xs font-bold text-brand-600">通知センターへ</button>
          </div>
          <div className="p-3 space-y-1.5">
            {state.notifications.slice(0, 4).map((n) => (
              <div key={n.id} className={`text-xs rounded-lg px-3 py-2 ${n.read ? "bg-slate-50 text-slate-500" : "bg-brand-50 text-slate-700"}`}>
                <span className="font-bold">[{n.type}]</span> {n.text}
                <span className="text-slate-400 ml-1 font-mono" style={{ fontSize: 10 }}>{fmtHM(n.time)}</span>
              </div>
            ))}
            {state.notifications.length === 0 && <p className="text-xs text-slate-400">通知はありません。</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ================================ AI提案画面 ================================ */
function AIScreen({ team, ai, runAI, applySuggestion, onToggleAi, openBilling }) {
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg flex items-center gap-1.5"><Sparkles className="w-4.5 h-4.5" />AI提案</h2>
        {team.aiEnabled && <Btn color="violet" onClick={runAI} disabled={ai.loading} className="flex items-center gap-1.5"><RefreshCw className={`w-4 h-4 ${ai.loading ? "animate-spin" : ""}`} />{ai.loading ? "分析中..." : "現場を再分析"}</Btn>}
      </div>
      <Card className="p-3 text-xs text-slate-500">
        現在の勤務・休憩・配置状況をAIが分析し、休憩不足の解消などを提案します。「適用」で配置(休憩予定含む)として登録され、監査ログに残ります。
      </Card>
      <Card className="p-4 flex items-center justify-between gap-3 border-violet-200 bg-violet-50">
        <div>
          <div className="text-sm font-bold text-violet-800">AI提案を{team.aiEnabled ? "ON" : "OFF"}にしています</div>
          <div className="text-xs text-violet-600 mt-0.5">{team.aiEnabled ? "この現場ではAI提案が使えます。" : "OFFの間は分析を行わず、費用も発生しません。"}</div>
        </div>
        <div className="shrink-0 flex gap-1.5">
          <button onClick={openBilling} className="py-2 px-2.5 text-xs font-bold text-violet-700 bg-white border border-violet-300 rounded-lg">プランを見る</button>
          <Btn color={team.aiEnabled ? "slate" : "violet"} onClick={onToggleAi} className="py-2 text-xs">{team.aiEnabled ? "OFFにする" : "ONにする"}</Btn>
        </div>
      </Card>
      {!team.aiEnabled && (
        <Card className="p-6 text-center text-sm text-slate-400">AI提案はOFFになっています。上のボタンからONにすると使えます。</Card>
      )}
      {team.aiEnabled && (
        <>
          {ai.note && <p className="text-xs text-violet-600 font-bold px-1">{ai.note}</p>}
          {ai.loading && <Card className="p-6 text-center text-sm text-slate-400"><Bot className="w-7 h-7 mx-auto mb-2 text-violet-400" />AIが現場状況を分析しています...</Card>}
          {!ai.loading && !ai.list && <Card className="p-6 text-center text-sm text-slate-400">「現場を再分析」を押すと提案が表示されます。</Card>}
          {!ai.loading && (ai.list || []).map((s, i) => {
            const SIcon = s.kind === "break" ? Coffee : s.kind === "assign" ? MapPin : Lightbulb;
            return (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-3">
                <SIcon className="w-6 h-6 text-violet-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{s.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{s.detail}</div>
                  {(s.kind === "break" || s.kind === "assign") && s.pid && (
                    <div className="text-xs text-violet-700 font-bold mt-1 font-mono">{fmtHM(s.start)}〜{fmtHM(s.end)} {s.name || "休憩予定"}</div>
                  )}
                </div>
              </div>
              {(s.kind === "break" || s.kind === "assign") && s.pid && (
                <Btn color="violet" className="w-full mt-3" onClick={() => applySuggestion(s)}>この提案を配置に適用する</Btn>
              )}
            </Card>
            );
          })}
          <p className="text-slate-400 px-1" style={{ fontSize: 10 }}>※AI提案は参考情報です。最終判断は現場責任者が行ってください。</p>
        </>
      )}
    </div>
  );
}

/* ================================ チャット ================================ */
function ChatScreen({ state, me, onSend }) {
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [state.chat.length]);
  const send = () => { if (text.trim()) { onSend(text.trim()); setText(""); } };
  const stamps = [
    { text: "了解です", Icon: ThumbsUp },
    { text: "急行します", Icon: Zap },
    { text: "休憩入ります", Icon: Coffee },
    { text: "戻りました", Icon: CheckCircle2 },
    { text: "応援お願いします", Icon: HandHeart },
  ];
  return (
    <div className="max-w-md mx-auto flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
      <h2 className="font-bold text-lg px-1 mb-2 flex items-center gap-1.5"><MessageCircle className="w-4.5 h-4.5" />チームチャット</h2>
      <Card className="flex-1 overflow-hidden p-3">
        <div ref={boxRef} className="h-full overflow-y-auto space-y-3">
          {state.chat.map((m) => {
            const p = state.participants.find((x) => x.id === m.pid);
            const mine = m.pid === me.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div style={{ maxWidth: "80%" }}>
                  {!mine && <div className="text-xs font-bold text-slate-500 mb-0.5"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>}
                  <div className={`px-3 py-2 rounded-2xl text-sm ${mine ? "bg-brand-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md"}`}>{m.text}</div>
                  <div className={`text-slate-400 font-mono mt-0.5 ${mine ? "text-right" : ""}`} style={{ fontSize: 10 }}>{fmtHM(m.time)}</div>
                </div>
              </div>
            );
          })}
          {state.chat.length === 0 && <p className="text-xs text-slate-400 text-center pt-8">最初のメッセージを送ってみましょう。</p>}
        </div>
      </Card>
      <div className="flex gap-1 overflow-x-auto py-2">
        {stamps.map(({ text, Icon }) => (
          <button key={text} onClick={() => onSend(text)} className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-600">
            <Icon className="w-3.5 h-3.5" />{text}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="メッセージを入力" />
        <Btn onClick={send} disabled={!text.trim()}>送信</Btn>
      </div>
    </div>
  );
}

/* ================================ マイ勤務(個人画面) ================================ */
function MemberScreen({ p, now, team, setRoute, onBreakStart, onBreakEnd, onCheckout }) {
  const st = ST[p.status];
  const open = p.breaks.find((b) => !b.end);
  const pct = p.req ? Math.min(100, Math.round((p.taken / p.req) * 100)) : 100;
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <Card className="p-5 text-center">
        <div className="text-xs text-slate-400">{team.siteName} / {team.date}</div>
        <div className="font-bold text-lg mt-0.5"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
        <div className={`inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full font-bold ${st.bg} ${st.tx}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{p.status}
          {p.status === "休憩中" && open && <span className="text-xs font-normal">({fmtMin(minDiff(open.start, now))}経過)</span>}
        </div>
        <div className="text-xs text-slate-500 mt-2 font-mono">予定 {fmtHM(p.planStart)}–{fmtHM(p.planEnd)}{p.checkOut && ` / 退勤 ${fmtHM(p.checkOut)}`}</div>
        {!p.checkOut && p.status !== "開始前" && (
          <div className="grid grid-cols-1 gap-2 mt-4">
            {p.status === "休憩中" ? (
              <Btn big color="emerald" onClick={onBreakEnd}><Play className="w-4 h-4 inline -mt-0.5 mr-1" />勤務に戻る</Btn>
            ) : (
              <Btn big color="amber" onClick={onBreakStart}><Coffee className="w-4 h-4 inline -mt-0.5 mr-1" />休憩開始</Btn>
            )}
            <Btn big color="rose" onClick={() => { if (confirm("退勤を記録しますか?")) onCheckout(); }}><LogOut className="w-4 h-4 inline -mt-0.5 mr-1" />退勤する</Btn>
          </div>
        )}
        {p.status === "開始前" && (
          <div className="mt-4 bg-sky-50 rounded-xl px-4 py-3 text-sm text-sky-700 font-bold">
            {fmtHM(p.planStart)} になると自動的に勤務中になります(あと{fmtMin(minDiff(now, p.planStart))})
          </div>
        )}
        {p.checkOut && (
          <div className="mt-4 bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-500 font-bold">本日はお疲れさまでした。
            <Btn className="w-full mt-2" onClick={() => setRoute("vote")}><VoteIcon className="w-4 h-4 inline -mt-0.5 mr-1" />ポイント投票へ</Btn>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Coffee className="w-4 h-4" />休憩状況</span>
          <span className="text-xs text-slate-400">6h以上45分 / 8h以上60分</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${p.remain === 0 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {[["必要休憩", `${p.req}分`], ["取得済み", `${p.taken}分`], ["残り", p.remain ? `${p.remain}分` : "充足✓"]].map(([k, v], i) => (
            <div key={k} className={`rounded-lg py-2 ${i === 2 ? (p.remain ? "bg-rose-50" : "bg-emerald-50") : "bg-slate-50"}`}>
              <div className="font-bold text-slate-400" style={{ fontSize: 10 }}>{k}</div>
              <div className={`font-bold tabular-nums ${i === 2 ? (p.remain ? "text-rose-600" : "text-emerald-600") : ""}`}>{v}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2 text-center">
          {[["勤務時間(実働)", fmtMin(p.workMin)], ["勤務残り時間", p.checkOut ? "—" : fmtMin(p.leftMin)]].map(([k, v]) => (
            <div key={k} className="rounded-lg py-2 bg-slate-50">
              <div className="font-bold text-slate-400" style={{ fontSize: 10 }}>{k}</div>
              <div className="font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        {p.breaks.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-bold text-slate-400 mb-1">休憩履歴</div>
            {p.breaks.map((b, i) => (
              <div key={i} className="flex justify-between text-xs bg-amber-50 rounded-lg px-3 py-1.5 mb-1 font-mono">
                <span>{fmtHM(b.start)} 〜 {b.end ? fmtHM(b.end) : "取得中"}</span>
                <span className="font-bold">{fmtMin(minDiff(b.start, b.end ?? now))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4" />自分の配置</div>
        {p.myAssigns.length === 0 && <p className="text-xs text-slate-400">配置はまだ登録されていません。</p>}
        {p.myAssigns.map((a) => {
          const cur = now >= a.start && now < a.end;
          const past = now >= a.end;
          return (
            <div key={a.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 ${cur ? "bg-brand-600 text-white" : past ? "bg-slate-50 text-slate-400" : "bg-slate-50"}`}>
              <span className="font-mono text-xs tabular-nums w-24">{fmtHM(a.start)}–{fmtHM(a.end)}</span>
              <span className="font-bold text-sm flex-1">{a.name}</span>
              {cur && <span className="bg-white/20 px-1.5 py-0.5 rounded" style={{ fontSize: 10 }}>現在</span>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ================================ 参加者一覧(詳細) ================================ */
function Dashboard({ team, enriched, isOwner, votingClosed, setRoute, setModal, onCheckout, onToggleRole, onToggleAi, openBilling, onNotifyShorts, onCloseVoting, onDeleteTeam }) {
  const shorts = enriched.filter((p) => p.shortage);
  const exportAttendanceCSV = () => {
    const header = ["氏名", "役割", "予定勤務開始", "予定勤務終了", "退勤時刻", "必要休憩(分)", "取得休憩(分)", "休憩不足(分)", "休憩詳細"];
    const rows = enriched.map((p) => [
      p.name, ROLE_LABEL[p.role] || p.role, fmtHM(p.planStart), fmtHM(p.planEnd), p.checkOut ? fmtHM(p.checkOut) : "",
      p.req, p.taken, p.remain,
      p.breaks.map((b) => `${fmtHM(b.start)}-${b.end ? fmtHM(b.end) : "未終了"}`).join(";"),
    ]);
    downloadCSV(`勤務休憩実績_${team.siteName}_${team.date}.csv`, [header, ...rows]);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1 gap-2">
        <h2 className="font-bold text-lg lg:text-xl">参加者一覧(詳細)</h2>
        <button onClick={exportAttendanceCSV} className="text-xs font-bold text-brand-600 bg-brand-50 px-2.5 py-1.5 rounded-lg whitespace-nowrap">CSVダウンロード</button>
      </div>
      <Card className="p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Sparkles className="w-4 h-4" />AI提案</div>
          <div className="text-xs text-slate-500 mt-0.5">現在 {team.aiEnabled ? "ON" : "OFF"} です。{!team.aiEnabled && "OFFの間は分析を行わず費用も発生しません。"}</div>
        </div>
        <div className="shrink-0 flex gap-1.5">
          <button onClick={openBilling} className="py-2 px-2.5 text-xs font-bold text-brand-600 bg-brand-50 rounded-lg">プラン</button>
          <Btn color={team.aiEnabled ? "slate" : "violet"} onClick={onToggleAi} className="py-2 text-xs">{team.aiEnabled ? "OFFにする" : "ONにする"}</Btn>
        </div>
      </Card>
      {shorts.length > 0 && (
        <Card className="p-3 border-rose-300 bg-rose-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />休憩不足 {shorts.length}名</span>
            <Btn color="rose" onClick={() => onNotifyShorts(shorts)} className="py-1.5 text-xs">不足者へ通知</Btn>
          </div>
        </Card>
      )}
      <Card className="divide-y divide-slate-100">
        {enriched.map((p) => (
          <div key={p.id} className={`px-4 py-3 ${p.shortage ? "bg-rose-50" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm"><BadgeMark b={p?.displayBadge} />{dName(p)}</span>
              <RoleTag r={p.role} />
              <Badge s={p.status} />
              {p.shortage && <span className="font-bold bg-rose-600 text-white px-1.5 py-0.5 rounded" style={{ fontSize: 10 }}>休憩不足</span>}
              <span className="ml-auto font-mono text-xs text-slate-500">{fmtHM(p.planStart)}–{fmtHM(p.planEnd)}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 mt-1.5 text-xs text-slate-500">
              <span>休憩:<b className={p.remain ? "text-amber-600" : "text-emerald-600"}>{p.taken}/{p.req}分</b>(残{p.remain}分)</span>
              <span>現在配置:<b className="text-slate-700">{p.curAssign?.name || "—"}</b></span>
              <span>今後:<b className="text-slate-700">{p.nextAssign ? `${fmtHM(p.nextAssign.start)} ${p.nextAssign.name}` : "—"}</b></span>
              <span>退勤:<b className="text-slate-700">{fmtHM(p.checkOut)}</b></span>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={() => setModal({ type: "editRecord", id: p.id })} className="text-xs font-bold text-brand-600 px-2 py-1 bg-brand-50 rounded-lg">履歴修正</button>
              {!p.checkOut && p.status !== "開始前" && (
                <button onClick={() => onCheckout(p.id, p.name)} className="text-xs font-bold text-rose-600 px-2 py-1 bg-rose-50 rounded-lg">代理退勤</button>
              )}
              {isOwner && p.role !== "owner" && p.role !== "guest" && (
                <button onClick={() => onToggleRole(p.id)} className="text-xs font-bold text-violet-600 px-2 py-1 bg-violet-50 rounded-lg">
                  {p.role === "admin" ? "管理者を外す" : "管理者にする"}
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>
      <Card className="p-4 space-y-2">
        <div className="text-sm font-bold text-slate-700">現場終了処理</div>
        {!votingClosed ? (
          <Btn className="w-full flex items-center justify-center gap-1.5" onClick={onCloseVoting}><VoteIcon className="w-4 h-4" />投票を締め切り結果を確定する</Btn>
        ) : (
          <Btn color="slate" className="w-full flex items-center justify-center gap-1.5" onClick={() => setRoute("voteResult")}><Trophy className="w-4 h-4" />ポイント結果を見る</Btn>
        )}
        {isOwner && <Btn color="rose" className="w-full" onClick={onDeleteTeam}>チームを削除(オーナーのみ)</Btn>}
      </Card>
    </div>
  );
}

/* ---------- 履歴修正モーダル ---------- */
function EditRecordModal({ p, now, team, onClose, onSave }) {
  const [start, setStart] = useState(fmtHM(p.planStart));
  const [end, setEnd] = useState(fmtHM(p.planEnd));
  const [out, setOut] = useState(p.checkOut ? fmtHM(p.checkOut) : "");
  const [brs, setBrs] = useState(p.breaks.map((b) => ({ s: fmtHM(b.start), e: b.end ? fmtHM(b.end) : "" })));
  const save = () => onSave({
    planStart: dateT(team.date, start),
    planEnd: dateT(team.date, end),
    checkOut: out ? dateT(team.date, out) : null,
    breaks: brs.filter((b) => b.s).map((b) => ({ start: dateT(team.date, b.s), end: b.e ? dateT(team.date, b.e) : null })),
  });
  return (
    <Modal title={`履歴修正 — ${p.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="予定勤務開始"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="予定勤務終了"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="実退勤時刻(空欄=未退勤)"><input type="time" className={inputCls} value={out} onChange={(e) => setOut(e.target.value)} /></Field>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-500">休憩履歴</label>
            <button onClick={() => setBrs([...brs, { s: fmtHM(now), e: "" }])} className="text-xs font-bold text-brand-600">＋追加</button>
          </div>
          {brs.map((b, i) => (
            <div key={i} className="flex items-center gap-2 mt-1.5">
              <input type="time" className={inputCls} value={b.s} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, s: e.target.value } : x)))} />
              <span className="text-slate-400">〜</span>
              <input type="time" className={inputCls} value={b.e} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, e: e.target.value } : x)))} />
              <button onClick={() => setBrs(brs.filter((_, j) => j !== i))} aria-label={`休憩${i + 1}件目を削除`} className="text-rose-500 px-1"><X className="w-4 h-4" /></button>
            </div>
          ))}
          {brs.length === 0 && <p className="text-xs text-slate-400 mt-1">休憩記録はありません。</p>}
        </div>
        <Btn className="w-full" onClick={save}>修正を保存(監査ログに記録)</Btn>
      </div>
    </Modal>
  );
}

/* ================================ 配置管理 ================================ */
function AssignScreen({ enriched, now, setModal, onDelete, onSaveTemplate, hasAssignments }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1 gap-2 flex-wrap">
        <h2 className="font-bold text-lg">配置管理</h2>
        <div className="flex gap-1.5">
          <button onClick={onSaveTemplate} disabled={!hasAssignments} className="text-xs font-bold text-violet-600 bg-violet-50 disabled:opacity-40 px-2.5 py-1.5 rounded-lg whitespace-nowrap">テンプレート保存</button>
          <button onClick={() => setModal({ type: "bulkAssign" })} className="text-xs font-bold text-brand-600 bg-brand-50 px-2.5 py-1.5 rounded-lg whitespace-nowrap">CSV/テンプレート一括登録</button>
          <Btn onClick={() => setModal({ type: "assignForm", init: null })} className="py-1.5 text-xs">＋ 配置を登録</Btn>
        </div>
      </div>
      {enriched.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-bold text-sm flex-1"><BadgeMark b={p?.displayBadge} />{dName(p)}</span>
            <Badge s={p.status} />
            <span className="text-xs text-brand-700 font-bold">{p.curAssign ? `現在:${p.curAssign.name}` : "現在:—"}</span>
          </div>
          {p.myAssigns.length === 0 && <p className="text-xs text-slate-400">配置なし</p>}
          {p.myAssigns.map((a) => {
            const cur = now >= a.start && now < a.end;
            return (
              <div key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 ${cur ? "bg-brand-50 border border-brand-200" : "bg-slate-50"}`}>
                <span className="font-mono text-xs tabular-nums w-24 shrink-0">{fmtHM(a.start)}–{fmtHM(a.end)}</span>
                <span className="text-sm font-bold flex-1 min-w-0 truncate">{a.name}{a.note && <span className="text-xs font-normal text-slate-400 ml-1">({a.note})</span>}</span>
                <button onClick={() => setModal({ type: "assignForm", init: a })} className="text-xs font-bold text-brand-600 px-1.5">編集</button>
                <button onClick={() => onDelete(a.id)} className="text-xs font-bold text-rose-500 px-1.5">削除</button>
              </div>
            );
          })}
          <button onClick={() => setModal({ type: "assignForm", init: { pid: p.id } })} className="mt-1 w-full py-1.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 text-xs font-bold">＋ {p.name} に配置を追加</button>
        </Card>
      ))}
    </div>
  );
}

function AssignFormModal({ init, enriched, team, onClose, onSave }) {
  const [f, setF] = useState({
    id: init?.id || null,
    pid: init?.pid || enriched[0]?.id,
    start: init?.start ? fmtHM(init.start) : "13:00",
    end: init?.end ? fmtHM(init.end) : "14:00",
    name: init?.name || "",
    note: init?.note || "",
  });
  const startMs = dateT(team.date, f.start), endMs = dateT(team.date, f.end);
  const ok = f.pid && f.name && f.start && f.end && startMs < endMs;
  return (
    <Modal title={f.id ? "配置を編集" : "配置を登録"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="対象メンバー *">
          <select className={inputCls} value={f.pid} onChange={(e) => setF({ ...f, pid: e.target.value })}>
            {enriched.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="開始時刻 *"><input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="終了時刻 *"><input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        </div>
        <Field label="配置名 *">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例:入口誘導" />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {[...POSITION_NAMES, "休憩予定"].map((n) => (
              <button key={n} onClick={() => setF({ ...f, name: n })} className={`text-xs font-bold px-2 py-1 rounded-full ${f.name === n ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{n}</button>
            ))}
          </div>
        </Field>
        <Field label="備考"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {f.start && f.end && startMs >= endMs && <p className="text-xs text-rose-600 font-bold">終了時刻は開始時刻より後にしてください。</p>}
        <Btn className="w-full" disabled={!ok} onClick={() => onSave({ id: f.id, pid: f.pid, start: startMs, end: endMs, name: f.name, note: f.note })}>保存(監査ログに記録)</Btn>
      </div>
    </Modal>
  );
}

/* CSVアップロード、または保存済みテンプレートから、配置を複数件まとめて登録する */
function BulkAssignModal({ enriched, team, onClose, onSubmit, fail }) {
  const [rows, setRows] = useState([]);
  const [templates, setTemplates] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.templates().then((d) => setTemplates(d.templates)).catch(() => setTemplates([])); }, []);

  const matchPid = (name) => enriched.find((p) => p.name === name)?.id || "";

  const loadFromCSV = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const all = parseCSV(String(reader.result || ""));
      if (all.length === 0) return;
      const body = /^(参加者名|氏名|名前)/.test(all[0][0] || "") ? all.slice(1) : all;
      const parsed = body
        .map((r) => ({ pid: matchPid((r[0] || "").trim()), rawName: (r[0] || "").trim(), start: (r[1] || "").trim(), end: (r[2] || "").trim(), name: (r[3] || "").trim(), note: (r[4] || "").trim() }))
        .filter((r) => r.start && r.end && r.name);
      setRows(parsed);
    };
    reader.readAsText(file, "utf-8");
  };

  const applyTemplate = async (tplId) => {
    if (!tplId) return;
    try {
      const d = await api.templateItems(tplId);
      setRows(d.items.map((it) => ({ pid: "", rawName: "", start: it.start, end: it.end, name: it.name, note: it.note })));
    } catch (e) { fail(e); }
  };

  const updateRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows((rs) => [...rs, { pid: "", rawName: "", start: "09:00", end: "10:00", name: "", note: "" }]);

  const valid = rows.filter((r) => r.pid && r.name && r.start && r.end && dateT(team.date, r.start) < dateT(team.date, r.end));
  const invalidCount = rows.length - valid.length;

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(valid.map((r) => ({ pid: r.pid, start: dateT(team.date, r.start), end: dateT(team.date, r.end), name: r.name, note: r.note || "" })));
      onClose();
    } finally { setBusy(false); }
  };

  const downloadSample = () => downloadCSV("配置一括登録_サンプル.csv", [
    ["参加者名", "開始時刻", "終了時刻", "配置名", "備考"],
    [enriched[0]?.name || "山田太郎", "09:00", "12:00", "入口誘導", ""],
  ]);

  return (
    <Modal title="配置を一括登録" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <label className="flex-1 text-center text-xs font-bold text-brand-600 bg-brand-50 rounded-lg py-2 cursor-pointer">
            CSVを選択
            <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files[0] && loadFromCSV(e.target.files[0])} />
          </label>
          <button onClick={downloadSample} className="flex-1 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg py-2">サンプルCSVをダウンロード</button>
        </div>
        <Field label="保存済みテンプレートから読み込む">
          <select className={inputCls} defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">選択してください</option>
            {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}({t.itemCount}件)</option>)}
          </select>
          {templates && templates.length === 0 && <p className="text-xs text-slate-400 mt-1">保存済みテンプレートはまだありません。配置管理画面の「テンプレート保存」から作成できます。</p>}
        </Field>

        {rows.length > 0 && (
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "40vh" }}>
            {rows.map((r, i) => (
              <div key={i} className="p-2.5 bg-slate-50 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input type="time" className={inputCls} value={r.start} onChange={(e) => updateRow(i, { start: e.target.value })} />
                  <span className="text-slate-400 text-xs shrink-0">〜</span>
                  <input type="time" className={inputCls} value={r.end} onChange={(e) => updateRow(i, { end: e.target.value })} />
                  <button onClick={() => removeRow(i)} aria-label={`${i + 1}行目を削除`} className="text-rose-500 px-1 shrink-0"><X className="w-4 h-4" /></button>
                </div>
                <input className={inputCls} value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="配置名" />
                <select className={inputCls} value={r.pid} onChange={(e) => updateRow(i, { pid: e.target.value })}>
                  <option value="">対象メンバーを選択{r.rawName ? `(CSV上の名前:${r.rawName})` : ""}</option>
                  {enriched.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <button onClick={addRow} className="w-full py-1.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-500 text-xs font-bold">＋ 行を追加</button>
        {invalidCount > 0 && <p className="text-xs text-rose-600 font-bold">{invalidCount}件は対象メンバー未選択または時刻の不備のため登録されません。</p>}
        <Btn className="w-full" disabled={busy || valid.length === 0} onClick={submit}>{busy ? "登録中..." : `${valid.length}件を登録する(監査ログに記録)`}</Btn>
      </div>
    </Modal>
  );
}

/* ================================ タイムライン ================================ */
function Timeline({ enriched, now, team }) {
  const H0 = dateT(team.date, "06:00"), H1 = dateT(team.date, "23:59");
  const pct = (t) => Math.min(100, Math.max(0, ((t - H0) / (H1 - H0)) * 100));
  const hours = Array.from({ length: 10 }, (_, i) => 6 + i * 2);
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-lg lg:text-xl px-1">タイムライン</h2>
      <div className="flex flex-wrap gap-3 px-1 text-xs font-bold text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-emerald-200 border border-emerald-400" />勤務予定</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-brand-500" />配置</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-amber-500" />実休憩</span>
        <span className="flex items-center gap-1"><span className="w-1 h-3 bg-rose-500" />現在</span>
      </div>
      <Card className="hidden md:block p-4 overflow-x-auto">
        <div style={{ minWidth: 760 }}>
          <div className="relative h-5 ml-28 mb-1">
            {hours.map((h) => (
              <span key={h} className="absolute text-slate-400 font-mono" style={{ left: `${pct(dateT(team.date, String(h).padStart(2, "0") + ":00"))}%`, fontSize: 10 }}>{h}:00</span>
            ))}
          </div>
          {enriched.map((p) => (
            <div key={p.id} className="flex items-center mb-2">
              <div className="w-28 shrink-0 pr-2">
                <div className="text-xs font-bold truncate"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
                <Badge s={p.status} />
              </div>
              <div className="relative flex-1 h-9 bg-slate-50 rounded-lg overflow-hidden">
                <div className="absolute top-1 bottom-1 rounded bg-emerald-100 border border-emerald-300"
                  style={{ left: `${pct(p.planStart)}%`, width: `${pct(p.checkOut ?? p.planEnd) - pct(p.planStart)}%` }} />
                {p.myAssigns.map((a) => (
                  <div key={a.id} className="absolute flex items-center justify-center text-white font-bold rounded bg-brand-500 overflow-hidden"
                    style={{ left: `${pct(a.start)}%`, width: `${pct(a.end) - pct(a.start)}%`, top: 6, bottom: 6, fontSize: 10 }}
                    title={`${fmtHM(a.start)}–${fmtHM(a.end)} ${a.name}`}>
                    <span className="truncate px-1">{a.name}</span>
                  </div>
                ))}
                {p.breaks.map((b, i) => (
                  <div key={i} className="absolute bg-amber-500 rounded" style={{ left: `${pct(b.start)}%`, width: `${Math.max(0.6, pct(b.end ?? now) - pct(b.start))}%`, top: 2, height: 4 }} />
                ))}
                {p.checkOut && <div className="absolute top-0 bottom-0 bg-slate-700" style={{ left: `${pct(p.checkOut)}%`, width: 3 }} />}
                <div className="absolute top-0 bottom-0 bg-rose-500" style={{ left: `${pct(now)}%`, width: 2 }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div className="md:hidden space-y-2">
        {enriched.map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm flex-1"><BadgeMark b={p?.displayBadge} />{dName(p)}</span>
              <Badge s={p.status} />
            </div>
            <div className="font-mono text-xs text-slate-500 mt-0.5">勤務予定 {fmtHM(p.planStart)}–{fmtHM(p.planEnd)}{p.checkOut && ` / 退勤 ${fmtHM(p.checkOut)}`}</div>
            <div className="relative h-3 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className="absolute top-0 bottom-0 bg-emerald-200" style={{ left: `${pct(p.planStart)}%`, width: `${pct(p.checkOut ?? p.planEnd) - pct(p.planStart)}%` }} />
              {p.myAssigns.map((a) => (
                <div key={a.id} className="absolute top-0 bottom-0 bg-brand-500 opacity-80" style={{ left: `${pct(a.start)}%`, width: `${pct(a.end) - pct(a.start)}%` }} />
              ))}
              {p.breaks.map((b, i) => (
                <div key={i} className="absolute top-0 bottom-0 bg-amber-500" style={{ left: `${pct(b.start)}%`, width: `${Math.max(1, pct(b.end ?? now) - pct(b.start))}%` }} />
              ))}
              <div className="absolute top-0 bottom-0 bg-rose-500" style={{ left: `${pct(now)}%`, width: 2 }} />
            </div>
            <div className="mt-2 space-y-0.5">
              {p.myAssigns.map((a) => (
                <div key={a.id} className="flex gap-2 text-xs">
                  <span className="font-mono text-slate-400 tabular-nums">{fmtHM(a.start)}–{fmtHM(a.end)}</span>
                  <span className="font-bold text-brand-700">{a.name}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ================================ ポイント投票 ================================ */
function Vote({ me, enriched, voting, setRoute, onVote }) {
  const [pick, setPick] = useState(null);
  const candidates = enriched.filter((p) => p.id !== me.id);
  if (voting.closed) return (
    <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
      <Trophy className="w-8 h-8 mx-auto text-amber-500" />
      <div className="font-bold">投票は締め切られました</div>
      <Btn className="w-full" onClick={() => setRoute("voteResult")}>結果を見る</Btn>
    </Card>
  );
  if (voting.myVote) return (
    <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
      <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
      <div className="font-bold">投票済みです(1人1回)</div>
      <p className="text-xs text-slate-500">結果は投票締切後に公開されます。</p>
      <Btn color="slate" className="w-full" onClick={() => setRoute("voteResult")}>結果ページへ</Btn>
    </Card>
  );
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await onVote(pick);
    setBusy(false);
  };
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg lg:text-xl px-1 flex items-center gap-2"><VoteIcon className="w-5 h-5" />ポイント投票</h2>
      <Card className="p-3 text-xs text-slate-500">
        今日いちばん活躍したと思う人を<b>1人だけ</b>選んで投票してください(自分は選べません)。
        得票数の順位に応じてポイントを獲得できます:<b>1位3P / 2位2P / 3位1P</b>。
      </Card>
      <div className="space-y-2">
        {candidates.map((p) => (
          <button key={p.id} onClick={() => setPick(p.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${pick === p.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"}`}>
            <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${pick === p.id ? "border-brand-600 bg-brand-600" : "border-slate-300"}`}>
              {pick === p.id && <span className="w-2 h-2 rounded-full bg-white" />}
            </span>
            <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center shrink-0">{p.name[0]}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
              <div className="text-xs text-slate-400">{p.curAssign?.name || "配置なし"} / {ROLE_LABEL[p.role]}</div>
            </div>
          </button>
        ))}
      </div>
      <Btn big className="w-full" disabled={!pick || busy} onClick={submit}>{busy ? "投票中..." : "この人に投票する(1人1回)"}</Btn>
    </div>
  );
}

/* ================================ ポイント結果 ================================ */
function VoteResult({ state, enriched, isAdmin, me, onCloseVoting }) {
  if (!state.voting.closed) return (
    <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
      <Hourglass className="w-8 h-8 mx-auto text-slate-400" />
      <div className="font-bold">投票受付中</div>
      <p className="text-xs text-slate-500">{state.voting.votedCount} / {enriched.length} 名が投票済み。結果は締切後に公開されます。</p>
      {isAdmin && <Btn className="w-full" onClick={onCloseVoting}>投票を締め切る(管理者)</Btn>}
    </Card>
  );
  const results = [...enriched].sort((a, b) => (a.todayRank || 999) - (b.todayRank || 999));
  const medalColor = { 1: "text-amber-500", 2: "text-slate-400", 3: "text-amber-700" };
  const top3 = results.filter((r) => r.todayRank <= 3 && r.todayVotes > 0).slice(0, 3);
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg lg:text-xl px-1 flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" />ポイント結果</h2>
      <div className="grid grid-cols-3 gap-2">
        {top3.map((p) => (
          <Card key={p.id} className={`p-3 text-center ${p.todayRank === 1 ? "border-amber-300 bg-amber-50" : ""}`}>
            <Medal className={`w-6 h-6 mx-auto ${medalColor[p.todayRank]}`} />
            <div className="font-bold text-sm mt-1 truncate"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
            <div className="text-xs text-slate-400">{p.todayVotes}票</div>
            <div className="text-lg font-bold text-brand-700 tabular-nums">+{p.todayPoints}P</div>
          </Card>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {results.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${p.id === me.id ? "bg-brand-50" : ""}`}>
            <span className="w-9 text-center font-bold text-slate-400 tabular-nums">{p.todayRank}位</span>
            <span className="flex-1 font-bold text-sm truncate"><BadgeMark b={p?.displayBadge} />{dName(p)}{p.id === me.id && <span className="text-xs text-brand-600 ml-1">(自分)</span>}</span>
            <span className="text-xs text-slate-400">{p.todayVotes}票</span>
            <span className="font-bold text-brand-700 tabular-nums w-10 text-right">{p.todayPoints > 0 ? `+${p.todayPoints}P` : "—"}</span>
          </div>
        ))}
      </Card>
      <Card className="p-3 text-xs text-slate-500">
        現場1位・初ポイント獲得・累計10P到達などの節目でバッジが自動付与されます。マイページで名前の前に表示するバッジを選べます。アカウント保有者はポイントが累計へ加算されます。
      </Card>
    </div>
  );
}

/* ================================ マイページ(トップレベル・チーム不要) ================================ */
function GlobalMyPageScreen({ user, say, fail, onBack }) {
  const [my, setMy] = useState(null);
  const [totpEnabled, setTotpEnabled] = useState(!!user?.totp_enabled);
  const [securityView, setSecurityView] = useState(null); // null / "setup" / "disable"
  const [disableCode, setDisableCode] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);
  useEffect(() => { api.mypage().then(setMy).catch(fail); }, []);
  const total = my?.user?.total_points ?? 0;
  const nextMilestone = (Math.floor(total / 10) + 1) * 10;

  if (securityView === "setup") return (
    <TwoFactorSetupScreen say={say} fail={fail} mode="manage" onBack={() => setSecurityView(null)}
      onDone={() => { setSecurityView(null); setTotpEnabled(true); }} />
  );

  const disable2fa = async () => {
    setDisableBusy(true);
    try {
      await api.disable2fa(disableCode.trim());
      setTotpEnabled(false);
      setSecurityView(null);
      setDisableCode("");
      say("2段階認証を無効にしました");
    } catch (e) { fail(e); setDisableCode(""); }
    setDisableBusy(false);
  };

  return (
    <Shell title="マイページ" onBack={onBack}>
      <div className="space-y-3">
        <Card className="p-4 flex items-center gap-3">
          <span className="w-12 h-12 rounded-full bg-brand-600 text-white text-lg font-bold flex items-center justify-center">{user?.name?.[0]}</span>
          <div>
            <div className="font-bold">{user?.name}</div>
            <div className="text-xs text-slate-500">{user?.email}</div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Lock className="w-4 h-4" />2段階認証</div>
              <div className="text-xs text-slate-500 mt-0.5">{totpEnabled ? "有効になっています" : "認証アプリでログイン時のコード確認を追加できます"}</div>
            </div>
            {totpEnabled
              ? <Btn color="rose" className="shrink-0" onClick={() => setSecurityView("disable")}>無効にする</Btn>
              : <Btn className="shrink-0" onClick={() => setSecurityView("setup")}>設定する</Btn>}
          </div>
        </Card>
        {securityView === "disable" && (
          <Modal title="2段階認証を無効にする" onClose={() => { setSecurityView(null); setDisableCode(""); }}>
            <div className="space-y-3">
              <p className="text-xs text-slate-500">確認のため、現在の認証アプリのコードかバックアップコードを入力してください。</p>
              <Field label="コード">
                <input className={`${inputCls} text-center text-lg tracking-widest`} value={disableCode} autoFocus
                  onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9a-z]/gi, ""))}
                  onKeyDown={(e) => e.key === "Enter" && disableCode && disable2fa()} placeholder="123456" />
              </Field>
              <Btn color="rose" className="w-full" disabled={disableBusy || !disableCode} onClick={disable2fa}>
                {disableBusy ? "処理中..." : "2段階認証を無効にする"}
              </Btn>
            </div>
          </Modal>
        )}

        {my === null && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}

        {my && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[["参加現場数", `${my.user.sites_count}現場`], ["累計勤務時間", fmtMin(my.user.total_work_min)], ["累計ポイント", `${total}P`]].map(([k, v]) => (
                <Card key={k} className="p-3 text-center">
                  <div className="text-lg font-bold">{v}</div>
                  <div className="text-xs font-bold text-slate-500">{k}</div>
                </Card>
              ))}
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-slate-700 flex items-center gap-1.5"><Gem className="w-3.5 h-3.5" />次の10P到達まで</span>
                <span className="text-brand-700 tabular-nums">{total}P / {nextMilestone}P</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500" style={{ width: `${((total % 10) / 10) * 100}%` }} />
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><Award className="w-4 h-4" />獲得バッジ</div>
              {my.badges.length === 0 && <p className="text-xs text-slate-400">まだバッジがありません。現場に参加してポイントを獲得しましょう。</p>}
              <div className="flex flex-wrap gap-2">
                {my.badges.map((b) => (
                  <span key={b} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-sm font-bold">
                    <BadgeMark b={b} className="w-4 h-4" /><span className="text-xs font-normal text-slate-500">{BADGE_INFO[b] || ""}</span>
                  </span>
                ))}
              </div>
              <p className="text-slate-400 mt-2" style={{ fontSize: 10 }}>名前の前に表示するバッジは、各チームの「マイページ・バッジ」から選べます。</p>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><History className="w-4 h-4" />過去の参加現場</div>
              {my.history.length === 0 && <p className="text-xs text-slate-400">まだ終了した現場がありません。</p>}
              {my.history.map((h, i) => (
                <div key={i} className="py-2 border-b border-slate-50">
                  <div className="flex justify-between text-sm font-bold"><span>{h.site_name}</span><span className="text-brand-700">+{h.today_points}P</span></div>
                  <div className="text-xs text-slate-400">{h.event_date} / {h.today_rank}位</div>
                </div>
              ))}
            </Card>

            <AdSection />
          </>
        )}
      </div>
    </Shell>
  );
}

/* ================================ プラン・課金 ================================ */
function BillingScreen({ say, fail, onBack }) {
  const [billing, setBilling] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [selectedBundle, setSelectedBundle] = useState("50"); // クレジットの選択状態(デフォルトはおすすめの50回分)
  const [comingSoonFor, setComingSoonFor] = useState(""); // "" | "sub" | "credits"
  const load = () => {
    setLoadErr("");
    api.getBilling().then(setBilling).catch(() => setLoadErr("決済は現在準備中です。"));
  };
  useEffect(() => { load(); }, []);

  const selectSubscription = () => {
    if (!billing.paymentsReady) { setComingSoonFor("sub"); return; }
    subscribe();
  };
  const selectCredits = () => {
    if (!billing.paymentsReady) { setComingSoonFor("credits"); return; }
    buyCredits(selectedBundle);
  };
  const subscribe = async () => {
    setBusy("sub");
    try { const d = await api.billingCheckout({ type: "subscription" }); location.href = d.url; }
    catch (e) { say("決済は現在準備中です。しばらくお待ちください。"); setBusy(""); }
  };
  const buyCredits = async (bundle) => {
    setBusy(bundle);
    try { const d = await api.billingCheckout({ type: "credits", bundle }); location.href = d.url; }
    catch (e) { say("決済は現在準備中です。しばらくお待ちください。"); setBusy(""); }
  };
  const openPortal = async () => {
    setBusy("portal");
    try { const d = await api.billingPortal(); location.href = d.url; }
    catch (e) { say("決済は現在準備中です。しばらくお待ちください。"); setBusy(""); }
  };
  const redeem = async () => {
    if (!codeInput.trim()) return;
    setBusy("redeem");
    try { await api.redeemCode(codeInput.trim()); say("コードを利用しました。AI提案が使い放題になります!"); setCodeInput(""); load(); }
    catch (e) { fail(e); }
    setBusy("");
  };
  const exchangePoints = async () => {
    if (!confirm(`${POINT_DAY_PASS_COST}Pを消費して、AI提案が1日使い放題になるパスと交換しますか?`)) return;
    setBusy("exchange");
    try { await api.exchangePoints(); say("ポイントを交換しました。24時間、AI提案が使い放題です。"); load(); }
    catch (e) { fail(e); }
    setBusy("");
  };

  const isSubscribed = billing?.planType === "subscription" && billing?.subscriptionActive;
  const BUNDLES = [
    { key: "10", label: "10回分", price: 300, unit: 30, note: "お試しに" },
    { key: "50", label: "50回分", price: 1200, unit: 24, note: "" },
    { key: "100", label: "100回分", price: 2000, unit: 20, note: "" },
  ];
  const bestValueKey = "100";

  return (
    <Shell title="プラン・課金" onBack={onBack}>
      <div className="space-y-3">
        {billing === null && !loadErr && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
        {billing?.freeMode && (
          <Card className="p-4 border-emerald-300 bg-emerald-50">
            <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5"><PartyPopper className="w-4 h-4" />現在、チーム作成・AI提案ともに無料でご利用いただけます</div>
            <p className="text-xs text-emerald-600 mt-0.5">決済の準備が整い次第、通常のプランに移行する予定です。今は何も購入する必要はありません。</p>
          </Card>
        )}
        {loadErr && (
          <Card className="p-6 text-center space-y-3">
            <p className="text-sm text-rose-600 font-bold">{loadErr}</p>
            <Btn className="w-full" onClick={load}>もう一度読み込む</Btn>
          </Card>
        )}
        {billing && (
          <>
            {billing.compUnlimited && (
              <Card className="p-4 border-emerald-300 bg-emerald-50">
                <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5"><Gift className="w-4 h-4" />招待コードにより、AI提案が無期限で使い放題です</div>
              </Card>
            )}
            {!billing.compUnlimited && billing.dayPassActive && (
              <Card className="p-4 border-emerald-300 bg-emerald-50">
                <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5"><Coffee className="w-4 h-4" />ポイント交換の1日パス利用中</div>
                <div className="text-xs text-emerald-600 mt-0.5">{fmtHM(billing.dayPassExpiresAt)} まで有効(本日中)</div>
              </Card>
            )}

            <Card className="p-4">
              <div className="text-xs font-bold text-slate-400">現在のプラン</div>
              <div className="text-lg font-bold mt-0.5">
                {isSubscribed ? "月額プラン" : billing.planType === "credits" ? `クレジット制(残り ${billing.creditBalance} 回)` : "未契約"}
              </div>
              {isSubscribed && (
                <Btn color="slate" className="w-full mt-3" onClick={openPortal} disabled={busy === "portal"}>
                  {busy === "portal" ? "処理中..." : "契約内容を管理・解約する"}
                </Btn>
              )}
              <p className="text-xs text-emerald-600 font-bold mt-2 bg-emerald-50 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                <Gift className="w-4 h-4 shrink-0 mt-0.5" />決済準備中につき、毎月クレジット{MONTHLY_FREE_CREDITS}回分を無料で自動付与しています(月初めに反映)。
              </p>
            </Card>

            {isSubscribed && billing.teamQuota && (
              <Card className="p-4">
                <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><Folder className="w-4 h-4" />チーム作成の無料枠</div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-slate-50 rounded-lg py-2">
                    <div className="text-xs font-bold text-slate-400">本日</div>
                    <div className="font-bold tabular-nums">{billing.teamQuota.dayCount} / {billing.teamQuota.dailyLimit}件</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2">
                    <div className="text-xs font-bold text-slate-400">今月</div>
                    <div className="font-bold tabular-nums">{billing.teamQuota.monthCount} / {billing.teamQuota.monthlyLimit}件</div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">無料枠を超えた分のチーム作成は、クレジットを1件につき1消費します。</p>
              </Card>
            )}

            {!billing.paymentsReady && (
              <Card className="p-3 border-amber-200 bg-amber-50">
                <p className="text-xs font-bold text-amber-700 flex items-start gap-1.5"><Construction className="w-4 h-4 shrink-0 mt-0.5" />決済機能は現在準備中です。下記はプレビューです。プランを選んでも、実際のお支払いは今しばらくお待ちください。</p>
              </Card>
            )}

            {/* 月額プラン */}
            <Card className={`p-4 ${!isSubscribed ? "border-brand-300 ring-1 ring-brand-100" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Sparkles className="w-4 h-4" />月額プラン</div>
                {isSubscribed && <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">契約中</span>}
              </div>
              <div className="text-2xl font-bold">¥980<span className="text-sm font-normal text-slate-400">/月</span></div>
              <ul className="mt-2 space-y-1">
                {["AI提案が使い放題", "チーム作成 1日1件・月15件まで無料", "枠を超えた分はクレジットで補える", "いつでも解約可能"].map((f) => (
                  <li key={f} className="text-xs text-slate-600 flex items-center gap-1.5"><span className="text-emerald-600 font-bold">✓</span>{f}</li>
                ))}
              </ul>
              {!isSubscribed && (
                <>
                  <Btn className="w-full mt-3" onClick={selectSubscription} disabled={!!busy}>
                    {busy === "sub" ? "処理中..." : billing.paymentsReady ? "月額プランを契約する(クレジットカード)" : "このプランを選ぶ"}
                  </Btn>
                  {comingSoonFor === "sub" && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-center">
                      <div className="text-xs font-bold text-amber-800 flex items-center justify-center gap-1.5"><Construction className="w-3.5 h-3.5" />決済機能は現在準備中です</div>
                      <p className="text-xs text-amber-600 mt-0.5">クレジットカードでのお支払いは今後実装予定です。もうしばらくお待ちください。</p>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* クレジット(都度払い) */}
            <Card className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5"><Coffee className="w-4 h-4" />クレジット(都度払い)</div>
              <p className="text-xs text-slate-500 mb-3">AI提案1回、または無料枠を超えたチーム作成1件につき1クレジット消費します。有効期限はありません。クレジットカードのほかPayPayもご利用いただけます。</p>
              <div className="space-y-2">
                {BUNDLES.map((b) => (
                  <button key={b.key} onClick={() => setSelectedBundle(b.key)}
                    className={`w-full flex items-center justify-between border rounded-lg px-3 py-2.5 text-left transition ${selectedBundle === b.key ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedBundle === b.key ? "border-brand-600 bg-brand-600" : "border-slate-300"}`}>
                        {selectedBundle === b.key && <span className="w-2 h-2 rounded-full bg-white" />}
                      </span>
                      <div>
                        <div className="text-sm font-bold flex items-center gap-1.5">
                          {b.label}
                          {b.key === bestValueKey && <span className="text-xs font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" style={{ fontSize: 10 }}>おすすめ</span>}
                        </div>
                        <div className="text-xs text-slate-400">1回あたり¥{b.unit}{b.note && ` ・ ${b.note}`}</div>
                      </div>
                    </div>
                    <span className="font-bold shrink-0">¥{b.price.toLocaleString()}</span>
                  </button>
                ))}
              </div>
              <Btn className="w-full mt-3" onClick={selectCredits} disabled={!!busy}>
                {busy === selectedBundle ? "処理中..." : billing.paymentsReady ? `¥${BUNDLES.find((b) => b.key === selectedBundle).price.toLocaleString()} を購入する` : "選んだクレジットを購入する"}
              </Btn>
              {comingSoonFor === "credits" && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-center">
                  <div className="text-xs font-bold text-amber-800 flex items-center justify-center gap-1.5"><Construction className="w-3.5 h-3.5" />決済機能は現在準備中です</div>
                  <p className="text-xs text-amber-600 mt-0.5">クレジットカード・PayPayでのお支払いは今後実装予定です。それまでは上記の「毎月無料付与クレジット」「ポイント交換」「招待コード」をご利用ください。</p>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><Coffee className="w-4 h-4" />ポイントで交換</div>
              <p className="text-xs text-slate-500 mb-3">
                投票で貯まった累計ポイント(現在 <b>{billing.totalPoints}P</b>)を使って、AI提案1日使い放題パスと交換できます。1回の交換で{POINT_DAY_PASS_COST}P消費し、再利用はできません。
              </p>
              <Btn color="amber" className="w-full" onClick={exchangePoints} disabled={!!busy || billing.totalPoints < POINT_DAY_PASS_COST}>
                {busy === "exchange" ? "処理中..." : `${POINT_DAY_PASS_COST}Pを消費して1日パスと交換`}
              </Btn>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><Ticket className="w-4 h-4" />招待コードをお持ちの方</div>
              <div className="flex gap-2">
                <input className={inputCls} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="例:FRIEND-XXXXXXXX" />
                <Btn onClick={redeem} disabled={!codeInput.trim() || !!busy} className="shrink-0 py-2.5 text-sm">{busy === "redeem" ? "確認中..." : "利用する"}</Btn>
              </div>
            </Card>

            <p className="text-xs text-slate-400 px-1">お支払いはStripeを通じて安全に処理されます。領収書はStripeから自動送付されます。AI提案の実際のAPI原価は1回あたり1円未満です。</p>
          </>
        )}
      </div>
    </Shell>
  );
}

/* ================================ 管理ページ(作成者専用) ================================ */
/* 直近N日の推移を表す簡易バーチャート(外部ライブラリ不使用、ホバー/タップで日付と値を確認できる) */
function MiniBarChart({ labels, values, color, unit = "" }) {
  const max = Math.max(1, ...values);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-0.5" style={{ height: 64, minWidth: labels.length * 7 }}>
        {values.map((v, i) => (
          <div key={i} title={`${labels[i]}: ${v.toLocaleString()}${unit}`}
            className={`rounded-t ${color}`} style={{ width: 5, height: `${Math.max(2, (v / max) * 60)}px` }} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-400 mt-1 font-mono">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function AdminScreen({ say, fail, onBack }) {
  const [tab, setTab] = useState("overview"); // overview / codes / users
  const [overview, setOverview] = useState(null);
  const [codes, setCodes] = useState(null);
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "friend_unlimited", note: "", maxUses: "", expiresInDays: "", creditAmount: "" });

  const loadOverview = () => api.adminOverview().then(setOverview).catch(fail);
  const loadCodes = () => api.adminCodes().then((d) => setCodes(d.codes)).catch(fail);
  const loadUsers = () => api.adminUsers().then((d) => setUsers(d.users)).catch(fail);

  useEffect(() => {
    if (tab === "overview" && !overview) loadOverview();
    if (tab === "codes" && !codes) loadCodes();
    if (tab === "users" && !users) loadUsers();
  }, [tab]);

  const createCode = async () => {
    setBusy(true);
    try {
      const d = await api.adminCreateCode({
        kind: form.kind || "friend_unlimited",
        note: form.note,
        maxUses: form.maxUses ? parseInt(form.maxUses, 10) : null,
        expiresInDays: form.expiresInDays ? parseInt(form.expiresInDays, 10) : null,
        creditAmount: form.creditAmount ? parseInt(form.creditAmount, 10) : null,
      });
      say(`コードを発行しました: ${d.code}`);
      setForm({ kind: form.kind, note: "", maxUses: "", expiresInDays: "", creditAmount: "" });
      loadCodes();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const toggleCode = async (code, active) => {
    try { await api.adminSetCodeActive(code, active); loadCodes(); } catch (e) { fail(e); }
  };
  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); say("コードをコピーしました"); } catch (e) {}
  };

  return (
    <Shell title={<span className="flex items-center gap-1.5"><Wrench className="w-4 h-4" />管理ページ</span>} onBack={onBack}>
      <div className="space-y-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {[["overview", "概要"], ["codes", "招待コード"], ["users", "ユーザー"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${tab === k ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>{l}</button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            {!overview && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
            {overview && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["登録ユーザー数", `${overview.userCount}人`],
                    ["作成チーム数", `${overview.teamCount}件`],
                    ["有効サブスク数", `${overview.activeSubscriptions}件`],
                    ["未消化クレジット合計", `${overview.outstandingCredits}回`],
                  ].map(([k, v]) => (
                    <Card key={k} className="p-3 text-center">
                      <div className="text-lg font-bold">{v}</div>
                      <div className="text-xs font-bold text-slate-500">{k}</div>
                    </Card>
                  ))}
                </div>
                <Card className="p-4 text-center bg-emerald-50 border-emerald-200">
                  <div className="text-xs font-bold text-emerald-700">累計売上(Stripe決済実績)</div>
                  <div className="text-3xl font-bold text-emerald-800 mt-1">¥{overview.totalRevenueYen.toLocaleString()}</div>
                </Card>
                {overview.dailyStats && (
                  <Card className="p-4 space-y-4">
                    <div className="text-sm font-bold text-slate-700">直近30日の推移</div>
                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">新規登録者数(合計{overview.dailyStats.newUsers.reduce((a, b) => a + b, 0)}人)</div>
                      <MiniBarChart labels={overview.dailyStats.labels} values={overview.dailyStats.newUsers} color="bg-brand-500" unit="人" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">新規チーム作成数(合計{overview.dailyStats.newTeams.reduce((a, b) => a + b, 0)}件)</div>
                      <MiniBarChart labels={overview.dailyStats.labels} values={overview.dailyStats.newTeams} color="bg-violet-500" unit="件" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500 mb-1">売上推移(合計¥{overview.dailyStats.revenueYen.reduce((a, b) => a + b, 0).toLocaleString()})</div>
                      <MiniBarChart labels={overview.dailyStats.labels} values={overview.dailyStats.revenueYen} color="bg-emerald-500" unit="円" />
                    </div>
                  </Card>
                )}
                <Card className="overflow-hidden">
                  <div className="px-4 pt-3 pb-1"><h3 className="text-sm font-bold text-slate-700">最近の入金</h3></div>
                  <div className="divide-y divide-slate-100">
                    {overview.recentLedger.length === 0 && <p className="text-xs text-slate-400 px-4 py-3">まだ入金記録がありません。</p>}
                    {overview.recentLedger.map((l) => (
                      <div key={l.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-bold truncate">{l.detail}</div>
                          <div className="text-xs text-slate-400 font-mono truncate">{new Date(l.time).toLocaleString("ja-JP")}</div>
                        </div>
                        <div className="font-bold text-emerald-700 shrink-0 whitespace-nowrap">¥{l.amountYen.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {tab === "codes" && (
          <>
            <Card className="p-4 space-y-2">
              <div className="text-sm font-bold text-slate-700">招待コードを発行</div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {[["friend_unlimited", "友人向け無制限"], ["credit_grant", "クレジット付与"]].map(([k, l]) => (
                  <button key={k} onClick={() => setForm({ ...form, kind: k })} className={`flex-1 py-2 rounded-md text-xs font-bold leading-tight ${(form.kind || "friend_unlimited") === k ? "bg-white shadow text-brand-700" : "text-slate-500"}`}>{l}</button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {(form.kind || "friend_unlimited") === "friend_unlimited"
                  ? "このコードを使った人は、AI提案・チーム作成が無期限で使い放題になります。何人でも同じコードを使えます(1人1回まで)。"
                  : "このコードを使った人に、指定した回数分のクレジットを付与します。何人でも同じコードを使えます(1人1回まで)。"}
              </p>
              {form.kind === "credit_grant" && (
                <Field label="付与するクレジット数 *"><input type="number" className={inputCls} value={form.creditAmount} onChange={(e) => setForm({ ...form, creditAmount: e.target.value })} placeholder="例:50" /></Field>
              )}
              <Field label="メモ(任意)"><input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例:社内メンバー用" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="利用可能人数(空欄=無制限)"><input type="number" className={inputCls} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="例:10" /></Field>
                <Field label="有効期限・日数(空欄=無期限)"><input type="number" className={inputCls} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} placeholder="例:30" /></Field>
              </div>
              <Btn className="w-full" onClick={createCode} disabled={busy || (form.kind === "credit_grant" && !form.creditAmount)}>{busy ? "発行中..." : "コードを発行する"}</Btn>
            </Card>
            {!codes && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
            {codes && codes.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">まだ発行したコードがありません。</Card>}
            {codes?.map((c) => (
              <Card key={c.code} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-sm truncate">{c.code}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {c.kind === "credit_grant" ? `クレジット${c.creditAmount}回分付与` : "友人向け無制限"} / {c.note || "(メモなし)"}
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.active ? "有効" : "無効"}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1.5 break-words">
                  利用回数:{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : "(無制限)"}
                  {c.expiresAt && ` / 期限:${new Date(c.expiresAt).toLocaleDateString("ja-JP")}`}
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => copyCode(c.code)} className="text-xs font-bold text-brand-600 px-2 py-1 bg-brand-50 rounded-lg">コピー</button>
                  <button onClick={() => toggleCode(c.code, !c.active)} className={`text-xs font-bold px-2 py-1 rounded-lg ${c.active ? "text-rose-600 bg-rose-50" : "text-emerald-600 bg-emerald-50"}`}>
                    {c.active ? "無効化する" : "再度有効化する"}
                  </button>
                </div>
              </Card>
            ))}
          </>
        )}

        {tab === "users" && (
          <>
            {!users && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
            {users?.map((u) => (
              <Card key={u.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{u.name}</div>
                    <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!!u.comp_unlimited && <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded" style={{ fontSize: 10 }}>招待</span>}
                    {u.plan_type === "subscription" && !!u.subscription_active && <span className="text-xs font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded" style={{ fontSize: 10 }}>サブスク</span>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                  <div className="bg-slate-50 rounded-lg py-1.5">
                    <div className="text-slate-400 font-bold" style={{ fontSize: 10 }}>クレジット</div>
                    <div className="font-bold tabular-nums text-sm">{u.credit_balance}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-1.5">
                    <div className="text-slate-400 font-bold" style={{ fontSize: 10 }}>累計P</div>
                    <div className="font-bold tabular-nums text-sm">{u.total_points}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-1.5">
                    <div className="text-slate-400 font-bold" style={{ fontSize: 10 }}>参加現場</div>
                    <div className="font-bold tabular-nums text-sm">{u.sites_count}</div>
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </Shell>
  );
}

/* ================================ マイページ・バッジ(チーム内) ================================ */
function MyPage({ p, team, hasAccount, onSetBadge }) {
  const [my, setMy] = useState(null);
  useEffect(() => { if (hasAccount) api.mypage().then(setMy).catch(() => {}); }, [hasAccount]);
  const total = my?.user?.total_points ?? 0;
  const nextMilestone = (Math.floor(total / 10) + 1) * 10;
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg lg:text-xl px-1">マイページ</h2>
      <Card className="p-4 flex items-center gap-3">
        <span className="w-12 h-12 rounded-full bg-brand-600 text-white text-lg font-bold flex items-center justify-center">{p.name[0]}</span>
        <div>
          <div className="font-bold"><BadgeMark b={p?.displayBadge} />{dName(p)}</div>
          <RoleTag r={p.role} />
        </div>
      </Card>

      {hasAccount && my && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[["参加現場数", `${my.user.sites_count}現場`], ["累計勤務時間", fmtMin(my.user.total_work_min)], ["累計ポイント", `${total}P`]].map(([k, v]) => (
              <Card key={k} className="p-3 text-center">
                <div className="text-lg font-bold">{v}</div>
                <div className="text-xs font-bold text-slate-500">{k}</div>
              </Card>
            ))}
          </div>
          <Card className="p-4">
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <span className="text-slate-700 flex items-center gap-1.5"><Gem className="w-3.5 h-3.5" />次の10P到達まで</span>
              <span className="text-brand-700 tabular-nums">{total}P / {nextMilestone}P</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500" style={{ width: `${((total % 10) / 10) * 100}%` }} />
            </div>
            <p className="text-slate-400 mt-1" style={{ fontSize: 10 }}>10P到達ごと・MVP獲得など「良いタイミング」でバッジが付与されます。</p>
          </Card>
        </>
      )}
      {!hasAccount && (
        <Card className="p-4 text-xs text-teal-700 font-bold bg-teal-50 border-teal-200">
          ゲスト参加中です。アカウントを登録すると、ポイント・勤務時間・バッジが累計として保存されます。
        </Card>
      )}

      <Card className="p-4">
        <div className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5"><Award className="w-4 h-4" />バッジ(名前の前に表示するものを選択)</div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button onClick={() => onSetBadge("")}
            className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${p.displayBadge === "" ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
            表示なし
          </button>
          {p.badges.map((b) => (
            <button key={b} onClick={() => onSetBadge(b)}
              className={`px-3 py-2.5 rounded-xl border text-left ${p.displayBadge === b ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
              <BadgeMark b={b} className="w-5 h-5" />
              <div className="font-bold text-slate-500" style={{ fontSize: 10 }}>{BADGE_INFO[b] || ""}</div>
            </button>
          ))}
        </div>
        {p.badges.length === 0 && <p className="text-xs text-slate-400 mt-2">まだバッジがありません。投票で入賞するか、10Pを貯めて獲得しましょう。</p>}
        <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2 text-xs">
          プレビュー:<span className="font-bold ml-1"><BadgeMark b={p?.displayBadge} />{dName(p)}</span>
        </div>
      </Card>

      {team.votingClosed && p.todayRank && (
        <Card className="p-4 bg-brand-50 border-brand-200">
          <div className="text-sm font-bold text-brand-800">本日の結果 — {team.siteName}</div>
          <div className="text-xs text-brand-700 mt-1">現場内 <b>{p.todayRank}位</b>({p.todayVotes}票)/ 獲得 <b>+{p.todayPoints}P</b></div>
        </Card>
      )}

      {hasAccount && my?.history?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5"><History className="w-4 h-4" />過去の参加現場</div>
          {my.history.map((h, i) => (
            <div key={i} className="py-2 border-b border-slate-50">
              <div className="flex justify-between text-sm font-bold"><span>{h.site_name}</span><span className="text-brand-700">+{h.today_points}P</span></div>
              <div className="text-xs text-slate-400">{h.event_date} / {h.today_rank}位</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ================================ 通知 ================================ */
function NotifyScreen({ state, isAdmin, onSend, onReadAll, onRead }) {
  const [type, setType] = useState("一斉連絡");
  const [text, setText] = useState("");
  const typeStyle = { 休憩不足: "bg-rose-600 text-white", 一斉連絡: "bg-brand-600 text-white", 緊急連絡: "bg-amber-500 text-white", 休憩終了: "bg-emerald-600 text-white", バッジ獲得: "bg-violet-600 text-white" };
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg">通知</h2>
        <button onClick={onReadAll} className="text-xs font-bold text-brand-600">すべて既読</button>
      </div>
      {isAdmin && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Megaphone className="w-4 h-4" />連絡を送信(管理者)</div>
          <div className="flex gap-1">
            {["一斉連絡", "緊急連絡"].map((t) => (
              <button key={t} onClick={() => setType(t)} className={`flex-1 py-2 rounded-lg text-xs font-bold ${type === t ? (t === "緊急連絡" ? "bg-amber-500 text-white" : "bg-brand-600 text-white") : "bg-slate-100 text-slate-500"}`}>{t}</button>
            ))}
          </div>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="例:15:00から入口誘導を増員してください" />
          <Btn className="w-full" disabled={!text} onClick={() => { onSend(type, text); setText(""); }}>送信</Btn>
        </Card>
      )}
      {state.notifications.map((n) => (
        <Card key={n.id} className={`p-3 ${!n.read ? "border-brand-300" : ""}`}>
          <div className="flex items-start gap-2">
            <span className={`font-bold px-1.5 py-0.5 rounded shrink-0 ${typeStyle[n.type] || "bg-slate-500 text-white"}`} style={{ fontSize: 10 }}>{n.type}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{n.text}</div>
              <div className="text-slate-400 font-mono mt-0.5" style={{ fontSize: 10 }}>{fmtHM(n.time)}</div>
            </div>
            {!n.read && <button onClick={() => onRead(n.id)} className="text-xs font-bold text-brand-600 shrink-0">既読</button>}
          </div>
        </Card>
      ))}
      {state.notifications.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">通知はありません。</Card>}
    </div>
  );
}

/* ================================ 監査ログ ================================ */
function Audit({ logs }) {
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-lg lg:text-xl px-1">監査ログ</h2>
      <Card className="p-3 text-xs text-slate-500">管理者による修正・配置変更・権限変更・チーム削除・投票締切を記録します。<b>監査ログは削除できません。</b></Card>
      {logs === null && <Card className="p-6 text-center text-sm text-slate-400">読み込み中...</Card>}
      {logs && logs.length === 0 && <Card className="p-6 text-center text-sm text-slate-400">まだ記録がありません。</Card>}
      {logs && logs.length > 0 && (
        <Card className="divide-y divide-slate-100">
          {logs.map((a) => (
            <div key={a.id} className="px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-slate-500 tabular-nums">{fmtHM(a.time)}</span>
                <span className="text-xs font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">{a.action}</span>
                <span className="text-xs text-slate-500">対象:<b className="text-slate-700">{a.target}</b></span>
              </div>
              <div className="text-xs text-slate-500 mt-1">実行者:{a.actor}</div>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <div className="font-bold text-slate-400" style={{ fontSize: 10 }}>変更前</div>
                  <div className="text-xs">{a.before}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg px-2.5 py-1.5">
                  <div className="font-bold text-emerald-600" style={{ fontSize: 10 }}>変更後</div>
                  <div className="text-xs">{a.after}</div>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
