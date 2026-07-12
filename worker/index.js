/* =====================================================================
   現場運営支援システム MVP - Cloudflare Workers バックエンド (Hono)
   - 認証: セッショントークン(アカウント) / 参加トークン pt_(ゲスト)
   - DB: D1 (binding: DB)
   - AI提案: Anthropic API (secret: ANTHROPIC_API_KEY) + ルールベースfallback
   ===================================================================== */
import { Hono } from "hono";

const app = new Hono();

/* ---------------- 共通ユーティリティ ---------------- */
const now = () => Date.now();
const uid = (p = "") => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const ok = (c, data) => c.json({ success: true, data });
const ng = (c, code, message, status = 400) => c.json({ success: false, errorCode: code, message }, status);

const requiredBreak = (planMin) => (planMin >= 480 ? 60 : planMin >= 360 ? 45 : 0);
const minDiff = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const fmtHM = (ts) => {
  if (!ts) return "--:--";
  const d = new Date(ts + 9 * 3600 * 1000); // JST表記(監査ログ・通知文用)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/* ---------------- パスワードハッシュ (PBKDF2) ---------------- */
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `${toHex(salt)}:${toHex(bits)}`;
}
async function verifyPassword(password, stored) {
  const [saltHex] = stored.split(":");
  const h = await hashPassword(password, saltHex);
  // 定数時間比較
  if (h.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

/* ---------------- Stripe連携(SDKを使わずREST APIを直接呼ぶ) ---------------- */
async function stripeFetch(env, path, params, method = "POST") {
  const body = new URLSearchParams();
  const flatten = (obj, prefix = "") => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (item && typeof item === "object") flatten(item, `${key}[${i}]`);
          else body.append(`${key}[${i}]`, item);
        });
      } else if (v && typeof v === "object") {
        flatten(v, key);
      } else if (v !== undefined && v !== null) {
        body.append(key, v);
      }
    }
  };
  flatten(params);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

/* Stripe Webhookの署名検証(Web Cryptoで手動実装。ライブラリ不使用) */
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${payload}`));
  const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 課金状態の判定 ---------------- */
const CREDIT_BUNDLES = {
  "10": { credits: 10, priceEnvKey: "STRIPE_PRICE_CREDITS_10" },
  "50": { credits: 50, priceEnvKey: "STRIPE_PRICE_CREDITS_50" },
  "100": { credits: 100, priceEnvKey: "STRIPE_PRICE_CREDITS_100" },
};
async function getBilling(env, userId) {
  await ensureMonthlyCredits(env, userId);
  return await env.DB.prepare(
    "SELECT plan_type, subscription_active, subscription_current_period_end, credit_balance, stripe_customer_id, comp_unlimited, day_pass_expires_at FROM users WHERE id = ?"
  ).bind(userId).first();
}
function billingOk(b) {
  if (!b) return false;
  if (b.comp_unlimited) return true; // 友人・知人向け招待コードで付与された永続無料フラグ
  if (b.day_pass_expires_at && b.day_pass_expires_at > now()) return true; // ポイント交換の1日パス
  if (b.plan_type === "subscription" && b.subscription_active) return true;
  if (b.plan_type === "credits" && b.credit_balance > 0) return true;
  return false;
}

/* 一時的に課金チェックを全面スキップするスイッチ。wrangler.tomlの[vars] FREE_MODE で切り替える。
   課金を再開する際はこの値を"false"に戻すだけでよく、購入・招待コード等の仕組みはそのまま残る */
function isFreeMode(env) {
  return env.FREE_MODE === "true";
}

/* 決済準備が整うまでの措置: 毎月、全アカウントにクレジット50回分を自動付与する(既存アカウントも対象)。
   定期実行の仕組み(Cron)を用意しなくても済むよう、「月が変わってから最初にgetBillingが
   呼ばれたタイミング」で不足分をまとめて付与する遅延評価方式にしている。
   何ヶ月アクセスが無くても、付与されるのは常に「今月分の50」だけで積み上がらない仕様 */
const MONTHLY_FREE_CREDITS = 50;
async function ensureMonthlyCredits(env, userId) {
  try {
    const { y, m } = jstDateParts(now());
    const monthKey = `${y}-${String(m).padStart(2, "0")}`;
    const row = await env.DB.prepare("SELECT credits_month_key FROM users WHERE id = ?").bind(userId).first();
    if (!row || row.credits_month_key === monthKey) return; // すでに今月分は付与済み
    await env.DB.prepare(
      `UPDATE users SET
         plan_type = CASE WHEN plan_type = 'subscription' AND subscription_active = 1 THEN plan_type ELSE 'credits' END,
         credit_balance = credit_balance + ?,
         credits_month_key = ?
       WHERE id = ?`
    ).bind(MONTHLY_FREE_CREDITS, monthKey, userId).run();
  } catch (e) {
    // マイグレーション未適用など何らかの理由で失敗しても、課金情報の取得自体は止めない
    console.error("ensureMonthlyCredits failed:", e.message);
  }
}

/* ---------------- チーム作成クォータ(サブスクは1日1件・月15件まで無料。超過分はクレジット消費) ---------------- */
const TEAM_DAILY_FREE_LIMIT = 1;
const TEAM_MONTHLY_FREE_LIMIT = 15;

function jstDateParts(ms) {
  const d = new Date(ms + 9 * 3600 * 1000); // JSTの壁時計時刻にずらしてから読む
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
function jstDayRangeMs(ms) {
  const { y, m, day } = jstDateParts(ms);
  const start = Date.UTC(y, m - 1, day) - 9 * 3600 * 1000; // JST 00:00 → UTC epoch ms
  return [start, start + 24 * 3600 * 1000];
}
function jstMonthRangeMs(ms) {
  const { y, m } = jstDateParts(ms);
  const start = Date.UTC(y, m - 1, 1) - 9 * 3600 * 1000;
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 9 * 3600 * 1000;
  return [start, end];
}

/* このオーナーのチーム作成状況(本日・当月の件数と、サブスク無料枠が残っているか)を返す。
   削除済みチームも「作成した実績」としてカウントする(削除して無料枠を使い回すのを防ぐため)。
   友人・知人向け招待コード(comp_unlimited)は日次・月次の上限なく常に無料 */
async function getTeamQuotaStatus(env, userId) {
  const billing = await getBilling(env, userId);
  if (billing?.comp_unlimited) return { billing, freeAvailable: true, dayCount: 0, monthCount: 0 };
  const t = now();
  const [dayStart, dayEnd] = jstDayRangeMs(t);
  const [monthStart, monthEnd] = jstMonthRangeMs(t);
  const dayCount = (await env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE owner_user_id = ? AND created_at >= ? AND created_at < ?")
    .bind(userId, dayStart, dayEnd).first())?.n || 0;
  const monthCount = (await env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE owner_user_id = ? AND created_at >= ? AND created_at < ?")
    .bind(userId, monthStart, monthEnd).first())?.n || 0;
  const freeAvailable = !!billing?.subscription_active && dayCount < TEAM_DAILY_FREE_LIMIT && monthCount < TEAM_MONTHLY_FREE_LIMIT;
  return { billing, freeAvailable, dayCount, monthCount };
}

/* このメールアドレスがサイト管理者(作成者)かどうか。wrangler.tomlのvars SITE_ADMIN_EMAILSで指定(カンマ区切り) */
function isSiteAdmin(env, user) {
  if (!user) return false;
  const admins = (env.SITE_ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

/* ---------------- 認証ミドルウェア ---------------- */
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  c.set("user", null);
  c.set("guestParticipant", null);
  if (token) {
    if (token.startsWith("pt_")) {
      const p = await c.env.DB.prepare("SELECT * FROM participants WHERE token = ?").bind(token).first();
      if (p) c.set("guestParticipant", p);
    } else {
      const s = await c.env.DB.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?").bind(token, now()).first();
      if (s) {
        const u = await c.env.DB.prepare("SELECT id, email, name, total_points, total_work_min, sites_count FROM users WHERE id = ?").bind(s.user_id).first();
        if (u) c.set("user", u);
      }
    }
  }
  await next();
});

/* チーム内の自分(参加者)を解決。管理系はロールも確認 */
async function resolveParticipant(c, teamId) {
  const gp = c.get("guestParticipant");
  if (gp && gp.team_id === teamId) return gp;
  const u = c.get("user");
  if (u) {
    return await c.env.DB.prepare("SELECT * FROM participants WHERE team_id = ? AND user_id = ?").bind(teamId, u.id).first();
  }
  return null;
}
const isAdmin = (p) => p && (p.role === "owner" || p.role === "admin");

async function audit(env, teamId, actor, target, action, before = "", after = "") {
  await env.DB.prepare(
    "INSERT INTO audit_logs (team_id, actor, target, action, before_text, after_text, created_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(teamId, actor, target, action, before, after, now()).run();
}
async function notify(env, teamId, type, text) {
  await env.DB.prepare("INSERT INTO notifications (team_id, type, text, created_at) VALUES (?,?,?,?)")
    .bind(teamId, type, text, now()).run();
}
const actorName = (p) => `${p.name}(${{ owner: "オーナー", admin: "管理者", member: "メンバー", guest: "ゲスト" }[p.role]})`;

async function awardBadge(env, teamId, participant, badge, reason) {
  // 最新のbadgesをDBから再取得(複数バッジ同時付与時の上書き防止)
  const row = await env.DB.prepare("SELECT badges FROM participants WHERE id = ?").bind(participant.id).first();
  const badges = JSON.parse(row?.badges || "[]");
  if (badges.includes(badge)) return;
  badges.push(badge);
  await env.DB.prepare("UPDATE participants SET badges = ? WHERE id = ?").bind(JSON.stringify(badges), participant.id).run();
  await notify(env, teamId, "バッジ獲得", `${participant.name}さんが ${badge} を獲得しました(${reason})`);
}

/* ================================ 認証 ================================ */
app.post("/api/v1/register", async (c) => {
  const { email, password, name } = await c.req.json();
  if (!email || !password || !name) return ng(c, "VAL-001", "メールアドレス・パスワード・名前は必須です。");
  if (password.length < 8) return ng(c, "VAL-001", "パスワードは8文字以上にしてください。");
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (exists) return ng(c, "DATA-002", "このメールアドレスは登録済みです。", 409);
  const id = uid("u_");
  await c.env.DB.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)")
    .bind(id, email, await hashPassword(password), name, now()).run();
  const token = uid("s_") + uid();
  await c.env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)")
    .bind(token, id, now() + 30 * 24 * 3600 * 1000).run();
  return ok(c, { token, user: { id, email, name }, isSiteAdmin: isSiteAdmin(c.env, { email }) });
});

app.post("/api/v1/login", async (c) => {
  const { email, password } = await c.req.json();
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email || "").first();
  if (!u || !(await verifyPassword(password || "", u.password_hash))) return ng(c, "AUTH-001", "メールアドレスまたはパスワードが違います。", 401);
  const token = uid("s_") + uid();
  await c.env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)")
    .bind(token, u.id, now() + 30 * 24 * 3600 * 1000).run();
  return ok(c, { token, user: { id: u.id, email: u.email, name: u.name }, isSiteAdmin: isSiteAdmin(c.env, u) });
});

app.post("/api/v1/logout", async (c) => {
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return ok(c, {});
});

app.get("/api/v1/me", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  return ok(c, { user: u, isSiteAdmin: isSiteAdmin(c.env, u) });
});

/* ================================ チーム ================================ */
app.post("/api/v1/teams", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "チーム作成にはログインが必要です。", 401);
  const { siteName, venueName, section, date, aiEnabled } = await c.req.json();
  if (!siteName || !venueName || !date) return ng(c, "VAL-001", "現場名・会場名・開催日は必須です。");

  const freeMode = isFreeMode(c.env);
  let usedCredit = false;
  let finalAiEnabled = !!aiEnabled;

  if (!freeMode) {
    // チーム作成の課金判定: サブスクは1日1件・月15件まで無料。それ以外はクレジットを1消費
    const { freeAvailable, billing } = await getTeamQuotaStatus(c.env, u.id);
    if (!freeAvailable) {
      if (!billing || billing.credit_balance <= 0) {
        return ng(c, "BILL-001", `チーム作成にはプラン契約またはクレジットが必要です(月額プランは1日${TEAM_DAILY_FREE_LIMIT}件・月${TEAM_MONTHLY_FREE_LIMIT}件まで無料)。`, 402);
      }
      const dec = await c.env.DB.prepare("UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ? AND credit_balance > 0").bind(u.id).run();
      if (!dec.meta.changes) return ng(c, "BILL-001", "クレジット残高が不足しています。", 402);
      usedCredit = true;
    }
    // 課金プランが無い場合は、AI希望があっても無視してOFFで作成する(安全側)。上でクレジットを使った場合は最新残高で判定
    const aiBilling = aiEnabled ? await getBilling(c.env, u.id) : null;
    finalAiEnabled = aiEnabled && billingOk(aiBilling);
  }

  const id = uid("t_");
  const code = uid().slice(0, 8).toUpperCase();
  await c.env.DB.prepare(
    "INSERT INTO teams (id, code, site_name, venue_name, section, event_date, owner_user_id, ai_enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(id, code, siteName, venueName, section || "", date, u.id, finalAiEnabled ? 1 : 0, now()).run();
  return ok(c, { team: { id, code, siteName, venueName, section, date, aiEnabled: finalAiEnabled, usedCredit } });
});

/* AI提案のON/OFF切り替え(オーナー・管理者)。通常はチームオーナーのアカウントに有効なプランが必要だが、
   FREE_MODE中は誰でもONにできる */
app.patch("/api/v1/teams/:id/ai-enabled", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "この設定は管理者のみ変更できます。", 403);
  const { enabled } = await c.req.json();
  if (enabled && !isFreeMode(c.env)) {
    const team = await c.env.DB.prepare("SELECT owner_user_id FROM teams WHERE id = ?").bind(teamId).first();
    const billing = await getBilling(c.env, team.owner_user_id);
    if (!billingOk(billing)) return ng(c, "BILL-001", "AI提案を使うには、月額プランの契約またはクレジットの購入が必要です。", 402);
  }
  await c.env.DB.prepare("UPDATE teams SET ai_enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, teamId).run();
  await audit(c.env, teamId, actorName(me), "AI提案設定", "AI提案の切り替え", "", enabled ? "ON" : "OFF");
  return ok(c, { aiEnabled: !!enabled });
});

app.get("/api/v1/teams", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT t.* FROM teams t
     LEFT JOIN participants p ON p.team_id = t.id AND p.user_id = ?
     WHERE t.deleted = 0 AND (t.owner_user_id = ? OR p.id IS NOT NULL)
     ORDER BY t.created_at DESC`
  ).bind(u.id, u.id).all();
  return ok(c, { teams: results });
});

app.get("/api/v1/teams/by-code/:code", async (c) => {
  const t = await c.env.DB.prepare("SELECT id, code, site_name, venue_name, section, event_date FROM teams WHERE code = ? AND deleted = 0")
    .bind(c.req.param("code")).first();
  if (!t) return ng(c, "DATA-001", "チームが見つかりません。URLまたはコードを確認してください。", 404);
  return ok(c, { team: t });
});

app.post("/api/v1/teams/:code/join", async (c) => {
  const t = await c.env.DB.prepare("SELECT * FROM teams WHERE code = ? AND deleted = 0").bind(c.req.param("code")).first();
  if (!t) return ng(c, "DATA-001", "チームが見つかりません。", 404);
  const { name, planStart, planEnd } = await c.req.json(); // planStart/planEnd: epoch ms
  if (!name || !planStart || !planEnd || planEnd <= planStart) return ng(c, "VAL-001", "表示名と正しい予定勤務時間を入力してください。");
  const u = c.get("user");
  if (u) {
    const dup = await c.env.DB.prepare("SELECT id FROM participants WHERE team_id = ? AND user_id = ?").bind(t.id, u.id).first();
    if (dup) return ng(c, "DATA-002", "すでにこのチームに参加しています。", 409);
  }
  const id = uid("p_");
  const role = u && u.id === t.owner_user_id ? "owner" : u ? "member" : "guest";
  const token = u ? null : "pt_" + uid() + uid();
  await c.env.DB.prepare(
    "INSERT INTO participants (id, team_id, user_id, token, name, role, plan_start, plan_end, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(id, t.id, u ? u.id : null, token, name, role, planStart, planEnd, now()).run();
  return ok(c, { teamId: t.id, participantId: id, participantToken: token, role });
});

app.delete("/api/v1/teams/:id", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me || me.role !== "owner") return ng(c, "AUTH-002", "チーム削除はオーナーのみ可能です。", 403);
  await c.env.DB.prepare("UPDATE teams SET deleted = 1 WHERE id = ?").bind(teamId).run();
  await audit(c.env, teamId, actorName(me), "チーム", "チーム削除", "有効", "削除済み");
  return ok(c, {});
});

/* ================================ チーム状態(ポーリング) ================================ */
app.get("/api/v1/teams/:id/state", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "このチームの参加者ではありません。", 403);
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ? AND deleted = 0").bind(teamId).first();
  if (!team) return ng(c, "DATA-001", "チームが見つかりません。", 404);

  const [parts, brks, asgs, chats, notifs, reads, myVote, voteCount] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM participants WHERE team_id = ? ORDER BY created_at").bind(teamId).all(),
    c.env.DB.prepare("SELECT b.* FROM breaks b JOIN participants p ON p.id = b.participant_id WHERE p.team_id = ? ORDER BY b.start_at").bind(teamId).all(),
    c.env.DB.prepare("SELECT * FROM assignments WHERE team_id = ? ORDER BY start_at").bind(teamId).all(),
    c.env.DB.prepare("SELECT * FROM chat_messages WHERE team_id = ? ORDER BY id DESC LIMIT 100").bind(teamId).all(),
    c.env.DB.prepare("SELECT * FROM notifications WHERE team_id = ? ORDER BY id DESC LIMIT 50").bind(teamId).all(),
    c.env.DB.prepare("SELECT notification_id FROM notification_reads WHERE participant_id = ?").bind(me.id).all(),
    c.env.DB.prepare("SELECT target_id FROM votes WHERE team_id = ? AND voter_id = ?").bind(teamId, me.id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE team_id = ?").bind(teamId).first(),
  ]);
  const readSet = new Set(reads.results.map((r) => r.notification_id));
  return ok(c, {
    team: { id: team.id, code: team.code, siteName: team.site_name, venueName: team.venue_name, section: team.section, date: team.event_date, votingClosed: !!team.voting_closed, aiEnabled: !!team.ai_enabled },
    me: { id: me.id, role: me.role, name: me.name, hasAccount: !!me.user_id },
    participants: parts.results.map((p) => ({
      id: p.id, name: p.name, role: p.role, hasAccount: !!p.user_id,
      planStart: p.plan_start, planEnd: p.plan_end, checkOut: p.check_out,
      badges: JSON.parse(p.badges || "[]"), displayBadge: p.display_badge,
      todayPoints: p.today_points, todayRank: p.today_rank, todayVotes: p.today_votes,
      breaks: brks.results.filter((b) => b.participant_id === p.id).map((b) => ({ id: b.id, start: b.start_at, end: b.end_at })),
    })),
    assignments: asgs.results.map((a) => ({ id: a.id, pid: a.participant_id, start: a.start_at, end: a.end_at, name: a.name, note: a.note })),
    chat: chats.results.reverse().map((m) => ({ id: m.id, pid: m.participant_id, text: m.text, time: m.created_at })),
    notifications: notifs.results.map((n) => ({ id: n.id, type: n.type, text: n.text, time: n.created_at, read: readSet.has(n.id) })),
    voting: { myVote: myVote?.target_id || null, votedCount: voteCount?.n || 0, closed: !!team.voting_closed },
  });
});

/* ================================ 勤務・休憩 ================================ */
app.post("/api/v1/teams/:id/breaks/start", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { participantId } = await c.req.json();
  const target = participantId && participantId !== me.id
    ? (isAdmin(me) ? await c.env.DB.prepare("SELECT * FROM participants WHERE id = ? AND team_id = ?").bind(participantId, teamId).first() : null)
    : me;
  if (!target) return ng(c, "AUTH-002", "他人の休憩操作は管理者のみ可能です。", 403);
  const open = await c.env.DB.prepare("SELECT id FROM breaks WHERE participant_id = ? AND end_at IS NULL").bind(target.id).first();
  if (open) return ng(c, "DATA-003", "すでに休憩中です。", 409);
  await c.env.DB.prepare("INSERT INTO breaks (id, participant_id, start_at) VALUES (?,?,?)").bind(uid("b_"), target.id, now()).run();
  return ok(c, {});
});

app.post("/api/v1/teams/:id/breaks/end", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { participantId } = await c.req.json();
  const target = participantId && participantId !== me.id
    ? (isAdmin(me) ? await c.env.DB.prepare("SELECT * FROM participants WHERE id = ? AND team_id = ?").bind(participantId, teamId).first() : null)
    : me;
  if (!target) return ng(c, "AUTH-002", "他人の休憩操作は管理者のみ可能です。", 403);
  const open = await c.env.DB.prepare("SELECT * FROM breaks WHERE participant_id = ? AND end_at IS NULL").bind(target.id).first();
  if (!open) return ng(c, "DATA-001", "休憩中ではありません。", 404);
  const t = now();
  await c.env.DB.prepare("UPDATE breaks SET end_at = ? WHERE id = ?").bind(t, open.id).run();
  await notify(c.env, teamId, "休憩終了", `${target.name}さんが休憩から勤務に戻りました(${minDiff(open.start_at, t)}分)`);
  return ok(c, {});
});

app.post("/api/v1/teams/:id/checkout", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { participantId } = await c.req.json();
  const byAdmin = participantId && participantId !== me.id;
  const target = byAdmin
    ? (isAdmin(me) ? await c.env.DB.prepare("SELECT * FROM participants WHERE id = ? AND team_id = ?").bind(participantId, teamId).first() : null)
    : me;
  if (!target) return ng(c, "AUTH-002", "代理退勤は管理者のみ可能です。", 403);
  if (target.check_out) return ng(c, "DATA-003", "すでに退勤済みです。", 409);
  const t = now();
  await c.env.DB.prepare("UPDATE breaks SET end_at = ? WHERE participant_id = ? AND end_at IS NULL").bind(t, target.id).run();
  await c.env.DB.prepare("UPDATE participants SET check_out = ? WHERE id = ?").bind(t, target.id).run();
  if (byAdmin) await audit(c.env, teamId, actorName(me), target.name, "退勤修正(代理退勤)", "勤務中", `退勤 ${fmtHM(t)}`);
  // 休憩充足バッジ
  const brs = await c.env.DB.prepare("SELECT * FROM breaks WHERE participant_id = ?").bind(target.id).all();
  const taken = brs.results.reduce((a, b) => a + minDiff(b.start_at, b.end_at ?? t), 0);
  const req = requiredBreak(minDiff(target.plan_start, target.plan_end));
  if (req > 0 && taken >= req) await awardBadge(c.env, teamId, target, "☕", "必要休憩を充足して退勤");
  return ok(c, {});
});

/* 管理者: 勤務・休憩履歴修正(監査ログ必須) */
app.patch("/api/v1/teams/:id/participants/:pid/records", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "履歴修正は管理者のみ可能です。", 403);
  const target = await c.env.DB.prepare("SELECT * FROM participants WHERE id = ? AND team_id = ?").bind(c.req.param("pid"), teamId).first();
  if (!target) return ng(c, "DATA-001", "対象者が見つかりません。", 404);
  const { planStart, planEnd, checkOut, breaks } = await c.req.json();
  const oldBrs = await c.env.DB.prepare("SELECT * FROM breaks WHERE participant_id = ? ORDER BY start_at").bind(target.id).all();
  const beforeText = `予定${fmtHM(target.plan_start)}〜${fmtHM(target.plan_end)} / 退勤${fmtHM(target.check_out)} / 休憩${oldBrs.results.map((b) => `${fmtHM(b.start_at)}-${b.end_at ? fmtHM(b.end_at) : "中"}`).join(",") || "なし"}`;
  await c.env.DB.prepare("UPDATE participants SET plan_start = ?, plan_end = ?, check_out = ? WHERE id = ?")
    .bind(planStart, planEnd, checkOut ?? null, target.id).run();
  await c.env.DB.prepare("DELETE FROM breaks WHERE participant_id = ?").bind(target.id).run();
  for (const b of breaks || []) {
    await c.env.DB.prepare("INSERT INTO breaks (id, participant_id, start_at, end_at) VALUES (?,?,?,?)")
      .bind(uid("b_"), target.id, b.start, b.end ?? null).run();
  }
  const afterText = `予定${fmtHM(planStart)}〜${fmtHM(planEnd)} / 退勤${fmtHM(checkOut)} / 休憩${(breaks || []).map((b) => `${fmtHM(b.start)}-${b.end ? fmtHM(b.end) : "中"}`).join(",") || "なし"}`;
  await audit(c.env, teamId, actorName(me), target.name, "勤務・休憩履歴修正", beforeText, afterText);
  return ok(c, {});
});

/* 権限変更 (オーナーのみ) */
app.post("/api/v1/teams/:id/participants/:pid/role", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me || me.role !== "owner") return ng(c, "AUTH-002", "権限変更はオーナーのみ可能です。", 403);
  const target = await c.env.DB.prepare("SELECT * FROM participants WHERE id = ? AND team_id = ?").bind(c.req.param("pid"), teamId).first();
  if (!target || target.role === "owner" || target.role === "guest") return ng(c, "VAL-001", "この参加者の権限は変更できません。");
  const next = target.role === "admin" ? "member" : "admin";
  await c.env.DB.prepare("UPDATE participants SET role = ? WHERE id = ?").bind(next, target.id).run();
  await audit(c.env, teamId, actorName(me), target.name, "権限変更", target.role, next);
  return ok(c, { role: next });
});

/* バッジ表示選択 (本人) */
app.patch("/api/v1/teams/:id/display-badge", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { badge } = await c.req.json();
  const badges = JSON.parse(me.badges || "[]");
  if (badge !== "" && !badges.includes(badge)) return ng(c, "VAL-001", "獲得していないバッジは表示できません。");
  await c.env.DB.prepare("UPDATE participants SET display_badge = ? WHERE id = ?").bind(badge, me.id).run();
  return ok(c, {});
});

/* ================================ 配置 ================================ */
app.post("/api/v1/teams/:id/assignments", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "配置登録は管理者のみ可能です。", 403);
  const { pid, start, end, name, note } = await c.req.json();
  if (!pid || !name || !start || !end || end <= start) return ng(c, "VAL-001", "対象者・配置名・正しい時刻を入力してください。");
  const target = await c.env.DB.prepare("SELECT name FROM participants WHERE id = ? AND team_id = ?").bind(pid, teamId).first();
  if (!target) return ng(c, "DATA-001", "対象者が見つかりません。", 404);
  const id = uid("a_");
  await c.env.DB.prepare("INSERT INTO assignments (id, team_id, participant_id, start_at, end_at, name, note) VALUES (?,?,?,?,?,?,?)")
    .bind(id, teamId, pid, start, end, name, note || "").run();
  await audit(c.env, teamId, actorName(me), target.name, "配置追加", "—", `${fmtHM(start)}〜${fmtHM(end)} ${name}`);
  return ok(c, { id });
});

app.patch("/api/v1/teams/:id/assignments/:aid", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "配置変更は管理者のみ可能です。", 403);
  const old = await c.env.DB.prepare("SELECT a.*, p.name AS pname FROM assignments a JOIN participants p ON p.id = a.participant_id WHERE a.id = ? AND a.team_id = ?")
    .bind(c.req.param("aid"), teamId).first();
  if (!old) return ng(c, "DATA-001", "配置が見つかりません。", 404);
  const { pid, start, end, name, note } = await c.req.json();
  if (!pid || !name || !start || !end || end <= start) return ng(c, "VAL-001", "入力内容を確認してください。");
  await c.env.DB.prepare("UPDATE assignments SET participant_id = ?, start_at = ?, end_at = ?, name = ?, note = ? WHERE id = ?")
    .bind(pid, start, end, name, note || "", old.id).run();
  await audit(c.env, teamId, actorName(me), old.pname, "配置変更", `${fmtHM(old.start_at)}〜${fmtHM(old.end_at)} ${old.name}`, `${fmtHM(start)}〜${fmtHM(end)} ${name}`);
  return ok(c, {});
});

app.delete("/api/v1/teams/:id/assignments/:aid", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "配置削除は管理者のみ可能です。", 403);
  const old = await c.env.DB.prepare("SELECT a.*, p.name AS pname FROM assignments a JOIN participants p ON p.id = a.participant_id WHERE a.id = ? AND a.team_id = ?")
    .bind(c.req.param("aid"), teamId).first();
  if (!old) return ng(c, "DATA-001", "配置が見つかりません。", 404);
  await c.env.DB.prepare("DELETE FROM assignments WHERE id = ?").bind(old.id).run();
  await audit(c.env, teamId, actorName(me), old.pname, "配置削除", `${fmtHM(old.start_at)}〜${fmtHM(old.end_at)} ${old.name}`, "—");
  return ok(c, {});
});

/* ================================ チャット・通知 ================================ */
app.post("/api/v1/teams/:id/chat", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { text } = await c.req.json();
  if (!text || !text.trim()) return ng(c, "VAL-001", "メッセージを入力してください。");
  await c.env.DB.prepare("INSERT INTO chat_messages (team_id, participant_id, text, created_at) VALUES (?,?,?,?)")
    .bind(teamId, me.id, text.trim().slice(0, 500), now()).run();
  return ok(c, {});
});

app.post("/api/v1/teams/:id/notifications", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "通知送信は管理者のみ可能です。", 403);
  const { type, text } = await c.req.json();
  if (!["一斉連絡", "緊急連絡", "休憩不足"].includes(type) || !text) return ng(c, "VAL-001", "種別と本文を確認してください。");
  await notify(c.env, teamId, type, text);
  return ok(c, {});
});

app.post("/api/v1/teams/:id/notifications/read", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const { ids } = await c.req.json(); // number[]
  for (const nid of ids || []) {
    await c.env.DB.prepare("INSERT OR IGNORE INTO notification_reads (notification_id, participant_id) VALUES (?,?)").bind(nid, me.id).run();
  }
  return ok(c, {});
});

/* ================================ 投票・結果・バッジ ================================ */
app.post("/api/v1/teams/:id/vote", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!me) return ng(c, "AUTH-002", "参加者ではありません。", 403);
  const team = await c.env.DB.prepare("SELECT voting_closed FROM teams WHERE id = ?").bind(teamId).first();
  if (team.voting_closed) return ng(c, "DATA-003", "投票は締め切られています。", 409);
  const { targetId } = await c.req.json();
  if (!targetId || targetId === me.id) return ng(c, "VAL-001", "自分以外の参加者を1人選んでください。");
  const target = await c.env.DB.prepare("SELECT id FROM participants WHERE id = ? AND team_id = ?").bind(targetId, teamId).first();
  if (!target) return ng(c, "DATA-001", "対象者が見つかりません。", 404);
  try {
    await c.env.DB.prepare("INSERT INTO votes (team_id, voter_id, target_id, created_at) VALUES (?,?,?,?)")
      .bind(teamId, me.id, targetId, now()).run();
  } catch (e) {
    return ng(c, "DATA-002", "すでに投票済みです(1人1回)。", 409);
  }
  return ok(c, {});
});

app.post("/api/v1/teams/:id/close-voting", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "投票締切は管理者のみ可能です。", 403);
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first();
  if (team.voting_closed) return ng(c, "DATA-003", "すでに締め切り済みです。", 409);

  const t = now();
  const parts = (await c.env.DB.prepare("SELECT * FROM participants WHERE team_id = ?").bind(teamId).all()).results;
  const votes = (await c.env.DB.prepare("SELECT target_id FROM votes WHERE team_id = ?").bind(teamId).all()).results;
  const cnt = {};
  parts.forEach((p) => (cnt[p.id] = 0));
  votes.forEach((v) => (cnt[v.target_id] = (cnt[v.target_id] || 0) + 1));
  const sorted = [...parts].sort((a, b) => cnt[b.id] - cnt[a.id]);
  let lastVotes = null, lastRank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const v = cnt[p.id];
    const rank = v === lastVotes ? lastRank : i + 1;
    lastVotes = v; lastRank = rank;
    const pts = v === 0 ? 0 : rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
    await c.env.DB.prepare("UPDATE participants SET today_points = ?, today_rank = ?, today_votes = ? WHERE id = ?")
      .bind(pts, rank, v, p.id).run();
    // バッジ付与
    if (rank === 1 && v > 0) await awardBadge(c.env, teamId, p, "🏆", "現場MVP");
    if (pts > 0 && JSON.parse(p.badges || "[]").length === 0) await awardBadge(c.env, teamId, p, "⚡", "初ポイント獲得");
    // アカウント保有者は累計へ加算
    if (p.user_id) {
      const brs = (await c.env.DB.prepare("SELECT * FROM breaks WHERE participant_id = ?").bind(p.id).all()).results;
      const taken = brs.reduce((a, b) => a + minDiff(b.start_at, b.end_at ?? t), 0);
      const endAt = p.check_out ?? Math.min(t, p.plan_end);
      const workMin = Math.max(0, minDiff(p.plan_start, endAt) - taken);
      const u = await c.env.DB.prepare("SELECT total_points FROM users WHERE id = ?").bind(p.user_id).first();
      const newTotal = (u?.total_points || 0) + pts;
      await c.env.DB.prepare("UPDATE users SET total_points = ?, total_work_min = total_work_min + ?, sites_count = sites_count + 1 WHERE id = ?")
        .bind(newTotal, workMin, p.user_id).run();
      if (Math.floor(newTotal / 10) > Math.floor((newTotal - pts) / 10)) await awardBadge(c.env, teamId, p, "💎", "累計10P到達");
    }
  }
  await c.env.DB.prepare("UPDATE teams SET voting_closed = 1 WHERE id = ?").bind(teamId).run();
  await audit(c.env, teamId, actorName(me), team.site_name, "投票締切", "投票受付中", "結果確定");
  return ok(c, {});
});

/* ================================ 監査ログ ================================ */
app.get("/api/v1/teams/:id/audit", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "監査ログは管理者のみ閲覧できます。", 403);
  const { results } = await c.env.DB.prepare("SELECT * FROM audit_logs WHERE team_id = ? ORDER BY id DESC LIMIT 200").bind(teamId).all();
  return ok(c, { logs: results.map((a) => ({ id: a.id, time: a.created_at, actor: a.actor, target: a.target, action: a.action, before: a.before_text, after: a.after_text })) });
});

/* ================================ マイページ ================================ */
app.get("/api/v1/mypage", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  const { results } = await c.env.DB.prepare(
    `SELECT p.today_points, p.today_rank, t.site_name, t.event_date, p.plan_start, p.plan_end, p.check_out, p.id AS pid
     FROM participants p JOIN teams t ON t.id = p.team_id
     WHERE p.user_id = ? AND t.voting_closed = 1 ORDER BY t.event_date DESC LIMIT 30`
  ).bind(u.id).all();
  // 参加した全チームの獲得バッジを重複なく集計(チームに入らなくても実績が見られるように)
  const badgeRows = await c.env.DB.prepare("SELECT badges FROM participants WHERE user_id = ?").bind(u.id).all();
  const badgeSet = new Set();
  badgeRows.results.forEach((r) => JSON.parse(r.badges || "[]").forEach((b) => badgeSet.add(b)));
  return ok(c, { user: u, history: results, badges: [...badgeSet] });
});

/* ================================ 課金(Stripe) ================================ */
app.get("/api/v1/billing", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  try {
    const b = await getBilling(c.env, u.id);
    const { freeAvailable, dayCount, monthCount } = await getTeamQuotaStatus(c.env, u.id);
    const pointsRow = await c.env.DB.prepare("SELECT total_points FROM users WHERE id = ?").bind(u.id).first();
    return ok(c, {
      freeMode: isFreeMode(c.env),
      paymentsReady: !!c.env.STRIPE_SECRET_KEY, // Stripeシークレットキー未設定の間は「決済準備中」として扱う
      planType: b?.plan_type || "none",
      subscriptionActive: !!b?.subscription_active,
      subscriptionEnd: b?.subscription_current_period_end || null,
      creditBalance: b?.credit_balance || 0,
      compUnlimited: !!b?.comp_unlimited,
      dayPassActive: !!(b?.day_pass_expires_at && b.day_pass_expires_at > now()),
      dayPassExpiresAt: b?.day_pass_expires_at || null,
      totalPoints: pointsRow?.total_points || 0,
      teamQuota: { freeAvailable, dayCount, monthCount, dailyLimit: TEAM_DAILY_FREE_LIMIT, monthlyLimit: TEAM_MONTHLY_FREE_LIMIT },
    });
  } catch (e) {
    console.error("GET /billing failed:", e.message);
    // 何らかの理由で取得に失敗しても、画面側が「準備中」として扱えるよう安全な既定値を返す
    return ok(c, {
      freeMode: false, paymentsReady: false, planType: "none", subscriptionActive: false, subscriptionEnd: null,
      creditBalance: 0, compUnlimited: false, dayPassActive: false, dayPassExpiresAt: null, totalPoints: 0,
      teamQuota: { freeAvailable: false, dayCount: 0, monthCount: 0, dailyLimit: TEAM_DAILY_FREE_LIMIT, monthlyLimit: TEAM_MONTHLY_FREE_LIMIT },
    });
  }
});

/* 招待コード・友人コードの利用。友人コード(friend_unlimited)は何人でも使える。1人1コード1回まで */
app.post("/api/v1/redeem", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  const { code } = await c.req.json();
  if (!code) return ng(c, "VAL-001", "コードを入力してください。");
  const row = await c.env.DB.prepare("SELECT * FROM redemption_codes WHERE code = ? AND active = 1").bind(code.trim()).first();
  if (!row) return ng(c, "DATA-001", "無効なコードです。", 404);
  if (row.expires_at && row.expires_at < now()) return ng(c, "DATA-003", "このコードは有効期限が切れています。", 409);
  if (row.max_uses != null && row.used_count >= row.max_uses) return ng(c, "DATA-003", "このコードは利用上限に達しています。", 409);
  const already = await c.env.DB.prepare("SELECT 1 FROM redemption_uses WHERE code = ? AND user_id = ?").bind(row.code, u.id).first();
  if (already) return ng(c, "DATA-002", "このコードはすでに利用済みです。", 409);

  try {
    await c.env.DB.prepare("INSERT INTO redemption_uses (code, user_id, used_at) VALUES (?,?,?)").bind(row.code, u.id, now()).run();
  } catch (e) {
    return ng(c, "DATA-002", "このコードはすでに利用済みです。", 409);
  }
  await c.env.DB.prepare("UPDATE redemption_codes SET used_count = used_count + 1 WHERE code = ?").bind(row.code).run();

  if (row.kind === "friend_unlimited") {
    await c.env.DB.prepare("UPDATE users SET comp_unlimited = 1 WHERE id = ?").bind(u.id).run();
    return ok(c, { granted: "friend_unlimited" });
  }
  if (row.kind === "credit_grant") {
    await c.env.DB.prepare(
      "UPDATE users SET plan_type = CASE WHEN plan_type = 'subscription' AND subscription_active = 1 THEN plan_type ELSE 'credits' END, credit_balance = credit_balance + ? WHERE id = ?"
    ).bind(row.credit_amount, u.id).run();
    return ok(c, { granted: "credit_grant", credits: row.credit_amount });
  }
  return ng(c, "VAL-001", "このコードは利用できません。");
});

/* 貯めたポイントをAI1日パスと交換する(150P消費・自分専用・再利用不可) */
const POINT_DAY_PASS_COST = 150;
const DAY_MS = 24 * 3600 * 1000;
app.post("/api/v1/points/exchange", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  const dec = await c.env.DB.prepare("UPDATE users SET total_points = total_points - ? WHERE id = ? AND total_points >= ?")
    .bind(POINT_DAY_PASS_COST, u.id, POINT_DAY_PASS_COST).run();
  if (!dec.meta.changes) return ng(c, "BILL-001", `ポイントが不足しています(必要:${POINT_DAY_PASS_COST}P)。`, 402);
  const t = now();
  // 既存の1日パスがまだ残っていればそこから延長、無ければ今から24時間
  await c.env.DB.prepare("UPDATE users SET day_pass_expires_at = MAX(COALESCE(day_pass_expires_at, 0), ?) + ? WHERE id = ?")
    .bind(t, DAY_MS, u.id).run();
  const row = await c.env.DB.prepare("SELECT day_pass_expires_at FROM users WHERE id = ?").bind(u.id).first();
  // 監査用に記録として1件発行(本人のみ有効・再利用不可)
  const code = "PX" + uid().slice(0, 10).toUpperCase();
  await c.env.DB.prepare(
    "INSERT INTO redemption_codes (code, kind, note, max_uses, created_by, created_at, active) VALUES (?,?,?,?,?,?,0)"
  ).bind(code, "point_day_pass", `${u.email} がポイント交換`, 1, u.id, t).run();
  await c.env.DB.prepare("INSERT INTO redemption_uses (code, user_id, used_at) VALUES (?,?,?)").bind(code, u.id, t).run();
  return ok(c, { expiresAt: row.day_pass_expires_at });
});

/* ================================ サイト管理(作成者専用) ================================ */
app.get("/api/v1/admin/overview", async (c) => {
  const u = c.get("user");
  if (!isSiteAdmin(c.env, u)) return ng(c, "AUTH-002", "管理者専用の機能です。", 403);
  const [userCount, teamCount, subCount, creditSum, revenue] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE deleted = 0").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE plan_type='subscription' AND subscription_active=1").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(credit_balance),0) AS n FROM users").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount_yen),0) AS n FROM billing_ledger").first(),
  ]);
  const recent = await c.env.DB.prepare("SELECT * FROM billing_ledger ORDER BY id DESC LIMIT 20").all();
  return ok(c, {
    userCount: userCount.n, teamCount: teamCount.n, activeSubscriptions: subCount.n,
    outstandingCredits: creditSum.n, totalRevenueYen: revenue.n,
    recentLedger: recent.results.map((r) => ({ id: r.id, kind: r.kind, amountYen: r.amount_yen, detail: r.detail, time: r.created_at })),
  });
});

app.get("/api/v1/admin/codes", async (c) => {
  const u = c.get("user");
  if (!isSiteAdmin(c.env, u)) return ng(c, "AUTH-002", "管理者専用の機能です。", 403);
  const { results } = await c.env.DB.prepare("SELECT * FROM redemption_codes WHERE kind IN ('friend_unlimited','credit_grant') ORDER BY created_at DESC").all();
  return ok(c, { codes: results.map((r) => ({ code: r.code, kind: r.kind, creditAmount: r.credit_amount, note: r.note, maxUses: r.max_uses, usedCount: r.used_count, active: !!r.active, createdAt: r.created_at, expiresAt: r.expires_at })) });
});

app.post("/api/v1/admin/codes", async (c) => {
  const u = c.get("user");
  if (!isSiteAdmin(c.env, u)) return ng(c, "AUTH-002", "管理者専用の機能です。", 403);
  const { kind, note, maxUses, expiresInDays, creditAmount } = await c.req.json();
  const useKind = kind === "credit_grant" ? "credit_grant" : "friend_unlimited";
  if (useKind === "credit_grant" && (!creditAmount || creditAmount <= 0)) return ng(c, "VAL-001", "付与するクレジット数を入力してください。");
  const code = (useKind === "credit_grant" ? "CREDIT-" : "FRIEND-") + uid().slice(0, 8).toUpperCase();
  const expiresAt = expiresInDays ? now() + expiresInDays * 24 * 3600 * 1000 : null;
  await c.env.DB.prepare(
    "INSERT INTO redemption_codes (code, kind, note, max_uses, credit_amount, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(code, useKind, note || "", maxUses || null, useKind === "credit_grant" ? creditAmount : 0, u.id, now(), expiresAt).run();
  return ok(c, { code });
});

app.patch("/api/v1/admin/codes/:code", async (c) => {
  const u = c.get("user");
  if (!isSiteAdmin(c.env, u)) return ng(c, "AUTH-002", "管理者専用の機能です。", 403);
  const { active } = await c.req.json();
  await c.env.DB.prepare("UPDATE redemption_codes SET active = ? WHERE code = ?").bind(active ? 1 : 0, c.req.param("code")).run();
  return ok(c, {});
});

app.get("/api/v1/admin/users", async (c) => {
  const u = c.get("user");
  if (!isSiteAdmin(c.env, u)) return ng(c, "AUTH-002", "管理者専用の機能です。", 403);
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, plan_type, subscription_active, credit_balance, comp_unlimited, total_points, sites_count, created_at FROM users ORDER BY created_at DESC LIMIT 200"
  ).all();
  return ok(c, { users: results });
});

app.post("/api/v1/billing/checkout", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  if (!c.env.STRIPE_SECRET_KEY) return ng(c, "SYS-002", "決済機能が未設定です。しばらくしてから再度お試しください。", 503);
  const { type, bundle } = await c.req.json();
  const row = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").bind(u.id).first();
  let customerId = row?.stripe_customer_id;
  try {
    if (!customerId) {
      const cust = await stripeFetch(c.env, "customers", { email: u.email, name: u.name, metadata: { userId: u.id } });
      customerId = cust.id;
      await c.env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").bind(customerId, u.id).run();
    }
    const origin = new URL(c.req.url).origin;
    let session;
    if (type === "subscription") {
      if (!c.env.STRIPE_PRICE_SUBSCRIPTION) return ng(c, "SYS-002", "月額プランは現在準備中です。", 503);
      session = await stripeFetch(c.env, "checkout/sessions", {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: c.env.STRIPE_PRICE_SUBSCRIPTION, quantity: 1 }],
        success_url: `${origin}/?billing=success`,
        cancel_url: `${origin}/?billing=cancel`,
        metadata: { userId: u.id, kind: "subscription" },
        subscription_data: { metadata: { userId: u.id } },
      });
    } else if (type === "credits") {
      const b = CREDIT_BUNDLES[bundle];
      if (!b) return ng(c, "VAL-001", "購入するクレジット数を選択してください。");
      const priceId = c.env[b.priceEnvKey];
      if (!priceId) return ng(c, "SYS-002", "このクレジットプランは現在準備中です。", 503);
      session = await stripeFetch(c.env, "checkout/sessions", {
        mode: "payment",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/?billing=success`,
        cancel_url: `${origin}/?billing=cancel`,
        metadata: { userId: u.id, kind: "credits", credits: String(b.credits) },
      });
    } else {
      return ng(c, "VAL-001", "購入内容を指定してください。");
    }
    return ok(c, { url: session.url });
  } catch (e) {
    return ng(c, "SYS-001", `決済ページの作成に失敗しました: ${e.message}`, 500);
  }
});

app.post("/api/v1/billing/portal", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "未ログインです。", 401);
  const row = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").bind(u.id).first();
  if (!row?.stripe_customer_id) return ng(c, "DATA-001", "契約情報が見つかりません。", 404);
  try {
    const origin = new URL(c.req.url).origin;
    const session = await stripeFetch(c.env, "billing_portal/sessions", { customer: row.stripe_customer_id, return_url: `${origin}/` });
    return ok(c, { url: session.url });
  } catch (e) {
    return ng(c, "SYS-001", `契約管理ページの作成に失敗しました: ${e.message}`, 500);
  }
});

/* Stripeからのイベント通知を受け取る。認証不要・署名検証のみ */
app.post("/api/v1/billing/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  const payload = await c.req.text();
  if (!c.env.STRIPE_WEBHOOK_SECRET) return c.text("webhook secret not configured", 500);
  const valid = await verifyStripeSignature(payload, sig, c.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return c.text("invalid signature", 400);
  let event;
  try { event = JSON.parse(payload); } catch (e) { return c.text("invalid payload", 400); }
  const obj = event.data?.object || {};
  try {
    if (event.type === "checkout.session.completed") {
      const userId = obj.metadata?.userId;
      const amountYen = obj.amount_total || 0; // JPYはゼロ小数通貨のため、そのまま円として扱える
      if (userId) {
        if (obj.mode === "subscription") {
          await c.env.DB.prepare(
            "UPDATE users SET plan_type='subscription', subscription_active=1, subscription_id=?, stripe_customer_id=? WHERE id=?"
          ).bind(obj.subscription, obj.customer, userId).run();
          await c.env.DB.prepare("INSERT INTO billing_ledger (user_id, kind, amount_yen, detail, created_at) VALUES (?,?,?,?,?)")
            .bind(userId, "subscription", amountYen, "月額プラン契約", now()).run();
        } else if (obj.mode === "payment") {
          const credits = parseInt(obj.metadata?.credits || "0", 10);
          if (credits > 0) {
            await c.env.DB.prepare(
              `UPDATE users SET
                 plan_type = CASE WHEN plan_type = 'subscription' AND subscription_active = 1 THEN plan_type ELSE 'credits' END,
                 credit_balance = credit_balance + ?,
                 stripe_customer_id = ?
               WHERE id = ?`
            ).bind(credits, obj.customer, userId).run();
            await c.env.DB.prepare("INSERT INTO billing_ledger (user_id, kind, amount_yen, detail, created_at) VALUES (?,?,?,?,?)")
              .bind(userId, "credits", amountYen, `クレジット${credits}回分`, now()).run();
          }
        }
      }
    }
    if (event.type === "customer.subscription.updated") {
      const active = obj.status === "active" || obj.status === "trialing" ? 1 : 0;
      const periodEnd = obj.current_period_end ? obj.current_period_end * 1000 : null;
      const userId = obj.metadata?.userId;
      if (userId) {
        await c.env.DB.prepare("UPDATE users SET subscription_active=?, subscription_current_period_end=? WHERE id=?").bind(active, periodEnd, userId).run();
      } else {
        await c.env.DB.prepare("UPDATE users SET subscription_active=?, subscription_current_period_end=? WHERE subscription_id=?").bind(active, periodEnd, obj.id).run();
      }
    } else if (event.type === "customer.subscription.deleted") {
      await c.env.DB.prepare("UPDATE users SET subscription_active=0 WHERE subscription_id=?").bind(obj.id).run();
    }
  } catch (e) {
    console.error("billing webhook handling error:", e.message);
  }
  return c.text("ok");
});

/* ================================ AI提案 ================================ */
function ruleSuggestions(state) {
  const sug = [];
  const t = state.currentTimeMs;
  for (const m of state.members) {
    if (m.status === "勤務中" && m.remainBreakMin > 0 && m.workedMin >= 240) {
      sug.push({ kind: "break", memberName: m.name, title: `${m.name}さんに休憩を提案`, detail: `必要休憩${m.requiredBreakMin}分に対し取得${m.takenBreakMin}分。今から${m.remainBreakMin}分の休憩予定を入れましょう。` });
    }
    if (!m.checkedOut && m.workLeftMin > 0 && m.workLeftMin <= 60) {
      sug.push({ kind: "info", memberName: m.name, title: `${m.name}さんは間もなく勤務終了`, detail: `勤務残り${m.workLeftMin}分。引き継ぎと退勤処理の準備をしてください。` });
    }
  }
  const idle = state.members.filter((m) => m.status === "勤務中" && !m.currentAssign);
  idle.slice(0, 2).forEach((m) => sug.push({ kind: "info", memberName: m.name, title: `${m.name}さんは現在配置なし`, detail: "手すきの状態です。必要な配置への割り当てを検討してください。" }));
  if (sug.length === 0) sug.push({ kind: "info", title: "現場は安定しています", detail: "休憩不足・配置の空きはありません。この状態を維持しましょう。" });
  return sug.slice(0, 4);
}

app.post("/api/v1/teams/:id/ai-suggest", async (c) => {
  const teamId = c.req.param("id");
  const me = await resolveParticipant(c, teamId);
  if (!isAdmin(me)) return ng(c, "AUTH-002", "AI提案は管理者のみ利用できます。", 403);
  const team = await c.env.DB.prepare("SELECT ai_enabled, owner_user_id FROM teams WHERE id = ?").bind(teamId).first();
  if (!team?.ai_enabled) return ng(c, "AUTH-002", "このチームはAI提案がOFFになっています。参加者一覧(詳細)からONにできます。", 403);
  if (!isFreeMode(c.env)) {
    const billing = await getBilling(c.env, team.owner_user_id);
    if (!billingOk(billing)) return ng(c, "BILL-001", "AI提案の利用枠がありません。プラン契約またはクレジット購入が必要です。", 402);
    if (billing.plan_type === "credits") {
      // 残高が1以上の場合のみ1減らす(D1の条件付きUPDATEで同時実行時も安全に処理)
      const dec = await c.env.DB.prepare("UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ? AND credit_balance > 0")
        .bind(team.owner_user_id).run();
      if (!dec.meta.changes) return ng(c, "BILL-001", "クレジット残高が不足しています。追加購入してください。", 402);
    }
  }

  const t = now();
  const parts = (await c.env.DB.prepare("SELECT * FROM participants WHERE team_id = ?").bind(teamId).all()).results;
  const brks = (await c.env.DB.prepare("SELECT b.* FROM breaks b JOIN participants p ON p.id = b.participant_id WHERE p.team_id = ?").bind(teamId).all()).results;
  const asgs = (await c.env.DB.prepare("SELECT * FROM assignments WHERE team_id = ?").bind(teamId).all()).results;

  const members = parts.map((p) => {
    const myBrs = brks.filter((b) => b.participant_id === p.id);
    const onBrk = myBrs.some((b) => !b.end_at);
    const taken = myBrs.reduce((a, b) => a + minDiff(b.start_at, b.end_at ?? t), 0);
    const req = requiredBreak(minDiff(p.plan_start, p.plan_end));
    const status = p.check_out ? "退勤済み" : t < p.plan_start ? "開始前" : onBrk ? "休憩中" : "勤務中";
    const cur = asgs.find((a) => a.participant_id === p.id && t >= a.start_at && t < a.end_at);
    return {
      name: p.name, status,
      plan: `${fmtHM(p.plan_start)}-${fmtHM(p.plan_end)}`,
      requiredBreakMin: req, takenBreakMin: taken, remainBreakMin: Math.max(0, req - taken),
      workedMin: t >= p.plan_start && !p.check_out ? minDiff(p.plan_start, t) : 0,
      workLeftMin: p.check_out ? 0 : Math.max(0, minDiff(t, p.plan_end)),
      currentAssign: cur?.name || null, checkedOut: !!p.check_out,
    };
  });
  const state = { currentTime: fmtHM(t), currentTimeMs: t, members };

  let suggestions = null, source = "rule", debug = "";
  if (c.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": c.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 800,
          messages: [{
            role: "user",
            content: `あなたはイベント現場運営のAIアシスタントです。以下の現場状況JSONを分析し、現場責任者への提案を最大4件、JSON配列のみで返してください(前置き・コードブロック禁止)。各要素: {"title":"短い見出し","detail":"具体的な提案(80字以内)","kind":"break"|"assign"|"info","memberName":"対象者名(あれば)"}。休憩不足の解消を最優先してください。\n\n${JSON.stringify({ currentTime: state.currentTime, members })}`,
          }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        debug = `HTTP ${res.status}: ${errText.slice(0, 300)}`;
        console.error("ai-suggest: API error", debug);
        throw new Error(debug);
      }
      const data = await res.json();
      const text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
      try {
        suggestions = JSON.parse(text.replace(/```json|```/g, "").trim());
      } catch (parseErr) {
        debug = `JSON解析失敗: ${text.slice(0, 300)}`;
        console.error("ai-suggest: parse error", debug);
        throw parseErr;
      }
      source = "ai";
    } catch (e) {
      if (!debug) debug = `fetch失敗: ${e.message || e}`;
      console.error("ai-suggest: fallback to rule-based:", debug);
      suggestions = null;
    }
  } else {
    debug = "ANTHROPIC_API_KEY が未設定です";
  }
  if (!suggestions) suggestions = ruleSuggestions(state);
  // 適用用パラメータを付与
  const mapped = suggestions.map((s) => {
    const p = parts.find((x) => x.name === s.memberName);
    const m = members.find((x) => x.name === s.memberName);
    if (s.kind === "break" && p) return { ...s, pid: p.id, start: t, end: t + Math.max(15, m?.remainBreakMin || 30) * 60000, name: "休憩予定" };
    if (s.kind === "assign" && p) return { ...s, pid: p.id, start: t, end: t + 120 * 60000 };
    return s;
  });
  return ok(c, { suggestions: mapped, source, debug });
});

/* ================================ フォールバック ================================ */
app.all("/api/*", (c) => ng(c, "DATA-001", "APIが見つかりません。", 404));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
