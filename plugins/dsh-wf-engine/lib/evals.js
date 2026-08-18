/**
 * dsh-wf-engine eval 场景库（§5.1 能力 eval + 回归 eval；§10 机器判定 pass/fail）。
 * 全部场景在进程内确定性判定，无网络、无外部仓库；store 用临时目录。
 * runEvals() → [{ id, name, pass, detail }]；scripts/run_eval.mjs 与
 * wf_eval 工具消费同一实现——测的就是船上跑的代码。
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'

import { Store, newTaskId } from './store.js'
import { canonical, transitionInfo, classifyFailure, budgetExceeded } from './state-machine.js'
import { redactSecrets, scanSensitive } from './redact.js'
import { upsertImpactAnalysis, upsertHypothesis, upsertValidationItem, computeProjectReadiness } from './project-intelligence.js'
import {
  createInitialTask, addWorkUnit, completeWorkUnit, applyPlan, applyTestResult,
  applyReview, computeGate, advancePhase, buildDelivery, guardTransition,
} from './engine.js'

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-eval-'))
  const store = new Store(dir)
  store.ensure()
  return { store, dir }
}

function scenario(id, name, fn) {
  try {
    const detail = fn()
    return { id, name, pass: detail === true, detail: detail === true ? '' : String(detail) }
  } catch (error) {
    return { id, name, pass: false, detail: `异常: ${error.message}` }
  }
}

export function runEvals() {
  const rows = []

  // ── 状态机图（§2.2 显式转移） ─────────────────────────────────────────────
  rows.push(scenario('sm-01', '合法转移 INSPECT→PLAN 被接受', () => {
    return transitionInfo('INSPECT', 'PLAN').ok === true || 'INSPECT→PLAN 应合法'
  }))
  rows.push(scenario('sm-02', '非法转移 VERIFY→DELIVERY 被拒绝（必须先独立审查）', () => {
    return transitionInfo('VERIFY', 'DELIVERY').ok === false || 'VERIFY→DELIVERY 必须被边集拒绝'
  }))
  rows.push(scenario('sm-03', '失败转移 VERIFY→REPAIR→VERIFY 闭环存在', () => {
    return transitionInfo('VERIFY', 'REPAIR').ok && transitionInfo('REPAIR', 'VERIFY').ok
  }))
  rows.push(scenario('sm-04', 'BLOCKED 只能受控恢复（不在成功路径上）', () => {
    return !transitionInfo('BLOCKED', 'DONE').ok && transitionInfo('BLOCKED', 'REPAIR').ok
  }))
  rows.push(scenario('sm-05', '失败分类：测试失败→保留复现再修', () => {
    const c = classifyFailure('pytest: 3 tests failed in test_api.py: assertion error')
    return c.type === 'test' || `期望 test，得到 ${c.type}`
  }))
  rows.push(scenario('sm-06', '失败分类：反复失败（repeats≥2）→回退诊断', () => {
    const c = classifyFailure('still failing', { repeats: 3 })
    return c.type === 'recurring'
  }))
  rows.push(scenario('sm-07', '迭代预算：达到 maxIterations 即停', () => {
    return budgetExceeded({ maxIterations: 5 }, { iterations: 5 }) === true
  }))

  // ── 引擎门禁（§5.3 / §2.3） ──────────────────────────────────────────────
  rows.push(scenario('eng-01', '验证未通过时交付门禁关闭', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    return computeGate(t).canShip === false
  }))
  rows.push(scenario('eng-02', '验证通过后 canShip 开启（无审查发现）', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    applyReview(t, [], { reviewer: 'independent-A' })
    return computeGate(t).canShip === true
  }))
  rows.push(scenario('eng-03', 'blocker 审查发现禁止交付', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    applyReview(t, [{ severity: 'blocker', area: 'auth', description: 'SQL 注入' }])
    return computeGate(t).canShip === false && computeGate(t).blockers === true
  }))
  rows.push(scenario('eng-04', 'medium 发现需用户知情（acknowledge）', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    applyReview(t, [{ severity: 'medium', area: 'perf', description: 'N+1' }])
    const g1 = computeGate(t)
    applyReview(t, [], { acknowledge_medium: true })
    const g2 = computeGate(t)
    return g1.canShip === false && g1.mediumHandled === false && g2.canShip === true && g2.mediumHandled === true
  }))
  rows.push(scenario('eng-05', '测试末态判定：最后一击失败→门禁关闭', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'VERIFY'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    applyTestResult(t, { command: 'npm test', outcome: 'fail' })
    return computeGate(t).verifyPassed === false
  }))
  rows.push(scenario('eng-06', '工作单元 complete 缺证据被标记（不假装完成）', () => {
    const t = createInitialTask({ goal: 'x' })
    const { task } = addWorkUnit(t, { title: '加接口', verify_command: 'pytest', done_criteria: '全绿' })
    const { unit, warnings } = completeWorkUnit(task, 'wu-1', '')
    return unit.status === 'needs-attention' && warnings.length > 0
  }))
  rows.push(scenario('eng-07', 'advance 受门禁约束：VERIFY→REVIEW 需测试通过', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'VERIFY'
    const r = advancePhase(t)
    return r.moved === false // 无 pass 测试，不允许前进
  }))

  rows.push(scenario('eng-08', '不同命令 PASS 不会清除仍失败命令', () => {
    const t = createInitialTask({ goal: 'x' })
    applyTestResult(t, { command: 'lint', outcome: 'fail' })
    applyTestResult(t, { command: 'unit', outcome: 'pass' })
    return computeGate(t).verifyPassed === false && t.verify.open_failures === 1
  }))
  rows.push(scenario('eng-09', '手工转移不能绕过独立审查', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'unit', outcome: 'pass' })
    return guardTransition(t, 'DELIVERY').ok === false
  }))
  rows.push(scenario('eng-10', '修复后重审可清除当前 blocker', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'unit', outcome: 'pass' })
    applyReview(t, [{ severity: 'high', area: 'auth', description: 'bug' }])
    applyReview(t, [], { reviewer: 'independent-B' })
    return computeGate(t).canShip === true && t.review_history.length === 1
  }))

  rows.push(scenario('eng-11', 'BLOCKED→DELIVERY 仍受交付门禁约束', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'BLOCKED'
    applyTestResult(t, { command: 'unit', outcome: 'pass' })
    return guardTransition(t, 'DELIVERY').ok === false
  }))
  rows.push(scenario('eng-12', '未审查时 advance 不能进入 DELIVERY', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'unit', outcome: 'pass' })
    const moved = advancePhase(t)
    return moved.moved === false && t.phase === 'INDEPENDENT_REVIEW'
  }))

  // ── 大型项目认知层 ─────────────────────────────────────────────────────────
  rows.push(scenario('proj-01', '影响未知项和未关闭假设阻止交付', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    upsertImpactAnalysis(t, { change: 'cache key', status: 'complete', affected: [{ target: 'cache.js' }], unknowns: ['worker path'] })
    upsertHypothesis(t, { statement: 'worker cache stale', status: 'open', next_experiment: 'restart worker' })
    const g = computeGate(t)
    return g.canShip === false && g.project.impactIncomplete.length === 1 && g.project.hypothesesOpen.length === 1
  }))
  rows.push(scenario('proj-02', 'wf_test 自动回填同命令验证矩阵', () => {
    const t = createInitialTask({ goal: 'x' })
    upsertValidationItem(t, { requirement: 'contract', command: 'node contract.mjs' })
    const result = applyTestResult(t, { command: 'node contract.mjs', outcome: 'pass', summary: 'ok' })
    return result.validationMatched[0] === 'val-1' && computeProjectReadiness(t).ready === true
  }))
  rows.push(scenario('proj-03', '项目账本未收敛时 VERIFY 不能前进', () => {
    const t = createInitialTask({ goal: 'x' })
    t.phase = 'VERIFY'
    applyTestResult(t, { command: 'npm test', outcome: 'pass' })
    upsertValidationItem(t, { requirement: 'integration', command: 'npm run integration' })
    const moved = advancePhase(t)
    return moved.moved === false && t.phase === 'VERIFY'
  }))

  // ── 存储与 checkpoint 往返（§3.2） ────────────────────────────────────────
  rows.push(scenario('st-01', 'checkpoint 保存→加载→深等', () => {
    const { store, dir } = tmpStore()
    try {
      const t = createInitialTask({ goal: 'demo' })
      t.task_id = newTaskId()
      t.phase = 'IMPLEMENT'
      t.next_action = '写单元测试'
      t.touched_files = ['src/a.py', 'tests/test_a.py']
      store.saveTask(t)
      const back = store.loadTask(t.task_id)
      return JSON.stringify(back) === JSON.stringify(t)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }))
  rows.push(scenario('st-02', 'resume 驱动器：phase/next_action/touched_files 原样恢复', () => {
    const { store, dir } = tmpStore()
    try {
      const t = createInitialTask({ goal: 'demo' })
      t.task_id = newTaskId()
      t.phase = 'REPAIR'
      t.next_action = '核对失败签名后从 REPAIR→IMPLEMENT'
      store.saveTask(t)
      store.setActive(t.task_id)
      const id = store.getActive()
      const back = store.loadTask(id)
      return back.phase === 'REPAIR' && back.next_action === t.next_action
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }))
  rows.push(scenario('st-03', 'dry-run 不写任何文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-eval-dry-'))
    try {
      const store = new Store(dir, { dryRun: true })
      const t = createInitialTask({ goal: 'demo' })
      t.task_id = newTaskId()
      store.ensure()
      store.saveTask(t)
      store.setActive(t.task_id)
      store.addLesson({ text: 'x' })
      return existsSync(store.activePath) === false && !existsSync(join(dir, 'lessons.jsonl'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }))
  rows.push(scenario('st-04', '教训库去重（同一教训不重复入账）', () => {
    const { store, dir } = tmpStore()
    try {
      store.addLesson({ text: '  FastAPI 用  uv  管锁文件  ' })
      const second = store.addLesson({ text: 'fastapi 用 uv 管锁文件' })
      return store.listLessons().length === 1 && second.dedupe === true
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }))

  // ── 去敏（§3.3 / §8） ────────────────────────────────────────────────────
  rows.push(scenario('sec-01', '明文 token/私钥/URI 凭据被替换', () => {
    const sample = 'key=sk-abc1234567890123456789 token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890123456789 url=https://user:pw@host/x\n-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'
    const { text, hits } = redactSecrets(sample)
    const leaked = /sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|BEGIN RSA PRIVATE KEY|user:pw@/i.test(text)
    return !leaked && hits['github-token'] >= 1 && hits['private-key'] >= 1 && hits['uri-credentials'] >= 1
  }))
  rows.push(scenario('sec-02', 'scanSensitive 判定普通文本安全', () => {
    return scanSensitive('修复了 get_user 的空指针，加了 pytest 用例').safe === true
  }))
  rows.push(scenario('sec-03', '审计日志写入前自动去敏', () => {
    const { store, dir } = tmpStore()
    try {
      const t = createInitialTask({ goal: 'demo' })
      t.task_id = newTaskId()
      store.appendActivity({ task: t.task_id, event: 'apply', data: { token: 'sk-abc1234567890123456789' } })
      const tail = store.tailActivity(t.task_id, 5)
      const raw = JSON.stringify(tail)
      return !/sk-[A-Za-z0-9]{16,}/.test(raw)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }))

  // ── 交付产物（§12） ──────────────────────────────────────────────────────
  rows.push(scenario('dl-01', '交付摘要包含 §12 全部小节', () => {
    const t = createInitialTask({ goal: 'demo' })
    t.task_id = 'task-demo'
    t.phase = 'INDEPENDENT_REVIEW'
    applyTestResult(t, { command: 'pytest', outcome: 'pass' })
    applyReview(t, [], { reviewer: 'independent-A' })
    const md = buildDelivery(t, computeGate(t))
    for (const section of ['状态：', '目标：', '已实现', '验证', '审查', '剩余风险', '用户需要批准', '恢复入口']) {
      if (!md.includes(section)) return `缺少小节 ${section}`
    }
    return true
  }))

  const failed = rows.filter((r) => !r.pass)
  return { rows, total: rows.length, passed: rows.length - failed.length, failed: failed.length, ok: failed.length === 0 }
}

export function renderEvalTable(report) {
  const lines = report.rows.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  lines.push('', `== ${report.passed}/${report.total} passed, ${report.failed} failed ==`)
  return lines.join('\n')
}