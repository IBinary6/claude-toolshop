#!/usr/bin/env node
// 兼容旧安装：不再向 CLAUDE.md 注入提示，只清理历史片段。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER_RE = /(?:\r?\n){0,2}## 代码结构图触发规则\r?\n<!-- codemap-boost-snippet-v\d+ -->[\s\S]*?(?=\r?\n## [^#]|\s*$)/g;

(function main() {
  try {
    const target = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    const existing = fs.readFileSync(target, 'utf-8');
    const next = existing.replace(MARKER_RE, '').replace(/\s+$/, '\n');
    if (next !== existing) {
      fs.writeFileSync(target, next, 'utf-8');
    }
  } catch (_) {
    // 静默兼容：任何失败都不阻塞 SessionStart。
  }
})();
