'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripBom, restoreBom } = require('../lib/bom_util.js');

const isWindows = process.platform === 'win32';

/**
 * BOM 感知的 clang-format：剥 BOM → 无 BOM 正文经 stdin 喂 clang-format(stdout)
 * → 与无 BOM 正文 diff → 仅变化时 restoreBom 写回。clang-format 缺失静默返回。
 * 不用 -i、不传 --sort-includes。
 * @param {string} filePath
 * @returns {boolean} 是否改写了文件
 */
function applyClangFormat(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);

  const r = spawnSync(
    'clang-format',
    ['-style=file', '-fallback-style=Google', `-assume-filename=${filePath}`],
    { input: body, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, windowsHide: isWindows }
  );
  // clang-format 不在 PATH（ENOENT）或执行失败 → 静默跳过
  if (r.error || r.status !== 0 || !r.stdout) return false;

  const formatted = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
  if (formatted.equals(body)) return false; // 无变化不写

  try {
    fs.writeFileSync(filePath, restoreBom(hadBom, formatted));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { applyClangFormat };
