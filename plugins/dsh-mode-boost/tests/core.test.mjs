import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMode, personaFor, coreFor, bandFor, testinessFor, findRepairLoop, classifyExecution, guideFor, executionControl, executionGuardText, stableSystemSections, stableToolSurface, cacheHitSample,
} from '../lib/core.js'

test('parseMode accepts deep and deep-fix as manual deep mode', () => {
  assert.equal(parseMode('deep'), 'deep')
  assert.equal(parseMode('deep-fix'), 'deep')
  assert.equal(parseMode('DEEP-FIX'), 'deep')
})

test('deep persona carries reproduce-rootcause-verify discipline', () => {
  const p = personaFor('deep', 'deepseek-v4-flash')
  assert.match(p, /最小输入复现失败/)
  assert.match(p, /根因/)
  assert.match(p, /验证/)
  assert.match(p, /不得声称完成/)
})

test('deep core surface is read-first and excludes write', () => {
  const core = coreFor('deep')
  assert.ok(core.includes('read'))
  assert.ok(core.includes('grep'))
  assert.ok(core.includes('glob'))
  assert.ok(!core.includes('write'))
})

test('deep band and testiness are reported as deep/normal', () => {
  assert.equal(bandFor('deep'), 'deep')
  assert.equal(testinessFor('deep'), 'normal')
})

function call(name, callId, args) {
  return { type: 'tool/call', callId, name, arguments: args }
}
function result(callId, { isError = false, exitCode, error, text = 'ok' } = {}) {
  const ev = {
    type: 'tool/result',
    message: { callId, isError, content: [{ type: 'text', text }] },
  }
  if (exitCode !== undefined) ev.meta = { exitCode }
  if (error) ev.error = error
  return ev
}

test('findRepairLoop returns null for no tool events', () => {
  assert.equal(findRepairLoop([]), null)
  assert.equal(findRepairLoop([{ type: 'user/message' }]), null)
})

test('findRepairLoop returns null for a single identical failure', () => {
  const events = [call('bash', 'c1', { command: 'npm test' }), result('c1', { exitCode: 1 })]
  assert.equal(findRepairLoop(events), null)
})

test('findRepairLoop detects two consecutive identical failing calls', () => {
  const events = [
    call('bash', 'c1', { command: 'npm test' }), result('c1', { exitCode: 1 }),
    call('bash', 'c2', { command: 'npm test' }), result('c2', { exitCode: 1 }),
  ]
  const loop = findRepairLoop(events)
  assert.ok(loop)
  assert.equal(loop.name, 'bash')
  assert.equal(loop.repeats, 2)
  assert.equal(loop.args.command, 'npm test')
})

test('findRepairLoop ignores identical calls when one succeeded in between', () => {
  const events = [
    call('bash', 'c1', { command: 'npm test' }), result('c1', { exitCode: 1 }),
    call('bash', 'c2', { command: 'npm test' }), result('c2', { exitCode: 0 }),
    call('bash', 'c3', { command: 'npm test' }), result('c3', { exitCode: 1 }),
  ]
  assert.equal(findRepairLoop(events), null)
})

test('findRepairLoop detects failures from isError results', () => {
  const events = [
    call('read', 'r1', { path: 'a.js' }), result('r1', { isError: true, text: 'Error: tool call aborted' }),
    call('read', 'r2', { path: 'a.js' }), result('r2', { isError: true, text: 'Error: tool call aborted' }),
  ]
  const loop = findRepairLoop(events)
  assert.ok(loop)
  assert.equal(loop.repeats, 2)
})

test('findRepairLoop detects failures from error field', () => {
  const events = [
    call('bash', 'b1', { command: 'npm test' }), result('b1', { error: { code: 'TOOL_ABORTED' } }),
    call('bash', 'b2', { command: 'npm test' }), result('b2', { error: { code: 'TOOL_ABORTED' } }),
  ]
  assert.ok(findRepairLoop(events))
})

test('findRepairLoop ignores pending results without callId pairing', () => {
  const events = [
    call('bash', 'b1', { command: 'npm test' }),
    call('bash', 'b2', { command: 'npm test' }),
  ]
  assert.equal(findRepairLoop(events), null)
})

test('tool catalog order is deterministic without dropping tools', () => {
  const tools = [{ name: 'read' }, { name: 'pwsh' }, { name: 'edit' }]
  const reversed = [...tools].reverse()
  assert.deepEqual(stableToolSurface(tools).map((tool) => tool.name), ['edit', 'pwsh', 'read'])
  assert.deepEqual(stableToolSurface(reversed).map((tool) => tool.name), ['edit', 'pwsh', 'read'])
  assert.equal(stableToolSurface(tools).length, tools.length)
})

test('cacheHitSample matches the UI disjoint-bucket formula', () => {
  assert.deepEqual(cacheHitSample({ inputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 0 }), { uncached: 10, read: 90, write: 0, total: 100, percent: 90 })
  assert.equal(cacheHitSample({ inputTokens: 0 }).percent, null)
})

test('dynamic execution state stays out of system-prompt sections', () => {
  const sections = [{ name: 'persona', text: 'stable' }]
  assert.strictEqual(stableSystemSections(sections), sections)
  const events = [{ type: 'user/message' }, call('edit', 'e1', { file_path: 'a.js' }), result('e1'), call('pwsh', 'v1', { command: 'node test.js' }), result('v1', { exitCode: 0 })]
  assert.match(executionGuardText(events), /Stop exploring and finish/)
  assert.strictEqual(stableSystemSections(sections), sections)
})

test('executionControl recommends parallel reads and stops runaway exploration', () => {
  const events = [{ type: 'user/message' }]
  for (let n = 1; n <= 3; n++) events.push(call('read', 'r' + n, { file_path: n + '.js' }), result('r' + n))
  assert.equal(executionControl(events).state, 'parallelize')
  for (let n = 4; n <= 6; n++) events.push(call('grep', 'r' + n, { pattern: String(n) }), result('r' + n))
  assert.equal(executionControl(events).state, 'stop-exploring')
})

test('executionControl stops after focused verification and invalidates verify-before-edit', () => {
  const passed = [{ type: 'user/message' }, call('edit', 'e1', { file_path: 'a.js' }), result('e1'), call('pwsh', 'v1', { command: 'node test.js' }), result('v1', { exitCode: 0 })]
  assert.equal(executionControl(passed).state, 'done')
  const stale = [...passed, call('edit', 'e2', { file_path: 'a.js' }), result('e2')]
  assert.equal(executionControl(stale).state, 'reverify')
})

test('execution classifier routes narrow fixes to speed-guard', () => {
  assert.deepEqual(classifyExecution('修一下这个单文件失败用例'), {
    track: 'small-fix', protocol: 'speed-guard', risk: 'low', confidence: 'high', reasons: ['explicit narrow fix scope'],
  })
})

test('execution classifier keeps analysis read-only', () => {
  const route = classifyExecution('分析这个项目目前的能力和不足')
  assert.equal(route.track, 'research')
  assert.equal(route.protocol, 'read-only')
})

test('execution classifier escalates architecture and security work', () => {
  assert.equal(classifyExecution('重构跨模块架构').protocol, 'wf-engine')
  const security = classifyExecution('修改生产环境的认证权限')
  assert.equal(security.track, 'high-risk')
  assert.equal(security.risk, 'high')
})

test('execution classifier does not treat token budget as a credential change', () => {
  assert.notEqual(classifyExecution('分析 token 使用量').track, 'high-risk')
})

test('near-field guide includes the execution protocol', () => {
  assert.match(guideFor(1, '修一下这个单文件失败用例', 'deepseek-v4-flash'), /protocol=speed-guard/)
  assert.match(guideFor(1, '分析项目结构', 'deepseek-v4-flash'), /protocol=read-only/)
})

