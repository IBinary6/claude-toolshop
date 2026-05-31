'use strict';

const path = require('path');
const { ensureUserTemplate } = require('./lib/config');
const { spawnPrewarm } = require('./lib/ensure_deps');

// 插件出厂默认模板绝对路径（hooks/js → 插件根 → templates/）
const PLUGIN_DEFAULT_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'cpp-style-template.default.json');

try {
  ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE);
} catch (_) {
  // 复制失败（权限等）→ 静默吞掉，调用方按无全局模板降级硬编码默认
}

try {
  // 后台 detached 预热 iconv-lite / clang-format，不阻塞 SessionStart、不占 10s timeout。
  // 子进程 stdio:ignore 保持静默契约；失败返回 null，绝不影响 exit 0。
  spawnPrewarm();
} catch (_) {
  // 预热不可用 → 编辑期 steps 走现有降级（GBK 跳过 / clang-format 跳过）
}

// 完全静默：无 stdout / stderr 输出
process.exit(0);
