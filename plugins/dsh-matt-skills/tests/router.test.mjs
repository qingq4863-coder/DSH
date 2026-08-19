import assert from 'node:assert/strict'
import test from 'node:test'
import { routeExecution, routePlan, routeTask, validateRouteCalls } from '../lib/router.js'

const cases = [
  ['修复 API 报错并补回归测试', ['diagnosis', 'tdd']],
  ['研究 API 规范并生成引用简报', ['research']],
  ['更新 Agent 指令和技能上下文', ['disclosure']],
  ['review this diff', ['review']],
  ['implement feature and add tests', ['tdd']],
  ['fix API error and add regression test', ['diagnosis', 'tdd']],
  ['修复 API 报错，查官方文档并补回归测试', ['diagnosis', 'tdd', 'research']],
  ['fix API error, look up official docs, and add regression test', ['diagnosis', 'tdd', 'research']],
]

test('explicit research becomes an auxiliary route for a bug fix', () => {
  assert.deepEqual(routePlan('修复 API 报错，查官方文档并补回归测试'), { primary: ['diagnosis', 'tdd'], auxiliary: ['research'] })
})

test('ordinary API bug fix has no research auxiliary route', () => {
  assert.deepEqual(routePlan('修复 API 报错并补回归测试'), { primary: ['diagnosis', 'tdd'], auxiliary: [] })
})

test('execution preserves primary before auxiliary routes', () => {
  assert.deepEqual(routeExecution('修复 API 报错，查官方文档并补回归测试'), ['diagnosis', 'tdd', 'research'])
})

test('call validator accepts generated mixed-task plan', async () => {
  const { routeCalls } = await import('../lib/router.js')
  assert.deepEqual(validateRouteCalls(routeCalls('修复 API 报错，查官方文档并补回归测试', 'API seam', 'npm test')), [])
})

test('call plans preserve conditional semantics across route classes', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const cases = [
    ['研究 API 规范并生成引用简报', 'research', false],
    ['更新 Agent 指令和技能上下文', 'disclosure', false],
    ['修复 API 报错并补回归测试', 'diagnosis', false],
    ['修复 API 报错，查官方文档并补回归测试', 'research', true],
  ]
  for (const [task, stage, conditional] of cases) {
    const calls = routeCalls(task, 'seam', 'npm test')
    const selected = calls.filter(call => call.stage === stage)
    assert.ok(selected.length > 0)
    assert.equal(selected.every(call => call.conditional === conditional), true)
    assert.deepEqual(validateRouteCalls(calls), [])
  }
})

test('unknown task receives explicit clarify fallback', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('整理一下', 'seam', 'npm test')
  assert.equal(calls.some(call => call.tool === 'matt_task_route' && call.stage === 'clarify' && call.args.task === '整理一下'), true)
  assert.deepEqual(validateRouteCalls(calls), [])
})

test('call validator rejects malformed clarify placement and mixing', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('整理一下', 'seam', 'npm test')
  const duplicated = [...calls.slice(0, -1), calls.at(-2), calls.at(-2), calls.at(-1)]
  assert.match(validateRouteCalls(duplicated).join('\n'), /clarify fallback must be unique/)
  const misplaced = [calls[0], calls[1], calls.at(-1), calls.at(-2)]
  assert.match(validateRouteCalls(misplaced).join('\n'), /last call|immediately precede/)
  const mixed = [...calls.slice(0, 2), { tool: 'matt_diagnosis_loop', stage: 'diagnosis', conditional: false, args: { symptom: '整理一下', seam: 'seam' } }, calls.at(-2), calls.at(-1)]
  assert.match(validateRouteCalls(mixed).join('\n'), /route tools/)
})

test('call validator rejects clarify argument drift', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('整理一下', 'seam', 'npm test').map(call => call.tool === 'matt_task_route' ? { ...call, args: { task: 'other' } } : call)
  assert.match(validateRouteCalls(calls).join('\n'), /clarify args/)
})

test('call validator rejects route-specific argument drift', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const fixtures = [
    ['review this diff', 'matt_review_diff', { scope: 'other', spec: 'review this diff' }, /review args/],
    ['研究 API 规范并生成引用简报', 'matt_research_brief', { question: 'other' }, /research args/],
    ['更新 Agent 指令和技能上下文', 'matt_disclosure_audit', { document: 'other' }, /disclosure args/],
  ]
  for (const [task, tool, args, expected] of fixtures) {
    const calls = routeCalls(task, 'seam', 'npm test').map(call => call.tool === tool ? { ...call, args: { ...call.args, ...args } } : call)
    assert.match(validateRouteCalls(calls).join('\n'), expected)
  }
})

test('call validator rejects contract parameter drift', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('修复 API 报错并补回归测试', 'seam', 'npm test')
  const drift = calls.map(call => call.tool === 'matt_contract_wf_plan' ? { ...call, args: { ...call.args, seam: 'other seam' } } : call)
  assert.match(validateRouteCalls(drift).join('\n'), /contract and wf-plan args must match/)
})

test('call validator rejects missing evidence adjacency and command drift', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('修复 API 报错，查官方文档并补回归测试', 'seam', 'npm test')
  const broken = calls.slice(0, -1)
  assert.match(validateRouteCalls(broken).join('\n'), /last call|route tool must be followed/)
  let changed = false
  const drift = calls.map(call => {
    if (!changed && call.tool === 'matt_wf_evidence_map') { changed = true; return { ...call, args: { ...call.args, command: 'other test' } } }
    return call
  })
  assert.match(validateRouteCalls(drift).join('\n'), /same command/)
})

test('call validator rejects malformed boundaries', () => {
  assert.match(validateRouteCalls([{ tool: 'bad', stage: 'x', conditional: false, args: {} }]).join('\n'), /first call|second call|last call|unsupported tool/)
})

test('call plan binds command and marks auxiliary calls conditional', async () => {
  const { routeCalls } = await import('../lib/router.js')
  const calls = routeCalls('修复 API 报错，查官方文档并补回归测试', 'API seam', 'npm test')
  assert.deepEqual(calls[0], { tool: 'matt_acceptance_contract', stage: 'contract', conditional: false, args: { requirement: '修复 API 报错，查官方文档并补回归测试', seam: 'API seam', command: 'npm test' } })
  assert.equal(calls.filter(x => x.stage === 'research').every(x => x.conditional), true)
  assert.equal(calls.find(x => x.tool === 'matt_wf_evidence_map' && x.stage === 'diagnosis').args.command, 'npm test')
  assert.equal(calls.at(-1).tool, 'wf_review')
})

test('workflow starts with contract and ends with review', async () => {
  const { routeWorkflow } = await import('../lib/router.js')
  assert.deepEqual(routeWorkflow('修复 API 报错，查官方文档并补回归测试'), [
    'matt_acceptance_contract', 'matt_contract_wf_plan',
    'matt_diagnosis_loop', 'matt_wf_evidence_map(diagnosis)',
    'matt_tdd_slice', 'matt_wf_evidence_map(tdd)',
    'matt_research_brief', 'matt_wf_evidence_map(research)',
    'wf_review',
  ])
})

for (const [task, expected] of cases) test(task, () => assert.deepEqual(routeTask(task), expected))
test('unknown task remains unclassified', () => assert.deepEqual(routeTask('整理一下'), []))
test('workflow preserves clarify fallback for unknown tasks', async () => {
  const { routeWorkflow } = await import('../lib/router.js')
  assert.deepEqual(routeWorkflow('整理一下'), ['matt_acceptance_contract', 'matt_contract_wf_plan', 'matt_task_route', 'wf_review'])
})
