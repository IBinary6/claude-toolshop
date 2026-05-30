'use strict';

const fs = require('fs');
const path = require('path');

const _cache = new Map(); // 单进程内缓存（每次 hook 是独立进程）

/**
 * 从被编辑文件向上逐级找 CMakeLists.txt，与 git 解耦。
 * @param {string} filePath
 * @returns {string|null} CMake 项目根（含 CMakeLists.txt 的目录）；找不到 null
 */
function findCMakeRoot(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (_cache.has(filePath)) return _cache.get(filePath);
  let result = null;
  try {
    let dir = path.dirname(path.resolve(filePath));
    let prev = null;
    while (dir && dir !== prev) {
      if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
        result = fs.existsSync(dir) ? fs.realpathSync(dir) : dir;
        break;
      }
      prev = dir;
      dir = path.dirname(dir);
    }
  } catch (_) {
    result = null;
  }
  _cache.set(filePath, result);
  return result;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isCMakeProject(filePath) {
  return findCMakeRoot(filePath) !== null;
}

module.exports = { findCMakeRoot, isCMakeProject };
