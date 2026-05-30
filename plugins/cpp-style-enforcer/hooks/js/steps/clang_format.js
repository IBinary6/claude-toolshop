'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripBom, restoreBom } = require('../lib/bom_util.js');
const { changedLineRanges } = require('../lib/git.js');

const isWindows = process.platform === 'win32';

/**
 * BOM 感知的双模式 clang-format。
 * 剥 BOM → 无 BOM 正文经 stdin 喂 clang-format(stdout) → 与无 BOM 正文 diff
 * → 仅变化时 restoreBom 写回。clang-format 缺失/失败静默返回 false。不用 -i。
 *
 * 模式（由 opts.isNew 决定，缺省视为新文件）：
 * - 新文件：整文件全格，-style=file -fallback-style=Google，include 正常排序。
 * - 老文件：仅格 git 改动行（--lines=s:e），-style 内联 SortIncludes:Never
 *   强制 include 不排序；无改动行则不格式化返回 false。
 *
 * 行号说明：--lines 作用于 stdin 输入（已剥 BOM 的正文）。剥 BOM 仅去掉文件最前
 * 3 字节（BOM 在第一行行首，不增减行），故 git diff 的改动行号可直接用作 --lines。
 *
 * @param {string} filePath
 * @param {{isNew?:boolean, root?:string|null}} [opts]
 * @returns {boolean} 是否改写了文件
 */
function applyClangFormat(filePath, opts) {
  const isNew = !opts || opts.isNew !== false; // 缺省 → 新文件整文件模式
  const root = opts && opts.root ? opts.root : null;

  let raw;
  try { raw = fs.readFileSync(filePath); } catch (_) { return false; }
  const { hadBom, body } = stripBom(raw);

  let args;
  if (isNew) {
    args = ['-style=file', '-fallback-style=Google', `-assume-filename=${filePath}`];
  } else {
    const ranges = changedLineRanges(filePath, root);
    if (!ranges || ranges.length === 0) return false; // 无改动行 → 不格式化
    args = ['-style={BasedOnStyle: Google, SortIncludes: Never}', `-assume-filename=${filePath}`];
    for (const [s, e] of ranges) args.push(`--lines=${s}:${e}`);
  }

  const r = spawnSync(
    'clang-format',
    args,
    { input: body, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 32 * 1024 * 1024, windowsHide: isWindows }
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
