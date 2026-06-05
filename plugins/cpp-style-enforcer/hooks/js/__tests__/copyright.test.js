const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyCopyright, hasAnyCopyrightContent } = require('../steps/copyright.js');

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copyright-'));
const created = [];
function write(name, buf) { const p = path.join(tmp, name); fs.writeFileSync(p, buf); created.push(p); return p; }
const info = (over) => ({ company: 'ACME', author: 'kevin', dateFormat: 'YYYY/MM/DD HH:mm', ...over });

try {
  // 无头 → 插入
  const f1 = write('a.cpp', Buffer.from('int a;\n', 'utf-8'));
  applyCopyright(f1, info());
  let t1 = fs.readFileSync(f1, 'utf-8');
  assert.ok(/Copyright .*ACME/.test(t1), '插入含公司名版权头');
  assert.ok(/Author kevin/.test(t1), '插入 Author 行');
  assert.ok(/Date \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(t1), 'Date 行按默认格式');
  assert.ok(/int a;/.test(t1), '原内容保留');

  // company 空 → 不写
  const f2 = write('b.cpp', Buffer.from('int b;\n', 'utf-8'));
  const before2 = fs.readFileSync(f2);
  applyCopyright(f2, info({ company: '' }));
  assert.ok(fs.readFileSync(f2).equals(before2), 'company 空不写');

  // 含 BOM 插头后 BOM 仍首字节
  const f3 = write('c.cpp', Buffer.concat([BOM, Buffer.from('int c;\n', 'utf-8')]));
  applyCopyright(f3, info());
  const b3 = fs.readFileSync(f3);
  assert.ok(b3.slice(0, 3).equals(BOM), '含 BOM 插头后 BOM 仍首字节');
  assert.ok(!b3.slice(3, 6).equals(BOM), 'BOM 不重复');
  assert.ok(/Copyright/.test(b3.slice(3).toString('utf-8')), '版权头在 BOM 之后');

  // dateFormat YYYY-MM-DD 生效
  const f4 = write('d.cpp', Buffer.from('int d;\n', 'utf-8'));
  applyCopyright(f4, info({ dateFormat: 'YYYY-MM-DD' }));
  const t4 = fs.readFileSync(f4, 'utf-8');
  assert.ok(/Date \d{4}-\d{2}-\d{2}\b/.test(t4), 'dateFormat YYYY-MM-DD 生效');
  assert.ok(!/Date \d{4}-\d{2}-\d{2} /.test(t4), '无时间部分');

  // dateFormat 缺 YMD（仅 YYYY）→ 回退默认带时间
  const f5 = write('e.cpp', Buffer.from('int e;\n', 'utf-8'));
  applyCopyright(f5, info({ dateFormat: 'YYYY' }));
  const t5 = fs.readFileSync(f5, 'utf-8');
  assert.ok(/Date \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(t5), 'dateFormat 缺 YMD 回退默认格式');

  // 已有 Date（任意日期）→ 一律不刷新，原文保留
  const today = new Date();
  const yyyy = String(today.getFullYear());
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const existing = `// Copyright (c) ${yyyy} ACME\n// Author kevin\n// Date ${yyyy}/${mm}/${dd} 00:00\n\nint f;\n`;
  const f6 = write('f.cpp', Buffer.from(existing, 'utf-8'));
  const before6 = fs.readFileSync(f6);
  applyCopyright(f6, info());
  assert.ok(fs.readFileSync(f6).equals(before6), '已有 Date → 不触碰，文件不变');

  // 跨天日期 → 仍保留原日期，不更新为今天
  const existingOld = `// Copyright (c) 2000 ACME\n// Author kevin\n// Date 2000/01/01 00:00\n\nint g;\n`;
  const f7 = write('g.cpp', Buffer.from(existingOld, 'utf-8'));
  applyCopyright(f7, info());
  const t7 = fs.readFileSync(f7, 'utf-8');
  assert.ok(t7.includes('Date 2000/01/01 00:00'), '跨天日期 → Date 原值保留');
  assert.ok(!t7.includes(`Date ${yyyy}/${mm}/${dd}`), '今日日期不覆盖已有 Date');

  // 旧版权块与用户普通注释零空行粘连：Date 不更新，普通注释保留
  const glued = `// Copyright (c) 2000 ACME\n// Author kevin\n// Date 2000/01/01 00:00\n// 这是用户自己的说明注释\nint h;\n`;
  const f8 = write('h.cpp', Buffer.from(glued, 'utf-8'));
  applyCopyright(f8, info());
  const t8 = fs.readFileSync(f8, 'utf-8');
  assert.ok(t8.includes('// 这是用户自己的说明注释'), '粘连的用户普通注释不被误删');
  assert.ok(t8.includes('Date 2000/01/01 00:00'), '粘连场景 Date 仍保留原值');
  assert.ok(/int h;/.test(t8), '原代码保留');

  // 形似文件名的用户注释（非 C/C++ 源码后缀）紧贴版权块：保留，Date 不更新
  const gluedMd = `// Copyright (c) 2000 ACME\n// Author kevin\n// Date 2000/01/01 00:00\n// 说明.md\nint j;\n`;
  const f10 = write('j.cpp', Buffer.from(gluedMd, 'utf-8'));
  applyCopyright(f10, info());
  const t10 = fs.readFileSync(f10, 'utf-8');
  assert.ok(t10.includes('// 说明.md'), '形似文件名的用户注释（.md）应保留');
  assert.ok(t10.includes('Date 2000/01/01 00:00'), '形似文件名场景 Date 保留原值');
  assert.ok(/int j;/.test(t10), '原代码保留');

  // 真正的 C/C++ 文件名行（.cpp）仍应被吞掉
  const gluedCpp = `// Copyright (c) 2000 ACME\n// Author kevin\n// Date 2000/01/01 00:00\n// k.cpp\nint k;\n`;
  const f11 = write('k.cpp', Buffer.from(gluedCpp, 'utf-8'));
  applyCopyright(f11, info());
  const t11 = fs.readFileSync(f11, 'utf-8');
  assert.ok(!t11.includes('// k.cpp'), 'C/C++ 源码后缀的文件名行被吞掉');
  assert.ok(/int k;/.test(t11), '原代码保留');

  // 含 BOM 且粘连普通注释：BOM 仍首字节，注释保留
  const gluedBom = Buffer.concat([BOM, Buffer.from(glued.replace('int h;', 'int i;'), 'utf-8')]);
  const f9 = write('i.cpp', gluedBom);
  applyCopyright(f9, info());
  const b9 = fs.readFileSync(f9);
  assert.ok(b9.slice(0, 3).equals(BOM), '更新含 BOM 文件后 BOM 仍首字节');
  assert.ok(!b9.slice(3, 6).equals(BOM), 'BOM 不重复');
  assert.ok(b9.slice(3).toString('utf-8').includes('// 这是用户自己的说明注释'), 'BOM 文件中用户注释保留');

  // Author 替换：文件有别人的 author → 替换为配置 author
  const foreignAuthor = `// Copyright 2020 ACME\n// Author alice@other.com\n// Date 2020/01/01 00:00\n\nint m;\n`;
  const f12 = write('m.cpp', Buffer.from(foreignAuthor, 'utf-8'));
  applyCopyright(f12, info());
  const t12 = fs.readFileSync(f12, 'utf-8');
  assert.ok(t12.includes('// Author kevin'), 'Author 替换为配置 author');
  assert.ok(!t12.includes('alice@other.com'), '别人的 Author 被替换');
  assert.ok(t12.includes('Date 2020/01/01 00:00'), 'Author 替换时 Date 仍保留');

  // Author 未配置 → 保留原文
  const f13 = write('n.cpp', Buffer.from(foreignAuthor, 'utf-8'));
  applyCopyright(f13, info({ author: '' }));
  const t13 = fs.readFileSync(f13, 'utf-8');
  assert.ok(t13.includes('alice@other.com'), 'author 未配置时保留原文');

  // 外来格式版权头（/* */ 块注释）→ 跳过，原文不动
  const block = `/* Copyright (c) 2024 Foo Inc. All rights reserved. */\n#include <foo.h>\n`;
  const f14 = write('o.cpp', Buffer.from(block, 'utf-8'));
  const before14 = fs.readFileSync(f14);
  applyCopyright(f14, info());
  assert.ok(fs.readFileSync(f14).equals(before14), '/* */ 外来版权头 → 原文不动');

  // 外来格式（// (c) 风格）→ 跳过
  const cinStyle = `// (c) 2024 Bar Corp\n// All rights reserved.\nint p;\n`;
  const f15 = write('p.cpp', Buffer.from(cinStyle, 'utf-8'));
  const before15 = fs.readFileSync(f15);
  applyCopyright(f15, info());
  assert.ok(fs.readFileSync(f15).equals(before15), '// (c) 外来版权头 → 原文不动');

  // hasAnyCopyrightContent 单元测试
  assert.ok(hasAnyCopyrightContent(['/* Copyright (c) 2024 Foo */', '#include <x>']), '块注释 copyright 检测');
  assert.ok(hasAnyCopyrightContent(['// SPDX-License-Identifier: MIT']), 'SPDX 检测');
  assert.ok(hasAnyCopyrightContent(['// (c) 2024 Acme']), '(c) 风格检测');
  assert.ok(!hasAnyCopyrightContent(['#pragma once', '#include <string>']), '无版权内容 → false');

  console.log('copyright.test.js PASS');
} finally {
  for (const p of created) { try { fs.unlinkSync(p); } catch (_) {} }
  try { fs.rmdirSync(tmp); } catch (_) {}
}

