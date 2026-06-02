'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.env.CLAUDE_WORKING_DIRECTORY || process.cwd();

// 仅在 git 仓库中操作
if (!fs.existsSync(path.join(dir, '.git'))) {
  process.exit(0);
}

const gitignorePath = path.join(dir, '.gitignore');
const ENTRIES = ['.codegraph/'];

let content = '';
if (fs.existsSync(gitignorePath)) {
  content = fs.readFileSync(gitignorePath, 'utf8');
}

const missing = ENTRIES.filter(entry => !content.includes(entry));
if (missing.length === 0) {
  process.exit(0);
}

// 确保文件末尾有换行
let append = (content.length > 0 && !content.endsWith('\n')) ? '\n' : '';
append += '# codegraph 生成目录\n';
append += missing.join('\n') + '\n';

fs.appendFileSync(gitignorePath, append, 'utf8');
process.exit(0);
