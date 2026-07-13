'use strict';

const { spawn } = require('child_process');

const WORKER_ARG = '--codemap-background-worker';

function launchDetachedSelf(scriptFile, cwd) {
  if (process.argv.includes(WORKER_ARG)) return false;
  try {
    const worker = spawn(process.execPath, [scriptFile, WORKER_ARG], {
      cwd,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: process.env,
    });
    worker.unref();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  WORKER_ARG,
  launchDetachedSelf,
};
