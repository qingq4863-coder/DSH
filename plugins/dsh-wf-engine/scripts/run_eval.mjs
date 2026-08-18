#!/usr/bin/env node
// CLI eval runner：node scripts/run_eval.mjs
// 退出码 = 0 全部通过，1 有失败。同一实现被 wf_eval 工具消费。
import { runEvals, renderEvalTable } from '../lib/evals.js'

const report = runEvals()
console.log(renderEvalTable(report))
process.exit(report.ok ? 0 : 1)