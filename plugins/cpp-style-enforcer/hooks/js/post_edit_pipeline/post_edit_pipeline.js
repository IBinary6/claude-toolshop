#!/usr/bin/env node
// ABOUTME: PostToolUse 流水线 hook — 串行执行 clang-format(增量) → UTF-8 BOM → copyright → cpplint
// ABOUTME: 全部静默, 仅 cpplint 检出违规时透传 stderr 并 exit 2 阻塞

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readStdinJson, isWindows, getCppStyleMode, isNewFileSince } = require("../lib/utils");

// 插件内 js 目录基址（用 __dirname 定位，调用 copyright/cpplint 子 hook 走插件内副本）
const HOOKS_BASE = path.join(__dirname, "..");

const CPP_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".hxx",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "out",
  "bin",
  "obj",
  ".git",
  "target",
  "third_party",
  "thirdparty",
  "external",
  "vendor",
  "deps",
  "packages",
]);

const SKIPPED_FILES = new Set(["resource.h"]);

function extractPathFromCommand(command) {
  if (!command || typeof command !== "string") return null;
  const extPattern = [...CPP_EXTENSIONS]
    .map((e) => e.replace(".", "\\."))
    .join("|");
  const re = new RegExp(
    "(?:[A-Za-z]:[/\\\\][^\\s'\"<>|*?]+|/[^\\s'\"<>|*?]+)(?:" +
      extPattern +
      ")(?=[\\s'\";|&)>]|$)",
    "g"
  );
  const matches = command.match(re);
  return matches ? matches[0].replace(/^['"]|['"]$/g, "") : null;
}

function resolveFilePath(input) {
  if (!input || typeof input !== "object") return null;
  const toolInput = input.tool_input;
  if (typeof toolInput === "object" && toolInput !== null) {
    if (toolInput.file_path) return toolInput.file_path;
    if (toolInput.path) return toolInput.path;
    if (typeof toolInput.command === "string") {
      return extractPathFromCommand(toolInput.command);
    }
  }
  const toolResponse = input.tool_response;
  if (typeof toolResponse === "object" && toolResponse !== null) {
    if (toolResponse.filePath) return toolResponse.filePath;
    if (toolResponse.file_path) return toolResponse.file_path;
  }
  return input.file_path || input.path || null;
}

function shouldHandle(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CPP_EXTENSIONS.has(ext)) return false;
  if (SKIPPED_FILES.has(path.basename(filePath).toLowerCase())) return false;
  const parts = filePath.split(/[/\\]/);
  for (const p of parts) {
    if (EXCLUDED_DIRS.has(p.toLowerCase())) return false;
  }
  return true;
}

function getRepoRoot(filePath) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.dirname(filePath),
    stdio: "pipe",
    timeout: 3000,
    windowsHide: isWindows,
  });
  if (result.status !== 0) return null;
  return (result.stdout || Buffer.alloc(0)).toString("utf-8").trim() || null;
}

function isTrackedByGit(filePath, repoRoot) {
  const result = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", filePath],
    {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 3000,
      windowsHide: isWindows,
    }
  );
  return result.status === 0;
}

// 返回工作区+暂存区相对 HEAD 的改动行范围 [[start,end], ...]
function getChangedLineRanges(filePath, repoRoot) {
  const result = spawnSync(
    "git",
    ["diff", "-U0", "HEAD", "--", filePath],
    {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 5000,
      windowsHide: isWindows,
    }
  );
  if (result.status !== 0) return null;
  const output = (result.stdout || Buffer.alloc(0)).toString("utf-8");
  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  const ranges = [];
  let m;
  while ((m = hunkRe.exec(output)) !== null) {
    const start = parseInt(m[1], 10);
    const len = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    if (len === 0) continue; // 纯删除, 跳过
    ranges.push([start, start + len - 1]);
  }
  return ranges;
}

// clang-format 单文件: 优先按改动行格式化, 兜底整文件
function runClangFormat(filePath) {
  const repoRoot = getRepoRoot(filePath);
  let lineArgs = [];

  if (repoRoot && isTrackedByGit(filePath, repoRoot)) {
    const ranges = getChangedLineRanges(filePath, repoRoot);
    if (ranges && ranges.length > 0) {
      lineArgs = ranges.map(([s, e]) => `--lines=${s}:${e}`);
    } else if (ranges && ranges.length === 0) {
      // 无改动行 (可能是回滚后回到 HEAD 状态), 不需要格式化
      return true;
    }
  }
  // 未跟踪 / 非 git 仓库 → lineArgs 为空 = 整文件格式化

  const args = [
    "-style=file",
    "-fallback-style=Google",
    "-i",
    ...lineArgs,
    filePath,
  ];
  const result = spawnSync("clang-format", args, {
    stdio: "pipe",
    timeout: 10000,
    windowsHide: isWindows,
  });
  return result.status === 0;
}

// 检测文件编码
function detectEncoding(content) {
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const utf16LeBom = Buffer.from([0xff, 0xfe]);
  const utf16BeBom = Buffer.from([0xfe, 0xff]);

  if (content.slice(0, 3).equals(utf8Bom)) return ["utf-8-sig", true];
  if (content.slice(0, 2).equals(utf16LeBom)) return ["utf-16-le", true];
  if (content.slice(0, 2).equals(utf16BeBom)) return ["utf-16-be", true];

  // 尝试 UTF-8
  try {
    content.toString("utf-8");
    return ["utf-8", false];
  } catch (e) {}

  // 尝试 GBK
  try {
    require("iconv-lite").decode(content, "gbk");
    return ["gbk", false];
  } catch (e) {}

  return [null, false];
}

// C/C++ 文件安全转换为 UTF-8 BOM
function safeConvertToUtf8Bom(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (!CPP_EXTENSIONS.has(ext)) return false;
  if (SKIPPED_FILES.has(basename)) return false;

  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);

  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch (e) {
    return false;
  }

  if (content.length === 0) {
    fs.writeFileSync(filePath, utf8Bom);
    return true;
  }

  const [encoding, hasBom] = detectEncoding(content);

  if (!encoding) return false;
  if (encoding === "utf-16-le" || encoding === "utf-16-be") return false;

  if (encoding === "utf-8-sig") {
    // 剥离所有前导 BOM，确认恰好只有 1 个
    let offset = 0;
    while (
      offset + 3 <= content.length &&
      content[offset] === 0xef &&
      content[offset + 1] === 0xbb &&
      content[offset + 2] === 0xbf
    ) {
      offset += 3;
    }
    if (offset === 3) return false; // 恰好 1 个 BOM，无需修改
    // 多个 BOM → 归一化为恰好 1 个
    fs.writeFileSync(filePath, Buffer.concat([utf8Bom, content.slice(offset)]));
    return true;
  }

  if (encoding === "utf-8") {
    // 仅在内容真有变化时写入. 否则 writeFileSync 会刷 mtime ->
    // 触发 harness 的 stale-file 警告, 导致下一次 Edit 必须 Read 重读.
    const newBuf = Buffer.concat([utf8Bom, content]);
    if (Buffer.compare(content, newBuf) === 0) return false;
    fs.writeFileSync(filePath, newBuf);
    return true;
  }

  if (encoding === "gbk") {
    try {
      const iconv = require("iconv-lite");
      const text = iconv.decode(content, "gbk");
      const newBuf = Buffer.concat([utf8Bom, Buffer.from(text, "utf-8")]);
      if (Buffer.compare(content, newBuf) === 0) return false;
      fs.writeFileSync(filePath, newBuf);
      return true;
    } catch (e) {
      return false;
    }
  }

  return false;
}

// 调用插件内 hook 子脚本, 传入原始 hook input JSON
function runChildHook(scriptRelPath, hookInputJson, timeoutMs, extraEnv) {
  const fullPath = path.join(HOOKS_BASE, scriptRelPath);
  const result = spawnSync("node", [fullPath], {
    input: hookInputJson,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: timeoutMs,
    windowsHide: isWindows,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return {
    status: result.status,
    stdout: (result.stdout || Buffer.alloc(0)).toString("utf-8"),
    stderr: (result.stderr || Buffer.alloc(0)).toString("utf-8"),
  };
}

async function main() {
  let hookInput;
  try {
    hookInput = await readStdinJson();
  } catch (e) {
    process.exit(0);
    return;
  }
  const hookInputJson = JSON.stringify(hookInput || {});

  const filePath = resolveFilePath(hookInput);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    process.exit(0);
    return;
  }
  if (!shouldHandle(filePath)) {
    process.exit(0);
    return;
  }

  // 解析配置, 决定三件套(clang-format/copyright/cpplint)是否作用于本文件:
  //   - full 模式: 所有文件
  //   - incremental 模式: 仅"基线 commit 之后新增"的文件, 老文件只补 BOM
  //   - null (未决定): 三件套都不做
  // BOM 补头独立于 mode, 由 checks.bom 控制, 对所有文件生效.
  const { mode, baseline, root, checks, copyrightInfo } = getCppStyleMode(filePath);
  let applyTriple = false;
  if (mode === 'full') {
    applyTriple = true;
  } else if (mode === 'incremental') {
    applyTriple = isNewFileSince(filePath, baseline, root);
  }

  // Step 1: clang-format
  if (applyTriple && checks.clangFormat) {
    try {
      runClangFormat(filePath);
    } catch (_) {
      // 格式化失败不阻塞后续步骤
    }
  }

  // Step 1.5: UTF-8 BOM 转换 (受 checks.bom 控制, 独立于 mode)
  if (checks.bom) {
    try {
      safeConvertToUtf8Bom(filePath);
    } catch (_) {
      // BOM 转换失败不阻塞后续步骤
    }
  }

  // Step 2: copyright header
  if (applyTriple && checks.copyright) {
    try {
      runChildHook("copyright/copyright_header.js", hookInputJson, 10000);
    } catch (_) {}
  }

  // Step 3: cpplint
  if (applyTriple && checks.cpplint) {
    // 屏蔽 cpplint legal/copyright 规则的两种情况:
    //   1) copyright 步骤被用户关闭;
    //   2) copyright 开着但 company 为空 -> 实际未写版权头, 不屏蔽会误拦.
    const company = copyrightInfo && typeof copyrightInfo.company === 'string'
      ? copyrightInfo.company.trim() : '';
    const suppressCopyright = !checks.copyright || !company;
    const cpplintEnv = suppressCopyright ? { CPP_STYLE_NO_COPYRIGHT: "1" } : undefined;
    let cpplint;
    try {
      cpplint = runChildHook("cpplint/cpplint_check.js", hookInputJson, 15000, cpplintEnv);
    } catch (_) {
      process.exit(0);
      return;
    }
    if (cpplint && cpplint.status === 2) {
      // 透传 cpplint 的 stderr (已经只截前 5 条) 给 Claude
      process.stderr.write(cpplint.stderr || "");
      process.exit(2);
      return;
    }
  }

  // 所有步骤通过, 静默退出
  process.exit(0);
}

main();
