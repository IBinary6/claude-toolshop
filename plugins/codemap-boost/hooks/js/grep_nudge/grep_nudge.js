#!/usr/bin/env node
// ABOUTME: PreToolUse:Grep 钩子 - 根据搜索路径判断推荐工具
// ABOUTME: 路径在当前仓库内 → 推荐 CRG 图谱搜索
// ABOUTME: 路径在仓库外 → 降级推荐 serena 等语义工具
// ABOUTME: CRG 不在 PATH 时静默退出, 永不阻塞 Grep
//
// stdin: PreToolUse JSON { tool_name, tool_input: { path?, pattern, ... } }
// stdout: hookSpecificOutput.additionalContext JSON + exit 0
//   - 不带 permissionDecision -> 仍放行 Grep (软提示, 不 deny)

'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { commandExists, readStdinJson } = require('../lib/utils');

// CRG CLI 不在 PATH -> 没必要推 CRG 工具, 但仍可推荐 serena
const hasCrg = commandExists('code-review-graph');

/**
 * 解析当前仓库根目录
 */
function getRepoRoot() {
  try {
    const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 判断目标路径是否在仓库根目录内
 * Windows 路径规范化：统一小写 + 正斜杠比较
 */
function isPathInRepo(targetPath, repoRoot) {
  if (!targetPath || !repoRoot) return true; // 无路径 = 默认 cwd = 在 repo 内
  try {
    const normalizedTarget = path.resolve(targetPath).replace(/\\/g, '/').toLowerCase();
    const normalizedRepo = path.resolve(repoRoot).replace(/\\/g, '/').toLowerCase();
    return normalizedTarget.startsWith(normalizedRepo + '/') || normalizedTarget === normalizedRepo;
  } catch {
    return true; // 解析失败保守处理：当作 repo 内
  }
}

// CRG 推荐（路径在 repo 内）
const CRG_CONTEXT =
  'Use code-review-graph MCP tools for code structure (symbols/functions/classes/calls/refs). ' +
  'Use Grep only for plain-text/string/comment search.';

// 降级推荐（路径在 repo 外）
const EXTERNAL_CONTEXT =
  'Target path is OUTSIDE the current repository — code-review-graph cannot help here. ' +
  'For cross-repo symbol/structure lookups, prefer mcp__serena tools (find_symbol, find_declaration, get_symbols_overview). ' +
  'Grep is acceptable for plain-text search in external paths.';

async function main() {
  let input;
  try {
    input = await readStdinJson({ timeoutMs: 2000 });
  } catch {
    // stdin 解析失败：降级为旧行为（有 CRG 就推荐）
    if (hasCrg) {
      emitContext(CRG_CONTEXT);
    }
    process.exit(0);
    return;
  }

  const grepPath = (input && input.tool_input && input.tool_input.path) || null;
  const repoRoot = getRepoRoot();

  if (isPathInRepo(grepPath, repoRoot)) {
    // 路径在 repo 内：推荐 CRG（如果可用）
    if (hasCrg) {
      emitContext(CRG_CONTEXT);
    }
  } else {
    // 路径在 repo 外：降级推荐 serena
    emitContext(EXTERNAL_CONTEXT);
  }

  process.exit(0);
}

function emitContext(text) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: text
    }
  };
  try {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } catch {}
}

main();
