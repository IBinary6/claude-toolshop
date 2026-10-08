'use strict';

const path = require('path');

/** C / C++ 源文件扩展名（含头文件） */
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx']);

/** 跳过检查的目录名（第三方 / 构建产物 / 包管理器） */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'build', 'dist', 'out', 'bin', 'obj',
  '.git', 'target', 'third_party', 'thirdparty', 'external',
  'vendor', 'deps', 'packages',
  '3rd', '3rdparty', '3rd_party', '3rd-party',
  'thirdpart', 'third-party', 'third_part', 'third-part',
  'thridpart', 'thridparty', 'thrid_party', 'thrid-party',
]);

/** 跳过的特定文件名（VS 自动生成 / 不该被风格化） */
const SKIPPED_FILES = new Set(['resource.h', 'targetver.h', 'stdafx.h', 'pch.h']);

const PATH_KEYS = new Set([
  'file_path', 'filePath', 'path', 'relative_path', 'relativePath',
  'target_path', 'targetPath',
]);
const PATCH_KEYS = new Set(['patch', 'diff']);

/**
 * 从 Agentic Patch / apply-patch 风格文本中提取目标文件。
 * 同时兼容 `*** Update File:`、重命名目标 `*** Move to:` 与 unified diff 的 `+++ b/...` 头。
 * @param {string} patchText
 * @returns {string[]}
 */
function patchPaths(patchText) {
  if (typeof patchText !== 'string') return [];
  const result = [];
  const patterns = [
    /^\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s*(.+?)\s*$/gm,
    /^\+\+\+\s+(?:b\/)?(.+?)\s*$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of patchText.matchAll(pattern)) {
      const value = match[1].trim();
      if (value && value !== '/dev/null') result.push(value);
    }
  }
  return result;
}

/**
 * 从内置编辑工具或 MCP 批量补丁参数中提取全部文件路径。
 * 只识别明确的路径字段和补丁头，不把普通 source content 当作路径。
 * @param {object} input
 * @returns {string[]}
 */
function resolveFilePaths(input) {
  if (!input || typeof input !== 'object') return [];
  const cwd = input.cwd || process.cwd();
  const paths = [];
  const add = (value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const file = value.trim();
    paths.push(path.isAbsolute(file) ? file : path.resolve(cwd, file));
  };
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (PATH_KEYS.has(key)) add(value);
      if (PATCH_KEYS.has(key)) patchPaths(value).forEach(add);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };

  if (typeof input.tool_input === 'string') add(input.tool_input);
  else visit(input.tool_input || null);
  for (const key of PATH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) add(input[key]);
  }
  const seen = new Set();
  return paths.filter((file) => {
    const key = file.replace(/\\/g, '/').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 从 hook stdin JSON 提取被编辑的文件路径（Write/Edit/MultiEdit/NotebookEdit/MCP）。
 * 不处理 Bash command（PostToolUse 已去掉 Bash matcher）。
 * 始终返回绝对路径：相对路径以 input.cwd（hook 协议提供，正常 Claude Code 传绝对 file_path）
 * 为基准解析，避免相对路径被原样漏过导致 repoRoot/配置查找/.clang-format 生成全错位。
 * @param {object} input
 * @returns {string|null}
 */
function resolveFilePath(input) {
  if (input && typeof input.tool_input === 'string') {
    const cwd = input.cwd || process.cwd();
    return path.isAbsolute(input.tool_input)
      ? input.tool_input
      : path.resolve(cwd, input.tool_input);
  }
  return resolveFilePaths(input)[0] || null;
}

/**
 * 是否应处理该文件：扩展名命中 && 非 SKIPPED_FILES && 路径无 EXCLUDED_DIRS。
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldHandle(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!CPP_EXTENSIONS.has(ext)) return false;
  if (SKIPPED_FILES.has(path.basename(filePath).toLowerCase())) return false;
  return !isExcludedPath(filePath);
}

/**
 * 按完整目录段匹配排除目录；文件名本身不参与，业务目录含 vendor/thirdparty 子串也不排除。
 * @param {string} filePath
 * @returns {boolean}
 * @example
 * isExcludedPath('/p/3rdparty/zlib/zlib.h') // true
 * isExcludedPath('/p/src/vendor_api.cpp')  // false
 */
function isExcludedPath(filePath) {
  return typeof filePath === 'string' && filePath.split(/[/\\]/).slice(0, -1)
    .some((part) => EXCLUDED_DIRS.has(part.toLowerCase()));
}

module.exports = {
  resolveFilePath,
  resolveFilePaths,
  shouldHandle,
  isExcludedPath,
  CPP_EXTENSIONS,
  EXCLUDED_DIRS,
  SKIPPED_FILES,
};
