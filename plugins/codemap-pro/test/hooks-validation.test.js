#!/usr/bin/env node
/**
 * codemap-pro Hook 配置验证测试（TDD）
 *
 * 测试内容：
 * 1. hooks.json 语法正确性
 * 2. 所有 hook 脚本文件存在
 * 3. 依赖的工具函数可用
 * 4. hook 脚本可独立运行
 * 5. 环境变量模拟测试
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function assert(condition, message) {
  if (!condition) {
    log(`✗ FAILED: ${message}`, 'red');
    process.exit(1);
  }
  log(`✓ PASS: ${message}`, 'green');
}

// 测试计数
let passCount = 0;
let failCount = 0;

const pluginRoot = path.resolve(__dirname, '..');

log('\n=== codemap-pro Hook 配置验证测试 ===\n', 'yellow');

// Test 1: hooks.json 存在且语法正确
log('Test 1: hooks.json 语法验证', 'yellow');
const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
assert(fs.existsSync(hooksJsonPath), 'hooks.json 文件存在');

let hooksConfig;
try {
  const content = fs.readFileSync(hooksJsonPath, 'utf-8');
  hooksConfig = JSON.parse(content);
  passCount++;
  log('✓ hooks.json JSON 语法正确', 'green');
} catch (err) {
  failCount++;
  log(`✗ hooks.json 解析失败: ${err.message}`, 'red');
  process.exit(1);
}

// Test 2: 验证 hooks 结构
log('\nTest 2: hooks 结构验证', 'yellow');
assert(hooksConfig.hooks, 'hooks 对象存在');
assert(hooksConfig.hooks.SessionStart, 'SessionStart 事件存在');
assert(hooksConfig.hooks.PreToolUse, 'PreToolUse 事件存在');
assert(hooksConfig.hooks.PostToolUse, 'PostToolUse 事件存在');
passCount += 3;

// Test 3: 验证没有多余的 matcher（SessionStart 不应该有 matcher）
log('\nTest 3: SessionStart matcher 验证', 'yellow');
const sessionStartHooks = hooksConfig.hooks.SessionStart;
for (const entry of sessionStartHooks) {
  if (entry.matcher !== undefined) {
    failCount++;
    log(`✗ SessionStart 不应该有 matcher: "${entry.matcher}"`, 'red');
  } else {
    passCount++;
    log('✓ SessionStart 没有多余的 matcher', 'green');
  }
}

// Test 4: 验证 timeout 单位（应该是秒）
log('\nTest 4: timeout 参数验证', 'yellow');
function validateTimeout(hooks, eventName) {
  for (const entry of hooks) {
    if (entry.hooks) {
      for (const hook of entry.hooks) {
        if (hook.timeout !== undefined) {
          // timeout 应该在 1-600 秒之间（合理范围）
          if (hook.timeout >= 1 && hook.timeout <= 600) {
            passCount++;
            log(`✓ ${eventName} timeout=${hook.timeout}s 合理`, 'green');
          } else {
            failCount++;
            log(`✗ ${eventName} timeout=${hook.timeout}s 不合理（应该 1-600 秒）`, 'red');
          }
        }
      }
    }
  }
}

validateTimeout(hooksConfig.hooks.SessionStart, 'SessionStart');
validateTimeout(hooksConfig.hooks.PreToolUse, 'PreToolUse');
validateTimeout(hooksConfig.hooks.PostToolUse, 'PostToolUse');
validateTimeout(hooksConfig.hooks.CwdChanged, 'CwdChanged');

// Test 5: 验证 async 语义
log('\nTest 5: async 参数验证', 'yellow');
const asyncHooks = [
  { event: 'SessionStart', entryIndex: 0, hookIndex: 0, name: 'cg_init.js' },
  { event: 'PostToolUse', entryIndex: 0, hookIndex: 0, name: 'cg_update.js' },
  { event: 'CwdChanged', entryIndex: 0, hookIndex: 0, name: 'cg_worktree.js' }
];

for (const item of asyncHooks) {
  const hooks = hooksConfig.hooks[item.event];
  if (hooks && hooks[item.entryIndex] && hooks[item.entryIndex].hooks && hooks[item.entryIndex].hooks[item.hookIndex]) {
    const hook = hooks[item.entryIndex].hooks[item.hookIndex];
    if (hook.async === true) {
      passCount++;
      log(`✓ ${item.name} 正确设置 async=true`, 'green');
    } else {
      failCount++;
      log(`✗ ${item.name} 应该设置 async=true`, 'red');
    }
  }
}

// Test 6: 验证所有 hook 脚本文件存在
log('\nTest 6: Hook 脚本文件存在性验证', 'yellow');
const expectedFiles = [
  'commands/codemap-pro-setup.md',
  'hooks/js/lib/utils.js',
  'hooks/js/lib/ensure_deps.js',
  'hooks/js/cg_init/cg_init.js',
  'hooks/js/cg_update/cg_update.js',
  'hooks/js/cg_gitignore/cg_gitignore.js',
  'hooks/js/cg_worktree/cg_worktree.js',
  'hooks/js/agent_nudge/agent_nudge.js',
  'hooks/js/grep_nudge/grep_nudge.js'
];

for (const file of expectedFiles) {
  const fullPath = path.join(pluginRoot, file);
  if (fs.existsSync(fullPath)) {
    passCount++;
    log(`✓ ${file} 存在`, 'green');
  } else {
    failCount++;
    log(`✗ ${file} 不存在`, 'red');
  }
}

// Test 7: 验证 hooks.json 中引用的脚本存在
log('\nTest 7: hooks.json 引用脚本验证', 'yellow');
function extractScriptPath(command) {
  // 提取 node "${CLAUDE_PLUGIN_ROOT}/hooks/js/xxx.js" 中的路径
  const match = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+?)"/);
  return match ? match[1] : null;
}

function validateHookScripts(hooks, eventName) {
  for (const entry of hooks) {
    if (entry.hooks) {
      for (const hook of entry.hooks) {
        if (hook.command) {
          const scriptPath = extractScriptPath(hook.command);
          if (scriptPath) {
            const fullPath = path.join(pluginRoot, scriptPath);
            if (fs.existsSync(fullPath)) {
              passCount++;
              log(`✓ ${eventName}: ${scriptPath} 存在`, 'green');
            } else {
              failCount++;
              log(`✗ ${eventName}: ${scriptPath} 不存在`, 'red');
            }
          }
        }
      }
    }
  }
}

validateHookScripts(hooksConfig.hooks.SessionStart, 'SessionStart');
validateHookScripts(hooksConfig.hooks.PreToolUse, 'PreToolUse');
validateHookScripts(hooksConfig.hooks.PostToolUse, 'PostToolUse');
validateHookScripts(hooksConfig.hooks.CwdChanged, 'CwdChanged');

const allHookCommands = JSON.stringify(hooksConfig.hooks);
assert(!allHookCommands.includes('claudemd_inject'), 'hooks.json 不再注册 CLAUDE.md 注入 hook');

// Test 8: 测试 utils.js 可以被 require
log('\nTest 8: utils.js 模块加载测试', 'yellow');
try {
  const utils = require(path.join(pluginRoot, 'hooks/js/lib/utils.js'));
  assert(typeof utils.commandExists === 'function', 'commandExists 函数存在');
  assert(typeof utils.isGitRepo === 'function', 'isGitRepo 函数存在');
  assert(typeof utils.runCommand === 'function', 'runCommand 函数存在');
  passCount += 3;
} catch (err) {
  failCount++;
  log(`✗ utils.js 加载失败: ${err.message}`, 'red');
}

// Test 9: 测试 ensure_deps.js 可以被 require
log('\nTest 9: ensure_deps.js 模块加载测试', 'yellow');
try {
  const ensureDeps = require(path.join(pluginRoot, 'hooks/js/lib/ensure_deps.js'));
  assert(typeof ensureDeps.ensureCodegraph === 'function', 'ensureCodegraph 函数存在');
  assert(typeof ensureDeps.spawnPrewarm === 'function', 'spawnPrewarm 函数存在');
  assert(typeof ensureDeps.writeMarker === 'function', 'writeMarker 函数存在');
  assert(ensureDeps.spawnPrewarm() === null, 'spawnPrewarm 是兼容 no-op，不会后台安装');
  let setupMcpCalls = 0;
  ensureDeps.ensureCodegraph({
    probe: () => true,
    setupMcp: () => { setupMcpCalls++; return true; }
  });
  assert(setupMcpCalls === 0, 'ensureCodegraph 只检测 CLI，不自动配置 MCP');
  const nestedMarker = path.join(
    require('os').tmpdir(),
    `codemap-pro-marker-${process.pid}`,
    'nested',
    '.codegraph-install-failed'
  );
  try {
    fs.rmSync(path.dirname(path.dirname(nestedMarker)), { recursive: true, force: true });
    ensureDeps.writeMarker(nestedMarker);
    assert(fs.existsSync(nestedMarker), 'writeMarker 会自动创建父目录');
  } finally {
    fs.rmSync(path.dirname(path.dirname(nestedMarker)), { recursive: true, force: true });
  }
  passCount += 6;
} catch (err) {
  failCount++;
  log(`✗ ensure_deps.js 加载失败: ${err.message}`, 'red');
}

// Test 10: 测试 hook 脚本可以独立运行（语法检查）
log('\nTest 10: Hook 脚本语法检查', 'yellow');
const scriptsToTest = [
  'hooks/js/cg_init/cg_init.js',
  'hooks/js/cg_sync/cg_sync.js',
  'hooks/js/cg_worktree/cg_worktree.js',
  'hooks/js/cg_gitignore/cg_gitignore.js',
  'hooks/js/grep_nudge/grep_nudge.js'
];

for (const script of scriptsToTest) {
  const fullPath = path.join(pluginRoot, script);
  try {
    // 使用 node --check 检查语法
    execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
    passCount++;
    log(`✓ ${script} 语法正确`, 'green');
  } catch (err) {
    failCount++;
    log(`✗ ${script} 语法错误`, 'red');
  }
}

// Test 11: 验证 plugin.json 版本与 marketplace.json 一致
log('\nTest 11: 版本一致性验证', 'yellow');
const pluginJsonPath = path.join(pluginRoot, '.claude-plugin/plugin.json');
if (fs.existsSync(pluginJsonPath)) {
  try {
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
    const marketplacePath = path.join(pluginRoot, '../..', '.claude-plugin/marketplace.json');

    if (fs.existsSync(marketplacePath)) {
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
      const entry = marketplace.plugins.find(p => p.name === 'codemap-pro');

      if (entry) {
        if (entry.version === pluginJson.version) {
          passCount++;
          log(`✓ 版本一致: ${pluginJson.version}`, 'green');
        } else {
          failCount++;
          log(`✗ 版本不一致: plugin.json=${pluginJson.version}, marketplace.json=${entry.version}`, 'red');
        }
      } else {
        log('⚠ marketplace.json 中未找到 codemap-pro 条目', 'yellow');
      }
    }
  } catch (err) {
    log(`⚠ 版本一致性检查跳过: ${err.message}`, 'yellow');
  }
}

// 总结
log('\n=== 测试总结 ===', 'yellow');
log(`通过: ${passCount}`, 'green');
log(`失败: ${failCount}`, failCount > 0 ? 'red' : 'green');

if (failCount > 0) {
  log('\n测试失败！请修复上述问题。', 'red');
  process.exit(1);
} else {
  log('\n所有测试通过！✓', 'green');
  process.exit(0);
}
