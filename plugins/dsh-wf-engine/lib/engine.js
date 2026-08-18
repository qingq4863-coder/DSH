/**
 * dsh-wf-engine 纯逻辑引擎（§3.2 / §4 / §5）：数据进、数据出，无 IO。
 * lib/index.js 只负责把它接到工具与存储上；测试直接测这里的每个决策函数。
 */

import { canonical, transitionInfo, SUCCESS_NEXT } from './state-machine.js'
import { computeProjectReadiness, ensureProjectIntelligence, syncValidationFromTest } from './project-intelligence.js'

export function createInitialTask({ goal, workspace = '', constraints = [], acceptanceCriteria = [], assumptions = [], model = '' }) {
  const now = new Date().toISOString()
  return {
    task_id: '', // 由 store.newTaskId() 填充
    goal: String(goal ?? ''),
    phase: 'INTAKE',
    acceptance_criteria: [...(acceptanceCriteria ?? [])],
    constraints: [...(constraints ?? [])],
    touched_files: [],
    work_units: [],
    commands_run: [],
    test_results: [],
    review_findings: [],
    review_history: [],
    review_completed: false,
    review_round: 0,
    pending_approvals: [],
    assumptions: [...(assumptions ?? [])],
    risks: [],
    architecture_map: { components: [], relations: [], entry_points: [], invariants: [], evidence: [], updated_at: null },
    impact_analyses: [],
    hypotheses: [],
    validation_matrix: [],
    plan: null,
    verify: { passed: false, open_failures: 0, last_run: null },
    next_action: '',
    cost: { model: model || '', tokens_estimated: 0, streams: 0, retries: 0, elapsed_seconds: 0 },
    workspace,
    created_at: now,
    updated_at: now,
    version: 1,
  }
}

export function touchTimes(task) {
  task.updated_at = new Date().toISOString()
  return task
}

/** 补齐 0.1.x checkpoint 缺失字段；不覆盖已有数据。 */
export function ensureTaskShape(task) {
  if (!task || typeof task !== 'object') throw new Error('无效 task checkpoint')
  for (const key of ['acceptance_criteria', 'constraints', 'touched_files', 'work_units', 'commands_run', 'test_results', 'review_findings', 'review_history', 'pending_approvals', 'assumptions', 'risks']) {
    if (!Array.isArray(task[key])) task[key] = []
  }
  if (!task.verify || typeof task.verify !== 'object') task.verify = { passed: false, open_failures: 0, last_run: null }
  task.verify.passed = task.verify.passed === true
  task.verify.open_failures = Number(task.verify.open_failures ?? 0)
  task.verify.last_run ??= null
  if (!task.cost || typeof task.cost !== 'object') task.cost = {}
  task.cost = { model: '', tokens_estimated: 0, streams: 0, retries: 0, elapsed_seconds: 0, ...task.cost }
  task.review_completed = task.review_completed === true
  task.review_round = Number(task.review_round ?? 0)
  task.review_medium_ack = task.review_medium_ack === true
  task.goal ??= ''
  task.phase ??= 'INTAKE'
  task.next_action ??= ''
  task.workspace ??= ''
  if (!Array.isArray(task.host_evidence)) task.host_evidence = []
  if (!Array.isArray(task.semantic_changes)) task.semantic_changes = []
  ensureProjectIntelligence(task)
  return task
}

/** 工作单元（§4.1：单一主风险/明确输入/文件范围/验证命令/done 条件）。 */
export function addWorkUnit(task, unit) {
  const warnings = []
  const input = {
    title: String(unit?.title ?? '').trim(),
    risk: unit?.risk ?? '',
    inputs: unit?.inputs ?? '',
    file_scope: [...(unit?.file_scope ?? [])],
    verify_command: unit?.verify_command ?? '',
    done_criteria: unit?.done_criteria ?? '',
    status: 'pending',
    evidence: '',
  }
  if (!input.title) throw new Error('work unit 必须有 title')
  if (!input.verify_command) warnings.push(`工作单元「${input.title}」缺 verify_command，complete 前必须补齐`)
  if (!input.done_criteria) warnings.push(`工作单元「${input.title}」缺 done_criteria，complete 前必须补齐`)
  if (warnings.length === 0 && (input.file_scope.length === 0 || !input.risk)) {
    warnings.push(`工作单元「${input.title}」建议补充 file_scope 与 risk（§4.1）`)
  }
  task.work_units.push({ id: `wu-${task.work_units.length + 1}`, ...input })
  return { task, unit: task.work_units[task.work_units.length - 1], warnings }
}

export function completeWorkUnit(task, idOrTitle, evidence) {
  const unit = task.work_units.find((u) => u.id === idOrTitle || u.title === idOrTitle)
  if (!unit) throw new Error(`找不到工作单元 ${idOrTitle}`)
  const warnings = []
  if (!unit.verify_command) warnings.push(`「${unit.title}」缺 verify_command —— 无法确认验证方式`)
  if (!unit.done_criteria) warnings.push(`「${unit.title}」缺 done_criteria —— 无法判定完成`)
  if (!String(evidence ?? '').trim()) warnings.push(`「${unit.title}」complete 缺 evidence`)
  unit.status = warnings.length === 0 ? 'done' : 'needs-attention'
  if (evidence) unit.evidence = String(evidence)
  return { task, unit, warnings }
}

/** 计划（§4.1 必须回答的问题集合）。 */
export function applyPlan(task, plan) {
  const warnings = []
  const input = {
    objective: plan?.objective ?? '',
    scope: plan?.scope ?? '',
    out_of_scope: plan?.out_of_scope ?? '',
    risks: [...(plan?.risks ?? [])],
    rollback: plan?.rollback ?? '',
    verify_actions: [...(plan?.verify_actions ?? [])],
    how_to_prove_done: plan?.how_to_prove_done ?? '',
  }
  if (!input.scope) warnings.push('计划缺 scope（本次要做什么）')
  if (!input.rollback) warnings.push('计划缺 rollback（如何回滚）')
  if (!input.how_to_prove_done && input.verify_actions.length === 0) warnings.push('计划缺完成证明（how_to_prove_done / verify_actions 至少其一）')
  if (input.risks.length > 3) warnings.push(`风险超过 3 个（当前 ${input.risks.length}），§4.1 要求聚焦最大三个风险`)
  task.plan = input
  return { task, warnings }
}

/** 宿主观测到验证后的代码变更时，统一作废测试、验证矩阵与审查结论。 */
export function invalidateVerificationAfterMutation(task, mutation = {}) {
  ensureTaskShape(task)
  const at = new Date().toISOString()
  const reason = `host-observed mutation after verification: ${mutation.file || mutation.tool || 'unknown'}`
  const invalidatedIds = new Set()
  for (const evidence of task.host_evidence) {
    if (!evidence?.passed || evidence.stale) continue
    evidence.stale = true
    evidence.stale_at = at
    evidence.stale_reason = reason
    if (evidence.id) invalidatedIds.add(evidence.id)
  }
  const commands = new Set()
  for (const record of task.test_results) {
    if (!record?.attestation?.id || !invalidatedIds.has(record.attestation.id)) continue
    record.stale = true
    record.stale_at = at
    record.stale_reason = reason
    commands.add(record.command)
  }
  for (const item of task.validation_matrix) {
    if (!commands.has(item.command)) continue
    item.status = 'pending'
    item.evidence = ''
    item.updated_at = at
  }
  if (invalidatedIds.size) {
    task.verify = { passed: false, open_failures: 0, last_run: task.verify?.last_run ?? null, stale: true, stale_reason: reason }
    if (task.review_completed) {
      task.review_history.push({ round: task.review_round, findings: task.review_findings, medium_ack: task.review_medium_ack === true, invalidated_at: at, invalidated_reason: reason })
      task.review_findings = []
      task.review_completed = false
      task.review_medium_ack = false
    }
  }
  return { task, invalidated: invalidatedIds.size, commands: [...commands], reason }
}

/** 测试结果（§5）：维护 verify 门禁的末态判定。 */
export function applyTestResult(task, row) {
  ensureTaskShape(task)
  const outcome = String(row?.outcome ?? '').toLowerCase()
  if (!['pass', 'fail'].includes(outcome)) throw new Error(`outcome 必须是 pass 或 fail，收到 "${outcome}"`)
  const record = {
    command: String(row?.command ?? ''),
    outcome,
    summary: row?.summary ?? '',
    artifacts: [...(row?.artifacts ?? [])],
    regression: Boolean(row?.regression),
    attestation: row?.attestation ? {
      id: row.attestation.id, source: row.attestation.source, session_id: row.attestation.session_id,
      call_id: row.attestation.call_id, root_call_id: row.attestation.root_call_id,
      exit_code: row.attestation.exit_code, stdout_sha256: row.attestation.stdout_sha256, stderr_sha256: row.attestation.stderr_sha256,
    } : null,
    ts: new Date().toISOString(),
  }
  if (!record.command) throw new Error('test 必须有 command（验证命令，§4.1）')
  const latestByCommand = new Map()
  for (const r of [...task.test_results, record]) latestByCommand.set(r.command, r)
  const latest = [...latestByCommand.values()]
  const openFailures = latest.filter((r) => r.outcome === 'fail').length
  const passed = latest.length > 0 && openFailures === 0
  task.test_results.push(record)
  if (!task.commands_run.some((c) => c.command === record.command)) {
    task.commands_run.push({ command: record.command, outcome: record.outcome, ts: record.ts })
  }
  task.verify = { passed, open_failures: openFailures, last_run: record.ts }
  const validationMatched = syncValidationFromTest(task, record)
  return { task, record, validationMatched }
}

/** 审查发现（§5.3）：severity 分级 + 门禁。 */
export function applyReview(task, findings, { acknowledge_medium = false, reviewer = '' } = {}) {
  ensureTaskShape(task)
  const input = [...(findings ?? [])]
  const acknowledgingCurrentMedium = input.length === 0 && acknowledge_medium && task.review_findings.some((f) => f.severity === 'medium')
  if (!acknowledgingCurrentMedium) {
    if (task.review_completed) {
      task.review_history.push({ round: task.review_round, findings: task.review_findings, medium_ack: task.review_medium_ack === true })
    }
    task.review_round += 1
    task.review_findings = []
    task.review_medium_ack = false
    for (const f of input) {
      const sev = canonical(f.severity)
      const norm = sev === 'BLOCKER' ? 'blocker' : sev === 'HIGH' ? 'high' : sev === 'MEDIUM' ? 'medium' : sev === 'LOW' ? 'low' : null
      if (!norm) throw new Error(`未知严重度 "${f.severity}"（blocker/high/medium/low）`)
      task.review_findings.push({
        severity: norm, area: f.area ?? '', description: String(f.description ?? ''), reviewer: reviewer || '', ts: new Date().toISOString(), round: task.review_round,
      })
    }
    task.review_completed = true
  }
  const severityCounts = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of task.review_findings) severityCounts[f.severity] += 1
  if (acknowledge_medium && severityCounts.medium > 0) task.review_medium_ack = true
  const mediumPending = severityCounts.medium > 0 && task.review_medium_ack !== true
  return {
    task, severityCounts, mediumPending,
    deliveryBlocked: severityCounts.blocker > 0 || severityCounts.high > 0 || mediumPending,
  }
}

/** 交付门禁（§5.3 + §2.3：两个独立审查者通过才能进入 DELIVERY）。 */
export function computeGate(task) {
  ensureTaskShape(task)
  const sev = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of task.review_findings) sev[f.severity] += 1
  const mediumHandled = sev.medium === 0 || task.review_medium_ack === true
  const blockers = sev.blocker > 0 || sev.high > 0
  const verifyPassed = task.verify?.passed === true && task.verify?.open_failures === 0
  const phase = canonical(task.phase)
  const reviewPhase = phase === 'INDEPENDENT_REVIEW' || phase === 'DELIVERY' || phase === 'LEARN' || phase === 'DONE'
  const reviewDone = reviewPhase && task.review_completed === true
  const project = computeProjectReadiness(task)
  const canShip = verifyPassed && !blockers && mediumHandled && reviewDone && project.ready
  const nextHint = []
  if (!verifyPassed) nextHint.push('验证未通过：先 wf_test 记录 pass')
  else if (!reviewDone) nextHint.push('验证已通过：wf_transition to=INDEPENDENT_REVIEW 后进行独立审查（wf_review）')
  if (blockers) nextHint.push('存在 blocker/high 审查发现：进入 REPAIR 修复后再重审')
  else if (!mediumHandled) nextHint.push('存在未确认的 medium 发现：请用户知情或 acknowledge_medium')
  if (project.impactIncomplete.length) nextHint.push(`影响分析未收敛：${project.impactIncomplete.map((row) => row.id).join(', ')}`)
  if (project.hypothesesOpen.length) nextHint.push(`故障假设未关闭：${project.hypothesesOpen.map((row) => row.id).join(', ')}`)
  if (project.validationIncomplete.length) nextHint.push(`验证矩阵未通过：${project.validationIncomplete.map((row) => row.id).join(', ')}`)
  if (nextHint.length === 0) nextHint.push('全部门禁通过，可 wf_deliver 生成交付摘要')
  return {
    severityCounts: sev, mediumHandled, blockers, verifyPassed, reviewDone, project, canShip, nextHint,
  }
}

/** 手工状态转移的业务门禁；状态机边合法不代表业务产物已满足。 */
export function guardTransition(task, toPhase) {
  const from = canonical(task.phase)
  const to = canonical(toPhase)
  const gate = computeGate(task)
  if (from === 'VERIFY' && to === 'INDEPENDENT_REVIEW' && (!gate.verifyPassed || !gate.project.ready)) {
    return { ok: false, gate, reason: 'VERIFY→INDEPENDENT_REVIEW 要求测试和项目认知账本全部收敛' }
  }
  if (to === 'DELIVERY' && !gate.canShip) {
    return { ok: false, gate, reason: '任何进入 DELIVERY 的路径都要求独立审查和全部交付门禁通过' }
  }
  return { ok: true, gate, reason: '' }
}

/** §5.3：存在 blocker/high 时禁止交付。 */
export function deliveryBlocked(gate) {
  return !gate.canShip
}

/**
 * advance 便利转移：仅当 from→SUCCESS_NEXT[from] 在显式边集中且门禁允许时才动。
 * 返回 { moved, to, reason }。
 */
export function advancePhase(task, { gate } = {}) {
  const from = canonical(task.phase)
  const to = SUCCESS_NEXT[from]
  if (!to) return { moved: false, to: null, reason: `没有从 ${from} 的前进边` }
  const { ok } = transitionInfo(from, to)
  if (!ok) return { moved: false, to, reason: `边 ${from}→${to} 不在显式边集中` }
  if (from === 'VERIFY' || to === 'DELIVERY') {
    const g = gate ?? computeGate(task)
    if (from === 'VERIFY' && (!g.verifyPassed || !g.project.ready)) {
      return { moved: false, to, reason: '门禁未过：验证与项目认知账本必须收敛' }
    }
    if (to === 'DELIVERY' && !g.canShip) {
      return { moved: false, to, reason: '门禁未过：进入 DELIVERY 前必须完成独立审查和全部交付门禁' }
    }
  }
  task.phase = to
  return { moved: true, to, reason: 'success-path advance' }
}

/** 交付摘要（§12 汇报结构）。 */
export function buildDelivery(task, gate) {
  const g = gate ?? computeGate(task)
  const sev = g.severityCounts
  const tests = task.test_results.length === 0
    ? '（无测试记录）'
    : task.test_results.map((t) => `  - ${t.outcome.toUpperCase()} \`${t.command}\`${t.summary ? ` — ${t.summary}` : ''}${t.artifacts?.length ? ` [artifacts: ${t.artifacts.join(', ')}]` : ''}`).join('\n')
  const units = task.work_units.length === 0 ? '（无工作单元）' : task.work_units.map((u) => `  - ${u.status === 'done' ? '✓' : '○'} ${u.title}${u.evidence ? ` — ${u.evidence}` : ''}`).join('\n')
  const findings = task.review_findings.length === 0 ? '（无审查发现）' : task.review_findings.map((f) => `  - [${f.severity.toUpperCase()}] ${f.area} ${f.description}`).join('\n')
  return `# 交付摘要 ${task.task_id}

状态：${g.canShip ? 'COMPLETED' : 'BLOCKED'}（本地交付；默认不推送远程）
目标：${task.goal || '（未记录）'}
阶段：${task.phase}

## 已实现
${task.touched_files.length === 0 ? '（已触碰文件未记录）' : task.touched_files.map((f) => `- \`${f}\``).join('\n')}

## 工作单元
${units}

## 项目认知
architecture.components=${task.architecture_map?.components?.length ?? 0} impacts=${task.impact_analyses?.length ?? 0} hypotheses=${task.hypotheses?.length ?? 0} validation_items=${task.validation_matrix?.length ?? 0} ready=${g.project.ready}

## 验证
verify.passed=${g.verifyPassed} open_failures=${task.verify?.open_failures ?? 0}|${g.verifyPassed ? '✓' : '✗'}
${tests}

## 审查
review_done=${g.reviewDone} blocker=${sev.blocker} high=${sev.high} medium=${sev.medium} low=${sev.low}
${findings}

## 剩余风险
${task.risks.length === 0 ? '（未记录）' : task.risks.map((r) => `- ${r}`).join('\n')}

## 用户需要批准的动作
${task.pending_approvals.length === 0 ? '（无）' : task.pending_approvals.map((p) => `- ${p}`).join('\n')}

## 恢复入口
task_id: \`${task.task_id}\` — 发送「resume ${task.task_id}」即可从最近 checkpoint 继续（wf_resume）。
`
}