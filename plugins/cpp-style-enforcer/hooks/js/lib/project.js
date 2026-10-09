'use strict';

const fs = require('fs');
const path = require('path');

const _cache = new Map(); // In-process cache (every hook run is its own process)

/**
 * Walk up from the edited file looking for CMakeLists.txt, independent of git.
 * @param {string} filePath
 * @returns {string|null} The CMake project root (the directory containing CMakeLists.txt), or null.
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
