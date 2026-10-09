const assert = require('node:assert');
const path = require('path');
const {
  resolveFilePath,
  resolveFilePaths,
  shouldHandle,
  CPP_EXTENSIONS,
  EXCLUDED_DIRS,
  SKIPPED_FILES,
} = require('../lib/target.js');

// resolveFilePath: tool_input.file_path is used directly
assert.strictEqual(
  resolveFilePath({ tool_input: { file_path: '/p/a.cpp' } }), '/p/a.cpp', 'file_path is used directly');
// relative_path + cwd
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { relative_path: 'src/a.cc' } }),
  path.resolve('/proj', 'src/a.cc'), 'relative_path is resolved');
// No path
assert.strictEqual(resolveFilePath({}), null, 'no path returns null');
assert.strictEqual(resolveFilePath(null), null, 'null input returns null');

// shouldHandle: extension
assert.strictEqual(shouldHandle('/p/a.cpp'), true, '.cpp is handled');
assert.strictEqual(shouldHandle('/p/a.txt'), false, '.txt is not handled');
// SKIPPED_FILES
assert.strictEqual(shouldHandle('/p/resource.h'), false, 'resource.h is skipped');
// EXCLUDED_DIRS (path contains node_modules)
assert.strictEqual(shouldHandle('/p/node_modules/a.cpp'), false, 'node_modules is skipped');
assert.strictEqual(shouldHandle('/p/build/a.cpp'), false, 'build is skipped');

// Constants
assert.ok(CPP_EXTENSIONS.has('.hpp'), '.hpp is in the extension set');
assert.ok(EXCLUDED_DIRS.has('node_modules'), 'node_modules is in the excluded set');
assert.ok(SKIPPED_FILES.has('resource.h'), 'resource.h is in the skipped set');

// Regression: substring directories are not misjudged (mybuild/buildtools contain 'build' but are not excluded directories themselves)
assert.strictEqual(shouldHandle('/proj/mybuild/a.cpp'), true, 'mybuild is not an excluded directory');
assert.strictEqual(shouldHandle('/proj/buildtools/a.cpp'), true, 'buildtools is not an excluded directory');
assert.strictEqual(shouldHandle('/proj/build/a.cpp'), false, 'build is an excluded directory');

// Regression: extensions are case-insensitive
assert.strictEqual(shouldHandle('/p/a.CPP'), true, '.CPP matches case-insensitively');
assert.strictEqual(shouldHandle('/p/a.Hpp'), true, '.Hpp matches case-insensitively');
// Regression: Windows backslash paths + excluded directories are case-insensitive
assert.strictEqual(shouldHandle('C:\\proj\\BUILD\\a.cpp'), false, 'BUILD is excluded case-insensitively');
// Every spelling of third-party directories (including the common "thrid" misspelling) is excluded; a business directory that only contains a substring is not.
for (const dir of ['3rd', '3rdparty', '3rd_party', '3rd-party', 'thirdparty', 'third_party',
  'third-party', 'thirdpart', 'third_part', 'third-part', 'thridpart', 'thridparty',
  'thrid_party', 'thrid-party', 'vendor', 'external', 'deps', 'packages']) {
  assert.strictEqual(shouldHandle(`/proj/${dir}/lib/a.cpp`), false, dir);
  assert.strictEqual(shouldHandle(`C:\\proj\\${dir.toUpperCase()}\\lib\\a.cpp`), false, dir);
}
assert.strictEqual(shouldHandle('/proj/third_party_adapter/a.cpp'), true, 'a directory name that only contains the substring is not excluded');
assert.strictEqual(shouldHandle('/proj/vendor_manager/a.cpp'), true, 'a directory name that only contains the substring is not excluded');

// Regression: the various resolveFilePath shapes
assert.strictEqual(
  resolveFilePath({ file_path: '/top/a.cpp' }), '/top/a.cpp', 'top-level input.file_path fallback');
assert.strictEqual(
  resolveFilePath({ tool_input: { path: '/p/b.cc' } }), '/p/b.cc', 'tool_input.path branch');
assert.strictEqual(
  resolveFilePath({ tool_input: {} }), null, 'a missing tool_input field returns null');

// Fix 3: resolveFilePath always returns an absolute path
// A relative file_path + input.cwd -> made absolute against cwd (a relative value no longer slips through as-is)
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { file_path: 'src/a.cpp' } }),
  path.resolve('/proj', 'src/a.cpp'),
  'a relative file_path is made absolute against cwd');
// Same for a relative path
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { path: 'src/b.cc' } }),
  path.resolve('/proj', 'src/b.cc'),
  'a relative path is made absolute against cwd');
// An absolute file_path -> returned as-is
assert.strictEqual(
  resolveFilePath({ cwd: '/elsewhere', tool_input: { file_path: '/abs/a.cpp' } }),
  '/abs/a.cpp',
  'an absolute file_path is returned as-is (cwd has no effect)');
// The top-level relative fallback is made absolute too
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', file_path: 'rel.cpp' }),
  path.resolve('/proj', 'rel.cpp'),
  'a top-level relative file_path is made absolute against cwd');
// The relative_path branch is unchanged
assert.strictEqual(
  resolveFilePath({ cwd: '/proj', tool_input: { relative_path: 'src/c.cc' } }),
  path.resolve('/proj', 'src/c.cc'),
  'the relative_path branch is unchanged');

// Agentic Patch / MCP batch edits: one hook call must cover every C++ file.
assert.deepStrictEqual(
  resolveFilePaths({
    cwd: '/proj',
    tool_input: {
      edits: [
        { file_path: 'src/a.cpp' },
        { targetPath: 'include/a.h' },
      ],
    },
  }),
  [path.resolve('/proj', 'src/a.cpp'), path.resolve('/proj', 'include/a.h')],
  'nested batch edits yield every path');

assert.deepStrictEqual(
  resolveFilePaths({
    cwd: '/proj',
    tool_input: {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/a.cpp',
        '*** Add File: include/a.hpp',
        '*** End Patch',
      ].join('\n'),
    },
  }),
  [path.resolve('/proj', 'src/a.cpp'), path.resolve('/proj', 'include/a.hpp')],
  'Agentic Patch text yields every target file');

assert.deepStrictEqual(
  resolveFilePaths({
    cwd: '/proj',
    tool_input: { diff: '--- a/src/a.cpp\n+++ b/src/a.cpp\n@@ -1 +1 @@' },
  }),
  [path.resolve('/proj', 'src/a.cpp')],
  'a unified diff uses only the new-file header and is deduplicated');

// The rename target in a patch also needs the closing processing.
assert.deepStrictEqual(
  resolveFilePaths({
    cwd: '/proj',
    tool_input: {
      patch: [
        '*** Begin Patch', '*** Update File: src/a.cpp',
        '*** Move to: src/renamed.cpp', '*** End Patch',
      ].join('\n'),
    },
  }),
  [path.resolve('/proj', 'src/a.cpp'), path.resolve('/proj', 'src/renamed.cpp')],
  'the Move to rename target is recognized');

console.log('target.test.js PASS');
