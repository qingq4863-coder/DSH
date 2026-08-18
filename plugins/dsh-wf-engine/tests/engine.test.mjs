import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createInitialTask, addWorkUnit, completeWorkUnit, applyPlan, applyTestResult,
  applyReview, computeGate, advancePhase, buildDelivery, ensureTaskShape, guardTransition,
} from '../lib/engine.js'

function reviewedTask({ findings = [], ack = false, tests = [{ command: 'pytest', outcome: 'pass' }] } = {}) {
  const t = createInitialTask({ goal: 'demo', workspace: 'ws' })
  t.task_id = 'task-t1'
  t.phase = 'INDEPENDENT_REVIEW'
  for (const r of tests) applyTestResult(t, r)
  applyReview(t, findings, { acknowledge_medium: ack, reviewer: 'independent-A' })
  return t
}

test('初始 checkpoint 结构符合 §3.2 schema', () => {
  const t = createInitialTask({ goal: 'g', constraints: ['c1'], acceptanceCriteria: ['a1'] })
  for (const key of ['task_id', 'goal', 'phase', 'acceptance_criteria', 'constraints', 'touched_files', 'work_units', 'commands_run', 'test_results', 'review_findings', 'pending_approvals', 'assumptions', 'risks', 'next_action', 'cost']) {
    assert.ok(key in t, `缺字段 ${key}`)
  }
  assert.equal(t.phase, 'INTAKE')
  assert.deepEqual(t.constraints, ['c1'])
  assert.deepEqual(t.acceptance_criteria, ['a1'])
})

test('工作单元：add 提醒补齐验证字段；complete 缺证据不得假装完成', () => {
  const t = createInitialTask({ goal: 'g' })
  const { task, unit, warnings } = addWorkUnit(t, {
    title: '加接口', verify_command: 'pytest', done_criteria: '全绿', risk: 'schema 变更影响前端', file_scope: ['src/api.py'],
  })
  assert.equal(warnings.length, 0)
  assert.equal(unit.status, 'pending') // add 必须返回 unit（工具层依赖，回归：wf_workunit add 崩溃修复）
  const { unit: doneUnit } = completeWorkUnit(task, 'wu-1', 'pytest 全绿')
  assert.equal(doneUnit.status, 'done')
  const t2 = createInitialTask({ goal: 'g' })
  const { task: task2 } = addWorkUnit(t2, { title: '无证据' })
  const r = completeWorkUnit(task2, '无证据', '')
  assert.equal(r.unit.status, 'needs-attention')
  assert.ok(r.warnings.length > 0)
})

test('计划：缺完成证明/回滚会警告', () => {
  const t = createInitialTask({ goal: 'g' })
  const { warnings } = applyPlan(t, { scope: 'src/', risks: ['r1'] })
  assert.ok(warnings.some((w) => w.includes('rollback')))
  assert.ok(warnings.some((w) => w.includes('证明')))
  const ok = applyPlan(t, { scope: 'src/', rollback: 'git revert', how_to_prove_done: 'pytest 全绿', risks: ['r1', 'r2', 'r3'] })
  assert.equal(ok.warnings.length, 0)
})

test('verify 末态判定：pass→fail 序列后门禁关闭', () => {
  const t = createInitialTask({ goal: 'g' })
  applyTestResult(t, { command: 'pytest', outcome: 'pass' })
  applyTestResult(t, { command: 'pytest', outcome: 'fail' })
  const g = computeGate(t)
  assert.equal(g.verifyPassed, false)
  assert.ok(g.nextHint.some((h) => h.includes('验证未通过')))
})

test('审查门禁：blocker 禁止交付；medium 需 ack；独立审查完成才能 ship', () => {
  const t1 = reviewedTask({ findings: [{ severity: 'blocker', area: 'security', description: '注入' }] })
  assert.equal(computeGate(t1).canShip, false)
  assert.equal(computeGate(t1).blockers, true)

  const t2 = createInitialTask({ goal: 'g' })
  t2.phase = 'IMPLEMENT'
  applyTestResult(t2, { command: 'pytest', outcome: 'pass' })
  assert.equal(computeGate(t2).canShip, false) // 还没到独立审查

  const t3 = reviewedTask({ findings: [{ severity: 'medium', area: 'perf', description: 'N+1' }], ack: false })
  assert.equal(computeGate(t3).canShip, false)
  assert.equal(computeGate(t3).mediumHandled, false)

  const t4 = reviewedTask({ findings: [{ severity: 'medium', area: 'perf', description: 'N+1' }], ack: true })
  const g4 = computeGate(t4)
  assert.equal(g4.canShip, true)
  assert.equal(g4.mediumHandled, true)

  const t5 = reviewedTask({ findings: [{ severity: 'high', area: 'auth', description: '越权' }] })
  assert.equal(computeGate(t5).canShip, false)
})

test('不同命令的失败不会被无关 PASS 清除', () => {
  const t = createInitialTask({ goal: 'g' })
  applyTestResult(t, { command: 'lint', outcome: 'fail' })
  applyTestResult(t, { command: 'unit', outcome: 'pass' })
  assert.equal(computeGate(t).verifyPassed, false)
  assert.equal(t.verify.open_failures, 1)
  applyTestResult(t, { command: 'lint', outcome: 'pass' })
  assert.equal(computeGate(t).verifyPassed, true)
})

test('重审替换当前发现，历史 high 不永久锁死；medium ack 不跨轮复用', () => {
  const t = reviewedTask({ findings: [{ severity: 'high', area: 'auth', description: '越权' }] })
  assert.equal(computeGate(t).blockers, true)
  applyReview(t, [], { reviewer: 'independent-B' })
  assert.equal(computeGate(t).blockers, false)
  assert.equal(computeGate(t).canShip, true)
  assert.equal(t.review_history.length, 1)
  applyReview(t, [{ severity: 'medium', area: 'perf', description: 'N+1' }], { reviewer: 'independent-C', acknowledge_medium: true })
  assert.equal(computeGate(t).mediumHandled, true)
  applyReview(t, [{ severity: 'medium', area: 'compat', description: 'new finding' }], { reviewer: 'independent-D' })
  assert.equal(computeGate(t).mediumHandled, false)
})

test('手工状态转移不能绕过验证和独立审查门禁', () => {
  const t = createInitialTask({ goal: 'g' })
  t.phase = 'VERIFY'
  assert.equal(guardTransition(t, 'INDEPENDENT_REVIEW').ok, false)
  applyTestResult(t, { command: 'unit', outcome: 'pass' })
  assert.equal(guardTransition(t, 'INDEPENDENT_REVIEW').ok, true)
  t.phase = 'INDEPENDENT_REVIEW'
  assert.equal(guardTransition(t, 'DELIVERY').ok, false)
  applyReview(t, [], { reviewer: 'independent-A' })
  assert.equal(guardTransition(t, 'DELIVERY').ok, true)
})

test('0.1.x checkpoint 补齐后可计算门禁', () => {
  const legacy = { task_id: 'legacy', goal: 'g', phase: 'IMPLEMENT' }
  assert.doesNotThrow(() => computeGate(legacy))
  ensureTaskShape(legacy)
  assert.ok(Array.isArray(legacy.review_findings))
  assert.ok(Array.isArray(legacy.work_units))
  assert.equal(legacy.cost.tokens_estimated, 0)
})

test('所有 DELIVERY 路径和 advance 都要求独立审查完成', () => {
  const blocked = reviewedTask()
  blocked.phase = 'BLOCKED'
  blocked.review_completed = false
  assert.equal(guardTransition(blocked, 'DELIVERY').ok, false)

  const review = createInitialTask({ goal: 'g' })
  review.phase = 'INDEPENDENT_REVIEW'
  applyTestResult(review, { command: 'unit', outcome: 'pass' })
  const moved = advancePhase(review)
  assert.equal(moved.moved, false)
  assert.equal(review.phase, 'INDEPENDENT_REVIEW')
})

test('advance 受门禁约束：VERIFY 无通过测试不能前进', () => {
  const t = createInitialTask({ goal: 'g' })
  t.phase = 'VERIFY'
  const r = advancePhase(t)
  assert.equal(r.moved, false)
  applyTestResult(t, { command: 'pytest', outcome: 'pass' })
  const r2 = advancePhase(t)
  assert.equal(r2.moved, true)
  assert.equal(t.phase, 'INDEPENDENT_REVIEW')
})

test('交付摘要包含 §12 全部小节与被门禁拦截路径', () => {
  const t = reviewedTask()
  const md = buildDelivery(t, computeGate(t))
  for (const section of ['状态：', '目标：', '已实现', '验证', '审查', '剩余风险', '用户需要批准', '恢复入口']) {
    assert.ok(md.includes(section), `缺小节 ${section}`)
  }
  assert.ok(md.includes('task-t1'))
  const t2 = createInitialTask({ goal: 'x' })
  assert.equal(deliveryBlockedCheck(computeGate(t2)), true)
})

function deliveryBlockedCheck(g) {
  return !g.canShip
}