#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write)。
// wrangler.toml の [vars] セクションに機密情報らしきキー(SECRET/KEY/TOKEN/PASSWORD等を含む変数名)を
// 書き込もうとした場合に拒否する。機密は `wrangler secret put` で設定するルール(CLAUDE.md)を、
// AIの判断に依存せず機械的に強制する。

const fs = require("fs");
const path = require("path");

const SECRET_KEY_RE = /SECRET|PASSWORD|PASSWD|TOKEN|CREDENTIAL|_KEY\b|^KEY\b/i;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function allow() {
  process.stdout.write("{}");
  process.exit(0);
}

function extractVarsBlock(content) {
  const m = content.match(/\[vars\]([\s\S]*?)(?=\n\s*\[|$)/i);
  return m ? m[1] : "";
}

function findSuspiciousKeys(varsBlock) {
  const found = [];
  const lineRe = /^\s*([A-Za-z0-9_]+)\s*=/gm;
  let m;
  while ((m = lineRe.exec(varsBlock))) {
    const key = m[1];
    if (SECRET_KEY_RE.test(key)) found.push(key);
  }
  return found;
}

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return allow();
  }

  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || "";
  if (path.basename(filePath) !== "wrangler.toml") return allow();

  let prospective;
  if (input.tool_name === "Write") {
    prospective = toolInput.content || "";
  } else {
    // Edit: 既存ファイルに old_string -> new_string を仮想的に適用してからチェックする
    let current = "";
    try {
      current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    } catch {
      current = "";
    }
    const oldStr = toolInput.old_string || "";
    const newStr = toolInput.new_string || "";
    if (oldStr && current.includes(oldStr)) {
      prospective = toolInput.replace_all
        ? current.split(oldStr).join(newStr)
        : current.replace(oldStr, newStr);
    } else {
      // 差分を適用できない場合も、新しく書き込まれる断片自体はチェックする
      prospective = current + "\n" + newStr;
    }
  }

  const varsBlock = extractVarsBlock(prospective);
  if (!varsBlock) return allow();

  const suspicious = findSuspiciousKeys(varsBlock);
  if (suspicious.length > 0) {
    return deny(
      `wrangler.toml の [vars] に機密情報らしきキー(${suspicious.join(", ")})を書き込もうとしています。` +
      `[vars] は平文で本番環境に残るため使わず、\`npx wrangler secret put <NAME>\` で設定してください。`
    );
  }

  return allow();
});
