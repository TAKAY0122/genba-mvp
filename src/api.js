/* APIクライアント: セッショントークン(アカウント) / 参加トークン(ゲスト)を管理 */

const LS_SESSION = "genba.session";
const LS_PTOKENS = "genba.ptokens"; // { [teamId]: "pt_..." }

export const store = {
  getSession: () => localStorage.getItem(LS_SESSION) || "",
  setSession: (t) => (t ? localStorage.setItem(LS_SESSION, t) : localStorage.removeItem(LS_SESSION)),
  getPTokens: () => JSON.parse(localStorage.getItem(LS_PTOKENS) || "{}"),
  setPToken: (teamId, token) => {
    const m = store.getPTokens();
    m[teamId] = token;
    localStorage.setItem(LS_PTOKENS, JSON.stringify(m));
  },
};

async function call(method, path, body, token) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch (e) { json = { success: false, message: "サーバーエラーが発生しました。" }; }
  if (!json.success) {
    const err = new Error(json.message || "エラーが発生しました。");
    err.code = json.errorCode;
    err.status = res.status;
    throw err;
  }
  return json.data;
}

/* チーム操作: セッション優先、なければ参加トークン */
const teamToken = (teamId) => store.getSession() || store.getPTokens()[teamId] || "";

export const api = {
  // 認証
  register: (b) => call("POST", "/api/v1/register", b),
  login: (b) => call("POST", "/api/v1/login", b),
  logout: () => call("POST", "/api/v1/logout", null, store.getSession()).catch(() => {}),
  me: () => call("GET", "/api/v1/me", null, store.getSession()),
  mypage: () => call("GET", "/api/v1/mypage", null, store.getSession()),

  // チーム
  createTeam: (b) => call("POST", "/api/v1/teams", b, store.getSession()),
  myTeams: () => call("GET", "/api/v1/teams", null, store.getSession()),
  teamByCode: (code) => call("GET", `/api/v1/teams/by-code/${code}`),
  join: (code, b) => call("POST", `/api/v1/teams/${code}/join`, b, store.getSession()),
  deleteTeam: (id) => call("DELETE", `/api/v1/teams/${id}`, null, teamToken(id)),

  // 状態(5秒ポーリング)
  state: (id) => call("GET", `/api/v1/teams/${id}/state`, null, teamToken(id)),

  // 勤務・休憩
  breakStart: (id, participantId) => call("POST", `/api/v1/teams/${id}/breaks/start`, { participantId }, teamToken(id)),
  breakEnd: (id, participantId) => call("POST", `/api/v1/teams/${id}/breaks/end`, { participantId }, teamToken(id)),
  checkout: (id, participantId) => call("POST", `/api/v1/teams/${id}/checkout`, { participantId }, teamToken(id)),
  editRecords: (id, pid, b) => call("PATCH", `/api/v1/teams/${id}/participants/${pid}/records`, b, teamToken(id)),
  toggleRole: (id, pid) => call("POST", `/api/v1/teams/${id}/participants/${pid}/role`, {}, teamToken(id)),
  setDisplayBadge: (id, badge) => call("PATCH", `/api/v1/teams/${id}/display-badge`, { badge }, teamToken(id)),

  // 配置
  addAssign: (id, b) => call("POST", `/api/v1/teams/${id}/assignments`, b, teamToken(id)),
  editAssign: (id, aid, b) => call("PATCH", `/api/v1/teams/${id}/assignments/${aid}`, b, teamToken(id)),
  delAssign: (id, aid) => call("DELETE", `/api/v1/teams/${id}/assignments/${aid}`, null, teamToken(id)),

  // チャット・通知
  sendChat: (id, text) => call("POST", `/api/v1/teams/${id}/chat`, { text }, teamToken(id)),
  sendNotify: (id, b) => call("POST", `/api/v1/teams/${id}/notifications`, b, teamToken(id)),
  readNotify: (id, ids) => call("POST", `/api/v1/teams/${id}/notifications/read`, { ids }, teamToken(id)),

  // 投票
  vote: (id, targetId) => call("POST", `/api/v1/teams/${id}/vote`, { targetId }, teamToken(id)),
  closeVoting: (id) => call("POST", `/api/v1/teams/${id}/close-voting`, {}, teamToken(id)),

  // 監査・AI
  auditLogs: (id) => call("GET", `/api/v1/teams/${id}/audit`, null, teamToken(id)),
  aiSuggest: (id) => call("POST", `/api/v1/teams/${id}/ai-suggest`, {}, teamToken(id)),
};
