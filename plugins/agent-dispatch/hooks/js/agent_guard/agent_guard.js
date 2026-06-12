#!/usr/bin/env node
// ABOUTME: PreToolUse:Agent 守卫 — 两条物理硬约束
// ABOUTME: 1. 研究/探索类子代理调用缺 model 字段 → block，要求显式指定 "sonnet"
// ABOUTME: 2. 子代理 prompt 用 Grep/Glob 但未引用 CRG/serena → block，要求改为先调图谱工具

'use strict';

const { readStdinJson, output } = require('../lib/utils');

// ── 守卫 1：model 字段检查 ─────────────────────────────────────────────────

/** subagent_type 永远应使用 sonnet（研究/探索/规划，不写代码） */
const ALWAYS_SONNET_TYPES = new Set(['Explore', 'Plan', 'architect']);

/**
 * 判断是否为研究/探索类调用（需要 sonnet）
 * Explore/Plan/architect 直接命中；general-purpose 看关键词
 */
function isResearchCall(toolInput) {
  const type = (toolInput.subagent_type || '').trim();
  if (ALWAYS_SONNET_TYPES.has(type)) return true;

  // 只扫 description + prompt 前 600 字符，避免超长 prompt 拖慢 hook
  const text = [
    toolInput.description || '',
    (toolInput.prompt || '').slice(0, 600),
  ].join(' ').toLowerCase();

  return RESEARCH_KEYWORDS.some((kw) => text.includes(kw));
}

const RESEARCH_KEYWORDS = [
  // 中文
  '探索', '搜索', '分析', '对比', '读取', '排查', '检查', '查找', '扫描', '理解',
  '定位', '查看', '了解', '浏览', '找到', '找出',
  // 英文（用前缀以覆盖变形）
  'find', 'search', 'explore', 'analyz', 'compar', 'read', 'check', 'locate',
  'review', 'research', 'investigat', 'understand', 'scan', 'audit', 'look',
  'inspect', 'examine', 'survey', 'identif',
];

// ── 守卫 2：Grep/Glob without CRG 检查 ────────────────────────────────────

/**
 * 判断 prompt 中是否出现 Grep/Glob/find 等工具调用字样
 * 匹配 "Grep"、"Glob"、"grep"、"用 Grep"、"用 Glob" 等常见写法
 */
const GREP_GLOB_RE = /\b(Grep|Glob)\b|用\s*(Grep|Glob)|grep\s+|glob\s+pattern/i;

/**
 * 判断 prompt 中是否已经引用了 CRG / serena / graphify 等图谱工具
 * 只要出现任一，即视为"已按优先级使用"，放行
 */
const CRG_RE = new RegExp([
  'code.review.graph',
  'mcp__code',
  'semantic_search',
  'get_minimal_context',
  'query_graph',
  'detect_changes',
  'get_review_context',
  'get_impact_radius',
  'serena',
  'find_symbol',
  'find_declaration',
  'graphify',
  '图谱',
  'crg',
].join('|'), 'i');

function hasGrepGlobWithoutCrg(toolInput) {
  const prompt = toolInput.prompt || '';
  if (!GREP_GLOB_RE.test(prompt)) return false;  // 没用 Grep/Glob，放行
  return !CRG_RE.test(prompt);                   // 用了但没提 CRG → 命中
}

// ── 消息构建 ───────────────────────────────────────────────────────────────

function buildModelMessage(toolInput) {
  const type = toolInput.subagent_type || 'general-purpose';
  return [
    `⚠️ [agent-guard] 研究/探索类子代理调用缺少 model 字段。`,
    `当前会话模型会被继承（可能是 Opus），导致 token 成本虚高。`,
    ``,
    `请重新调用并显式添加：`,
    `  "model": "sonnet"`,
    ``,
    `示例：`,
    `  Agent({`,
    `    subagent_type: "${type}",`,
    `    model: "sonnet",`,
    `    description: "...",`,
    `    prompt: "..."`,
    `  })`,
  ].join('\n');
}

function buildCrgMessage() {
  return [
    `⚠️ [agent-guard] 子代理 prompt 中使用了 Grep/Glob，但未引用 CRG / serena 图谱工具。`,
    `搜索优先级：CRG → serena → graphify → Grep（最后手段）。`,
    ``,
    `请重写子代理 prompt，在正文开头加入图谱工具调用：`,
    `  "首先调用 mcp__code-review-graph__get_minimal_context_tool 了解代码结构，`,
    `   再用 semantic_search_nodes_tool 或 query_graph_tool 定位目标，`,
    `   仅在图谱未命中时降级到 Grep。"`,
    ``,
    `改写后再重新派遣子代理。`,
  ].join('\n');
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────

async function main() {
  let input;
  try { input = await readStdinJson(); }
  catch { process.exit(0); return; }

  if (!input) { process.exit(0); return; }

  // subagent 内部调用不拦截（避免递归 block）
  if (input.agent_id) { process.exit(0); return; }

  const toolInput = input.tool_input || {};

  // 守卫 1：研究类调用必须显式指定 model
  if (!toolInput.model && isResearchCall(toolInput)) {
    output({ decision: 'block', reason: buildModelMessage(toolInput) });
    process.exit(0);
    return;
  }

  // 守卫 2：Grep/Glob 出现在 prompt 中但未引用 CRG → 要求改写
  if (hasGrepGlobWithoutCrg(toolInput)) {
    output({ decision: 'block', reason: buildCrgMessage() });
    process.exit(0);
    return;
  }

  // 两条检查均通过 → 放行
  process.exit(0);
}

main();
