/**
 * cpp-style-enforcer 插件自带的公共工具库（跨平台：Windows / macOS / Linux）
 *
 * 仅保留本插件 hook 实际用到的导出，并新增模板继承 / 版权信息读取相关函数。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

/**
 * 跨平台：强制 stdout/stderr 使用 UTF-8，避免 Windows 等环境下中文乱码
 */
function ensureStdioUtf8() {
  try {
    if (process.stdout && typeof process.stdout.setDefaultEncoding === 'function') {
      process.stdout.setDefaultEncoding('utf8');
    }
    if (process.stderr && typeof process.stderr.setDefaultEncoding === 'function') {
      process.stderr.setDefaultEncoding('utf8');
    }
  } catch (_) {}
}
ensureStdioUtf8();

// 平台检测
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

/**
 * 用户主目录
 */
function getHomeDir() {
  return os.homedir();
}

/**
 * ~/.claude 配置目录
 */
function getClaudeDir() {
  return path.join(getHomeDir(), '.claude');
}

/**
 * 用户级 C++ 风格模板路径：~/.claude/cpp-style-template.json
 */
function getUserTemplatePath() {
  return path.join(getClaudeDir(), 'cpp-style-template.json');
}

/**
 * 从 stdin 读取 JSON（hook 输入）。空输入或解析失败返回 {}。
 * @param {object} options
 * @param {number} options.timeoutMs 超时毫秒（默认 5000），防止 stdin 永不关闭时挂死
 */
async function readStdinJson(options = {}) {
  const { timeoutMs = 5000, maxSize = 1024 * 1024 } = options;

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
        if (process.stdin.unref) process.stdin.unref();
        try {
          resolve(data.trim() ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (data.length < maxSize) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });

    process.stdin.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({});
    });
  });
}

/**
 * 输出到 stderr（用户可见）
 */
function log(message) {
  console.error(message);
}

/**
 * 输出到 stdout（返回给 Claude）
 */
function output(data) {
  if (typeof data === 'object') {
    console.log(JSON.stringify(data));
  } else {
    console.log(data);
  }
}

/**
 * 检查命令是否在 PATH 中（用 spawnSync 防注入）
 */
function commandExists(cmd) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(cmd)) {
    return false;
  }
  try {
    if (isWindows) {
      const result = spawnSync('where', [cmd], { stdio: 'pipe', windowsHide: true });
      return result.status === 0;
    } else {
      const result = spawnSync('which', [cmd], { stdio: 'pipe', windowsHide: true });
      return result.status === 0;
    }
  } catch {
    return false;
  }
}

/**
 * 运行命令并返回输出
 *
 * 安全提示：仅用于可信、硬编码的命令，切勿直接传入用户输入。
 * @param {string} cmd 命令（应为可信/硬编码）
 * @param {object} options execSync 选项
 */
function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...options
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return { success: false, output: err.stderr || err.message };
  }
}

/**
 * 从文件路径向上查找 git 仓库根目录
 * @param {string} startPath 起始路径（文件或目录）
 * @returns {string|null} git root 绝对路径，非 git 仓库返回 null
 */
function getRepoRootFrom(startPath) {
  const cwd = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    stdio: 'pipe',
    timeout: 3000,
    windowsHide: isWindows,
  });
  if (result.status !== 0) return null;
  return (result.stdout || Buffer.alloc(0)).toString('utf-8').trim() || null;
}

/**
 * 读取用户级模板 ~/.claude/cpp-style-template.json
 * @returns {object|null} 解析后的对象；不存在/损坏返回 null
 */
function readUserTemplate() {
  const p = getUserTemplatePath();
  try {
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_) {
    return null;
  }
}

/**
 * 确保用户级模板存在：不存在时从插件出厂默认模板复制一份。
 * @param {string} pluginDefaultPath 插件内 templates/cpp-style-template.default.json 绝对路径
 * @returns {string} 用户模板路径 ~/.claude/cpp-style-template.json
 */
function ensureUserTemplate(pluginDefaultPath) {
  const userPath = getUserTemplatePath();
  try {
    if (fs.existsSync(userPath)) return userPath;
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    if (pluginDefaultPath && fs.existsSync(pluginDefaultPath)) {
      fs.copyFileSync(pluginDefaultPath, userPath);
    }
  } catch (_) {
    // 复制失败不抛错，调用方按"无模板"降级处理
  }
  return userPath;
}

/**
 * 读取版权信息：项目 .claude-cpp-style 的 copyrightInfo 优先，
 * 项目无该段则回退用户级模板的 copyrightInfo，都没有返回 null。
 * @param {string} startPath 项目内任意文件或目录路径
 * @returns {object|null} { company, author, dateFormat } 或 null
 */
function getCopyrightInfo(startPath) {
  // 1) 项目级
  const root = getRepoRootFrom(startPath);
  if (root) {
    const flagFile = path.join(root, '.claude-cpp-style');
    try {
      if (fs.existsSync(flagFile)) {
        const cfg = JSON.parse(fs.readFileSync(flagFile, 'utf-8'));
        if (cfg && typeof cfg === 'object' && cfg.copyrightInfo
            && typeof cfg.copyrightInfo === 'object') {
          return cfg.copyrightInfo;
        }
      }
    } catch (_) {
      // 项目配置损坏 -> 继续回退到用户模板
    }
  }
  // 2) 用户级模板
  const tpl = readUserTemplate();
  if (tpl && tpl.copyrightInfo && typeof tpl.copyrightInfo === 'object') {
    return tpl.copyrightInfo;
  }
  return null;
}

/**
 * 读取项目的 C++ 风格检查配置 (.claude-cpp-style, JSON 格式)
 *
 * JSON 结构:
 *   {
 *     "mode": "full" | "incremental",   // full=所有文件; incremental=仅基线后新文件
 *     "baseline": "<commit hash>",       // 仅 incremental 需要
 *     "checks": {
 *       "clangFormat": true,             // 是否 clang-format
 *       "copyright":   true,             // 是否加版权头
 *       "cpplint":     true,             // 是否 cpplint 拦截
 *       "bom":         true              // 是否补 UTF-8 BOM (独立于 mode, 老文件也生效)
 *     },
 *     "copyrightInfo": { "company": "...", "author": "...", "dateFormat": "..." }
 *   }
 *
 * @param {string} startPath 项目内任意文件或目录路径
 * @returns {{mode, baseline, root, checks, copyrightInfo}}
 *   文件不存在/非git/JSON损坏时 mode=null；copyrightInfo 缺失为 null。
 */
function getCppStyleMode(startPath) {
  const DEFAULT_CHECKS = { clangFormat: true, copyright: true, cpplint: true, bom: true };
  const root = getRepoRootFrom(startPath);
  if (!root) {
    return { mode: null, baseline: null, root: null, checks: DEFAULT_CHECKS, copyrightInfo: null };
  }

  const flagFile = path.join(root, '.claude-cpp-style');
  if (!fs.existsSync(flagFile)) {
    return { mode: null, baseline: null, root, checks: DEFAULT_CHECKS, copyrightInfo: null };
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(flagFile, 'utf-8'));
  } catch (_) {
    // JSON 损坏 -> 当未决定处理, 触发重新询问
    return { mode: null, baseline: null, root, checks: DEFAULT_CHECKS, copyrightInfo: null };
  }
  if (!cfg || typeof cfg !== 'object') {
    return { mode: null, baseline: null, root, checks: DEFAULT_CHECKS, copyrightInfo: null };
  }

  const mode = cfg.mode === 'full' ? 'full' : (cfg.mode === 'incremental' ? 'incremental' : null);
  const baseline = typeof cfg.baseline === 'string' && cfg.baseline.trim()
    ? cfg.baseline.trim() : null;
  // checks 缺失字段默认 true (安全默认: 不少做检查)
  const c = (cfg.checks && typeof cfg.checks === 'object') ? cfg.checks : {};
  const checks = {
    clangFormat: c.clangFormat !== false,
    copyright: c.copyright !== false,
    cpplint: c.cpplint !== false,
    bom: c.bom !== false,
  };
  // copyrightInfo: 项目配置内有则用, 否则回退用户模板 (与 getCopyrightInfo 一致)
  let copyrightInfo = (cfg.copyrightInfo && typeof cfg.copyrightInfo === 'object')
    ? cfg.copyrightInfo : null;
  if (!copyrightInfo) {
    const tpl = readUserTemplate();
    if (tpl && tpl.copyrightInfo && typeof tpl.copyrightInfo === 'object') {
      copyrightInfo = tpl.copyrightInfo;
    }
  }

  return { mode, baseline, root, checks, copyrightInfo };
}

/**
 * 判断文件是否为"基线 commit 之后新增"的文件
 *
 * 利用 git cat-file 检查文件在基线 commit 时是否存在:
 *   - 基线时已存在 -> 老文件 -> false
 *   - 基线时不存在 / 未跟踪 -> 新文件 -> true
 *
 * @param {string} filePath 文件绝对路径
 * @param {string} baseline 基线 commit hash
 * @param {string} root git 仓库根目录
 * @returns {boolean} true=新文件(应走full), false=老文件(仅BOM)
 */
function isNewFileSince(filePath, baseline, root) {
  if (!baseline || !root) return false;
  const relPath = path.relative(root, filePath).split(path.sep).join('/');
  const result = spawnSync('git', ['cat-file', '-e', `${baseline}:${relPath}`], {
    cwd: root,
    stdio: 'pipe',
    timeout: 3000,
    windowsHide: isWindows,
  });
  // exit 0 = 基线时文件存在 = 老文件; 非0 = 新文件
  return result.status !== 0;
}

module.exports = {
  // 平台信息
  isWindows,
  isMacOS,
  isLinux,

  // 目录
  getHomeDir,
  getClaudeDir,
  getUserTemplatePath,

  // Hook I/O
  readStdinJson,
  log,
  output,

  // 系统
  commandExists,
  runCommand,

  // C++ 风格强制
  getRepoRootFrom,
  getCppStyleMode,
  isNewFileSince,

  // 模板继承 / 版权信息
  readUserTemplate,
  ensureUserTemplate,
  getCopyrightInfo,
};
