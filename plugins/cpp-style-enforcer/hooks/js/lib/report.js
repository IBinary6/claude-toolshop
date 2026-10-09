'use strict';

const MAX_CHANGED_FILES_SHOWN = 10;

/**
 * Cap the length of the auto-rewritten file list so the Stop report cannot take unbounded model context.
 * @param {string[]} filePaths
 * @returns {string}
 * @example
 * formatChangedFiles(['a.cpp', 'b.h']) // '  - a.cpp\n  - b.h'
 */
function formatChangedFiles(filePaths) {
  const shown = filePaths.slice(0, MAX_CHANGED_FILES_SHOWN);
  let output = shown.map((filePath) => `  - ${filePath}`).join('\n');
  const remaining = filePaths.length - shown.length;
  if (remaining > 0) {
    output += `\n  ... and ${remaining} more file(s) not shown`;
  }
  return output;
}

module.exports = { formatChangedFiles, MAX_CHANGED_FILES_SHOWN };
