'use strict';

const fs = require('node:fs');
const path = require('node:path');

const realRmSync = fs.rmSync;
let failedSnapshot = null;

/**
 * Make only the first staged-snapshot cleanup fail, to verify the fail-closed semantics of the commit check.
 *
 * @param {string} target The path to delete.
 * @param {object} options The rmSync options.
 * @returns {void}
 */
fs.rmSync = function failFirstSnapshotCleanup(target, options) {
  if (!failedSnapshot && path.basename(String(target)).startsWith('cpp-style-staged-')) {
    failedSnapshot = target;
    throw new Error('simulated snapshot cleanup failure');
  }
  return realRmSync.call(fs, target, options);
};

process.once('exit', () => {
  if (!failedSnapshot) return;
  try { realRmSync.call(fs, failedSnapshot, { recursive: true, force: true }); } catch (_) {}
});
