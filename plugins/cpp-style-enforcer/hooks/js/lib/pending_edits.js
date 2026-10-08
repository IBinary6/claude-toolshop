'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 把会话/代理标识收敛为安全目录名，避免路径穿越与超长文件名。
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 * @example
 * safePart('../x', 'session') // '.._x'
 */
function safePart(value, fallback) {
  const text = String(value || fallback).replace(/[^A-Za-z0-9._-]/g, '_');
  return text.slice(0, 120) || fallback;
}

/**
 * 待处理 C++ 编辑记录目录：<数据目录>/pending-edits/<session_id>/<agent_id|main>。
 *
 * 按 agent_id 分桶：子代理的编辑由它自己的 SubagentStop 收尾，主 Agent 的编辑由 Stop 收尾，
 * 互不抢占。数据目录优先 CLAUDE_PLUGIN_DATA；手动安装缺失时回退系统临时目录，
 * 不写插件根，也不因缺少环境变量而静默跳过记录。
 * @param {object} input hook stdin JSON
 * @returns {string}
 * @example
 * pendingDir({ session_id: 's1' }) // '<data>/pending-edits/s1/main'
 */
function pendingDir(input) {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA
    || path.join(os.tmpdir(), 'cpp-style-enforcer');
  return path.join(
    path.resolve(dataDir),
    'pending-edits',
    safePart(input && input.session_id, 'session'),
    safePart(input && input.agent_id, 'main'),
  );
}

/**
 * 记录本次编辑触碰的 C++ 文件；每次工具调用一个 JSON 文件，先写临时文件再 rename，
 * 并行 PostToolUse 不会互相覆盖。失败返回 false，不影响编辑流程。
 * @param {object} input hook stdin JSON
 * @param {string[]} filePaths
 * @returns {boolean}
 * @example
 * recordPendingPaths({ session_id: 's1', tool_use_id: 't1' }, ['/p/a.cpp']) // true
 */
function recordPendingPaths(input, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return false;
  const dir = pendingDir(input);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const id = safePart(input && input.tool_use_id, `${process.pid}-${Date.now()}-${Math.random()}`);
    const target = path.join(dir, `${id}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(filePaths.map((filePath) => path.resolve(filePath))), 'utf8');
    fs.renameSync(temp, target);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 取出并删除当前桶内全部待处理路径（去重）。目录不存在返回 []。
 * @param {object} input Stop / SubagentStop stdin JSON
 * @returns {string[]}
 * @example
 * consumePendingPaths({ session_id: 's1' }) // ['/p/a.cpp']
 */
function consumePendingPaths(input) {
  const dir = pendingDir(input);
  const paths = new Set();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const values = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          if (typeof value === 'string' && value) paths.add(path.resolve(value));
        }
      } catch (_) {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    return [];
  }
  return [...paths];
}

module.exports = { recordPendingPaths, consumePendingPaths, pendingDir };
