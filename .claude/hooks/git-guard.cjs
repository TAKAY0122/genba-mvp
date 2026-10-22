#!/usr/bin/env node
// PreToolUse hook (matcher: Bash|PowerShell)。
// 1. 破壊的なgitコマンド(force push / reset --hard / branch -D / clean -f)を機械的に拒否する。
// 2. `git commit` 実行前に、CLAUDE.local.md が誤ってステージされていないか確認する。
// AIの判断や合意事項(CLAUDE.md)に依存せず、常にこのスクリプトが強制する。

const { execSync } = require("child_process");

const DESTRUCTIVE_PATTERNS = [
  { re: /\bgit\s+push\b(?:(?!\n).)*(--force\b|-f\b)/i, reason: "git push の force系オプション(--force / --force-with-lease / -f)は拒否しています。リモート履歴を上書きする危険な操作です。" },
  { re: /\bgit\s+reset\b(?:(?!\n).)*--hard\b/i, reason: "git reset --hard は拒否しています。未コミットの変更を破棄する危険な操作です。" },
  { re: /\bgit\s+branch\b(?:(?!\n).)*(-D\b|--delete\s+--force\b)/i, reason: "git branch -D(強制削除)は拒否しています。" },
  { re: /\bgit\s+clean\b(?:(?!\n).)*(-[a-zA-Z]*f[a-zA-Z]*\b|--force\b)/i, reason: "git clean -f 系は拒否しています。未追跡ファイルを完全に削除する危険な操作です。" },
];

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

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return allow(); // 入力を解釈できない場合はブロックしない(harness側の想定外形式)
  }

  const command = (input.tool_input && input.tool_input.command) || "";
  if (!command) return allow();

  for (const { re, reason } of DESTRUCTIVE_PATTERNS) {
    if (re.test(command)) return deny(reason);
  }

  if (/\bgit\s+commit\b/i.test(command)) {
    try {
      const staged = execSync("git diff --cached --name-only", { encoding: "utf8" });
      if (staged.split(/\r?\n/).some((f) => f.trim() === "CLAUDE.local.md")) {
        return deny("CLAUDE.local.md がステージされています(個人用・Git管理外のファイルです)。`git restore --staged CLAUDE.local.md` で外してからコミットしてください。");
      }
    } catch {
      // git自体が使えない/リポジトリ外などの場合はチェックをスキップし、コミット自体は妨げない
    }
  }

  return allow();
});
