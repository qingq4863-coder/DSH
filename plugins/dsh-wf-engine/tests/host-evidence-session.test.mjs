import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/index.js'
import { Store } from '../lib/store.js'

const root = mkdtempSync(join(tmpdir(), 'wf-host-evidence-'))
const registered = new Map()
const listeners = new Map()
const ctx = {
  effect(fn) { return fn() },
  tools: { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } },
  on(name, fn) {
    const list = listeners.get(name) || []
    list.push(fn)
    listeners.set(name, list)
    return () => {}
  },
}
const exec = (sid, extra = {}) => ({ agent: { session: { id: sid } }, ...extra })
const foreground = (exitCode) => ({
  kind: 'foreground', exitCode, signal: null, timedOut: false, aborted: false,
  stdout: { text: exitCode === 0 ? 'ok' : '', truncated: false },
  stderr: { text: exitCode === 0 ? '' : 'failed', truncated: false },
  sandbox: { mode: 'workspace-write', denied: false, enforcement: 'partial' },
})

try {
  apply(ctx, { root })
  const start = registered.get('wf_start')
  const test = registered.get('wf_test')
  assert.ok(start && test, 'workflow tools registered')
  assert.equal(Object.hasOwn(test.parameters.properties, 'outcome'), false, 'wf_test schema rejects model-reported outcome')

  const execA = exec('session-A')
  const execB = exec('session-B')
  start.execute({ goal: 'A', workspace: root }, execA)
  start.execute({ goal: 'B', workspace: root }, execB)

  const store = new Store(root)
  const taskAId = store.getActive('session-A')
  const taskBId = store.getActive('session-B')
  assert.ok(taskAId && taskBId && taskAId !== taskBId, 'active task pointers are session isolated')
  assert.equal(store.getActive(), null, 'session tasks do not overwrite legacy global active')

  const command = 'node --check lib/index.js'
  const forged = test.execute({ command, outcome: 'pass' }, execA)
  assert.match(forged, /未找到可消费的宿主回执/, 'model cannot self-report pass')
  assert.equal(store.loadTask(taskAId).verify.passed, false)

  const resultHandler = listeners.get('tools/result')[0]
  resultHandler(exec('session-A', { name: 'pwsh', callId: 'call-A', rootCallId: 'root-A', arguments: { command, workdir: root } }), { isError: false, value: foreground(0) })
  resultHandler(exec('session-B', { name: 'pwsh', callId: 'call-B', rootCallId: 'root-B', arguments: { command, workdir: root } }), { isError: false, value: foreground(1) })

  const pass = test.execute({ command }, execA)
  const fail = test.execute({ command }, execB)
  assert.match(pass, /\[PASS\]/)
  assert.match(fail, /\[FAIL\]/)
  const taskA = store.loadTask(taskAId)
  const taskB = store.loadTask(taskBId)
  assert.equal(taskA.verify.passed, true)
  assert.equal(taskB.verify.passed, false)
  assert.equal(taskA.test_results.at(-1).attestation.source, 'tools/result')
  assert.equal(taskA.test_results.at(-1).attestation.call_id, 'call-A')
  assert.equal(taskA.host_evidence.at(-1).consumed, true)
  assert.match(test.execute({ command }, execA), /未找到可消费的宿主回执/, 'evidence is single use')

  const editHandler = resultHandler
  const taskFile = join(root, 'src/a.ts')
  editHandler(exec('session-A', { name: 'edit', callId: 'edit-A', arguments: { file_path: taskFile } }), { isError: false, value: { path: taskFile, before: 'export function a() { return 1 }', after: 'export function a() { return 2 }' } })
  const staleA = store.loadTask(taskAId)
  assert.equal(staleA.host_evidence.at(-1).stale, true, 'mutation invalidates consumed evidence')
  assert.equal(staleA.test_results.at(-1).stale, true, 'mutation invalidates attested test result')
  assert.equal(staleA.verify.passed, false, 'mutation closes verify gate')
  const semanticChanges = staleA.semantic_changes.length
  const outsideFile = join(tmpdir(), 'wf-external.ts')
  editHandler(exec('session-A', { name: 'edit', callId: 'edit-outside', arguments: { file_path: outsideFile } }), { isError: false, value: { path: outsideFile, before: 'export function external() { return 1 }', after: 'export function external() { return 2 }' } })
  assert.equal(store.loadTask(taskAId).semantic_changes.length, semanticChanges, 'outside-workspace edit must not create semantic impact')

  const streamHandler = listeners.get('llm/stream')[0]
  const stream = streamHandler({ sessionId: 'session-A', model: 'test-model' }, async function* () {
    yield { type: 'text-delta', text: '12345678' }
  })
  for await (const _chunk of stream) {}
  assert.equal(store.loadTask(taskAId).cost.tokens_estimated, 2)
  assert.equal(store.loadTask(taskBId).cost.tokens_estimated, 0)

  const activity = readFileSync(join(root, 'activity.jsonl'), 'utf8')
  assert.match(activity, /host-evidence/)
  console.log('PASS host evidence + session isolation')
} finally {
  rmSync(root, { recursive: true, force: true })
}
