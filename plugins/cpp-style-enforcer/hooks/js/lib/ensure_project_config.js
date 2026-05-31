'use strict';

const fs = require('fs');
const path = require('path');
const { userTemplatePath, DEFAULT_CONFIG } = require('./config.js');

/**
 * 走全套流程且项目根缺少 .claude-cpp-style/cpp-style.json 时，从全局模板拷一份到项目根。
 * 与 ensureClangFormatConfig 同样的触发条件：让项目自带一份可编辑的本地配置。
 *
 * - root 为 null（非 git）→ 不生成（无可靠项目根概念）。
 * - root/.claude-cpp-style/cpp-style.json 已存在 → 绝不覆盖，直接返回。
 * - 内容来源：全局模板 ~/.claude/cpp-style-template.json；缺失/损坏 → 硬编码默认 schema。
 * - 写文件 UTF-8 无 BOM、LF；失败 try/catch 不崩。
 *
 * @param {string|null} root git 仓库根
 * @param {string} [templatePath] 全局模板路径（默认 ~/.claude/cpp-style-template.json）
 */
function ensureProjectConfig(root, templatePath = userTemplatePath()) {
  if (!root) return;
  try {
    const dir = path.join(root, '.claude-cpp-style');
    const target = path.join(dir, 'cpp-style.json');
    if (fs.existsSync(target)) return;

    let content = null;
    try {
      if (templatePath && fs.existsSync(templatePath)) {
        const raw = fs.readFileSync(templatePath, 'utf-8');
        JSON.parse(raw); // 校验全局模板是合法 JSON，损坏则回退默认
        content = raw;
      }
    } catch (_) {
      content = null;
    }
    if (content === null) {
      content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, Buffer.from(content, 'utf-8'));
  } catch (_) {
    // 生成失败不影响主流程
  }
}

module.exports = { ensureProjectConfig };
