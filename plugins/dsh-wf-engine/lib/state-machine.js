/**
 * dsh-wf-engine 状态机：规格文档 §2.2 工作流图的显式数据表示。
 * 纯数据模块——无 IO、零依赖。lib/engine.js、lib/evals.js 与测试直接导入。
 *
 * 设计要点（对应文档）：
 * - 状态转移是显式数据（TRANSITIONS 边集），不是提示词约定（§2.2）。
 * - 每个状态有输入/产物/进入/退出/失败转移/审计（§2.2）。
 * - 失败分类表（§6）也作为数据存在，供 wf_test/wf_repair 决策。
 */

export const PHASES = [
  'INTAKE', 'INSPECT', 'CLARIFY', 'PLAN', 'RESEARCH', 'BASELINE_EVAL',
  'IMPLEMENT', 'VERIFY', 'INDEPENDENT_REVIEW', 'REPAIR', 'DELIVERY', 'LEARN',
  'DONE', 'BLOCKED',
]

/** 每个状态：输入 / 产物 / 进入条件 / 退出条件 / 失败转移。 */
export const STATE_DEFS = {
  INTAKE: {
    inputs: ['用户目标 / 任务请求'],
    outputs: ['task_id', 'goal', '初始 acceptance_criteria', 'constraints'],
    entry: '任务请求被接受',
    exit: 'goal 与 constraints 已持久化',
    failure: 'CLARIFY',
  },
  INSPECT: {
    inputs: ['workspace', '任务请求'],
    outputs: ['依赖清单', '风险笔记', '问题复述'],
    entry: '代码库侦察开始（只读）',
    exit: '侦察事实与问题复述已记录',
    failure: 'CLARIFY',
  },
  CLARIFY: {
    inputs: ['关键事实缺失'],
    outputs: ['≤3 个高信息量问题 / 用户回答'],
    entry: '关键事实缺失',
    exit: '事实已解决或用户拍板',
    failure: 'BLOCKED',
  },
  PLAN: {
    inputs: ['侦察事实', '验收标准'],
    outputs: ['实施计划', '文件影响面', '测试策略', '回滚方案'],
    entry: '规划被授权',
    exit: '计划经用户审阅',
    failure: 'RESEARCH',
  },
  RESEARCH: {
    inputs: ['未决问题'],
    outputs: ['来源引用', '关键结论', '不确定性'],
    entry: '存在未决问题',
    exit: '问题带来源回答',
    failure: 'PLAN',
  },
  BASELINE_EVAL: {
    inputs: ['计划', 'fixture 仓库'],
    outputs: ['基线测试运行', '失败签名'],
    entry: '计划已固定',
    exit: '基线已记录',
    failure: 'RESEARCH',
  },
  IMPLEMENT: {
    inputs: ['工作单元'],
    outputs: ['每个单元的最小正确修改'],
    entry: '基线已记录',
    exit: '每个单元有验证证据',
    failure: 'VERIFY',
  },
  VERIFY: {
    inputs: ['代码变更'],
    outputs: ['测试/lint/类型结果', '最小复现'],
    entry: '实现完成',
    exit: '无未关闭失败',
    failure: 'REPAIR',
  },
  INDEPENDENT_REVIEW: {
    inputs: ['变更 + 证据'],
    outputs: ['按严重度分级审查发现'],
    entry: '验证通过',
    exit: '无 blocker/high，medium 已处理',
    failure: 'REPAIR',
  },
  REPAIR: {
    inputs: ['失败证据'],
    outputs: ['原因、修复计划、重测'],
    entry: '证据支撑的失败',
    exit: '原因已修复或升级',
    failure: 'BLOCKED',
  },
  DELIVERY: {
    inputs: ['已验证变更', '审查通过'],
    outputs: ['交付摘要', '变更清单', '剩余风险'],
    entry: '审查门禁通过',
    exit: '摘要交付，默认不推送',
    failure: 'INDEPENDENT_REVIEW',
  },
  LEARN: {
    inputs: ['已交付任务'],
    outputs: ['去重、去敏的教训'],
    entry: '交付完成',
    exit: '教训已写入',
    failure: 'DONE',
  },
  DONE: {
    inputs: [],
    outputs: ['结案审计'],
    entry: 'learn+delivery 关闭',
    exit: '—',
    failure: '—',
  },
  BLOCKED: {
    inputs: ['硬阻塞'],
    outputs: ['checkpoint + 回滚说明'],
    entry: '不可恢复 / 需要用户',
    exit: '用户决策后 resume',
    failure: '—',
  },
}

/**
 * 显式边集：未列出的转移一律拒绝（由 wf_transition 强制）。
 * 业务规则固化在图中：
 * - VERIFY 不能直达 DELIVERY（必须先 INDEPENDENT_REVIEW，§2.3 双重审查门禁）。
 * - REVIEW 失败回 REPAIR；REPAIR 只能回到 IMPLEMENT/VERIFY/RESEARCH。
 * - BLOCKED 只能由用户决策后 resume 进入受控恢复路径。
 */
export const TRANSITIONS = {
  INTAKE: ['INSPECT', 'CLARIFY', 'BLOCKED'],
  INSPECT: ['CLARIFY', 'PLAN', 'BLOCKED'],
  CLARIFY: ['INSPECT', 'PLAN', 'BLOCKED'],
  PLAN: ['RESEARCH', 'BASELINE_EVAL', 'INSPECT', 'BLOCKED'],
  RESEARCH: ['PLAN', 'BASELINE_EVAL', 'BLOCKED'],
  BASELINE_EVAL: ['IMPLEMENT', 'RESEARCH', 'BLOCKED'],
  IMPLEMENT: ['VERIFY', 'BLOCKED'],
  VERIFY: ['REPAIR', 'INDEPENDENT_REVIEW', 'BLOCKED'],
  INDEPENDENT_REVIEW: ['REPAIR', 'DELIVERY', 'VERIFY', 'BLOCKED'],
  REPAIR: ['IMPLEMENT', 'VERIFY', 'RESEARCH', 'BLOCKED'],
  DELIVERY: ['LEARN', 'INDEPENDENT_REVIEW', 'BLOCKED'],
  LEARN: ['DONE', 'BLOCKED'],
  DONE: [],
  BLOCKED: ['INSPECT', 'PLAN', 'IMPLEMENT', 'VERIFY', 'INDEPENDENT_REVIEW', 'REPAIR', 'DELIVERY'],
}

/** 成功路径上的“自然下一状态”，供 wf_* 的 advance 便利参数使用。 */
export const SUCCESS_NEXT = {
  INTAKE: 'INSPECT',
  INSPECT: 'PLAN',
  CLARIFY: 'PLAN',
  PLAN: 'RESEARCH',
  RESEARCH: 'BASELINE_EVAL',
  BASELINE_EVAL: 'IMPLEMENT',
  IMPLEMENT: 'VERIFY',
  VERIFY: 'INDEPENDENT_REVIEW',
  INDEPENDENT_REVIEW: 'DELIVERY',
  REPAIR: 'VERIFY',
  DELIVERY: 'LEARN',
  LEARN: 'DONE',
}

export function canonical(given) {
  return String(given ?? '').trim().toUpperCase().replace(/[^A-Z_]/g, '')
}

export function isPhase(value) {
  return PHASES.includes(canonical(value))
}

/** 查询 from→to 是否在显式边集中；返回 { ok, allowed }。 */
export function transitionInfo(from, to) {
  const f = canonical(from)
  const allowed = TRANSITIONS[f] ?? []
  return { ok: allowed.includes(canonical(to)), allowed }
}

/**
 * 失败分类表（§6）：给定失败签名文本，启发式归类到处理策略。
 * 返回 { type, strategy }；repeats 参数用于识别“反复失败”。
 */
export const FAILURE_TABLE = [
  { type: 'ambiguity', keywords: ['ambiguous', 'unclear', 'need clarification', '缺少信息', '不明确', '歧义'], strategy: '暂停在 CLARIFY，最多问 3 个高信息量问题' },
  { type: 'transient', keywords: ['timeout', 'econnreset', 'econnrefused', 'etimedout', 'retry', '网络', '超时', '瞬时'], strategy: '有上限的指数退避，记录重试次数' },
  { type: 'test', keywords: ['test fail', 'assertion', 'tests failed', '测试失败', '断言', 'lint error', 'type error', 'pytest'], strategy: '保存最小复现、错误摘要和相关 diff，再修复' },
  { type: 'dependency', keywords: ['module not found', 'cannot find module', 'version conflict', '依赖', '找不到模块', '版本冲突'], strategy: '检查锁文件、版本、解释器和可重复命令，不擅自升级大版本' },
  { type: 'schema', keywords: ['schema', 'json parse', 'invalid json', 'unexpected token', 'schema 不符', '解析失败'], strategy: '确定性解析/修复，超上限降级并报告' },
  { type: 'permission', keywords: ['permission denied', 'access denied', 'not authorized', 'forbidden', '无权限', '拒绝访问'], strategy: '生成待批准动作和 dry-run，不绕过权限' },
]

export function classifyFailure(signature, { repeats = 0 } = {}) {
  const text = String(signature ?? '').toLowerCase()
  if (repeats >= 2) {
    return { type: 'recurring', strategy: '同一假设连续失败两次后回退到诊断，不继续盲修' }
  }
  for (const row of FAILURE_TABLE) {
    if (row.keywords.some((k) => text.includes(k.toLowerCase()))) {
      return { type: row.type, strategy: row.strategy }
    }
  }
  return { type: 'unrecoverable', strategy: '保留 checkpoint、工作树状态和回滚说明，清晰交付阻塞原因' }
}

/** 迭代预算（§6）：任何循环必须有预算，达到即停。 */
export function budgetExceeded(budget, used) {
  if (budget == null) return false
  const u = used ?? {}
  if (budget.maxIterations != null && (u.iterations ?? 0) >= budget.maxIterations) return true
  if (budget.maxTokens != null && (u.tokens ?? 0) >= budget.maxTokens) return true
  if (budget.maxWallMs != null && (u.elapsedMs ?? 0) >= budget.maxWallMs) return true
  if (budget.maxExternalCalls != null && (u.externalCalls ?? 0) >= budget.maxExternalCalls) return true
  return false
}
