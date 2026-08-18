import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createInitialTask, applyReview, applyTestResult, computeGate, buildDelivery } from '../lib/engine.js'
import {
  ensureProjectIntelligence, applyArchitectureMap, upsertImpactAnalysis, deriveSemanticImpact,
  upsertHypothesis, upsertValidationItem, computeProjectReadiness,
} from '../lib/project-intelligence.js'

test('语义影响从符号、依赖、契约和测试映射确定性推导', () => {
  const task = createInitialTask({ goal: 'semantic impact', workspace: 'repo' })
  const result = deriveSemanticImpact(task, {
    change: 'change parser contract', status: 'draft',
    symbols: [{ file: 'src/parser.js', symbol: 'parse', exported: true, change_kind: 'behavior', evidence: 'diff' }],
    dependencies: [{ from: 'src/router.js#route', to: 'src/parser.js#parse', type: 'calls', evidence: 'import+call' }],
    contracts: [{ target: 'api/parse-result', change: 'adds status field', evidence: 'schema diff' }],
    test_mappings: [
      { target: 'src/parser.js#parse', command: 'node tests/parser.test.mjs', level: 'targeted' },
      { target: 'api/parse-result', command: 'node tests/contract.test.mjs', level: 'contract' },
    ],
  })
  assert.deepEqual(result.analysis.affected.map((row) => row.target).sort(), ['api/parse-result', 'src/parser.js#parse', 'src/router.js#route'])
  assert.deepEqual(result.analysis.required_tests.sort(), ['node tests/contract.test.mjs', 'node tests/parser.test.mjs'])
  assert.deepEqual(result.analysis.unknowns, [])
  assert.equal(task.validation_matrix.length, 2)
  deriveSemanticImpact(task, { id: result.analysis.id, change: result.analysis.change, symbols: [{ target: 'src/parser.js#parse' }], test_mappings: [{ target: 'src/parser.js#parse', command: 'node tests/parser.test.mjs' }] })
  assert.equal(task.validation_matrix.filter((row) => row.command === 'node tests/parser.test.mjs').length, 1)
})

test('语义影响传递传播并合并同命令多目标', () => {
  const task = createInitialTask({ goal: 'transitive', workspace: 'repo' })
  const result = deriveSemanticImpact(task, { change: 'C changes', symbols: [{ target: 'C' }], dependencies: [{ from: 'B', to: 'C' }, { from: 'A', to: 'B' }], test_mappings: [{ target: 'A', command: 'test all' }, { target: 'B', command: 'test all' }] })
  assert.deepEqual(result.analysis.affected.map((row) => row.target).sort(), ['A', 'B', 'C'])
  assert.equal(result.validation.length, 1)
  assert.match(result.validation[0].requirement, /A, B/)
})

test('契约根参与依赖传播且同命令选择更强验证层级', () => {
  const task = createInitialTask({ goal: 'contract dependency', workspace: 'repo' })
  const result = deriveSemanticImpact(task, { change: 'contract', contracts: [{ target: 'api/x', change: 'v2' }], dependencies: [{ from: 'src/client.js#call', to: 'api/x' }], test_mappings: [{ target: 'src/client.js#call', command: 'test shared', level: 'targeted' }, { target: 'api/x', command: 'test shared', level: 'regression' }] })
  assert.ok(result.analysis.affected.some((row) => row.target === 'src/client.js#call'))
  assert.equal(result.validation.length, 1)
  assert.equal(result.validation[0].level, 'regression')
})

test('契约内容变化使同命令旧 PASS 失效', () => {
  const task = createInitialTask({ goal: 'contract invalidation', workspace: 'repo' })
  deriveSemanticImpact(task, { change: 'v1', contracts: [{ target: 'api/x', change: 'v1' }], test_mappings: [{ target: 'api/x', command: 'test contract', level: 'contract' }] })
  task.validation_matrix[0].status = 'pass'; task.validation_matrix[0].evidence = 'old'
  deriveSemanticImpact(task, { change: 'v2', contracts: [{ target: 'api/x', change: 'v2' }], test_mappings: [{ target: 'api/x', command: 'test contract', level: 'contract' }] })
  assert.equal(task.validation_matrix[0].status, 'pending')
  assert.equal(task.validation_matrix[0].evidence, '')
})

test('缺少调用方或契约验证证据时保留 unknowns', () => {
  const task = createInitialTask({ goal: 'unknown impact', workspace: 'repo' })
  const result = deriveSemanticImpact(task, { change: 'export change', symbols: [{ target: 'src/api.js#run', exported: true }], contracts: [{ target: 'api/run' }] })
  assert.equal(result.analysis.unknowns.length, 2)
  assert.match(result.analysis.unknowns.join(' '), /no dependent evidence/)
  assert.match(result.analysis.unknowns.join(' '), /no mapped validation/)
})

test('旧 checkpoint 懒迁移且未启用认知层时保持兼容', () => {
  const legacy = { phase: 'IMPLEMENT' }
  ensureProjectIntelligence(legacy)
  assert.deepEqual(legacy.impact_analyses, [])
  assert.equal(computeProjectReadiness(legacy).enabled, false)
  assert.equal(computeProjectReadiness(legacy).ready, true)
})

test('架构地图校验悬空关系并保留证据', () => {
  const task = createInitialTask({ goal: 'map' })
  const result = applyArchitectureMap(task, {
    components: [{ name: 'api', path: 'src/api', responsibility: 'HTTP' }],
    relations: [{ from: 'api', to: 'db', type: 'calls', evidence: 'src/api/db.js' }],
    entry_points: ['src/index.js'], invariants: ['API schema is backward compatible'], evidence: ['package.json'],
  })
  assert.equal(result.architecture.components.length, 1)
  assert.ok(result.warnings.some((row) => row.includes('未登记组件')))
  assert.deepEqual(result.architecture.evidence, ['package.json'])
})

test('影响分析未知项和未关闭假设会关闭项目门禁', () => {
  const task = createInitialTask({ goal: 'diagnose' })
  upsertImpactAnalysis(task, {
    change: 'change auth cache', status: 'complete',
    affected: [{ target: 'auth/cache.js', kind: 'runtime', reason: 'cache key changes', confidence: 'high' }],
    unknowns: ['worker invalidation path'],
  })
  upsertHypothesis(task, { statement: 'stale worker cache causes failures', status: 'open', next_experiment: 'restart one worker' })
  const readiness = computeProjectReadiness(task)
  assert.equal(readiness.ready, false)
  assert.equal(readiness.impactIncomplete.length, 1)
  assert.equal(readiness.hypothesesOpen.length, 1)
})

test('wf_test 同命令自动回填验证矩阵，失败后重新关闭', () => {
  const task = createInitialTask({ goal: 'verify' })
  upsertValidationItem(task, {
    area: 'contract', requirement: 'API contract remains compatible', command: 'node tests/contract.mjs', level: 'contract',
  })
  let result = applyTestResult(task, { command: 'node tests/contract.mjs', outcome: 'pass', summary: '12 cases passed' })
  assert.deepEqual(result.validationMatched, ['val-1'])
  assert.equal(task.validation_matrix[0].status, 'pass')
  assert.equal(computeProjectReadiness(task).ready, true)
  result = applyTestResult(task, { command: 'node tests/contract.mjs', outcome: 'fail', summary: 'schema mismatch' })
  assert.deepEqual(result.validationMatched, ['val-1'])
  assert.equal(task.validation_matrix[0].status, 'fail')
  assert.equal(computeProjectReadiness(task).ready, false)
})

test('全部项目账本收敛后交付门禁开启并写入项目认知摘要', () => {
  const task = createInitialTask({ goal: 'ship' })
  task.task_id = 'task-project'
  task.phase = 'INDEPENDENT_REVIEW'
  applyArchitectureMap(task, { components: [{ name: 'core', path: 'lib' }] })
  upsertImpactAnalysis(task, { change: 'add ledger', status: 'complete', affected: [{ target: 'lib', kind: 'code', reason: 'implementation' }] })
  upsertHypothesis(task, { statement: 'state migration is compatible', status: 'confirmed', evidence: ['legacy fixture passes'] })
  upsertValidationItem(task, { requirement: 'targeted suite passes', command: 'node tests/project-intelligence.test.mjs' })
  applyTestResult(task, { command: 'node tests/project-intelligence.test.mjs', outcome: 'pass', summary: 'pass' })
  applyReview(task, [], { reviewer: 'independent-A' })
  const gate = computeGate(task)
  assert.equal(gate.project.ready, true)
  assert.equal(gate.canShip, true)
  assert.match(buildDelivery(task, gate), /## 项目认知/)
})

test('自动 ID 避开显式编号且局部 upsert 保留主字段', () => {
  const task = createInitialTask({ goal: 'ids' })
  upsertImpactAnalysis(task, { id: 'impact-2', change: 'first' })
  assert.equal(upsertImpactAnalysis(task, { change: 'second' }).analysis.id, 'impact-1')
  upsertHypothesis(task, { id: 'hyp-1', statement: 'root cause', next_experiment: 'probe' })
  const updated = upsertHypothesis(task, { id: 'hyp-1', status: 'confirmed', evidence: ['probe matched'] })
  assert.equal(updated.hypothesis.statement, 'root cause')
})

test('验证契约变化会使旧 PASS 失效', () => {
  const task = createInitialTask({ goal: 'validation contract' })
  upsertValidationItem(task, { id: 'val-2', requirement: 'old contract', command: 'old' })
  upsertValidationItem(task, { requirement: 'another', command: 'another' })
  assert.equal(task.validation_matrix[1].id, 'val-1')
  upsertValidationItem(task, { id: 'val-2', status: 'pass', evidence: 'old passed' })
  const changed = upsertValidationItem(task, { id: 'val-2', command: 'new' })
  assert.equal(changed.item.status, 'pending')
  assert.equal(changed.item.evidence, '')
  assert.equal(computeProjectReadiness(task).ready, false)
})
