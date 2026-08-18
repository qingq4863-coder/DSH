import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PHASES, STATE_DEFS, TRANSITIONS, canonical, isPhase, transitionInfo,
  classifyFailure, budgetExceeded,
} from '../lib/state-machine.js'

test('每个阶段都有定义（输入/产物/进入/退出/失败转移）', () => {
  for (const phase of PHASES) {
    const def = STATE_DEFS[phase]
    assert.ok(def, `缺少 ${phase} 定义`)
    assert.ok(Array.isArray(def.inputs) && Array.isArray(def.outputs), `${phase} inputs/outputs 须为数组`)
    assert.ok(def.entry && def.exit, `${phase} entry/exit 须有文本`)
  }
})

test('TRANSITIONS 引用的目标都在 PHASES 内', () => {
  for (const [from, list] of Object.entries(TRANSITIONS)) {
    assert.ok(PHASES.includes(from), `边起点 ${from} 非法`)
    for (const to of list) assert.ok(PHASES.includes(to), `边 ${from}→${to} 目标非法`)
  }
})

test('成功路径上每个阶段都有自然下一状态（DONE 除外）', () => {
  for (const phase of ['INTAKE', 'INSPECT', 'CLARIFY', 'PLAN', 'RESEARCH', 'BASELINE_EVAL', 'IMPLEMENT', 'VERIFY', 'INDEPENDENT_REVIEW', 'REPAIR', 'DELIVERY', 'LEARN']) {
    assert.ok(PHASES.includes(phase))
  }
})

test('INSPECT→PLAN 合法；VERIFY→DELIVERY 非法（必须先独立审查）', () => {
  assert.equal(transitionInfo('INSPECT', 'PLAN').ok, true)
  assert.equal(transitionInfo('VERIFY', 'DELIVERY').ok, false)
  assert.ok(transitionInfo('VERIFY', 'DELIVERY').allowed.includes('INDEPENDENT_REVIEW'))
})

test('失败循环：VERIFY→REPAIR 且 REPAIR→VERIFY / REPAIR→IMPLEMENT 合法', () => {
  assert.equal(transitionInfo('VERIFY', 'REPAIR').ok, true)
  assert.equal(transitionInfo('REPAIR', 'VERIFY').ok, true)
  assert.equal(transitionInfo('REPAIR', 'IMPLEMENT').ok, true)
})

test('BLOCKED 只能走受控恢复边，不能直达 DONE', () => {
  assert.equal(transitionInfo('BLOCKED', 'DONE').ok, false)
  assert.equal(transitionInfo('BLOCKED', 'REPAIR').ok, true)
  assert.equal(transitionInfo('BLOCKED', 'DELIVERY').ok, true)
})

test('canonical 归一化：小写/空白/下划线', () => {
  assert.equal(canonical('independent review'), 'INDEPENDENTREVIEW')
  assert.equal(canonical(' independent_review '), 'INDEPENDENT_REVIEW')
  assert.equal(isPhase('verify'), true)
  assert.equal(isPhase('nope'), false)
})

test('失败分类：测试/瞬时/权限/反复失败', () => {
  assert.equal(classifyFailure('pytest: 4 tests failed: assertion error').type, 'test')
  assert.equal(classifyFailure('ETIMEDOUT after 5s').type, 'transient')
  assert.equal(classifyFailure('permission denied: cannot write').type, 'permission')
  assert.equal(classifyFailure('anything', { repeats: 3 }).type, 'recurring')
  assert.equal(classifyFailure('weird unknown thing').type, 'unrecoverable')
})

test('预算：任一维度达到即停', () => {
  assert.equal(budgetExceeded({ maxIterations: 5 }, { iterations: 5 }), true)
  assert.equal(budgetExceeded({ maxTokens: 1000 }, { tokens: 1000 }), true)
  assert.equal(budgetExceeded({ maxIterations: 5 }, { iterations: 4 }), false)
  assert.equal(budgetExceeded(null, { iterations: 99 }), false)
})