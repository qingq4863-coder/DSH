import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyzeSemanticChange } from '../lib/semantic-scan.js'
import { apply } from '../lib/index.js'
import { Store } from '../lib/store.js'

const before = `
export function greet(name: string): string { return helper(name) }
function helper(value: string): string { return value.trim() }
`
const after = `
export function greet(name: string, loud = false): string { return helper(loud ? name.toUpperCase() : name) }
function helper(value: string): string { return value.trimStart() }
`

const semantic = analyzeSemanticChange('src/greet.ts', before, after)
assert.equal(semantic.supported, true)
assert.equal(semantic.symbols.find((item) => item.symbol === 'greet').change_kind, 'contract')
assert.equal(semantic.symbols.find((item) => item.symbol === 'helper').change_kind, 'behavior')
assert.equal(semantic.contracts.length, 1)
assert.match(semantic.contracts[0].evidence, /typescript-typechecker/)

const crossFile = analyzeSemanticChange('src/greet.ts', before, after, {
  projectFiles: {
    'src/consumer.ts': "import { greet } from './greet'; export function welcome(): string { return greet('world') }",
  },
})
assert.ok(crossFile.dependencies.some((edge) => edge.from === 'src/consumer.ts#welcome' && edge.to === 'src/greet.ts#greet' && edge.type === 'type-checker-reference'))
assert.ok(semantic.dependencies.some((edge) => edge.from.endsWith('#greet') && edge.to === 'helper'))

const added = analyzeSemanticChange('src/model.ts', '', 'export interface User { id: string }')
assert.equal(added.symbols[0].change_kind, 'added')
assert.equal(added.contracts[0].change, 'exported InterfaceDeclaration added')
const unsupported = analyzeSemanticChange('main.py', 'def f(): pass', 'def f(x): pass')
assert.equal(unsupported.supported, false)
assert.match(unsupported.unknowns[0], /unsupported semantic language/)

const root = mkdtempSync(join(tmpdir(), 'wf-semantic-scan-'))
const registered = new Map()
const listeners = new Map()
const ctx = {
  effect(fn) { return fn() },
  tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
  on(name, fn) { const rows = listeners.get(name) || []; rows.push(fn); listeners.set(name, rows); return () => {} },
}
const exec = { agent: { session: { id: 'semantic-session' } } }
try {
  apply(ctx, { root })
  registered.get('wf_start').execute({ goal: 'semantic integration' }, exec)
  registered.get('wf_plan').execute({
    scope: 'src/greet.ts', out_of_scope: 'other files', rollback: 'revert file',
    verify_actions: ['node tests/greet.test.mjs'], how_to_prove_done: 'contract test passes',
  }, exec)
  const store = new Store(root)
  const taskId = store.getActive('semantic-session')
  const resultHandler = listeners.get('tools/result')[0]
  resultHandler({ ...exec, name: 'edit', callId: 'edit-call', arguments: { file_path: 'src/greet.ts' } }, {
    isError: false, value: { path: 'src/greet.ts', before, after },
  })
  const task = store.loadTask(taskId)
  assert.equal(task.semantic_changes.length, 1)
  assert.equal(task.semantic_changes[0].source, 'tools/result')
  assert.ok(task.impact_analyses.some((item) => item.id.startsWith('impact-auto-')))
  assert.ok(task.impact_analyses.flatMap((item) => item.affected).some((item) => item.target === 'src/greet.ts#greet'))
  assert.ok(task.validation_matrix.some((item) => item.command === 'node tests/greet.test.mjs' && item.level === 'contract'))
  assert.ok(task.impact_analyses.flatMap((item) => item.unknowns).some((item) => item.includes('exported symbol')), 'missing dependent evidence remains fail-closed')
  console.log('PASS TypeScript Program + TypeChecker semantic scan + host integration')
} finally {
  rmSync(root, { recursive: true, force: true })
}
