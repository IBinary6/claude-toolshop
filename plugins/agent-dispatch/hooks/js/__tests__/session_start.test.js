'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SESSION_START = path.resolve(__dirname, '..', 'session_start.js');

function git(args, cwd) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 10000,
    windowsHide: process.platform === 'win32',
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function runSessionStart(repo, fakeHome) {
  return spawnSync('node', [SESSION_START], {
    input: JSON.stringify({ cwd: repo }),
    encoding: 'utf-8',
    timeout: 10000,
    cwd: repo,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dispatch-session-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dispatch-home-'));

try {
  git(['init'], repo);

  const globalDir = path.join(fakeHome, '.agent-dispatch');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'config.json'), JSON.stringify({
    schema_version: 2,
    modules: {},
    overrides: { tools_add: ['CustomTool'] }
  }), 'utf8');

  const first = runSessionStart(repo, fakeHome);
  assert.equal(first.status, 0, `SessionStart should exit 0: ${first.stderr}`);
  assert.equal((first.stdout || '').trim(), '', 'SessionStart stdout should stay empty');

  const globalConfigPath = path.join(fakeHome, '.agent-dispatch', 'config.json');
  const globalCfg = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
  assert.deepEqual(globalCfg.overrides.tools_add, ['CustomTool'], 'global overrides should keep user values');
  for (const key of [
    'tools_remove',
    'mcp_prefixes_add',
    'mcp_prefixes_remove',
    'mcp_block_exact_add',
    'mcp_block_exact_remove',
    'bash_heads_add',
    'bash_heads_remove'
  ]) {
    assert.ok(Array.isArray(globalCfg.overrides[key]), `global overrides.${key} should be bootstrapped`);
  }

  const projectConfigPath = path.join(repo, '.agent-dispatch', 'config.json');
  assert.ok(fs.existsSync(projectConfigPath), 'project config should be created');
  const projectCfg = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
  assert.ok(Array.isArray(projectCfg.overrides.mcp_prefixes_remove), 'project config exposes mcp_prefixes_remove');

  const gitignorePath = path.join(repo, '.gitignore');
  assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');
  assert.ok(fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/).includes('.agent-dispatch/'),
    '.agent-dispatch/ should be ignored at runtime');

  const second = runSessionStart(repo, fakeHome);
  assert.equal(second.status, 0, `second SessionStart should exit 0: ${second.stderr}`);
  const entries = fs.readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() === '.agent-dispatch/');
  assert.equal(entries.length, 1, '.agent-dispatch/ should not be duplicated in .gitignore');
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

console.log('✓ session_start.test.js — all assertions passed');
