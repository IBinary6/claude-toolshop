'use strict';

const REVIEW_TERMS = ['审查', '审核', '评审', 'review', 'audit'];
const HIGH_RISK_TERMS = [
  '安全', '漏洞', 'security', 'vulnerability', '并发', '竞态', 'concurrency',
  'race condition', '权限', '授权', 'permission', '生产', 'production', '死锁', 'deadlock',
];
const HARD_TERMS = [
  '困难', '疑难', '复杂实现', '复杂调试', 'hard task', 'hard implementation',
  'complex debugging', 'difficult', '崩溃', 'crash', '死锁', 'deadlock', '竞态',
];
const PLAN_TERMS = [
  '架构', 'architecture', '接口设计', '接口契约', 'api contract', '设计方案',
  '技术方案', '选型', '决策', '权衡', 'tradeoff', '制定计划', 'plan first',
];
const IMPLEMENT_TERMS = [
  '实现', 'implement', '修复', 'fix', 'bug', '编码', '修改', '迁移', 'migrate',
  '重构', 'refactor', '构建', 'build', '开发', 'develop',
];
const LOOKUP_TERMS = [
  '查找', '搜索', '定位', '调查', '研究', '扫描', 'find', 'search', 'lookup',
  'investigat', 'research', 'scan',
];
const BROAD_TERMS = [
  '跨模块', '全仓', '全仓库', '全面扫描', '广泛扫描', '大范围', 'repository-wide',
  'cross-module', 'broad scan', 'read-heavy', 'entire repository',
];
const CROSS_FILE_TERMS = [
  '跨文件', '多文件', '多个文件', '调用链', '引用关系', '影响面', 'cross-file',
  'multiple files', 'call chain', 'reference graph', 'impact radius',
];
const TRIVIAL_TERMS = [
  'getter', 'setter', '拼写', 'typo', '加个注释', '添加注释', '这一行',
  '单行修改', 'one-line', 'single-line',
];

const ROLE_LABELS = {
  'dispatch-explorer': 'agent-dispatch:dispatch-explorer（手动安装名 dispatch-explorer，sonnet/low）',
  'dispatch-mapper': 'agent-dispatch:dispatch-mapper（手动安装名 dispatch-mapper，sonnet/medium）',
  'dispatch-planner': 'agent-dispatch:dispatch-planner（手动安装名 dispatch-planner，opus/xhigh）',
  'dispatch-worker': 'agent-dispatch:dispatch-worker（手动安装名 dispatch-worker，sonnet/high）',
  'dispatch-hard-worker': 'agent-dispatch:dispatch-hard-worker（手动安装名 dispatch-hard-worker，opus/max）',
  'dispatch-reviewer': 'agent-dispatch:dispatch-reviewer（手动安装名 dispatch-reviewer，sonnet/high）',
  'dispatch-deep-reviewer': 'agent-dispatch:dispatch-deep-reviewer（手动安装名 dispatch-deep-reviewer，opus/xhigh）',
};

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function configuredKeywordMatch(text, config) {
  const keywords = config && config.whitelist && Array.isArray(config.whitelist.prompt_keywords)
    ? config.whitelist.prompt_keywords
    : [];
  return keywords.some((keyword) => {
    const value = String(keyword || '').trim().toLowerCase();
    return value.length > 0 && text.includes(value);
  });
}

/**
 * 按风险优先级分类用户任务，不把 Codex 的模型名或 Hook 字段带入 Claude。
 */
function routePrompt(prompt, config) {
  const text = typeof prompt === 'string' ? prompt.trim().toLowerCase() : '';
  if (!text) return { category: 'generic', shouldDispatch: false, role: '' };

  const review = includesAny(text, REVIEW_TERMS);
  const risky = includesAny(text, HIGH_RISK_TERMS);
  const highRisk = review && risky;
  const hard = includesAny(text, HARD_TERMS)
    || (includesAny(text, ['调试', 'debug', '排查', 'diagnose'])
      && includesAny(text, ['复杂', '疑难', '困难', 'complex', 'difficult', 'hard']));
  const plan = includesAny(text, PLAN_TERMS);
  const lookup = includesAny(text, LOOKUP_TERMS);
  const broad = includesAny(text, BROAD_TERMS);
  const crossFile = includesAny(text, CROSS_FILE_TERMS);
  const implementation = includesAny(text, IMPLEMENT_TERMS);

  if (highRisk) return { category: 'high-risk-review', shouldDispatch: true, role: 'dispatch-deep-reviewer' };
  if (hard || (implementation && risky)) {
    return { category: 'hard-task', shouldDispatch: true, role: 'dispatch-planner' };
  }
  if (plan && (text.length >= 80 || broad || crossFile)) {
    return { category: 'plan', shouldDispatch: true, role: 'dispatch-planner' };
  }
  if (broad) return { category: 'broad-search', shouldDispatch: true, role: 'dispatch-mapper' };
  if (crossFile || (lookup && includesAny(text, ['多个', 'many', 'several']))) {
    return { category: 'bounded-search', shouldDispatch: true, role: 'dispatch-explorer' };
  }
  if (review) return { category: 'review', shouldDispatch: true, role: 'dispatch-reviewer' };
  if (implementation && !includesAny(text, TRIVIAL_TERMS)) {
    return { category: 'implementation', shouldDispatch: true, role: 'dispatch-worker' };
  }
  if (implementation && includesAny(text, TRIVIAL_TERMS)) {
    return { category: 'generic', shouldDispatch: false, role: '' };
  }
  if (configuredKeywordMatch(text, config)) {
    return { category: 'generic', shouldDispatch: true, role: 'dispatch-explorer' };
  }
  return { category: 'generic', shouldDispatch: false, role: '' };
}

function promptGuidance(prompt, config) {
  const route = routePrompt(prompt, config);
  if (!route.shouldDispatch) return '';
  const role = ROLE_LABELS[route.role] || '';
  switch (route.category) {
    case 'high-risk-review':
      return `任务路由：高风险审查。优先派遣 ${role} 独立审查；主 Agent 保留权限和最终决策。`;
    case 'hard-task':
      return `任务路由：困难实现/复杂调试。先由 ${role} 只读制定计划，主 Agent 整合后再派遣 ${ROLE_LABELS['dispatch-hard-worker']} 执行；非必要不并行。`;
    case 'plan':
      return `任务路由：非琐碎计划/架构。派遣 ${role} 做只读方案，架构与接口决策仍由主 Agent 确认。`;
    case 'broad-search':
      return `任务路由：广泛/跨模块扫描。派遣 ${role}；若 CodeMap 可用优先图查询，图刷新由 CodeMap 插件负责。`;
    case 'bounded-search':
      return `任务路由：有界跨文件搜索。派遣 ${role}；精确单文件或单符号读取由主 Agent 直接完成。`;
    case 'review':
      return `任务路由：常规独立审查。派遣 ${role}，主 Agent 复核后整合。`;
    case 'implementation':
      return `任务路由：边界明确的常规实现。派遣 ${role}，并给出文件责任、验收条件和验证命令。`;
    default:
      return `任务路由：先由主 Agent 划定边界；可从 ${role || ROLE_LABELS['dispatch-explorer']} 开始有界调查，再决定是否需要实现角色。`;
  }
}

function mainAgentGuidance(config) {
  const maxParallel = Number(config.policy && config.policy.max_parallel_subagents) || 3;
  return [
    'Agent Dispatch（Claude Code 原生语义）：你是主 Agent，负责需求澄清、架构/接口决策、任务拆分、结果审查和最终整合。',
    '明确、有界的搜索、实现和独立审查使用本插件提供的 agent-dispatch:* 子代理；琐碎读取、小改和强耦合步骤直接完成。',
    '按最低可靠角色路由：有界搜索 dispatch-explorer；广泛扫描 dispatch-mapper；常规实现 dispatch-worker；常规审查 dispatch-reviewer；复杂计划/高风险审查才使用 opus 角色。',
    `独立且并行有收益时才并行，最多 ${maxParallel} 个子代理；结果已整合或不再需要时立即停止后台 Agent。`,
    '所有 Git 命令由主 Agent 串行执行；子代理不得运行 Git。委派不扩大文件、网络、权限或外部操作授权。',
    '子代理必须报告 Changed files、Validation、Blockers；主 Agent 重读改动并自行判断是否完成。',
    'CodeMap 负责图刷新和检索屏障，Agent Dispatch 只负责角色选择。Claude MCP schema 可能延迟加载，先用 ToolSearch 发现工具，不能仅凭当前工具列表断言不可用。',
  ].join('\n');
}

function subagentGuidance(config) {
  const lines = [
    'Agent Dispatch：你是被派遣的 Claude 子代理，不是主协调者。直接完成给定的有界任务，不扩大范围。',
    '不要再派遣 Agent；不要运行任何 Git 命令，Git 由主 Agent 串行处理。保留并适配他人现有改动，不得回滚。',
    'CodeMap 插件负责图刷新/读前屏障；结构、调用、引用或影响面查询优先使用图工具，纯文本/注释/字符串再用 Grep。MCP schema 延迟时先用 ToolSearch。',
  ];
  if (config.policy && config.policy.require_changed_file_report) {
    lines.push('最终报告必须包含 `Changed files:`，逐项列出修改文件；未修改时写 `Changed files: none`。');
  }
  if (config.policy && config.policy.require_validation_report) {
    lines.push('最终报告必须包含 `Validation:`，写明实际命令和结果；未运行时说明原因。');
  }
  if (config.policy && config.policy.require_blocker_report) {
    lines.push('最终报告必须包含 `Blockers:`；没有阻塞时写 `Blockers: none`。');
  }
  return lines.join('\n');
}

function missingReportSections(message, config) {
  const text = typeof message === 'string'
    ? message.replace(/[*_`#]/g, '')
    : '';
  const missing = [];
  if (config.policy && config.policy.require_changed_file_report
      && !/(?:^|\n)\s*(?:Changed files|修改文件)\s*[:：]/i.test(text)) missing.push('Changed files');
  if (config.policy && config.policy.require_validation_report
      && !/(?:^|\n)\s*(?:Validation|验证)\s*[:：]/i.test(text)) missing.push('Validation');
  if (config.policy && config.policy.require_blocker_report
      && !/(?:^|\n)\s*(?:Blockers|阻塞)\s*[:：]/i.test(text)) missing.push('Blockers');
  return missing;
}

function agentNudge(toolInput, config) {
  const type = String((toolInput && (toolInput.subagent_type || toolInput.agent_type)) || '');
  if (/^(?:agent-dispatch:)?dispatch-(?:explorer|mapper|planner|worker|hard-worker|reviewer|deep-reviewer)$/.test(type)) {
    return '';
  }
  const text = [toolInput && toolInput.description, toolInput && toolInput.prompt]
    .filter(Boolean).join(' ');
  const guidance = promptGuidance(text, config);
  return guidance ? `${guidance}\n优先使用插件提供的 scoped agent，而不是临时用同一高成本模型承接所有任务。` : '';
}

module.exports = {
  ROLE_LABELS,
  agentNudge,
  mainAgentGuidance,
  missingReportSections,
  promptGuidance,
  routePrompt,
  subagentGuidance,
};
