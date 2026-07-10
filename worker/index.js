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
  return ok(c, { token, user: { id, email, name } });
});

app.post("/api/v1/login", async (c) => {
  const { email, password } = await c.req.json();
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email || "").first();
  if (!u || !(await verifyPassword(password || "", u.password_hash))) return ng(c, "AUTH-001", "メールアドレスまたはパスワードが違います。", 401);
  const token = uid("s_") + uid();
  await c.env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)")
    .bind(token, u.id, now() + 30 * 24 * 3600 * 1000).run();
  return ok(c, { token, user: { id: u.id, email: u.email, name: u.name } });
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
  return ok(c, { user: u });
});

/* ================================ チーム ================================ */
app.post("/api/v1/teams", async (c) => {
  const u = c.get("user");
  if (!u) return ng(c, "AUTH-001", "チーム作成にはログインが必要です。", 401);
  const { siteName, venueName, section, date } = await c.req.json();
  if (!siteName || !venueName || !date) return ng(c, "VAL-001", "現場名・会場名・開催日は必須です。");
  const id = uid("t_");
  const code = uid().slice(0, 8).toUpperCase();
  await c.env.DB.prepare(
    "INSERT INTO teams (id, code, site_name, venue_name, section, event_date, owner_user_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(id, code, siteName, venueName, section || "", date, u.id, now()).run();
  return ok(c, { team: { id, code, siteName, venueName, section, date } });
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
    team: { id: team.id, code: team.code, siteName: team.site_name, venueName: team.venue_name, section: team.section, date: team.event_date, votingClosed: !!team.voting_closed },
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
