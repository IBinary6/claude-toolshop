'use strict';

const path = require('path');
const { ensureUserTemplate } = require('./lib/config');

// 插件出厂默认模板绝对路径（hooks/js → 插件根 → templates/）
const PLUGIN_DEFAULT_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'cpp-style-template.default.json');

try {
  ensureUserTemplate(PLUGIN_DEFAULT_TEMPLATE);
} catch (_) {
  // 复制失败（权限等）→ 静默吞掉，调用方按无全局模板降级硬编码默认
}

// 完全静默：无 stdout / stderr 输出
process.exit(0);
