import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runEvals } from '../lib/evals.js'

test('eval 全场景机器判定通过（能力 eval + 回归 eval）', () => {
  const report = runEvals()
  const failed = report.rows.filter((r) => !r.pass)
  assert.equal(report.ok, true, `eval 有失败：\n${failed.map((f) => `FAIL ${f.id} ${f.name} — ${f.detail}`).join('\n')}`)
  assert.ok(report.total >= 20, `场景数应 >= 20，实际 ${report.total}`)
})