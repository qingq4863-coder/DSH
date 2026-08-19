import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const source = await readFile(new URL('src/index.ts', root), 'utf8')
const routerSource = await readFile(new URL('src/router.ts', root), 'utf8')
const readme = await readFile(new URL('README.md', root), 'utf8')
const manifest = await readFile(new URL('package.json', root), 'utf8')
const upstreamReceipt = await readFile(new URL('UPSTREAM-ABSORPTION.md', root), 'utf8')
const finalAcceptance = await readFile(new URL('FINAL-ACCEPTANCE.md', root), 'utf8')

const tools = [
  'matt_diagnosis_loop', 'matt_review_diff', 'matt_context_pointer',
  'matt_tdd_slice', 'matt_research_brief', 'matt_disclosure_audit',
  'matt_wf_evidence_map', 'matt_task_route', 'matt_route_plan', 'matt_compose_flow',
  'matt_acceptance_contract', 'matt_contract_wf_plan', 'matt_engineering_protocol',
  'matt_grilling_plan', 'matt_domain_model', 'matt_codebase_design',
  'matt_architecture_survey', 'matt_to_spec', 'matt_to_tickets', 'matt_writing_for_agents',
  'matt_wayfinder', 'matt_wait_what',
  'matt_triage_plan', 'matt_grill_with_docs',
  'matt_prototype_plan', 'matt_merge_conflict_plan',
  'matt_upstream_inventory', 'matt_upstream_sync_plan', 'matt_install_lifecycle_plan', 'matt_external_operation_plan',
]

test('all documented tools are registered in source', () => {
  for (const name of tools) {
    assert.equal(source.includes("name: '" + name + "'"), true)
    assert.equal(readme.includes(name), true)
  }
})

test('all five flow names are wired to evidence mapping', () => {
  for (const flow of ['diagnosis', 'tdd', 'review', 'research', 'disclosure']) {
    assert.equal(source.includes(flow), true)
    assert.equal(source.includes('matt_wf_evidence_map'), true)
  }
})

test('machine route plan exposes stable fields', () => {
  assert.equal(source.includes("name: 'matt_route_plan'"), true)
  for (const field of ['task', 'primary', 'auxiliary', 'execution', 'tools', 'workflow', 'calls', 'conditional', 'args']) assert.equal(source.includes(field), true)
  assert.equal(source.includes('routeExecution(args.task)'), true)
  assert.equal(source.includes('routeTools(args.task)'), true)
  assert.equal(source.includes('routeWorkflow(args.task)'), true)
  assert.equal(source.includes('routeCalls(args.task, args.seam, args.command)'), true)
  assert.equal(source.includes('validateRouteCalls'), true)
  assert.equal(source.includes('call_errors'), true)
  assert.equal(source.includes('matt_task_route'), true)
  assert.equal(routerSource.includes("stage: 'clarify'"), true)
  assert.equal(routerSource.includes('clarify fallback must be unique'), true)
  assert.equal(routerSource.includes('clarify fallback must immediately precede wf_review'), true)
  assert.equal(routerSource.includes('all evidence maps must use the same command'), true)
  assert.equal(readme.includes('clarify'), true)
  assert.equal(readme.includes('call_errors'), true)
  assert.equal(source.includes('additionalProperties: false'), true)
  assert.equal(source.includes('additionalProperties: true'), true)
})

test('route priority output remains explicit', () => {
  assert.equal(source.includes('Primary flows:'), true)
  assert.equal(source.includes('Auxiliary flows:'), true)
  assert.equal(source.includes('Primary route:'), true)
  assert.equal(source.includes('Auxiliary route:'), true)
  assert.equal(readme.includes('Primary flows'), true)
  assert.equal(readme.includes('Auxiliary flows'), true)
})

test('pinned upstream receipt remains complete', () => {
  assert.match(upstreamReceipt, /9c9f36ccd3995266cd675468af71639c8dde1ec5/)
  assert.match(upstreamReceipt, /Future update protocol/)
  assert.match(upstreamReceipt, /does not claim that external systems were modified/)
})

test('upstream parity status remains explicit', () => {
  assert.match(finalAcceptance, /does not implement all 35 upstream skills/)
  for (const marker of ['Partial or adapter-specific:', 'Not implemented:', 'A plan tool does not perform the named operation.']) assert.equal(finalAcceptance.includes(marker), true)
})

test('final GitHub acceptance receipt remains pinned', () => {
  assert.match(finalAcceptance, /qingq4863-coder\/DSH/)
  assert.match(finalAcceptance, /7346ebaf598b29556674b6361f12e16e5bdfb3dc/)
  assert.match(finalAcceptance, /Remote mutation: none/)
  assert.match(finalAcceptance, /dsh-wf-engine/)
  assert.match(finalAcceptance, /dsh-context-doctor/)
})

test('integration tools preserve no-side-effect boundaries', () => {
  for (const marker of ['matt_upstream_inventory', 'matt_upstream_sync_plan', 'matt_install_lifecycle_plan', 'matt_external_operation_plan']) assert.equal(source.includes(marker), true)
  assert.match(source, /does not call GitHub, Linear, git, shell, or credential stores/)
  assert.match(readme, /不直接调用外部系统/)
})

test('persistent bundle manifest remains complete', () => {
  assert.match(manifest, /\"dsh\"/)
  assert.match(manifest, /\"bundle\"/)
  assert.match(manifest, /cordis\.patch\.yml/)
})

test('README states evidence and GUI boundaries', () => {
  assert.match(readme, /宿主回执/)
  assert.match(readme, /真实刷新后的页面行为/)
  assert.match(readme, /headless/)
})
