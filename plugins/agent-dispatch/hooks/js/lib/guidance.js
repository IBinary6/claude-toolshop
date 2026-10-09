'use strict';

const { isPureGitCommand } = require('./rules');

/**
 * 插件提供的 Claude 原生子代理角色及其 frontmatter 中的 model/effort。
 * 由 guidance.test.js 与 agents/*.md 交叉校验，二者不得漂移。
 */
const ROLES = {
  'dispatch-explorer': { model: 'haiku', effort: 'medium' },
  'dispatch-mapper': { model: 'haiku', effort: 'medium' },
  'dispatch-researcher': { model: 'haiku', effort: 'medium' },
  'dispatch-tester': { model: 'haiku', effort: 'high' },
  'dispatch-planner': { model: 'opus', effort: 'high' },
  'dispatch-worker': { model: 'sonnet', effort: 'high' },
  'dispatch-hard-worker': { model: 'sonnet', effort: 'xhigh' },
  'dispatch-reviewer': { model: 'opus', effort: 'high' },
  'dispatch-deep-reviewer': { model: 'opus', effort: 'xhigh' },
};

const ROLE_LABELS = Object.fromEntries(Object.entries(ROLES).map(([name, { model, effort }]) => [
  name, `agent-dispatch:${name}（手动安装名 ${name}，${model}/${effort}）`,
]));

const PROMPT_ROUTE_NOTICE = 'Agent Dispatch 候选建议（仅据当前消息推断）：按完整对话及用户最新明确要求核对，不是宿主限制或跨轮约束。';

const REVIEW_TERMS = ['审查', '审核', '评审', 'review', 'audit', 'code review', 'reviewing'];
const HIGH_RISK_TERMS = [
  '安全', '漏洞', 'security', 'vulnerability', '并发', '竞态', 'concurrency',
  'race condition', '权限', '授权', 'permission', 'production', '生产',
  '线上', '上线风险', '死锁', 'deadlock',
];
const HARD_TERMS = [
  '困难', '疑难', '复杂任务', '复杂实现', '复杂调试', '困难实现', 'hard task',
  'hard implementation', 'complex task', 'complex implementation',
  'complex debugging', 'difficult', '性能瓶颈', '性能回归', '崩溃', 'crash',
  '死锁', 'deadlock', '竞态', 'race condition',
];
const PLAN_TERMS = [
  '架构', 'architecture', '架构设计', '设计方案', '方案设计', '技术方案',
  '接口设计', '接口契约', 'api contract', 'design', 'plan', '规划', '方案',
  '计划', '决策', 'decision', '选型', '策略', 'strategy',
];
const IMPLEMENT_TERMS = [
  '实现', 'implement', 'implementation', '修复', 'fix', 'bug', '编码',
  '修改', '改动', '迁移', 'migrate', '重构', 'refactor', '构建', 'build',
  '开发', 'develop',
];
const DELIVERY_TERMS = [
  '制作', '产出', '撰写', '编写', '生成', '整理', '填入', '填表',
  '更新文档', '创建原型', '制作原型', 'produce', 'deliver', 'draft', 'write',
  'create a prototype', 'build a prototype', 'prepare a report', 'create a report',
];
// 制作动作由交付与计划识别共享；计划作为产出对象时仍需规划，不能因换个动词落入普通执行。
const CREATION_ACTIONS_CN = ['制作', '产出', '撰写', '编写', '生成', '创建'];
const CREATION_ACTIONS_EN = ['produce', 'draft', 'write', 'create', 'prepare'];
const DELIVERY_ACTION_PATTERN = new RegExp(
  `^(?:请|帮我)?(?:按.{0,30})?(?:${[...CREATION_ACTIONS_CN, '交付', '整理', '填入', '填表'].join('|')})`
  + `|^(?:please\\s+)?(?:${[...CREATION_ACTIONS_EN, 'deliver'].join('|')})\\b`
);
const PLAN_CREATION_PATTERN = new RegExp(
  `(?:${[...CREATION_ACTIONS_CN, '制定', '规划', '拟定', '设计'].join('|')})[^，。；,;.!?]{0,30}(?:计划|方案|策略)`
  + `|\\b(?:${[...CREATION_ACTIONS_EN, 'design'].join('|')})\\b[^，。；,;.!?]{0,30}\\b(?:plan|strategy)\\b`
);
const VERIFICATION_TERMS = [
  '验证', '验收', '测试', '复现', '核验', '质检', '质量检查', 'qa', 'test',
  'verify', 'validate', 'verification', 'acceptance check', 'reproduce',
];
const VERIFICATION_ACTION_TERMS = [
  '运行测试', '执行测试', '开始测试', '执行验证', '按已有用例', '按既有用例',
  '按用例验证', '验证结果', '验证交付物', 'run tests', 'execute tests',
  'run the tests', 'verify the result', 'validate the deliverable', 'execute qa',
];
const EXTERNAL_RESEARCH_TERMS = [
  '外部研究', '外部调研', '网络调研', '互联网', '官网', '官方来源', '公开来源',
  '最新资料', '市场调研', '竞品', '行业研究', 'web research', 'external research',
  'official sources', 'public sources', 'latest information', 'market research',
  'competitor', 'competitive research',
];
const CODE_CONTEXT_TERMS = [
  '代码', '源码', '代码仓库', '源码仓库', '代码库', '函数', '代码符号', '调用链', '调用方',
  '代码引用', '接口实现', '接口迁移', '代码补丁', '代码审查', 'code', 'source code',
  'repository', 'repo', 'function', 'code symbol', 'call chain', 'callers',
  'callees', 'code patch', 'code review', 'source diff',
];
const LOW_COST_LOG_TERMS = [
  '日志', 'log', 'logs', 'trace', 'stack trace', 'stderr', 'stdout', 'dump', 'event log',
];
const LOW_COST_DOCUMENT_TERMS = [
  '文档', 'document', 'documents', 'docs', 'readme', 'markdown', '.md', '.txt',
  'pdf', 'docx', 'doc', 'rtf', 'xml', 'csv', 'json', 'tsv', 'xlsx', 'spreadsheet',
];
const LOW_COST_TEXT_TERMS = ['原文', '文本', 'text', 'transcript'];
const LOW_COST_EXTRACTION_TERMS = [
  '提取', '抽取', '摘录', '整理', '汇总', '总结', '归纳', '读取', '阅读',
  '读写', '写入', '写', '编辑', '更新', '替换', '修改',
  'extract', 'parse', 'summarize', 'summary', 'organize', 'aggregate', 'collect',
  'read', 'write', 'edit', 'update', 'replace',
];
const LOW_COST_CODE_EVIDENCE_TERMS = [
  '调用方', '调用关系', '引用关系', '影响面', '依赖关系', '源码检索', '代码检索', '取证',
  'callers', 'callees', 'call chain', 'reference graph', 'impact radius', 'source search',
  'code search', 'depends on',
];
const LOW_COST_CODE_TEST_TERMS = [
  'ctest', '单元测试', '回归测试', 'unit test', 'unit tests', 'regression test',
  'regression tests', '代码测试', '源码测试', 'npm test', 'cargo test', 'pytest',
];
const LOW_COST_ESTABLISHED_TEST_TERMS = ['既定测试', '现有测试', '已有测试', 'approved test', 'existing test'];
const LOW_COST_TEST_EXECUTION_TERMS = [
  '运行', '执行', '开始', '验证', '验收', '核验', 'run', 'execute', 'perform',
  'verify', 'validate', 'check',
];
const CODE_CREATION_ACTION_TERMS = [
  '实现', '编写', '写', '创建', '新增', '增加', '生成', '更新', '修改', '构建', '开发', '编码',
  'implement', 'write', 'create', 'add', 'generate', 'update', 'modify', 'build', 'develop',
];
const CODE_CREATION_ARTIFACT_TERMS = [
  '代码', '源码', '解析器', '处理器', '函数', '方法', '模块', '类', '组件', '服务',
  '脚本', '算法', '测试代码', 'parser', 'processor', 'handler', 'function', 'method', 'module',
  'class', 'component', 'service', 'script', 'algorithm', 'test code',
];
const MATERIAL_OPERATION_TERMS = [
  '已有', '现有', '这些', '指定', '给定', '模板', '原格式', '字段', '版本号', '批量',
  '保留', 'existing', 'specified', 'given', 'template', 'original format', 'field',
  'version', 'batch', 'preserve',
];
const DOCUMENT_WRITE_TERMS = ['写入', '写', '编辑', '更新', '替换', '修改', 'write', 'edit', 'update', 'replace', 'modify'];
const LOOKUP_TERMS = [
  '查找', '搜索', '搜寻', '检索', '定位', '查询', '调查', '研究', '扫描', '梳理',
  'find', 'search', 'retrieve', 'retrieval', 'lookup', 'investigate', 'investigation', 'research', 'scan',
];
const CROSS_FILE_TERMS = [
  '跨文件', '多文件', '多个文件', '调用链', '引用关系', '影响面', '依赖链',
  '模块依赖', '依赖关系', 'cross-file', 'multiple files', 'call chain',
  'reference graph', 'impact radius', 'callers', 'callees', 'depends on', 'dependencies',
];
const BROAD_SCAN_TERMS = [
  '跨模块', '全仓', '全仓库', '全局扫描', '全面扫描', '广泛扫描', '大范围',
  '读重型', '大型扫描', 'repository-wide', 'cross-module', 'broad scan',
  'wide scan', 'large-scale', 'read-heavy', 'massive scan', 'entire repository',
];
const SINGLE_LOOKUP_TERMS = [
  '单符号', '单个符号', '单文件', '单个文件', '某个函数', '这个函数', '这个文件',
  'single symbol', 'single file', 'one symbol', 'one file', 'this function', 'this file',
];
const NON_TRIVIAL_PLAN_TERMS = [
  '架构', 'architecture', '接口设计', '接口契约', 'api contract', '技术方案',
  '选型', '决策', 'decision', '权衡', 'tradeoff', '迁移方案', '跨模块',
  '多阶段', 'multi-stage', '制定计划', '先计划', '开发计划', '实现计划',
  '测试计划', '验收标准', '策略', 'strategy', '可行性', 'plan first',
  'plan then', 'implementation plan', 'test plan', 'acceptance criteria',
];
const TRIVIAL_EDIT_TERMS = [
  'getter', 'setter', '拼写', 'typo', '加个注释', '添加注释', '补个注释',
  '类型定义', '这一行', '一行代码', '单行修改', 'one-line', 'single-line',
];

const REVIEW_FEEDBACK_GUIDANCE = '交付物由主 Agent 验收并整合；按交付物完成相称验证后，再独立审查非琐碎成果。只对有具体证据且影响本次验收的实质问题，经主 Agent 核实后交原执行角色有界修复并复查；提示项不自动返修或停工。';
const THIRD_PARTY_GUIDANCE = '默认不审查、不格式化/lint 第三方实现目录（3rd、third_party、third-party、thridpart、vendor 等），只核对自有代码的接入与调用契约，按需读取依赖接口；用户明确要求时才扩大范围。';

/**
 * 英文词按单词边界匹配（避免 fix 命中 prefix、bug 命中 debug），中文与符号按子串匹配。
 * @param {string} text 已小写的提示
 * @param {string[]} terms
 * @returns {boolean}
 * @example
 * includesAny('add a prefix', ['fix']) // false
 */
function includesAny(text, terms) {
  return terms.some((term) => {
    if (!/^[a-z][a-z -]*$/i.test(term)) return text.includes(term);
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  });
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

function exactNarrowLookup(text) {
  return includesAny(text, LOOKUP_TERMS)
    && includesAny(text, SINGLE_LOOKUP_TERMS)
    && !includesAny(text, CROSS_FILE_TERMS)
    && !includesAny(text, BROAD_SCAN_TERMS);
}

/**
 * 识别可交给低成本角色的机械证据工作类型；代码写作意图不走低成本路线。
 * @returns {''|'logs'|'code-evidence'|'established-tests'|'structured-data'|'documents'}
 * @example
 * detectLowCostKind('分析这些日志的报错', false, false, false, false) // 'logs'
 */
function detectLowCostKind(text, explicitCodeContext, lookup, crossFile, codeCreationIntent) {
  const hasLogs = includesAny(text, LOW_COST_LOG_TERMS);
  const hasDocuments = includesAny(text, LOW_COST_DOCUMENT_TERMS);
  const hasStructuredData = includesAny(text, ['csv', 'json', 'tsv', 'xlsx', 'spreadsheet']);
  const hasText = includesAny(text, LOW_COST_TEXT_TERMS);
  const hasExtractionAction = includesAny(text, LOW_COST_EXTRACTION_TERMS)
    || includesAny(text, ['查看', '分析', '运行', '执行', 'inspect', 'review']);
  const codeEvidence = explicitCodeContext
    && (lookup || crossFile || includesAny(text, LOW_COST_CODE_EVIDENCE_TERMS));
  const testExecution = includesAny(text, LOW_COST_TEST_EXECUTION_TERMS);
  const explicitCodeTest = includesAny(text, LOW_COST_CODE_TEST_TERMS);
  const establishedTestWithCodeContext = includesAny(text, LOW_COST_ESTABLISHED_TEST_TERMS)
    && explicitCodeContext
    && includesAny(text, ['测试', '用例', 'test', 'case', 'qa']);
  if (hasLogs && (hasExtractionAction || lookup
      || includesAny(text, ['修复', '排查', 'debug', 'fix', 'crash', 'error']))) return 'logs';
  if (codeEvidence) return 'code-evidence';
  if (!codeCreationIntent && testExecution && (explicitCodeTest || establishedTestWithCodeContext)) {
    return 'established-tests';
  }
  if (codeCreationIntent) return '';
  if (hasStructuredData && hasExtractionAction) return 'structured-data';
  if ((hasDocuments || hasText) && hasExtractionAction) return 'documents';
  return '';
}

/**
 * 判断当前消息是否有直接的只读任务指示。只读线索须出现在请求分句开头，
 * 不把产品行为中的“不修改”“只读模式”等任意子串当成任务权限。
 * @param {string} text 已小写的提示
 * @returns {boolean}
 * @example
 * hasReadOnlyDirective('只读诊断崩溃，禁止修改') // true
 * hasReadOnlyDirective('实现一个只读模式开关')     // false
 */
function hasReadOnlyDirective(text) {
  const prose = text.replace(/```[^]*?```|~~~[^]*?~~~/g, '')
    .replace(/^\s*>.*$/gm, '');
  return prose.split(/[，。！？；,.!?;\n]+/).some((clause) => {
    const directive = clause.trim()
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/^(?:(?:请(?:你)?|先|暂时|本次|本轮|这次|你)\s*)+/, '')
      .replace(/^(?:(?:please|for now)\s+)+/, '');
    return /^(?:只读(?=$|\s|[：:]|分析|诊断|审查|调查|检查|查看|读取|排查)|(?:仅|只)(?:分析|诊断|审查|调查)|(?:不要|禁止|不允许|不得|不)(?:修改|改动|编辑|写入|改))/.test(directive)
      || /^(?:read[- ]only(?:$|\s+(?:analysis|diagnosis|review|inspection|investigation)\b)|do not (?:edit|modify|write)\b|don't (?:edit|modify|write)\b|diagnosis only\b)/.test(directive);
  });
}

/**
 * 提取路由范围线索；这些启发式结果不构成写入或委派授权。
 * @param {string} text 已小写的提示
 * @returns {{primaryOnly:boolean, limitedAgents:boolean, readOnly:boolean, existingPlan:boolean, narrow:boolean, wordingOnly:boolean}}
 * @example
 * promptConstraints('不要委派，直接修复').primaryOnly // true
 */
function promptConstraints(text) {
  const primaryOnly = /只(?:用|由|让)?主(?:代理|agent)|仅(?:用|由|让)?主(?:代理|agent)|(?:不要|禁止|不用|不允许)(?:再)?(?:委派|分派|派遣|子代理|子任务)|\b(?:primary agent only|main agent only|no subagents?|no delegation|do not delegate|don't delegate)\b/.test(text);
  const limitedAgents = /(?:只|仅|最多).{0,8}(?:一个|一名|1 个|1名)(?:子)?代理|不要多个代理|不要并行|\b(?:only one agent|at most one subagent|no parallel agents|do not parallelize)\b/.test(text);
  const explicitReadOnly = hasReadOnlyDirective(text);
  const writeIntent = /实现|修复|迁移|重构|编码|\b(?:implement|fix|migrate|refactor|edit|modify|develop)\b/.test(text);
  const diagnosis = /诊断|排查|根因|\b(?:diagnos\w*|investigate|root cause|debug)\b/.test(text);
  const existingPlan = /(?:(?:已有|现有|已批准|已确认|批准的|确认的)(?:实现|执行|测试|验证|设计)?(?:计划|方案|用例))|不要重新规划|无需重新规划|\b(?:(?:existing|approved) (?:(?:implementation|execution|test|qa|design) )?(?:plan|cases?)|do not replan|don't replan)\b/.test(text);
  const narrow = /(?:只|仅).{0,12}(?:一个|单个|单|这个)文件|单文件|\b(?:one file|single file|this file only)\b/.test(text);
  const wordingOnly = /(?:拼写|措辞|标点|\b(?:spelling|wording|typo|punctuation)\b)/.test(text)
    && /readme|changelog|markdown|文档|注释|\b(?:docs?|comments?)\b/.test(text)
    && /仅|只|\bonly\b/.test(text);
  return { primaryOnly, limitedAgents, readOnly: explicitReadOnly || (diagnosis && !writeIntent), existingPlan, narrow, wordingOnly };
}

/** 低成本证据类型 → 承接角色：需要执行命令的走 tester，纯读取走 explorer。 */
function lowCostRole(kind) {
  return ['logs', 'established-tests'].includes(kind) ? 'dispatch-tester' : 'dispatch-explorer';
}

/**
 * 去掉提示里的工具标识符再做关键词匹配：`code-review-graph` 中的 review、
 * `mcp__plugin_x_y__fix_tool` 中的 fix 都是工具名，不是任务意图。
 * @param {string} text 已小写的提示
 * @returns {string}
 * @example
 * stripToolIdentifiers('调用 code-review-graph 的 list_graph_stats') // '调用   的 list_graph_stats'
 */
function stripToolIdentifiers(text) {
  return text.replace(/mcp__[\w-]+/g, ' ').replace(/code[-_]review[-_]graph/g, ' ');
}

/**
 * 按范围、任务意图、风险选择候选路线，不直接启动代理。
 * @param {string} prompt 用户原始提示
 * @param {object} config 有效配置
 * @returns {{category:string, shouldDispatch:boolean, role:string}} 另含范围线索字段
 * @example
 * routePrompt('请修复这个普通 bug 并补测试', config).role // 'dispatch-worker'
 */
function routePrompt(prompt, config) {
  const text = typeof prompt === 'string' ? stripToolIdentifiers(prompt.trim().toLowerCase()) : '';
  if (!text) return { category: 'generic', shouldDispatch: false, role: '' };

  // Git CLI 参数中的 fix/review/architecture 是数据，不是任务意图；
  // 只有整段可安全解析且全部为 Git 时才静默，混合自然语言或其他命令仍正常路由。
  if (isPureGitCommand(prompt.trim())) {
    return { category: 'generic', shouldDispatch: false, role: '', reason: 'pure Git CLI command' };
  }

  const constraints = promptConstraints(text);
  const regressionReview = /\b(?:inspect|check)\b.{0,40}\b(?:patch|changes?|diff)\b.{0,30}\bregressions?\b/.test(text);
  const codeRegressionReview = /\b(?:inspect|check)\b.{0,40}\b(?:patch|diff)\b.{0,30}\bregressions?\b/.test(text);
  const review = includesAny(text, REVIEW_TERMS) || regressionReview;
  const highRisk = !constraints.wordingOnly && includesAny(text, HIGH_RISK_TERMS);
  const hardSignal = includesAny(text, HARD_TERMS)
    || (includesAny(text, ['调试', 'debug', '排查', 'diagnose'])
      && includesAny(text, ['复杂', '疑难', '困难', 'complex', 'difficult', 'hard']));
  const plan = includesAny(text, PLAN_TERMS);
  const lookup = includesAny(text, LOOKUP_TERMS);
  const broad = includesAny(text, BROAD_SCAN_TERMS);
  const crossFile = includesAny(text, CROSS_FILE_TERMS);
  const hasImplementationTerm = includesAny(text, IMPLEMENT_TERMS);
  const designDeliverable = includesAny(text, ['原型', '线框图', '成稿', 'prototype', 'mockup', 'wireframe'])
    && includesAny(text, ['制作', '创建', '生成', '设计', 'produce', 'create', 'build', 'design']);
  const explicitDeliveryAction = DELIVERY_ACTION_PATTERN.test(text);
  const delivery = !constraints.readOnly
    && (includesAny(text, DELIVERY_TERMS) || designDeliverable || explicitDeliveryAction);
  const directVerification = /^(?:请)?(?:验证|核验|验收|测试|复现)/.test(text)
    || /^(?:please\s+)?(?:verify|validate|test|reproduce)\b/.test(text);
  const verification = includesAny(text, VERIFICATION_TERMS)
    && (includesAny(text, VERIFICATION_ACTION_TERMS)
      || directVerification
      || /(?:按|依据|依照|使用|运行|执行|run|execute|perform|use).{0,30}(?:用例|测试|验证|验收|cases?|tests?|qa|verification)/.test(text));
  const explicitModificationAction = /^(?:请|帮我)?(?:实现|修复|修改|改动|迁移|重构|编码|开发)/.test(text)
    || /(?:并|然后|再|之后|后|[，,;；])\s*(?:再)?(?:实现|修复|修改|改动|迁移|重构|编码|开发)/.test(text)
    || /^(?:please\s+)?(?:implement|fix|modify|edit|migrate|refactor|develop)\b/.test(text)
    || /\b(?:and|then|after that)\s+(?:implement|fix|modify|edit|migrate|refactor|develop)\b/.test(text);
  const testImplementation = /(?:写|编写|添加|补|补充|新增|增加|更新|修改|覆盖).{0,8}(?:单元测试|回归测试|测试用例|测试代码|代码测试|源码测试)/.test(text)
    || /(?:写|编写|添加|补充|新增)\s*测试(?:$|[，。,.]|代码|覆盖)/.test(text)
    || /\b(?:write|add|cover|implement)\b.{0,24}\b(?:unit tests?|regression tests?|test cases?|code tests?)\b/i.test(text);
  const codeCreationIntent = !constraints.readOnly
    && includesAny(text, CODE_CREATION_ACTION_TERMS)
    && includesAny(text, CODE_CREATION_ARTIFACT_TERMS);
  const hard = hardSignal || ((testImplementation || codeCreationIntent)
    && includesAny(text, ['复杂', '疑难', '困难', 'complex', 'difficult', 'hard']));
  const modificationIntent = explicitModificationAction || includesAny(text, [
    '实现', '修复', '修改', '改动', '迁移', '重构', '编码', '开发',
    'implement', 'fix', 'modify', 'edit', 'migrate', 'refactor', 'develop',
  ]) || testImplementation || codeCreationIntent;
  const implementation = !constraints.readOnly && (hasImplementationTerm || testImplementation || codeCreationIntent)
    && (!verification || explicitModificationAction);
  const externalResearch = includesAny(text, EXTERNAL_RESEARCH_TERMS)
    && includesAny(text, [...LOOKUP_TERMS, '调研', '核对', '比较', 'compare', 'verify']);
  const inspectArchitecture = /(?:分析|梳理|了解|解释).{0,20}(?:架构|模块)|\b(?:explain|inspect|map|understand)\b.{0,30}\b(?:architecture|modules?)\b/.test(text);
  const createsPlan = PLAN_CREATION_PATTERN.test(text);
  const executesPlan = /(?:执行|落实|运行|按|依据|依照|follow|execute|run|carry out).{0,30}(?:计划|方案|plan)/.test(text);
  const planCreation = !constraints.existingPlan
    && (!lookup || createsPlan)
    && (!executesPlan || createsPlan);
  const nonTrivialPlan = plan && (!delivery || createsPlan) && !constraints.existingPlan && !inspectArchitecture && (
    text.length >= 80
    || includesAny(text, NON_TRIVIAL_PLAN_TERMS)
    || crossFile
    || broad
  ) && planCreation;

  const explicitCodeContext = includesAny(text, CODE_CONTEXT_TERMS)
    || codeRegressionReview
    || /\b[a-z_][a-z0-9_.:-]*\s+module\b|\b[a-z_][a-z0-9_.:-]*\s+模块/i.test(text);
  const lowCostKind = detectLowCostKind(text, explicitCodeContext, lookup, crossFile, codeCreationIntent);
  const policyDiscussion = includesAny(text, ['agent dispatch', 'agentdispatch', '调度', '路由', '分派', '委派'])
    && includesAny(text, ['配置', '优化', '讨论', '策略', '规则', '设置', '交给', 'policy', 'configure', 'configuration']);
  const materialKind = ['documents', 'structured-data'].includes(lowCostKind);
  const materialWriteIntent = materialKind && includesAny(text, DOCUMENT_WRITE_TERMS);
  const boundedMaterialWrite = !materialWriteIntent || includesAny(text, MATERIAL_OPERATION_TERMS);
  const documentRoutineWrite = materialKind
    && boundedMaterialWrite
    && !includesAny(text, ['实现', '修复', '迁移', '重构', '编码', 'implement', 'fix', 'migrate', 'refactor', 'develop']);
  const unboundedMaterialWrite = !constraints.readOnly && materialWriteIntent && !boundedMaterialWrite;
  const lowCostRoute = Boolean(lowCostKind
    && !unboundedMaterialWrite
    && (!modificationIntent || documentRoutineWrite)
    && !(lowCostKind === 'established-tests' && delivery && !testImplementation)
    && !review
    && !nonTrivialPlan);
  const needsGraph = !constraints.wordingOnly && explicitCodeContext
    && (crossFile || broad || inspectArchitecture || review);
  const result = (category, role, extra = {}) => ({
    category,
    shouldDispatch: true,
    role,
    needsGraph,
    lowCostKind,
    lowCostEvidence: Boolean(lowCostKind
      && !(lowCostKind === 'established-tests' && testImplementation)
      && !lowCostRoute
      && (modificationIntent || implementation || highRisk || hard || nonTrivialPlan || review)),
    ...constraints,
    ...extra,
  });

  if (constraints.primaryOnly) return result('primary-only', '', { shouldDispatch: false });
  if (constraints.wordingOnly) return result('generic', '', { shouldDispatch: false, reason: 'wording-only document edit/review' });
  if (constraints.narrow || (!review && exactNarrowLookup(text))) {
    return result(highRisk ? 'primary-risk' : 'generic', '', {
      shouldDispatch: false, reason: 'explicit narrow scope is primary-agent work',
    });
  }
  if (policyDiscussion) {
    return result('generic', '', { shouldDispatch: false, reason: 'dispatch policy discussion is primary-agent work' });
  }
  if (review) return result(highRisk ? 'high-risk-review' : 'review', 'dispatch-reviewer');
  if (nonTrivialPlan && !hard) return result('plan', 'dispatch-planner');
  if (lowCostRoute) {
    const writes = documentRoutineWrite && materialWriteIntent && !constraints.readOnly;
    return result('low-cost', writes ? 'dispatch-worker' : lowCostRole(lowCostKind));
  }
  if (unboundedMaterialWrite) return result('execution', 'dispatch-worker');
  if (verification && !implementation && (!delivery || directVerification)) return result('verification', 'dispatch-tester');
  if (externalResearch) return result('external-research', 'dispatch-researcher', { needsGraph: false });
  if (constraints.readOnly) {
    if (broad) return result('broad-search', 'dispatch-mapper');
    return result(crossFile ? 'bounded-search' : 'diagnosis', 'dispatch-explorer');
  }
  if (implementation && highRisk) return result('high-risk-implementation', 'dispatch-worker');
  if (hard) {
    return result('hard-task', nonTrivialPlan ? 'dispatch-planner' : 'dispatch-hard-worker', { requiresPlanner: nonTrivialPlan });
  }
  if (implementation) {
    return result('implementation', 'dispatch-worker', { shouldDispatch: !includesAny(text, TRIVIAL_EDIT_TERMS) });
  }
  if (delivery) return result('execution', 'dispatch-worker');
  if (broad || (lookup && includesAny(text, ['全局', '全面', '广泛', 'wide', 'broad']))) {
    return result('broad-search', 'dispatch-mapper');
  }
  if (crossFile || inspectArchitecture || (lookup && includesAny(text, ['多个', 'many', 'several']))) {
    return result('bounded-search', 'dispatch-explorer');
  }

  const configured = configuredKeywordMatch(text, config);
  return {
    category: 'generic',
    shouldDispatch: configured,
    role: configured ? 'dispatch-explorer' : '',
    reason: configured ? 'configured prompt keyword' : 'no task-specific routing signal',
  };
}

function lowCostKindLabel(kind) {
  return {
    logs: '日志检索与摘录',
    documents: '机械文档读写与文本整理',
    'structured-data': '机械结构化数据整理',
    'established-tests': '既定代码测试与失败证据收集',
    'code-evidence': '代码检索与调用取证',
  }[kind] || '机械证据处理';
}

function lowCostEvidenceGuidance(route) {
  if (!route.lowCostEvidence || !route.lowCostKind) return '';
  return ` 其中的${lowCostKindLabel(route.lowCostKind)}可先拆成证据子任务交给 ${ROLE_LABELS[lowCostRole(route.lowCostKind)]}，只回传位置与必要摘录；实现、关键方案和审查不随之降级。`;
}

/**
 * 生成与已解析范围一致的角色建议。
 * @param {object} route routePrompt 结果
 * @returns {string}
 * @example
 * routeGuidance(routePrompt('只读诊断崩溃', config)) // '任务路由：只读诊断。...'
 */
function routeGuidance(route) {
  const role = ROLE_LABELS[route.role] || '';
  const writer = `代码写作默认交给 ${ROLE_LABELS['dispatch-worker']}，给出文件责任、验收条件和验证命令；确属困难实现时改用 ${ROLE_LABELS['dispatch-hard-worker']}。`;
  switch (route.category) {
    case 'low-cost': {
      const scope = route.readOnly ? '保持只读，只回传必要证据'
        : route.lowCostKind === 'documents' ? '文档写入只限指定文件和字段'
          : route.lowCostKind === 'structured-data' ? '只处理指定字段和记录，保留来源与去重依据'
            : route.lowCostKind === 'established-tests' ? '只运行既定用例，不修改被测交付物或产品代码'
              : '保持只读，只回传必要证据';
      return `任务路由：低成本${lowCostKindLabel(route.lowCostKind)}。职责匹配时委派给 ${role}；${scope}，回传证据位置、必要摘录、验证与阻塞，不传整篇原文。主 Agent 负责范围、授权和整合。`;
    }
    case 'diagnosis':
      return `任务路由：只读诊断。确为调查阶段时可由 ${role} 在确认的只读范围内收集现象、根因证据和验证办法；主 Agent 按实际授权决定后续实施。`;
    case 'verification':
      return `任务路由：验证执行。按既定用例、验收标准或复现步骤由 ${role} 收集证据，该子任务内不修改被验收交付物。验证方式随交付物选择，不把构建或代码测试强加给非代码成果。`;
    case 'external-research':
      return `任务路由：外部研究。可交给 ${role}，回传来源、日期和事实/推断边界；工作区内已有材料改由 explorer 或主 Agent 读取。`;
    case 'high-risk-implementation':
      return `任务路由：涉及安全、权限或并发等风险的修改。主 Agent 先核对真实调用路径、契约、已有授权和验收标准，明确边界后才委派有界修改，不因关键词扩大权限。${writer} ${REVIEW_FEEDBACK_GUIDANCE}${lowCostEvidenceGuidance(route)}`;
    case 'high-risk-review':
      return `任务路由：高风险审查。默认 ${role}（已是 opus）；关键验收或极复杂约束确需更高推理强度时，主 Agent 可改用 ${ROLE_LABELS['dispatch-deep-reviewer']}（opus/xhigh），风险关键词本身不要求升级。纯证据收集或既定测试结果不等于独立审查通过。${THIRD_PARTY_GUIDANCE}`;
    case 'hard-task':
      if (!route.requiresPlanner) {
        return `任务路由：困难任务执行。主 Agent 先固定范围和验收标准，再交 ${ROLE_LABELS['dispatch-hard-worker']} 执行；不要仅因任务困难启动规划角色。${REVIEW_FEEDBACK_GUIDANCE}${lowCostEvidenceGuidance(route)}`;
      }
      return `任务路由：包含规划的困难任务。先核对现有方案；需要时由 ${role} 只读制定计划，主 Agent 拍板关键方案和公开契约后再交 ${ROLE_LABELS['dispatch-hard-worker']} 执行。已有可执行方案时直接推进，不重复规划。${REVIEW_FEEDBACK_GUIDANCE}${lowCostEvidenceGuidance(route)}`;
    case 'plan':
      return `任务路由：非琐碎计划/方案。可由 ${role} 做只读方案，架构与接口决策仍由主 Agent 确认；已有可执行方案时不重复规划。`;
    case 'broad-search':
      return `任务路由：广泛范围只读调查。可交 ${role}；子代理只完成确认的取证范围，主 Agent 继续推进完整任务。`;
    case 'bounded-search':
      return `任务路由：有界只读调查。可交 ${role}；精确的小范围查找由主 Agent 直接完成。`;
    case 'implementation':
      return `任务路由：常规实现。${writer} ${REVIEW_FEEDBACK_GUIDANCE}${lowCostEvidenceGuidance(route)}`;
    case 'execution':
      return `任务路由：内容制作/交付执行。主 Agent 先固定交付物、受众、格式和验收标准，再交 ${role} 执行。${REVIEW_FEEDBACK_GUIDANCE}${lowCostEvidenceGuidance(route)}`;
    case 'review':
      return `任务路由：常规审查。可交 ${role}，主 Agent 复核后整合；纯证据收集或既定测试结果不等于独立审查通过。${THIRD_PARTY_GUIDANCE}`;
    default:
      return `任务路由：先由主 Agent 划定边界；可从 ${role || ROLE_LABELS['dispatch-explorer']} 开始有界调查，再决定是否需要实现角色。`;
  }
}

/**
 * 返回 UserPromptSubmit 注入的简短任务路线；琐碎、主 Agent 专属或无信号的提示保持静默。
 * @param {string} prompt
 * @param {object} config
 * @returns {string}
 * @example
 * promptGuidance('修复这一行 typo', config) // ''
 */
function promptGuidance(prompt, config) {
  const route = routePrompt(prompt, config);
  if (route.category === 'primary-risk') {
    return `${PROMPT_ROUTE_NOTICE} 任务路由：单文件风险检查/修复，由主 Agent 处理。先核对权限、安全或并发契约的证据与现有授权，按实际风险验证，不扩大用户指定范围。${route.readOnly ? '若用户当前要求只读，则按该范围收集证据。' : ''}`;
  }
  if (!route.shouldDispatch) return '';
  const graph = route.needsGraph
    ? ' 明确涉及代码结构、调用关系或代码审查时优先图查询，再读源码核对；图刷新由 CodeMap 插件负责。'
    : '';
  const agentLimit = route.limitedAgents
    ? ' 用户声明的代理数量或并行限制优先于默认并发额度；不把候选列表变成多个必须启动的代理。'
    : '';
  return `${PROMPT_ROUTE_NOTICE} ${routeGuidance(route)}${graph}${agentLimit}`;
}

function mainAgentGuidance(config) {
  const maxParallel = Number(config.policy && config.policy.max_parallel_subagents) || 3;
  return [
    'Agent Dispatch（Claude Code 原生语义）：你是主 Agent，负责需求澄清、关键方案与公开契约决策、任务拆分、结果审查和最终整合。',
    '按完整对话和用户最新明确要求判断当前任务；产品行为和引用材料不等于任务限制。UserPromptSubmit 的路由只是候选建议，不是宿主限制或持久任务状态；后续没有新建议不代表旧路线继续生效。',
    '明确、有界的调查、规划分析、交付执行、验证与审查可交给 agent-dispatch:* 子代理；琐碎读取、小改和强耦合步骤直接完成。',
    '模型分工：opus 负责规划与审查（dispatch-planner/reviewer，关键验收用 dispatch-deep-reviewer 提高 effort）；sonnet 负责写代码（dispatch-worker，困难实现用 dispatch-hard-worker 提高 effort）；其余——读代码、搜索扫描、读日志、外部研究、既定测试执行——一律 haiku（dispatch-explorer/mapper/researcher/tester）。风险关键词不决定换模型；用户明确指定的模型优先。',
    '混合任务按阶段拆分：只把日志、调用链、源码位置和既定测试证据交给 haiku 角色；实现与关键判断不随之降级。',
    `独立且并行有收益时才并行，最多 ${maxParallel} 个子代理；结果已整合或不再需要时立即停止后台 Agent。`,
    '所有 Git 命令由主 Agent 串行执行；子代理运行 Git 会被 Hook 拦截。委派不扩大文件、网络、权限、对外发布、付费、生产或真实数据变更的授权。',
    '非琐碎交付完成相称验证后独立审查；只有具体证据证明影响本次验收的缺陷才阻塞，假设性风险与风格建议作为非阻塞提示。' + THIRD_PARTY_GUIDANCE,
    '子代理必须报告 Changed files、Validation、Blockers；主 Agent 重读改动并自行判断是否完成。',
    'CodeMap 负责图刷新和检索屏障，Agent Dispatch 只负责角色选择；只有明确的代码结构、调用关系或代码审查才使用图规则。MCP schema 可能延迟加载，先用 ToolSearch 发现工具，不能仅凭当前工具列表断言不可用。',
  ].join('\n');
}

function subagentGuidance(config) {
  const lines = [
    'Agent Dispatch：你是被派遣的 Claude 子代理，不是主协调者。直接完成给定的有界任务，不扩大范围，不自行升级模型。',
    '不要再派遣 Agent；不要运行任何 Git 命令，Git 由主 Agent 串行处理。保留并适配他人现有改动，不得回滚。',
    '角色与写入权限不新增对外发布、发送、付费、生产或真实数据变更的授权。' + THIRD_PARTY_GUIDANCE,
    'CodeMap 插件负责图刷新/读前屏障；只有明确的代码结构、调用、引用或影响面查询才优先使用图工具，纯文本/注释/字符串再用 Grep。MCP schema 延迟时先用 ToolSearch。',
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

const SCOPED_ROLE_PATTERN = new RegExp(`^(?:agent-dispatch:)?(?:${Object.keys(ROLES).join('|')})$`);

function agentNudge(toolInput, config) {
  const type = String((toolInput && (toolInput.subagent_type || toolInput.agent_type)) || '');
  if (SCOPED_ROLE_PATTERN.test(type)) return '';
  const text = [toolInput && toolInput.description, toolInput && toolInput.prompt]
    .filter(Boolean).join(' ');
  const route = routePrompt(text, config);
  if (!route.shouldDispatch || !route.role) return '';
  return `${routeGuidance(route)}\n优先使用插件提供的 scoped agent（${ROLE_LABELS[route.role]}），而不是临时用同一高成本模型承接所有任务。`;
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  agentNudge,
  hasReadOnlyDirective,
  mainAgentGuidance,
  missingReportSections,
  promptGuidance,
  routePrompt,
  subagentGuidance,
};
