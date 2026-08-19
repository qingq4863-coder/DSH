import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_PROTOCOL_MARKERS, REQUIRED_CONTRACT_MARKERS, REQUIRED_WF_PLAN_MARKERS, hasMarkers } from '../lib/protocol.js'

test('protocol contract markers remain complete', () => {
  const output = 'Acceptance handoff: Preserve the exact command. Safety: this protocol produces a plan only.'
  assert.equal(hasMarkers(output, REQUIRED_PROTOCOL_MARKERS), true)
})

test('acceptance contract markers remain complete', () => {
  const output = 'ACCEPTANCE CONTRACT Failure signal: Verification: Done:'
  assert.equal(hasMarkers(output, REQUIRED_CONTRACT_MARKERS), true)
})

test('wf plan markers remain complete', () => {
  const output = 'WF CONTRACT EXECUTION PLAN wf_workunit add wf_validation: wf_test: Guard:'
  assert.equal(hasMarkers(output, REQUIRED_WF_PLAN_MARKERS), true)
})

test('missing marker fails closed', () => {
  assert.equal(hasMarkers('ACCEPTANCE CONTRACT', REQUIRED_CONTRACT_MARKERS), false)
})
