#!/usr/bin/env node
// ABOUTME: PreToolUse:Grep 钩子 - 每会话首次 Grep 时提示优先用 CRG 图谱搜索
// ABOUTME: 用 sentinel 文件控频, CRG 不在 PATH 时静默退出, 永不阻塞 Grep
//
// sentinel 路径: os.tmpdir() / grep-nudge-<key>.lock
//   key 优先 CLAUDE_SESSION_ID, 缺失则 sha1(cwd).slice(0,16)
// 首次: 写 sentinel + 输出 systemMessage JSON + exit 0
// 后续: sentinel 存在直接 exit 0 不输出
// CRG CLI 不在 PATH -> 静默 exit 0 (commandExists)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { commandExists } = require('../lib/utils');

// CRG CLI 不在 PATH -> 没必要推 CRG 工具, 静默退出
if (!commandExists('code-review-graph')) {
  process.exit(0);
}

const cwd = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();
const sessionId = process.env.CLAUDE_SESSION_ID;
const key = sessionId && sessionId.trim()
  ? sessionId.trim()
  : crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 16);

const sentinel = path.join(os.tmpdir(), `grep-nudge-${key}.lock`);

// 已提示过 -> 静默
if (fs.existsSync(sentinel)) {
  process.exit(0);
}

// 首次: 原子写 sentinel (wx 标志, 已存在则失败, 避免并发重复输出)
try {
  fs.writeFileSync(sentinel, String(process.pid), { flag: 'wx' });
} catch (e) {
  // 并发竞争, 别人写了 -> 静默
  process.exit(0);
}

// 输出 systemMessage 通知 Claude 优先用 CRG
const payload = {
  continue: true,
  systemMessage: '本仓库有 code-review-graph 索引，符号/调用关系搜索优先用 mcp__code-review-graph__semantic_search_nodes_tool 或 query_graph_tool。'
};

try {
  process.stdout.write(JSON.stringify(payload) + '\n');
} catch (e) {}

process.exit(0);
