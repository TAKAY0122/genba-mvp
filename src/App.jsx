import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { api, store } from "./api.js";

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

const ROLE_LABEL = { owner: "オーナー", admin: "管理者", member: "メンバー", guest: "ゲスト" };
const BADGE_INFO = {
  "🏆": "MVP(現場1位)",
  "💎": "累計10P到達",
  "☕": "休憩マスター(必要休憩を充足)",
  "⚡": "初ポイント獲得",
};
const POSITION_NAMES = ["入口誘導", "チケット確認", "物販列整理", "関係者受付", "楽屋口確認", "場内巡回"];
const dName = (p) => (p?.displayBadge ? `${p.displayBadge}${p.name}` : p?.name || "");

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
  const m = { owner: "bg-violet-100 text-violet-700", admin: "bg-indigo-100 text-indigo-700", member: "bg-slate-100 text-slate-600", guest: "bg-teal-100 text-teal-700" };
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${m[r] || ""}`}>{ROLE_LABEL[r] || r}</span>;
};

/* ---------- 共通UI ---------- */
const Card = ({ children, className = "", onClick }) => (
  <div onClick={onClick} className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
);
const Btn = ({ children, onClick, color = "indigo", disabled, className = "", big }) => {
  const map = {
    indigo: "bg-indigo-600 hover:bg-indigo-700 text-white",
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
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold">✕</button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);
const Field = ({ label, children }) => (
  <div><label className="text-xs font-bold text-slate-500">{label}</label><div className="mt-1">{children}</div></div>
);
const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

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
  const [toast, setToast] = useState("");
  const say = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2800); }, []);
  const fail = useCallback((e) => say(e.message || "エラーが発生しました。"), [say]);

  useEffect(() => {
    (async () => {
      const m = location.pathname.match(/^\/join\/([A-Za-z0-9-]+)/);
      if (m) { setJoinCode(m[1]); setPhase("join"); return; }
      if (store.getSession()) {
        try { const d = await api.me(); setUser(d.user); setPhase("teams"); return; } catch (e) { store.setSession(null); }
      }
      // ゲスト: 参加済みチームがあれば復帰
      const pt = store.getPTokens();
      const ids = Object.keys(pt);
      if (ids.length > 0) { setTeamId(ids[ids.length - 1]); setPhase("team"); return; }
      setPhase("login");
    })();
  }, []);

  const openTeam = (id) => { setTeamId(id); setPhase("team"); };
  const logout = async () => { await api.logout(); store.setSession(null); setUser(null); setTeamId(null); setPhase("login"); };

  if (phase === "boot") return <Splash />;
  if (phase === "login") return <AuthScreen say={say} fail={fail} onLoggedIn={(u) => { setUser(u); setPhase("teams"); }} onGuestCode={(code) => { setJoinCode(code); setPhase("join"); }} />;
  if (phase === "join") return <JoinScreen code={joinCode} user={user} say={say} fail={fail}
    onJoined={(tid) => openTeam(tid)}
    onBack={() => setPhase(user ? "teams" : "login")} />;
  if (phase === "teams") return <TeamsScreen user={user} say={say} fail={fail} openTeam={openTeam}
    onJoinByCode={(code) => { setJoinCode(code); setPhase("join"); }} logout={logout} />;
  return <TeamApp teamId={teamId} user={user} say={say} fail={fail} toast={toast}
    exitTeam={() => setPhase(user ? "teams" : "login")} logout={logout} />;
}

const Splash = () => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center">
    <div className="text-white font-bold animate-pulse">読み込み中...</div>
  </div>
);

/* ================================ ログイン / 新規登録 ================================ */
function AuthScreen({ say, fail, onLoggedIn, onGuestCode }) {
  const [tab, setTab] = useState("login");
  const [f, setF] = useState({ email: "", password: "", name: "", code: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const d = tab === "login" ? await api.login(f) : await api.register(f);
      store.setSession(d.token);
      say(tab === "login" ? "ログインしました" : "アカウントを作成しました");
      onLoggedIn(d.user);
    } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4" style={{ fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-600 text-white items-center justify-center text-2xl font-bold mb-3">◎</div>
          <h1 className="text-xl font-bold text-white">現場運営支援システム</h1>
          <p className="text-xs text-slate-400 mt-1">勤務・休憩・配置・投票をリアルタイムに。</p>
        </div>
        <div className="bg-white rounded-2xl p-5">
          <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1">
            {[["login", "ログイン"], ["register", "新規登録"], ["guest", "コード参加"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-md text-xs font-bold ${tab === k ? "bg-white shadow text-indigo-700" : "text-slate-500"}`}>{l}</button>
            ))}
          </div>
          {tab === "guest" ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">QRコードを読み取るか、チームコードを入力して参加します(アカウント不要)。</p>
              <Field label="チームコード"><input className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="例:A1B2C3D4" /></Field>
              <Btn className="w-full" disabled={!f.code} onClick={() => onGuestCode(f.code.trim())}>参加画面へ →</Btn>
            </div>
          ) : (
            <div className="space-y-3">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================ チーム一覧 / 作成 ================================ */
function TeamsScreen({ user, say, fail, openTeam, onJoinByCode, logout }) {
  const [teams, setTeams] = useState(null);
  const [view, setView] = useState("list"); // list / create / share
  const [created, setCreated] = useState(null);
  const load = async () => { try { const d = await api.myTeams(); setTeams(d.teams); } catch (e) { fail(e); } };
  useEffect(() => { load(); }, []);

  if (view === "create") return (
    <Shell title="チーム作成" onBack={() => setView("list")}>
      <CreateTeamForm fail={fail} onCreated={(t) => { setCreated(t); setView("share"); say("チームを作成しました"); load(); }} />
    </Shell>
  );
  if (view === "share" && created) return (
    <Shell title="参加用QR / URL" onBack={() => setView("list")}>
      <ShareCard team={created} onOpenJoin={() => onJoinByCode(created.code)} say={say} />
    </Shell>
  );
  return (
    <Shell title="チーム一覧" right={<button onClick={logout} className="text-xs font-bold text-rose-600">ログアウト</button>}>
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
        <p className="text-xs text-slate-400 px-1">ログイン中:{user?.name}({user?.email})</p>
      </div>
    </Shell>
  );
}

const Shell = ({ title, children, onBack, right }) => (
  <div className="min-h-screen bg-slate-100" style={{ fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif" }}>
    <header className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="max-w-lg mx-auto flex items-center gap-2 px-3 py-3">
        {onBack && <button onClick={onBack} className="w-9 h-9 rounded-lg bg-slate-800 font-bold">←</button>}
        <div className="flex-1 font-bold">{title}</div>
        {right}
      </div>
    </header>
    <main className="max-w-lg mx-auto p-3">{children}</main>
  </div>
);

function CreateTeamForm({ fail, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ siteName: "", venueName: "", section: "", date: today });
  const [busy, setBusy] = useState(false);
  const ok = f.siteName && f.venueName && f.date;
  const submit = async () => {
    setBusy(true);
    try { const d = await api.createTeam(f); onCreated({ ...d.team, date: f.date }); } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <Card className="p-4 space-y-3">
      <Field label="現場名 *"><input className={inputCls} value={f.siteName} onChange={(e) => setF({ ...f, siteName: e.target.value })} placeholder="例:AAA LIVE 大阪公演" /></Field>
      <Field label="会場名 *"><input className={inputCls} value={f.venueName} onChange={(e) => setF({ ...f, venueName: e.target.value })} placeholder="例:大阪城ホール" /></Field>
      <Field label="セクション名(任意)"><input className={inputCls} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="例:運営" /></Field>
      <Field label="開催日 *"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Btn className="w-full" big disabled={!ok || busy} onClick={submit}>{busy ? "作成中..." : "チームを作成して共有URLを発行"}</Btn>
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
            <div className="bg-indigo-50 rounded-lg px-3 py-2 text-xs text-indigo-800">
              予定勤務 <b>{fmtMin(planMin)}</b> → 必要休憩 <b>{req}分</b>
              <div className="mt-0.5 text-indigo-500" style={{ fontSize: 10 }}>予定開始時刻になると自動的に「勤務中」になります。</div>
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
function TeamApp({ teamId, user, say, fail, toast, exitTeam, logout }) {
  const [state, setState] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [route, setRoute] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [ai, setAi] = useState({ list: null, loading: false, note: "" });
  const [auditLogs, setAuditLogs] = useState(null);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.state(teamId);
      setState(d);
      setLoadErr("");
      if (route === null) setRoute(d.me.role === "owner" || d.me.role === "admin" ? "cc" : "member");
    } catch (e) { setLoadErr(e.message); }
  }, [teamId, route]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(clock); };
  }, [refresh]);

  /* API呼び出し共通ラッパ: 実行→即時再取得 */
  const run = async (fn, okMsg) => {
    try { await fn(); if (okMsg) say(okMsg); await refresh(); } catch (e) { fail(e); await refresh(); }
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

  if (loadErr && !state) return (
    <Shell title="エラー" onBack={exitTeam}><Card className="p-6 text-center text-sm text-rose-600 font-bold">{loadErr}</Card></Shell>
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
      setAi({ list: d.suggestions, loading: false, note: d.source === "ai" ? "AI(Claude)が現場状況を分析した提案です。" : "ルールベースの自動提案です(AIキー未設定または接続失敗)。" });
    } catch (e) { setAi({ list: [], loading: false, note: e.message }); }
  };
  const applySuggestion = (s) => run(
    () => api.addAssign(teamId, { pid: s.pid, start: s.start, end: s.end, name: s.name || "休憩予定", note: "AI提案より適用" }),
    "提案を配置に適用しました"
  ).then(() => setAi((a) => ({ ...a, list: (a.list || []).filter((x) => x !== s) })));

  const loadAudit = async () => { try { const d = await api.auditLogs(teamId); setAuditLogs(d.logs); } catch (e) { fail(e); } };

  const NAV = [
    ...(isAdmin ? [{ id: "cc", label: "Command Center", icon: "◎" }] : []),
    { id: "member", label: "マイ勤務", icon: "🙋" },
    { id: "chat", label: "チャット", icon: "💬" },
    ...(isAdmin ? [{ id: "ai", label: "AI提案", icon: "✨" }] : []),
    ...(isAdmin ? [{ id: "dash", label: "参加者一覧(詳細)", icon: "📋" }] : []),
    { id: "timeline", label: "タイムライン", icon: "📊" },
    ...(isAdmin ? [{ id: "assign", label: "配置管理", icon: "📍" }] : []),
    { id: "vote", label: "ポイント投票", icon: "🗳" },
    { id: "voteResult", label: "ポイント結果", icon: "🏆" },
    { id: "notify", label: "通知", icon: "🔔" },
    { id: "mypage", label: "マイページ・バッジ", icon: "🪪" },
    ...(isAdmin ? [{ id: "share", label: "QR/URLで招待", icon: "📱" }] : []),
    ...(isAdmin ? [{ id: "audit", label: "監査ログ", icon: "📜" }] : []),
  ];
  const BOTTOM = isAdmin ? ["cc", "member", "assign", "chat"] : ["member", "timeline", "chat", "vote"];

  const goto = (r) => { setRoute(r); if (r === "audit") loadAudit(); };

  const screens = {
    cc: <CommandCenter team={team} now={now} kpi={kpi} enriched={enriched} posSummary={posSummary} state={state} setRoute={goto}
      ai={ai} runAI={runAI} applySuggestion={applySuggestion}
      onBreakEnd={(pid) => run(() => api.breakEnd(teamId, pid), "勤務に戻しました")} />,
    member: me && <MemberScreen p={me} now={now} team={team} setRoute={goto}
      onBreakStart={() => run(() => api.breakStart(teamId, me.id), "休憩を開始しました")}
      onBreakEnd={() => run(() => api.breakEnd(teamId, me.id), "勤務に戻りました")}
      onCheckout={() => run(() => api.checkout(teamId, me.id), "退勤を記録しました")} />,
    chat: <ChatScreen state={state} me={state.me} now={now}
      onSend={(text) => run(() => api.sendChat(teamId, text))} />,
    ai: <AIScreen ai={ai} runAI={runAI} applySuggestion={applySuggestion} />,
    dash: <Dashboard enriched={enriched} isOwner={isOwner} votingClosed={team.votingClosed} setRoute={goto} setModal={setModal}
      onCheckout={(pid, name) => { if (confirm(`${name} を代理退勤させますか?(監査ログに記録)`)) run(() => api.checkout(teamId, pid), "代理退勤を記録しました"); }}
      onToggleRole={(pid) => run(() => api.toggleRole(teamId, pid), "権限を変更しました")}
      onNotifyShorts={(shorts) => run(async () => { for (const p of shorts) await api.sendNotify(teamId, { type: "休憩不足", text: `${p.name}さんの休憩が不足しています(残り${p.remain}分)` }); }, "休憩不足通知を送信しました")}
      onCloseVoting={() => { if (confirm("現場を終了し、ポイント投票を締め切りますか?")) run(() => api.closeVoting(teamId), "投票を締め切りました"); }}
      onDeleteTeam={() => { if (confirm("チームを削除しますか?(監査ログは削除されません)")) run(() => api.deleteTeam(teamId), "チームを削除しました").then(exitTeam); }} />,
    assign: <AssignScreen enriched={enriched} now={now} setModal={setModal}
      onDelete={(aid) => { if (confirm("この配置を削除しますか?")) run(() => api.delAssign(teamId, aid), "配置を削除しました"); }} />,
    timeline: <Timeline enriched={enriched} now={now} team={team} />,
    vote: <Vote me={state.me} enriched={enriched} voting={state.voting} setRoute={goto}
      onVote={(target) => run(() => api.vote(teamId, target), "投票しました(1人1回)")} />,
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
    <div className="min-h-screen bg-slate-100 text-slate-900" style={{ fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif" }}>
      <header className="sticky top-0 z-40 bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto flex items-center gap-2 px-3 py-2.5">
          <button onClick={() => setMenuOpen(true)} className="w-9 h-9 rounded-lg bg-slate-800 text-lg">☰</button>
          <div className="flex-1 min-w-0">
            <div className="text-slate-400 leading-none" style={{ fontSize: 10 }}>現場運営支援システム</div>
            <div className="text-sm font-bold truncate">{team.siteName}</div>
          </div>
          <div className="text-lg font-mono font-bold tabular-nums">{fmtHM(now)}</div>
          <button onClick={() => goto("notify")} className="relative w-9 h-9 rounded-lg bg-slate-800">🔔
            {unread > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-bold rounded-full flex items-center justify-center" style={{ fontSize: 10, minWidth: 17, height: 17 }}>{unread}</span>}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto flex">
        <nav className="hidden lg:block w-56 shrink-0 py-4 pl-3">
          <div className="bg-white rounded-xl border border-slate-200 p-2 sticky top-16">
            <div className="px-3 py-2 mb-1 border-b border-slate-100">
              <div className="text-sm font-bold">{dName(me)}</div>
              <RoleTag r={state.me.role} />
            </div>
            {NAV.map((n) => (
              <button key={n.id} onClick={() => goto(n.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold mb-0.5 ${route === n.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                <span className="w-5 text-center">{n.icon}</span>{n.label}
              </button>
            ))}
            <button onClick={exitTeam} className="w-full px-3 py-2 rounded-lg text-sm font-bold text-slate-500 hover:bg-slate-100 text-left">↩ チーム一覧へ</button>
            {user && <button onClick={logout} className="w-full px-3 py-2 rounded-lg text-sm font-bold text-rose-600 hover:bg-rose-50 text-left">ログアウト</button>}
          </div>
        </nav>
        <main className="flex-1 min-w-0 p-3 pb-24 lg:pb-6">{screens[route] || screens.member}</main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 flex" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {BOTTOM.map((id) => {
          const n = NAV.find((x) => x.id === id);
          if (!n) return null;
          return (
            <button key={id} onClick={() => goto(id)} className={`flex-1 py-2 flex flex-col items-center gap-0.5 font-bold ${route === id ? "text-indigo-600" : "text-slate-400"}`} style={{ fontSize: 10 }}>
              <span className="text-lg leading-none">{n.icon}</span>{n.label.replace("管理", "").replace("ポイント", "").replace("Command Center", "現場")}
            </button>
          );
        })}
        <button onClick={() => setMenuOpen(true)} className="flex-1 py-2 flex flex-col items-center gap-0.5 font-bold text-slate-400" style={{ fontSize: 10 }}>
          <span className="text-lg leading-none">☰</span>メニュー
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50" onClick={() => setMenuOpen(false)}>
          <div className="w-72 h-full bg-white p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 pb-3 mb-2 border-b border-slate-100">
              <span className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">{me?.name?.[0]}</span>
              <div>
                <div className="text-sm font-bold">{dName(me)}</div>
                <RoleTag r={state.me.role} />
              </div>
            </div>
            {NAV.map((n) => (
              <button key={n.id} onClick={() => { goto(n.id); setMenuOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-bold ${route === n.id ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                <span className="w-5 text-center">{n.icon}</span>{n.label}
              </button>
            ))}
            <button onClick={() => { exitTeam(); setMenuOpen(false); }} className="w-full mt-3 px-3 py-2.5 rounded-lg text-sm font-bold text-slate-600 bg-slate-100">↩ チーム一覧へ</button>
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

      {toast && <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm font-bold px-4 py-2.5 rounded-full shadow-lg text-center" style={{ zIndex: 60, maxWidth: "90vw" }}>{toast}</div>}
    </div>
  );
}

/* ================================ Command Center ================================ */
function CommandCenter({ team, now, kpi, enriched, posSummary, state, setRoute, ai, runAI, applySuggestion, onBreakEnd }) {
  useEffect(() => { if (!ai.list && !ai.loading) runAI(); }, []); // 初回自動分析
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
          <button key={k} onClick={() => setRoute("dash")} className="bg-white rounded-xl border border-slate-200 py-2.5 text-center active:scale-95 transition">
            <div className={`text-2xl font-bold tabular-nums ${c}`}>{v}</div>
            <div className="font-bold text-slate-500" style={{ fontSize: 10 }}>{k}</div>
          </button>
        ))}
      </div>

      {alerts.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">🚨 アラート</h3>
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
        <div className="px-4 pt-3 pb-1 flex items-center justify-between bg-violet-50">
          <h3 className="text-sm font-bold text-violet-800">✨ AI提案</h3>
          <div className="flex gap-2 items-center pb-1">
            <button onClick={runAI} disabled={ai.loading} className="text-xs font-bold text-violet-700 disabled:opacity-40">{ai.loading ? "分析中..." : "🔄 再分析"}</button>
            <button onClick={() => setRoute("ai")} className="text-xs font-bold text-violet-700">すべて見る</button>
          </div>
        </div>
        <div className="p-3 space-y-2">
          {ai.loading && <p className="text-xs text-slate-400 px-1">AIが現場状況を分析しています...</p>}
          {!ai.loading && (ai.list || []).slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-base mt-0.5">{s.kind === "break" ? "☕" : s.kind === "assign" ? "📍" : "💡"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{s.title}</div>
                <div className="text-xs text-slate-500">{s.detail}</div>
              </div>
              {(s.kind === "break" || s.kind === "assign") && s.pid && (
                <Btn color="violet" onClick={() => applySuggestion(s)} className="py-1.5 text-xs shrink-0">適用</Btn>
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">📍 現在の配置</h3>
            <button onClick={() => setRoute("assign")} className="text-xs font-bold text-indigo-600">配置管理へ</button>
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
                      {p.displayBadge}{p.name.split(" ")[0]}
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
            <h3 className="text-sm font-bold text-slate-700">🙋 スタッフ状況</h3>
            <button onClick={() => setRoute("dash")} className="text-xs font-bold text-indigo-600">詳細一覧</button>
          </div>
          <div className="p-3 space-y-1.5 overflow-y-auto" style={{ maxHeight: 280 }}>
            {enriched.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{dName(p)}</div>
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
            <h3 className="text-sm font-bold text-slate-700">💬 チャット</h3>
            <button onClick={() => setRoute("chat")} className="text-xs font-bold text-indigo-600">開く</button>
          </div>
          <div className="p-3 space-y-1.5">
            {state.chat.slice(-3).map((m) => {
              const p = state.participants.find((x) => x.id === m.pid);
              return (
                <div key={m.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-bold">{dName(p)}</span>
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
            <h3 className="text-sm font-bold text-slate-700">🔔 通知</h3>
            <button onClick={() => setRoute("notify")} className="text-xs font-bold text-indigo-600">通知センターへ</button>
          </div>
          <div className="p-3 space-y-1.5">
            {state.notifications.slice(0, 4).map((n) => (
              <div key={n.id} className={`text-xs rounded-lg px-3 py-2 ${n.read ? "bg-slate-50 text-slate-500" : "bg-indigo-50 text-slate-700"}`}>
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
function AIScreen({ ai, runAI, applySuggestion }) {
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg">✨ AI提案</h2>
        <Btn color="violet" onClick={runAI} disabled={ai.loading}>{ai.loading ? "分析中..." : "🔄 現場を再分析"}</Btn>
      </div>
      <Card className="p-3 text-xs text-slate-500">
        現在の勤務・休憩・配置状況をAIが分析し、休憩不足の解消などを提案します。「適用」で配置(休憩予定含む)として登録され、監査ログに残ります。
      </Card>
      {ai.note && <p className="text-xs text-violet-600 font-bold px-1">{ai.note}</p>}
      {ai.loading && <Card className="p-6 text-center text-sm text-slate-400"><div className="text-2xl mb-2">🤖</div>AIが現場状況を分析しています...</Card>}
      {!ai.loading && !ai.list && <Card className="p-6 text-center text-sm text-slate-400">「現場を再分析」を押すと提案が表示されます。</Card>}
      {!ai.loading && (ai.list || []).map((s, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{s.kind === "break" ? "☕" : s.kind === "assign" ? "📍" : "💡"}</span>
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
      ))}
      <p className="text-slate-400 px-1" style={{ fontSize: 10 }}>※AI提案は参考情報です。最終判断は現場責任者が行ってください。</p>
    </div>
  );
}

/* ================================ チャット ================================ */
function ChatScreen({ state, me, onSend }) {
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [state.chat.length]);
  const send = () => { if (text.trim()) { onSend(text.trim()); setText(""); } };
  const stamps = ["了解です👍", "急行します🏃", "休憩入ります☕", "戻りました✅", "応援お願いします🙏"];
  return (
    <div className="max-w-md mx-auto flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
      <h2 className="font-bold text-lg px-1 mb-2">💬 チームチャット</h2>
      <Card className="flex-1 overflow-hidden p-3">
        <div ref={boxRef} className="h-full overflow-y-auto space-y-3">
          {state.chat.map((m) => {
            const p = state.participants.find((x) => x.id === m.pid);
            const mine = m.pid === me.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div style={{ maxWidth: "80%" }}>
                  {!mine && <div className="text-xs font-bold text-slate-500 mb-0.5">{dName(p)}</div>}
                  <div className={`px-3 py-2 rounded-2xl text-sm ${mine ? "bg-indigo-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md"}`}>{m.text}</div>
                  <div className={`text-slate-400 font-mono mt-0.5 ${mine ? "text-right" : ""}`} style={{ fontSize: 10 }}>{fmtHM(m.time)}</div>
                </div>
              </div>
            );
          })}
          {state.chat.length === 0 && <p className="text-xs text-slate-400 text-center pt-8">最初のメッセージを送ってみましょう。</p>}
        </div>
      </Card>
      <div className="flex gap-1 overflow-x-auto py-2">
        {stamps.map((s) => (
          <button key={s} onClick={() => onSend(s)} className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-600">{s}</button>
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
        <div className="font-bold text-lg mt-0.5">{dName(p)}</div>
        <div className={`inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full font-bold ${st.bg} ${st.tx}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{p.status}
          {p.status === "休憩中" && open && <span className="text-xs font-normal">({fmtMin(minDiff(open.start, now))}経過)</span>}
        </div>
        <div className="text-xs text-slate-500 mt-2 font-mono">予定 {fmtHM(p.planStart)}–{fmtHM(p.planEnd)}{p.checkOut && ` / 退勤 ${fmtHM(p.checkOut)}`}</div>
        {!p.checkOut && p.status !== "開始前" && (
          <div className="grid grid-cols-1 gap-2 mt-4">
            {p.status === "休憩中" ? (
              <Btn big color="emerald" onClick={onBreakEnd}>▶ 勤務に戻る</Btn>
            ) : (
              <Btn big color="amber" onClick={onBreakStart}>☕ 休憩開始</Btn>
            )}
            <Btn big color="rose" onClick={() => { if (confirm("退勤を記録しますか?")) onCheckout(); }}>🏁 退勤する</Btn>
          </div>
        )}
        {p.status === "開始前" && (
          <div className="mt-4 bg-sky-50 rounded-xl px-4 py-3 text-sm text-sky-700 font-bold">
            {fmtHM(p.planStart)} になると自動的に勤務中になります(あと{fmtMin(minDiff(now, p.planStart))})
          </div>
        )}
        {p.checkOut && (
          <div className="mt-4 bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-500 font-bold">本日はお疲れさまでした。
            <Btn className="w-full mt-2" onClick={() => setRoute("vote")}>🗳 ポイント投票へ</Btn>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-slate-700">☕ 休憩状況</span>
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
        <div className="text-sm font-bold text-slate-700 mb-2">📍 自分の配置</div>
        {p.myAssigns.length === 0 && <p className="text-xs text-slate-400">配置はまだ登録されていません。</p>}
        {p.myAssigns.map((a) => {
          const cur = now >= a.start && now < a.end;
          const past = now >= a.end;
          return (
            <div key={a.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 ${cur ? "bg-indigo-600 text-white" : past ? "bg-slate-50 text-slate-400" : "bg-slate-50"}`}>
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
function Dashboard({ enriched, isOwner, votingClosed, setRoute, setModal, onCheckout, onToggleRole, onNotifyShorts, onCloseVoting, onDeleteTeam }) {
  const shorts = enriched.filter((p) => p.shortage);
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-lg px-1">参加者一覧(詳細)</h2>
      {shorts.length > 0 && (
        <Card className="p-3 border-rose-300 bg-rose-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-rose-700">🚨 休憩不足 {shorts.length}名</span>
            <Btn color="rose" onClick={() => onNotifyShorts(shorts)} className="py-1.5 text-xs">不足者へ通知</Btn>
          </div>
        </Card>
      )}
      <Card className="divide-y divide-slate-100">
        {enriched.map((p) => (
          <div key={p.id} className={`px-4 py-3 ${p.shortage ? "bg-rose-50" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">{dName(p)}</span>
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
              <button onClick={() => setModal({ type: "editRecord", id: p.id })} className="text-xs font-bold text-indigo-600 px-2 py-1 bg-indigo-50 rounded-lg">履歴修正</button>
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
          <Btn className="w-full" onClick={onCloseVoting}>🗳 投票を締め切り結果を確定する</Btn>
        ) : (
          <Btn color="slate" className="w-full" onClick={() => setRoute("voteResult")}>🏆 ポイント結果を見る</Btn>
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
            <button onClick={() => setBrs([...brs, { s: fmtHM(now), e: "" }])} className="text-xs font-bold text-indigo-600">＋追加</button>
          </div>
          {brs.map((b, i) => (
            <div key={i} className="flex items-center gap-2 mt-1.5">
              <input type="time" className={inputCls} value={b.s} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, s: e.target.value } : x)))} />
              <span className="text-slate-400">〜</span>
              <input type="time" className={inputCls} value={b.e} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, e: e.target.value } : x)))} />
              <button onClick={() => setBrs(brs.filter((_, j) => j !== i))} className="text-rose-500 font-bold px-1">✕</button>
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
function AssignScreen({ enriched, now, setModal, onDelete }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg">配置管理</h2>
        <Btn onClick={() => setModal({ type: "assignForm", init: null })}>＋ 配置を登録</Btn>
      </div>
      {enriched.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-bold text-sm flex-1">{dName(p)}</span>
            <Badge s={p.status} />
            <span className="text-xs text-indigo-700 font-bold">{p.curAssign ? `現在:${p.curAssign.name}` : "現在:—"}</span>
          </div>
          {p.myAssigns.length === 0 && <p className="text-xs text-slate-400">配置なし</p>}
          {p.myAssigns.map((a) => {
            const cur = now >= a.start && now < a.end;
            return (
              <div key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 ${cur ? "bg-indigo-50 border border-indigo-200" : "bg-slate-50"}`}>
                <span className="font-mono text-xs tabular-nums w-24 shrink-0">{fmtHM(a.start)}–{fmtHM(a.end)}</span>
                <span className="text-sm font-bold flex-1 min-w-0 truncate">{a.name}{a.note && <span className="text-xs font-normal text-slate-400 ml-1">({a.note})</span>}</span>
                <button onClick={() => setModal({ type: "assignForm", init: a })} className="text-xs font-bold text-indigo-600 px-1.5">編集</button>
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
              <button key={n} onClick={() => setF({ ...f, name: n })} className={`text-xs font-bold px-2 py-1 rounded-full ${f.name === n ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>{n}</button>
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

/* ================================ タイムライン ================================ */
function Timeline({ enriched, now, team }) {
  const H0 = dateT(team.date, "06:00"), H1 = dateT(team.date, "23:59");
  const pct = (t) => Math.min(100, Math.max(0, ((t - H0) / (H1 - H0)) * 100));
  const hours = Array.from({ length: 10 }, (_, i) => 6 + i * 2);
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-lg px-1">タイムライン</h2>
      <div className="flex flex-wrap gap-3 px-1 text-xs font-bold text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-emerald-200 border border-emerald-400" />勤務予定</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-indigo-500" />配置</span>
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
                <div className="text-xs font-bold truncate">{dName(p)}</div>
                <Badge s={p.status} />
              </div>
              <div className="relative flex-1 h-9 bg-slate-50 rounded-lg overflow-hidden">
                <div className="absolute top-1 bottom-1 rounded bg-emerald-100 border border-emerald-300"
                  style={{ left: `${pct(p.planStart)}%`, width: `${pct(p.checkOut ?? p.planEnd) - pct(p.planStart)}%` }} />
                {p.myAssigns.map((a) => (
                  <div key={a.id} className="absolute flex items-center justify-center text-white font-bold rounded bg-indigo-500 overflow-hidden"
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
              <span className="font-bold text-sm flex-1">{dName(p)}</span>
              <Badge s={p.status} />
            </div>
            <div className="font-mono text-xs text-slate-500 mt-0.5">勤務予定 {fmtHM(p.planStart)}–{fmtHM(p.planEnd)}{p.checkOut && ` / 退勤 ${fmtHM(p.checkOut)}`}</div>
            <div className="relative h-3 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div className="absolute top-0 bottom-0 bg-emerald-200" style={{ left: `${pct(p.planStart)}%`, width: `${pct(p.checkOut ?? p.planEnd) - pct(p.planStart)}%` }} />
              {p.myAssigns.map((a) => (
                <div key={a.id} className="absolute top-0 bottom-0 bg-indigo-500 opacity-80" style={{ left: `${pct(a.start)}%`, width: `${pct(a.end) - pct(a.start)}%` }} />
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
                  <span className="font-bold text-indigo-700">{a.name}</span>
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
      <div className="text-3xl">🏆</div>
      <div className="font-bold">投票は締め切られました</div>
      <Btn className="w-full" onClick={() => setRoute("voteResult")}>結果を見る</Btn>
    </Card>
  );
  if (voting.myVote) return (
    <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
      <div className="text-3xl">✅</div>
      <div className="font-bold">投票済みです(1人1回)</div>
      <p className="text-xs text-slate-500">結果は投票締切後に公開されます。</p>
      <Btn color="slate" className="w-full" onClick={() => setRoute("voteResult")}>結果ページへ</Btn>
    </Card>
  );
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg px-1">🗳 ポイント投票</h2>
      <Card className="p-3 text-xs text-slate-500">
        今日いちばん活躍したと思う人を<b>1人だけ</b>選んで投票してください(自分は選べません)。
        得票数の順位に応じてポイントを獲得できます:<b>1位3P / 2位2P / 3位1P</b>。
      </Card>
      <div className="space-y-2">
        {candidates.map((p) => (
          <button key={p.id} onClick={() => setPick(p.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition ${pick === p.id ? "border-indigo-600 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`}>
            <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${pick === p.id ? "border-indigo-600 bg-indigo-600" : "border-slate-300"}`}>
              {pick === p.id && <span className="w-2 h-2 rounded-full bg-white" />}
            </span>
            <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">{p.name[0]}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{dName(p)}</div>
              <div className="text-xs text-slate-400">{p.curAssign?.name || "配置なし"} / {ROLE_LABEL[p.role]}</div>
            </div>
          </button>
        ))}
      </div>
      <Btn big className="w-full" disabled={!pick} onClick={() => onVote(pick)}>この人に投票する(1人1回)</Btn>
    </div>
  );
}

/* ================================ ポイント結果 ================================ */
function VoteResult({ state, enriched, isAdmin, me, onCloseVoting }) {
  if (!state.voting.closed) return (
    <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
      <div className="text-3xl">⏳</div>
      <div className="font-bold">投票受付中</div>
      <p className="text-xs text-slate-500">{state.voting.votedCount} / {enriched.length} 名が投票済み。結果は締切後に公開されます。</p>
      {isAdmin && <Btn className="w-full" onClick={onCloseVoting}>投票を締め切る(管理者)</Btn>}
    </Card>
  );
  const results = [...enriched].sort((a, b) => (a.todayRank || 999) - (b.todayRank || 999));
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const top3 = results.filter((r) => r.todayRank <= 3 && r.todayVotes > 0).slice(0, 3);
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg px-1">🏆 ポイント結果</h2>
      <div className="grid grid-cols-3 gap-2">
        {top3.map((p) => (
          <Card key={p.id} className={`p-3 text-center ${p.todayRank === 1 ? "border-amber-300 bg-amber-50" : ""}`}>
            <div className="text-2xl">{medal[p.todayRank]}</div>
            <div className="font-bold text-sm mt-1 truncate">{dName(p)}</div>
            <div className="text-xs text-slate-400">{p.todayVotes}票</div>
            <div className="text-lg font-bold text-indigo-700 tabular-nums">+{p.todayPoints}P</div>
          </Card>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {results.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${p.id === me.id ? "bg-indigo-50" : ""}`}>
            <span className="w-9 text-center font-bold text-slate-400 tabular-nums">{p.todayRank}位</span>
            <span className="flex-1 font-bold text-sm truncate">{dName(p)}{p.id === me.id && <span className="text-xs text-indigo-600 ml-1">(自分)</span>}</span>
            <span className="text-xs text-slate-400">{p.todayVotes}票</span>
            <span className="font-bold text-indigo-700 tabular-nums w-10 text-right">{p.todayPoints > 0 ? `+${p.todayPoints}P` : "—"}</span>
          </div>
        ))}
      </Card>
      <Card className="p-3 text-xs text-slate-500">
        1位=🏆MVP、初ポイント=⚡、累計10P到達=💎のバッジが自動付与されます。マイページで名前の前に表示するバッジを選べます。アカウント保有者はポイントが累計へ加算されます。
      </Card>
    </div>
  );
}

/* ================================ マイページ・バッジ ================================ */
function MyPage({ p, team, hasAccount, onSetBadge }) {
  const [my, setMy] = useState(null);
  useEffect(() => { if (hasAccount) api.mypage().then(setMy).catch(() => {}); }, [hasAccount]);
  const total = my?.user?.total_points ?? 0;
  const nextMilestone = (Math.floor(total / 10) + 1) * 10;
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <h2 className="font-bold text-lg px-1">マイページ</h2>
      <Card className="p-4 flex items-center gap-3">
        <span className="w-12 h-12 rounded-full bg-indigo-600 text-white text-lg font-bold flex items-center justify-center">{p.name[0]}</span>
        <div>
          <div className="font-bold">{dName(p)}</div>
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
              <span className="text-slate-700">💎 次の10P到達まで</span>
              <span className="text-indigo-700 tabular-nums">{total}P / {nextMilestone}P</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${((total % 10) / 10) * 100}%` }} />
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
        <div className="text-sm font-bold text-slate-700 mb-1">🎖 バッジ(名前の前に表示するものを選択)</div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button onClick={() => onSetBadge("")}
            className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${p.displayBadge === "" ? "border-indigo-600 bg-indigo-50" : "border-slate-200"}`}>
            表示なし
          </button>
          {p.badges.map((b) => (
            <button key={b} onClick={() => onSetBadge(b)}
              className={`px-3 py-2.5 rounded-xl border text-left ${p.displayBadge === b ? "border-indigo-600 bg-indigo-50" : "border-slate-200"}`}>
              <span className="text-lg">{b}</span>
              <div className="font-bold text-slate-500" style={{ fontSize: 10 }}>{BADGE_INFO[b] || ""}</div>
            </button>
          ))}
        </div>
        {p.badges.length === 0 && <p className="text-xs text-slate-400 mt-2">まだバッジがありません。投票で入賞するか、10Pを貯めて獲得しましょう。</p>}
        <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2 text-xs">
          プレビュー:<span className="font-bold ml-1">{dName(p)}</span>
        </div>
      </Card>

      {team.votingClosed && p.todayRank && (
        <Card className="p-4 bg-indigo-50 border-indigo-200">
          <div className="text-sm font-bold text-indigo-800">本日の結果 — {team.siteName}</div>
          <div className="text-xs text-indigo-700 mt-1">現場内 <b>{p.todayRank}位</b>({p.todayVotes}票)/ 獲得 <b>+{p.todayPoints}P</b></div>
        </Card>
      )}

      {hasAccount && my?.history?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-bold text-slate-700 mb-2">📁 過去の参加現場</div>
          {my.history.map((h, i) => (
            <div key={i} className="py-2 border-b border-slate-50">
              <div className="flex justify-between text-sm font-bold"><span>{h.site_name}</span><span className="text-indigo-700">+{h.today_points}P</span></div>
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
  const typeStyle = { 休憩不足: "bg-rose-600 text-white", 一斉連絡: "bg-indigo-600 text-white", 緊急連絡: "bg-amber-500 text-white", 休憩終了: "bg-emerald-600 text-white", バッジ獲得: "bg-violet-600 text-white" };
  return (
    <div className="space-y-3 max-w-md mx-auto">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg">通知</h2>
        <button onClick={onReadAll} className="text-xs font-bold text-indigo-600">すべて既読</button>
      </div>
      {isAdmin && (
        <Card className="p-4 space-y-2">
          <div className="text-sm font-bold text-slate-700">📢 連絡を送信(管理者)</div>
          <div className="flex gap-1">
            {["一斉連絡", "緊急連絡"].map((t) => (
              <button key={t} onClick={() => setType(t)} className={`flex-1 py-2 rounded-lg text-xs font-bold ${type === t ? (t === "緊急連絡" ? "bg-amber-500 text-white" : "bg-indigo-600 text-white") : "bg-slate-100 text-slate-500"}`}>{t}</button>
            ))}
          </div>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="例:15:00から入口誘導を増員してください" />
          <Btn className="w-full" disabled={!text} onClick={() => { onSend(type, text); setText(""); }}>送信</Btn>
        </Card>
      )}
      {state.notifications.map((n) => (
        <Card key={n.id} className={`p-3 ${!n.read ? "border-indigo-300" : ""}`}>
          <div className="flex items-start gap-2">
            <span className={`font-bold px-1.5 py-0.5 rounded shrink-0 ${typeStyle[n.type] || "bg-slate-500 text-white"}`} style={{ fontSize: 10 }}>{n.type}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{n.text}</div>
              <div className="text-slate-400 font-mono mt-0.5" style={{ fontSize: 10 }}>{fmtHM(n.time)}</div>
            </div>
            {!n.read && <button onClick={() => onRead(n.id)} className="text-xs font-bold text-indigo-600 shrink-0">既読</button>}
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
      <h2 className="font-bold text-lg px-1">監査ログ</h2>
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
