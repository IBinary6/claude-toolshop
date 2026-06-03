#!/usr/bin/env node
/**
 * codemap-pro SessionStart 钩子 - CLAUDE.md 提示注入
 *
 * 职责:
 * 1. 检测 codemap-boost 是否存在 → 存在则跳过（互斥）
 * 2. 版本化幂等注入/更新 CodeGraph 使用规则
 * 3. 触发依赖预热（后台安装 codegraph）
 *
 * 参考: codemap-boost/hooks/js/claudemd_inject/claudemd_inject.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// 触发依赖预热（失败不阻塞）
try {
  require('../lib/ensure_deps').spawnPrewarm();
} catch (_) {}

const target = path.join(os.homedir(), '.claude', 'CLAUDE.md');

function ensureTargetDir() {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (_) {}
}

// 版本标记 - 用于幂等更新
const SNIPPET_VERSION = 'codemap-pro-snippet-v1';
const SECTION_START = '## 代码结构图触发规则 (CodeGraph)';

// 提示内容
const SNIPPET = `

${SECTION_START}
本仓库已安装 codemap-pro (CodeGraph)。代码搜索优先使用 \`mcp__codegraph__*\` 工具，仅在未命中时降级到 Grep。

<!-- ${SNIPPET_VERSION} -->
`;

// 读取现有 CLAUDE.md
let existing = '';
try {
  existing = fs.readFileSync(target, 'utf-8');
} catch (err) {
  if (err.code === 'ENOENT') {
    // 文件不存在 → 走追加分支
    existing = '';
  } else {
    // 其他读取错误 → 保守不动
    process.exit(0);
  }
}

// 互斥检测 - codemap-boost 已存在
if (existing.includes('codemap-boost-snippet')) {
  console.error('[codemap-pro] 检测到 codemap-boost，跳过注入（两个插件不能同时使用）');
  process.exit(0);
}

// 1. 已是最新版本 → 不动
if (existing.includes(SNIPPET_VERSION)) {
  process.exit(0);
}

// 2. 有旧版段落（含 SECTION_START 但无版本标记）→ 精准替换
if (existing.includes(SECTION_START)) {
  const startIdx = existing.indexOf(SECTION_START);

  // 回退吃掉前导换行
  let prefixEnd = startIdx;
  while (prefixEnd > 0 && existing[prefixEnd - 1] === '\n') {
    prefixEnd--;
  }

  // 找下一个同级 ## 标题（排除 ###）
  const afterStart = existing.slice(startIdx + SECTION_START.length);
  const nextH2 = afterStart.search(/\n## [^#]/);
  const suffixStart = nextH2 >= 0
    ? startIdx + SECTION_START.length + nextH2
    : existing.length;

  try {
    ensureTargetDir();
    fs.writeFileSync(
      target,
      existing.slice(0, prefixEnd) + SNIPPET + existing.slice(suffixStart),
      'utf-8'
    );
  } catch (_) {}

  process.exit(0);
}

// 3. 全新 → 追加
try {
  ensureTargetDir();
  fs.appendFileSync(target, SNIPPET, 'utf-8');
} catch (_) {}

process.exit(0);
