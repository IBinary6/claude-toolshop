'use strict';

const childProcess = require('node:child_process');

const realSpawnSync = childProcess.spawnSync;

/**
 * Make only `git diff --cached` fail, to verify the fail-closed semantics of staged-file enumeration.
 *
 * @param {string} command The executable command.
 * @param {string[]} args The command arguments.
 * @param {object} options The spawnSync options.
 * @returns {object} The simulated or real child process result.
 */
childProcess.spawnSync = function failStagedDiff(command, args, options) {
  if (/^git(?:\.exe)?$/i.test(String(command))
      && Array.isArray(args) && args[0] === 'diff' && args.includes('--cached')) {
    return {
      status: 128,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from('simulated git diff failure', 'utf8'),
      error: undefined,
    };
  }
  return realSpawnSync.call(childProcess, command, args, options);
};
