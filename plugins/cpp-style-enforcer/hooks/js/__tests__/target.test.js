const assert = require('node:assert');
const path = require('path');
const { resolveFilePath, shouldHandle, CPP_EXTENSIONS, EXCLUDED_DIRS, SKIPPED_FILES } = require('../lib/target.js');

// resolveFilePath: tool_input.file_path 直取
assert.strictEqual(
  resolveFilePath({ tool_input: { file_path: '/p/a.cpp' } }), '/p/a.cpp', 'file_path 直取');
// relative_path + cwd
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { relative_path: 'src/a.cc' } }),
  path.resolve('/proj', 'src/a.cc'), 'relative_path 解析');
// 无路径
assert.strictEqual(resolveFilePath({}), null, '无路径返回 null');
assert.strictEqual(resolveFilePath(null), null, 'null 输入返回 null');

// shouldHandle: 扩展名
assert.strictEqual(shouldHandle('/p/a.cpp'), true, '.cpp 处理');
assert.strictEqual(shouldHandle('/p/a.txt'), false, '.txt 不处理');
// SKIPPED_FILES
assert.strictEqual(shouldHandle('/p/resource.h'), false, 'resource.h 跳过');
// EXCLUDED_DIRS（路径含 node_modules）
assert.strictEqual(shouldHandle('/p/node_modules/a.cpp'), false, 'node_modules 跳过');
assert.strictEqual(shouldHandle('/p/build/a.cpp'), false, 'build 跳过');

// 常量
assert.ok(CPP_EXTENSIONS.has('.hpp'), '.hpp 在扩展名集');
assert.ok(EXCLUDED_DIRS.has('node_modules'), 'node_modules 在排除集');
assert.ok(SKIPPED_FILES.has('resource.h'), 'resource.h 在跳过集');
console.log('target.test.js PASS');
