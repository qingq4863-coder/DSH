/**
 * dsh-wf-engine 插件入口：编程 Agent 工作流引擎（DSH 宿主平面 bundle 插件）。
 *
 * 把《强大编程Agent插件制作指令.md》的 Codex 插件能力映射为 DSH 等价分层
 * （差异见 README「Codex→DSH 能力映射」）：
 *   commands/*  →  wf_* 工具（agent 通过工具调用进入各入口语义）
 *   hooks/*     →  ctx.on('llm/stream', …, {global:true}) 成本钩子
 *   agents/*    →  DSH 宿主 subagent 设施 + wf_review 独立审查记录
 *   scripts/*   →  scripts/run_eval.mjs
 *   evals/*     →  lib/evals.js（10+ 机器判定场景）+ DSH_HOME/wf/evals/*.json
 *   checkpoint  →  DSH_HOME/wf/tasks/<task_id>.json（原子写）
 *   memory      →  DSH_HOME/wf/lessons.jsonl（去重 + 去敏）
 *   observability → DSH_HOME/wf/activity.jsonl（写入前自动去敏）
 *
 * 零运行时依赖（node:fs 仅用于存储与审计）。遵循 mode-boost 的宿主平面范式。
 */

import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { Store, defaultRoot, newTaskId } from './store.js'
import {
  createInitialTask, addWorkUnit, completeWorkUnit, applyPlan, applyTestResult,
  applyReview, computeGate, advancePhase, buildDelivery, ensureTaskShape, guardTransition, touchTimes, invalidateVerificationAfterMutation,
} from './engine.js'
import { canonical, isPhase, transitionInfo, SUCCESS_NEXT, classifyFailure } from './state-machine.js'
import { scanSensitive } from './redact.js'
import {
  applyArchitectureMap, upsertImpactAnalysis, deriveSemanticImpact, upsertHypothesis, upsertValidationItem, computeProjectReadiness,
} from './project-intelligence.js'
import { runEvals, renderEvalTable } from './evals.js'
import { analyzeSemanticChange } from './semantic-scan.js'

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'wf-engine'

/** 依赖宿主服务：工具注册 + LLM 流。 */
export const inject = ['tools', 'llm']

/** 规格 → JSON Schema 编译器（defineTool 的等价子集，支持 enum / string[] / object[]）。 */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    let prop = null
    switch (meta.type) {
      case 'string':
      case 'number':
      case 'boolean':
        prop = { type: meta.type }
        break
      case 'string[]':
        prop = { type: 'array', items: { type: 'string' } }
        break
      case 'object[]': {
        const items = { type: 'object', properties: {}, required: [] }
        for (const [k, m] of Object.entries(meta.items?.spec ?? {})) {
          items.properties[k] = { type: m.type }
          if (Array.isArray(m.enum)) items.properties[k].enum = m.enum
          if (m.required) items.required.push(k)
        }
        prop = { type: 'array', items }
        break
      }
    }
    if (!prop) continue
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function apply(ctx, config) {
  let store = new Store(config?.root || defaultRoot())
  store.ensure()

  const sessionKey = (exec) => String(exec?.agent?.session?.id || 'global')
  const sha256 = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')
  const isWithinTaskWorkspace = (task, file) => {
    const workspace = String(task.workspace ?? '').trim()
    if (!workspace) return true
    const path = relative(resolve(workspace), resolve(file))
    return path === '' || (!path.startsWith('..') && !isAbsolute(path))
  }

  /** 注册一个 wf_* 工具（string 输出）。 */
  function registerTool(tool) {
    ctx.effect(() => ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.parameters),
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      execute: tool.execute,
    }))
  }

  // ── 任务解析 / 提交助手 ────────────────────────────────────────────────────
  function requireTask(args, exec) {
    let task = null
    if (args?.task_id) task = store.loadTask(args.task_id)
    else {
      const id = store.getActive(sessionKey(exec))
      if (id) task = store.loadTask(id)
    }
    if (!task) throw new Error('没有可用任务：先 wf_start 建任务，或传 task_id（wf_status 可列出全部任务）')
    return ensureTaskShape(task)
  }

  function commit(task, event, data) {
    touchTimes(task)
    store.saveTask(task)
    store.appendActivity({ task: task.task_id, event, data })
    return task
  }

  ctx.on('tools/result', (exec, result) => {
    try {
      const args = exec.arguments || {}
      const sid = sessionKey(exec)
      const taskId = store.getActive(sid)
      if (!taskId) return
      const loaded = store.loadTask(taskId)
      if (!loaded) return
      const task = ensureTaskShape(loaded)
      const value = !result.isError ? result.value : null

      if ((exec.name === 'edit' || exec.name === 'write') && value) {
        const file = String(value.path || args.file_path || '')
        if (!file) return
        if (!isWithinTaskWorkspace(task, file)) {
          commit(task, 'semantic-change-ignored', { file, workspace: task.workspace, reason: 'outside-task-workspace', call_id: String(exec.callId ?? '') })
          return
        }
        const invalidation = invalidateVerificationAfterMutation(task, { file, source: 'tools/result', call_id: String(exec.callId ?? '') })
        const semantic = analyzeSemanticChange(file, value.before ?? '', value.after ?? '')
        const verifyCommands = [
          ...(task.plan?.verify_actions || []),
          ...task.work_units.filter((unit) => !unit.file_scope?.length || unit.file_scope.includes(file)).map((unit) => unit.verify_command).filter(Boolean),
        ]
        const testMappings = [...new Set(verifyCommands)].map((command) => ({ target: '*', command, level: semantic.contracts.length ? 'contract' : 'targeted' }))
        const derived = deriveSemanticImpact(task, {
          id: `impact-auto-${sha256(file).slice(0, 12)}`, change: `Host-observed semantic change in ${file}`,
          status: semantic.supported && semantic.unknowns.length === 0 ? 'complete' : 'draft',
          symbols: semantic.symbols, dependencies: semantic.dependencies, contracts: semantic.contracts,
          test_mappings: testMappings, unknowns: semantic.unknowns,
        })
        task.semantic_changes = [...(task.semantic_changes || []), { file, source: 'tools/result', call_id: String(exec.callId ?? ''), symbols: semantic.symbols.length, contracts: semantic.contracts.length, at: new Date().toISOString() }].slice(-100)
        commit(task, 'semantic-change', { file, supported: semantic.supported, symbols: semantic.symbols.length, contracts: semantic.contracts.length, impact_id: derived.analysis.id, invalidated_evidence: invalidation.invalidated, call_id: String(exec.callId ?? '') })
        return
      }

      if (exec.name !== 'pwsh' || !String(args.command || '')) return
      const foreground = value && value.kind === 'foreground'
      const sandbox = foreground ? value.sandbox : null
      const passed = Boolean(foreground && value.exitCode === 0 && !value.timedOut && !value.aborted && !sandbox?.denied && !sandbox?.runnerFailed)
      const evidence = {
        id: randomUUID(), source: 'tools/result', task_id: task.task_id, session_id: sid,
        call_id: String(exec.callId ?? ''), root_call_id: String(exec.rootCallId ?? ''),
        command: String(args.command), workdir: String(args.workdir || ''), passed,
        exit_code: foreground ? value.exitCode : null, signal: foreground ? value.signal : null,
        timed_out: foreground ? Boolean(value.timedOut) : false, aborted: foreground ? Boolean(value.aborted) : Boolean(exec.signal?.aborted),
        sandbox: sandbox ? { mode: sandbox.mode, denied: Boolean(sandbox.denied), enforcement: sandbox.enforcement || '', runner_failed: Boolean(sandbox.runnerFailed) } : null,
        stdout_sha256: foreground ? sha256(value.stdout?.text) : '', stderr_sha256: foreground ? sha256(value.stderr?.text) : '',
        captured_at: new Date().toISOString(), consumed: false,
      }
      task.host_evidence = [...(task.host_evidence || []), evidence].slice(-50)
      commit(task, 'host-evidence', { id: evidence.id, command: evidence.command, passed, session_id: sid, call_id: evidence.call_id })
    } catch { /* 证据采集失败不得影响原工具结果 */ }
  }, { global: true })

  /** advance 前进后刷新 next_action（与 wf_transition 行为一致，保证 resume 可用）。 */
  function refreshNextAction(task) {
    const to = task.phase
    task.next_action = `处于 ${to}。${SUCCESS_NEXT[to] ? `完成本阶段产物后转移至 ${SUCCESS_NEXT[to]}（wf_transition）` : '终态。'}`.trim()
  }

  function summarize(task) {
    const g = computeGate(task)
    const project = computeProjectReadiness(task)
    return [
      `task=${task.task_id}  phase=${task.phase}`,
      `goal=${task.goal || '（未记录）'}`,
      `verify=${g.verifyPassed ? 'PASS' : 'FAIL'}  review=blocker:${g.severityCounts.blocker} high:${g.severityCounts.high} medium:${g.severityCounts.medium} low:${g.severityCounts.low}  canShip=${g.canShip}`,
      `next_action=${task.next_action || '（未设置）'}`,
      `touched=${task.touched_files.length}  units=${task.work_units.length}  tests=${task.test_results.length}  project=${project.ready ? 'READY' : 'OPEN'}(impact:${project.impactIncomplete.length}/hyp:${project.hypothesesOpen.length}/val:${project.validationIncomplete.length})  cost=${task.cost.tokens_estimated}t/${task.cost.streams}streams/${task.cost.retries}retries`,
      ...(store.dryRun ? ['⚠ dry-run 开启：以上变更仅演算，未落盘。'] : []),
    ].join('\n')
  }

  function allowedFrom(phase) {
    return `可转移：${transitionInfo(phase, '__').allowed.join(' → ')}`
  }

  // ── §2.1 任务入口工具 ─────────────────────────────────────────────────────
  registerTool({
    name: 'wf_start',
    description: '任务入口：接收新任务并建立任务上下文（checkpoint 落盘 + 设为 active）。创建后自动进入 INSPECT（代码库侦察）。返回 task_id 与第一步 next_action。',
    parameters: {
      goal: { type: 'string', required: true, description: '用户目标（一句话，验收标准可另传）' },
      workspace: { type: 'string', description: '工作目录（缺省用会话 workspace）' },
      acceptance_criteria: { type: 'string[]', description: '验收标准清单' },
      constraints: { type: 'string[]', description: '硬约束（不做什么/不许碰什么）' },
      assumptions: { type: 'string[]', description: '尚未验证的假设（将在 INSPECT/RESEARCH 阶段验证）' },
    },
    execute(args, exec) {
      const task = createInitialTask({
        goal: args.goal,
        workspace: args.workspace ?? '',
        constraints: args.constraints,
        acceptanceCriteria: args.acceptance_criteria,
        assumptions: args.assumptions,
      })
      task.task_id = newTaskId()
      task.phase = 'INSPECT' // INTAKE→INSPECT 合法边，start 即建立侦察上下文
      task.next_action = `INSPECT：只读侦察 ${task.workspace || 'workspace'}（入口/依赖/测试/配置/历史变更），记录风险与问题复述 → wf_checkpoint 保存侦察事实 → wf_transition to=PLAN`
      task.session_id = sessionKey(exec)
      store.setActive(task.task_id, task.session_id)
      commit(task, 'start', { goal: task.goal, phase: 'INSPECT' })
      return `${summarize(task)}\n${allowedFrom(task.phase)}\n\n开始侦察：只读目录、入口文件、依赖清单、测试与配置；不要修改代码。`
    },
  })

  registerTool({
    name: 'wf_status',
    description: '状态入口：显示当前阶段、门禁、阻塞点、已完成工作、测试结果、成本、待批准动作与下一步。不传 task_id 时列出全部任务并指向 active。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active 任务）' },
    },
    execute(args, exec) {
      if (!args.task_id && !store.getActive(sessionKey(exec))) {
        const all = store.listTasks()
        if (all.length === 0) return '无任务记录。用 wf_start 开始一个任务。'
        return [
          `全部任务（${all.length}）：`,
          ...all.map((t) => `  ${t.task_id}  [${t.phase}]  ${(t.goal || '').slice(0, 60)}`),
          '用 wf_status 传 task_id 查看详情，或 wf_resume 恢复。',
        ].join('\n')
      }
      const task = requireTask(args, exec)
      const g = computeGate(task)
      const lines = [summarize(task), '', `已触碰文件：${task.touched_files.length === 0 ? '（无）' : task.touched_files.map((f) => `\`${f}\``).join(' ')}`]
      if (task.plan) {
        lines.push('', `计划 scope：${task.plan.scope || '（未写）'}`)
        lines.push(`计划 out_of_scope：${task.plan.out_of_scope || '（未写）'}`)
        lines.push(`回滚：${task.plan.rollback || '（未写）'}`)
        if (task.plan.risks?.length) lines.push(`风险：${task.plan.risks.join(' | ')}`)
        if (task.plan.verify_actions?.length) lines.push(`验证动作：${task.plan.verify_actions.join(' | ')}`)
      }
      if (task.work_units.length) {
        lines.push('', '工作单元：')
        for (const u of task.work_units) lines.push(`  ${u.status === 'done' ? '✓' : '○'} ${u.id} ${u.title}${u.status === 'needs-attention' ? '（需补齐证据）' : ''}`)
      }
      if (task.test_results.length) {
        lines.push('', `测试记录（${task.test_results.length}）：`)
        for (const t of task.test_results.slice(-5)) lines.push(`  ${t.outcome.toUpperCase()} \`${t.command}\`${t.summary ? ` — ${t.summary}` : ''}`)
      }
      if (task.review_findings.length) {
        lines.push('', `审查发现（${task.review_findings.length}）：`)
        for (const f of task.review_findings) lines.push(`  [${f.severity.toUpperCase()}] ${f.area} ${f.description}`)
      }
      if (task.pending_approvals.length) lines.push('', `待批准：${task.pending_approvals.join(' | ')}`)
      lines.push('', `门禁：verify=${g.verifyPassed ? '✓' : '✗'} blocker/high=${g.blockers ? '有（禁止交付）' : '无'} medium=${g.mediumHandled ? '已处理' : '未确认'} canShip=${g.canShip}`)
      lines.push(...g.nextHint.map((h) => `  ▶ ${h}`))
      lines.push('', allowedFrom(task.phase))
      return lines.join('\n')
    },
  })

  registerTool({
    name: 'wf_transition',
    description: '显式状态转移：仅允许状态机图中的边（§2.2）。例如 INSPECT→PLAN、VERIFY→INDEPENDENT_REVIEW、INDEPENDENT_REVIEW→DELIVERY。VERIFY 不能直达 DELIVERY（必须先独立审查）。',
    parameters: {
      to: { type: 'string', required: true, description: '目标阶段（INTAKE/INSPECT/CLARIFY/PLAN/RESEARCH/BASELINE_EVAL/IMPLEMENT/VERIFY/INDEPENDENT_REVIEW/REPAIR/DELIVERY/LEARN/DONE/BLOCKED）' },
      reason: { type: 'string', required: true, description: '转移理由（写入审计）' },
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const to = canonical(args.to)
      if (!isPhase(to)) return `未知阶段 "${args.to}"。合法：${transitionInfo(task.phase, '__').allowed.join(', ')}`
      const { ok, allowed } = transitionInfo(task.phase, to)
      if (!ok) return `非法转移 ${task.phase}→${to}。本状态允许：${allowed.join(' → ')}（提示：VERIFY 后必须先 INDEPENDENT_REVIEW 再 DELIVERY）`
      const guarded = guardTransition(task, to)
      if (!guarded.ok) {
        return [`转移被门禁拦截：${guarded.reason}。`, ...guarded.gate.nextHint.map((hint) => `  ▶ ${hint}`)].join('\n')
      }
      const from = task.phase
      task.phase = to
      task.next_action = `处于 ${to}。${SUCCESS_NEXT[to] ? `完成本阶段产物后转移至 ${SUCCESS_NEXT[to]}（wf_transition）` : '终态。'}`.trim()
      commit(task, 'transition', { from, to, reason: args.reason })
      return `${summarize(task)}\n${allowedFrom(task.phase)}`
    },
  })

  registerTool({
    name: 'wf_checkpoint',
    description: '安全边界：保存当前 checkpoint 并写入可执行的下一步（resume 从这里继续，绝不从头猜）。同时可追加已触碰文件与证据。',
    parameters: {
      next_action: { type: 'string', required: true, description: '可直接继续执行的下一步' },
      touched_files: { type: 'string[]', description: '本次触碰的文件（追加去重）' },
      evidence: { type: 'string', description: '阶段产物/证据摘要（自动去敏入审计）' },
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      task.next_action = args.next_action
      for (const f of args.touched_files ?? []) {
        if (!task.touched_files.includes(f)) task.touched_files.push(f)
      }
      commit(task, 'checkpoint', { next_action: args.next_action, evidence: args.evidence ?? '' })
      return `${store.dryRun ? '⚠ dry-run：未落盘（仅演算）' : 'checkpoint 已保存'}：${join(store.tasksDir, `${task.task_id}.json`)}\n${summarize(task)}`
    },
  })

  registerTool({
    name: 'wf_resume',
    description: '从最近一个安全边界恢复被中断的任务（§3.2/§6 不可恢复兜底）。恢复 active 指针并返回阶段、next_action、已触碰文件与审计尾部。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active；无 active 时报错并列出候选）' },
    },
    execute(args, exec) {
      if (!args.task_id && !store.getActive(sessionKey(exec))) {
        const all = store.listTasks()
        return all.length === 0
          ? '没有可恢复的任务。'
          : `没有 active 指针。候选任务：\n${all.map((t) => `  ${t.task_id}  [${t.phase}]  ${(t.goal || '').slice(0, 60)}`).join('\n')}\n传 task_id 恢复。`
      }
      const task = requireTask(args, exec)
      task.session_id = sessionKey(exec)
      store.setActive(task.task_id, task.session_id)
      const gate = computeGate(task)
      commit(task, 'resume', { from: 'interrupted' })
      return [
        `恢复任务 ${task.task_id}（phase=${task.phase}）`,
        `目标：${task.goal || '（未记录）'}`,
        `下一步：${task.next_action || '（未设置）'}`,
        `已触碰：${task.touched_files.length === 0 ? '（无）' : task.touched_files.join(', ')}`,
        `验证：${gate.verifyPassed ? 'PASS' : 'FAIL'}（open=${task.verify?.open_failures ?? 0}） 待批准：${task.pending_approvals.length === 0 ? '无' : task.pending_approvals.join(' | ')}`,
        `最近审计：${store.tailActivity(task.task_id, 3).map((l) => `[${l.event}] ${JSON.stringify(l.data ?? {}).slice(0, 120)}`).join(' | ')}`,
        '',
        '从 next_action 继续。若失败过，先复现/读证据（classifyFailure 分类）再行动，不要盲修。',
      ].join('\n')
    },
  })

  // ── 大型项目认知层：架构 / 影响 / 假设 / 验证矩阵 ───────────────────────────
  registerTool({
    name: 'wf_architecture',
    description: '建立或替换当前任务的项目架构地图：组件职责、依赖关系、入口、不变量和来源证据。用于跨模块推理，不扫描文件系统。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      components: { type: 'object[]', items: { spec: {
        name: { type: 'string', required: true }, path: { type: 'string' }, responsibility: { type: 'string' }, owner: { type: 'string' },
      } }, description: '架构组件' },
      relations: { type: 'object[]', items: { spec: {
        from: { type: 'string', required: true }, to: { type: 'string', required: true }, type: { type: 'string' }, evidence: { type: 'string' },
      } }, description: '组件依赖/调用/数据关系' },
      entry_points: { type: 'string[]', description: '关键入口' },
      invariants: { type: 'string[]', description: '跨模块不变量和契约' },
      evidence: { type: 'string[]', description: '来源文件、命令或文档证据' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const result = applyArchitectureMap(task, args)
      commit(task, 'architecture', { components: result.architecture.components.length, relations: result.architecture.relations.length, warnings: result.warnings.length })
      return [`架构地图已记录：components=${result.architecture.components.length} relations=${result.architecture.relations.length}`, ...result.warnings.map((w) => `  ⚠ ${w}`), summarize(task)].join('\n')
    },
  })

  registerTool({
    name: 'wf_impact',
    description: '新增或更新变更影响分析：追踪直接/间接受影响目标、必需测试和未知项。draft 或仍有 unknowns 会关闭交付门禁。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      id: { type: 'string', description: '已有分析 id；缺省自动创建' },
      change: { type: 'string', description: '拟议变更或故障修复；新建时必填，更新可沿用原值' },
      status: { type: 'string', enum: ['draft', 'complete'], description: '分析状态' },
      affected: { type: 'object[]', items: { spec: {
        target: { type: 'string', required: true }, kind: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'string' },
      } }, description: '受影响文件/符号/接口/配置/测试' },
      required_tests: { type: 'string[]', description: '由影响面推导的测试' },
      unknowns: { type: 'string[]', description: '尚未排除的影响未知项' },
      symbols: { type: 'object[]', items: { spec: { file: { type: 'string' }, symbol: { type: 'string' }, target: { type: 'string' }, exported: { type: 'boolean' }, change_kind: { type: 'string' }, evidence: { type: 'string' } } }, description: '已变更符号证据（file+symbol 或 target）' },
      dependencies: { type: 'object[]', items: { spec: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, type: { type: 'string' }, evidence: { type: 'string' } } }, description: 'from 依赖 to 的代码关系' },
      contracts: { type: 'object[]', items: { spec: { target: { type: 'string', required: true }, change: { type: 'string' }, evidence: { type: 'string' } } }, description: '发生变化的公共契约' },
      test_mappings: { type: 'object[]', items: { spec: { target: { type: 'string', required: true }, command: { type: 'string', required: true }, level: { type: 'string', enum: ['targeted', 'contract', 'integration', 'regression', 'platform', 'performance'] } } }, description: '目标到验证命令的映射' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const semantic = ['symbols', 'dependencies', 'contracts', 'test_mappings'].some((key) => Array.isArray(args[key]) && args[key].length)
      const result = semantic ? deriveSemanticImpact(task, args) : upsertImpactAnalysis(task, args)
      commit(task, 'impact', { id: result.analysis.id, status: result.analysis.status, affected: result.analysis.affected.length, unknowns: result.analysis.unknowns.length, validation: result.validation?.length ?? 0 })
      return [`影响分析 ${result.analysis.id}：status=${result.analysis.status} affected=${result.analysis.affected.length} unknowns=${result.analysis.unknowns.length}`, ...result.warnings.map((w) => `  ⚠ ${w}`), summarize(task)].join('\n')
    },
  })

  registerTool({
    name: 'wf_hypothesis',
    description: '维护疑难故障假设账本。open/supported 假设必须继续实验或用证据关闭；未关闭假设会阻止交付。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      id: { type: 'string', description: '已有假设 id；缺省自动创建' },
      statement: { type: 'string', description: '可证伪的根因假设；新建时必填，更新可沿用原值' },
      status: { type: 'string', enum: ['open', 'supported', 'rejected', 'confirmed'], description: '证据状态' },
      evidence: { type: 'string[]', description: '支持或反驳证据（追加去重）' },
      next_experiment: { type: 'string', description: '下一项可区分候选根因的实验' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const result = upsertHypothesis(task, args)
      commit(task, 'hypothesis', { id: result.hypothesis.id, status: result.hypothesis.status, evidence: result.hypothesis.evidence.length })
      return [`假设 ${result.hypothesis.id}：${result.hypothesis.status} — ${result.hypothesis.statement}`, ...result.warnings.map((w) => `  ⚠ ${w}`), summarize(task)].join('\n')
    },
  })

  registerTool({
    name: 'wf_validation',
    description: '维护分层验证矩阵（targeted/contract/integration/regression/platform/performance）。必需项全部 pass 才能交付；wf_test 会按完全相同的 command 自动回填。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      id: { type: 'string', description: '已有验证项 id；缺省自动创建' },
      area: { type: 'string', description: '验证面' },
      requirement: { type: 'string', description: '需要证明的行为或契约；新建时必填，更新可沿用原值' },
      command: { type: 'string', description: '精确验证命令；wf_test 用它自动回填' },
      level: { type: 'string', enum: ['targeted', 'contract', 'integration', 'regression', 'platform', 'performance'], description: '验证层级' },
      required: { type: 'boolean', description: '是否为交付必需项（缺省 true）' },
      status: { type: 'string', enum: ['pending', 'pass', 'fail', 'blocked'], description: '当前状态' },
      evidence: { type: 'string', description: '结果摘要或 artifact' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const result = upsertValidationItem(task, args)
      commit(task, 'validation', { id: result.item.id, status: result.item.status, required: result.item.required, level: result.item.level })
      return [`验证项 ${result.item.id}：${result.item.status} [${result.item.level}] ${result.item.requirement}`, ...result.warnings.map((w) => `  ⚠ ${w}`), summarize(task)].join('\n')
    },
  })

  // ── §4 计划 / 工作单元 / 测试 ──────────────────────────────────────────────
  registerTool({
    name: 'wf_plan',
    description: '生成可审阅的实施计划：scope/out_of_scope/风险（最大三个）/回滚/完成证明/验证动作。advance=true 且当前在 INSPECT/CLARIFY 时自动转移至 PLAN。返回计划警告（缺字段会提示）。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      objective: { type: 'string', description: '要解决的具体问题' },
      scope: { type: 'string', description: '本次做什么（文件/接口/配置面）' },
      out_of_scope: { type: 'string', description: '明确不做什么' },
      risks: { type: 'string[]', description: '最大的风险（≤3 个）' },
      rollback: { type: 'string', description: '如何回滚' },
      how_to_prove_done: { type: 'string', description: '如何证明完成' },
      verify_actions: { type: 'string[]', description: '独立验证命令/检查' },
      advance: { type: 'boolean', description: '记录后自动转移至 PLAN（缺省 false）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const { warnings } = applyPlan(task, args)
      commit(task, 'plan', { warnings: warnings.length })
      const fromPlan = task.phase
      const moved = args.advance ? advancePhase(task) : { moved: false }
      if (moved.moved) {
        refreshNextAction(task)
        commit(task, 'transition', { from: fromPlan, to: moved.to, reason: 'wf_plan advance' })
      }
      const lines = [`计划已记录（warnings=${warnings.length === 0 ? '无' : warnings.join('; ')}）`, summarize(task)]
      if (moved.moved) lines.push(`已前进至 ${moved.to}`)
      return lines.join('\n')
    },
  })

  registerTool({
    name: 'wf_workunit',
    description: '工作单元（§4.1，≤15 分钟可验证单元）：add 创建（需 title；建议 risk/inputs/file_scope/verify_command/done_criteria），complete 关闭（必须 verify_command+done_criteria+evidence，否则标记 needs-attention 而非假装完成）。',
    parameters: {
      action: { type: 'string', required: true, enum: ['add', 'complete'], description: 'add=创建单元，complete=带证据关闭单元' },
      title: { type: 'string', required: true, description: '单元标题（complete 时用 id 或 title 定位）' },
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      risk: { type: 'string', description: '单一主风险' },
      inputs: { type: 'string', description: '明确输入' },
      file_scope: { type: 'string[]', description: '文件范围' },
      verify_command: { type: 'string', description: '独立验证命令' },
      done_criteria: { type: 'string', description: 'done 条件' },
      evidence: { type: 'string', description: 'complete 时必填的证据（命令输出摘要/artifacts 路径）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      let result
      if (args.action === 'add') {
        result = addWorkUnit(task, args)
      } else {
        result = completeWorkUnit(task, args.title, args.evidence ?? '')
        if (result.unit.verify_command && result.unit.verify_command !== '') {
          task.commands_run.push({ command: result.unit.verify_command, outcome: 'pending', ts: new Date().toISOString() })
        }
      }
      commit(task, 'workunit', { action: args.action, title: args.title, warnings: result.warnings?.length ?? 0 })
      const lines = [`[${args.action}] ${args.title} → ${result.unit.status}`, summarize(task)]
      for (const w of result.warnings ?? []) lines.push(`  ⚠ ${w}`)
      return lines.join('\n')
    },
  })

  registerTool({
    name: 'wf_test',
    description: '消费宿主 tools/result 生成的真实命令回执并记录测试结果。模型不能提交 outcome；无同会话、同命令、未消费回执时门禁保持关闭。',
    parameters: {
      command: { type: 'string', required: true, description: '必须与已执行 pwsh 命令完全一致' },
      task_id: { type: 'string', description: '任务 id（缺省用当前会话 active）' },
      regression: { type: 'boolean', description: '是否为回归测试' },
      advance: { type: 'boolean', description: '宿主回执 PASS 且门禁满足时自动前进' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const sid = sessionKey(exec)
      const evidence = [...(task.host_evidence || [])].reverse().find((item) => item.command === args.command && item.session_id === sid && !item.consumed)
      if (!evidence) return `未找到可消费的宿主回执：session=${sid} command=${args.command}。请先执行完全相同的 pwsh 命令。`
      evidence.consumed = true
      evidence.consumed_at = new Date().toISOString()
      const outcome = evidence.passed ? 'pass' : 'fail'
      const summary = `host-attested evidence=${evidence.id} exit=${evidence.exit_code} timeout=${evidence.timed_out} sandboxDenied=${Boolean(evidence.sandbox?.denied)}`
      const { record, validationMatched } = applyTestResult(task, { command: args.command, outcome, summary, regression: args.regression, attestation: evidence })
      const gate = computeGate(task)
      commit(task, 'test', { command: record.command, outcome, evidence_id: evidence.id, source: evidence.source, validation_matched: validationMatched })
      const lines = [`[${outcome.toUpperCase()}] ${record.command}`, `  ↳ 宿主回执 ${evidence.id} 已消费（source=${evidence.source}）`, validationMatched.length ? `  ↳ 验证矩阵已回填：${validationMatched.join(', ')}` : '  ↳ 未匹配验证矩阵项', summarize(task)]
      if (outcome === 'fail') {
        const cls = classifyFailure(`${record.command} ${record.summary ?? ''}`)
        lines.push(`  ▶ 失败分类：${cls.type} —— ${cls.strategy}`)
      }
      if (outcome === 'pass' && args.advance) {
        const fromPhase = task.phase
        const moved = advancePhase(task, { gate })
        if (moved.moved) {
          refreshNextAction(task)
          commit(task, 'transition', { from: fromPhase, to: moved.to, reason: 'wf_test host-attested advance' })
          lines.push(`  已前进至 ${moved.to}`)
        } else lines.push(`  advance 未动：${moved.reason}`)
      }
      return lines.join('\n')
    },
  })

  // ── §5.3 独立审查门禁 ──────────────────────────────────────────────────────
  registerTool({
    name: 'wf_review',
    description: '记录独立审查发现（§5.3，严重度 blocker/high/medium/low）。存在 blocker/high 时禁止交付；medium 必须 acknowledge_medium=true（用户知情）才能放行。advance=true 且全门禁通过时 INDEPENDENT_REVIEW→DELIVERY。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      findings: { type: 'object[]', items: { spec: {
        severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'], required: true, description: '严重度' },
        area: { type: 'string', required: true, description: '审查面（逻辑/安全/并发/兼容/回归/范围）' },
        description: { type: 'string', required: true, description: '发现描述' },
      } }, description: '审查发现列表' },
      reviewer: { type: 'string', description: '审查者标识（如 adversarial-A）' },
      acknowledge_medium: { type: 'boolean', description: '确认 medium 发现已向用户知情（缺省 false）' },
      advance: { type: 'boolean', description: '门禁满足时自动 DELIVERY（缺省 false）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const { severityCounts, deliveryBlocked: blocked, mediumPending } = applyReview(task, args.findings ?? [], {
        acknowledge_medium: Boolean(args.acknowledge_medium),
        reviewer: args.reviewer ?? '',
      })
      const gate = computeGate(task)
      commit(task, 'review', { severityCounts, findings: (args.findings ?? []).length })
      const lines = [
        summarize(task),
        `本次发现：${args.findings?.length ?? 0} 条（blocker:${severityCounts.blocker} high:${severityCounts.high} medium:${severityCounts.medium} low:${severityCounts.low}）`,
      ]
      if (blocked) lines.push(`  ▶ ${mediumPending ? 'medium 发现未确认（用户需知情）' : '存在 blocker/high：禁止交付，进入 REPAIR 修复后重审'}`)
      else if (args.advance) {
        const fromReview = task.phase
        const moved = advancePhase(task, { gate })
        if (moved.moved) {
          refreshNextAction(task)
          commit(task, 'transition', { from: fromReview, to: moved.to, reason: 'wf_review advance' })
          lines.push(`  ✓ 门禁通过，已前进至 ${moved.to}（可 wf_deliver）`)
        } else lines.push(`  advance 未动：${moved.reason}`)
      } else if (gate.canShip) {
        lines.push('  ✓ 全部门禁通过，可 wf_deliver 生成交付摘要')
      } else {
        lines.push('  ▶ 审查本身无新增阻断，但其余交付门禁尚未通过：')
        lines.push(...gate.nextHint.map((hint) => `    - ${hint}`))
      }
      return lines.join('\n')
    },
  })

  // ── §12 交付 ───────────────────────────────────────────────────────────────
  registerTool({
    name: 'wf_deliver',
    description: '交付门禁（§2.3/§5.3）：verify 必须通过、无 blocker/high、medium 已处理、已完成独立审查——否则返回缺口清单。通过则按 §12 生成交付摘要（状态/目标/已实现/验证/审查/剩余风险/批准动作/恢复入口），落盘 DSH_HOME/wf/deliveries/ 并返回全文。默认不推送远程。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
    },
    execute(args, exec) {
      const task = requireTask(args, exec)
      const gate = computeGate(task)
      if (!gate.canShip) {
        return ['交付被门禁拦截：', summarize(task), ...gate.nextHint.map((h) => `  ▶ ${h}`)].join('\n')
      }
      const md = buildDelivery(task, gate)
      store.saveDelivery(task.task_id, md)
      if (canonical(task.phase) === 'INDEPENDENT_REVIEW') {
        task.phase = 'DELIVERY'
        commit(task, 'deliver', { task_id: task.task_id })
      } else {
        commit(task, 'deliver', { task_id: task.task_id, phase: task.phase })
      }
      return `交付摘要已生成：${join(store.deliveriesDir, `${task.task_id}.md`)}\n\n${md}`
    },
  })

  // ── §3.3 记忆（learn） ─────────────────────────────────────────────────────
  registerTool({
    name: 'wf_learn',
    description: '把可复用工程规律提炼为教训（§3.3）：自动去敏（token/私钥/凭据不落盘）+ 规范化去重（重复内容不重复入账）。advance=true 且处于 DELIVERY/LEARN 时沿成功路径前进（DELIVERY→LEARN→DONE）。',
    parameters: {
      lesson: { type: 'string', required: true, description: '可复用教训（一条，不含一次性噪声）' },
      task_id: { type: 'string', description: '任务 id（缺省用 active）' },
      category: { type: 'string', description: '分类（general/architecture/test/python/…）' },
      advance: { type: 'boolean', description: '记录后沿成功路径前进（缺省 false）' },
    },
    execute(args, exec) {
      const scan = scanSensitive(args.lesson)
      const task = requireTask(args, exec)
      const result = store.addLesson({ text: args.lesson, category: args.category, project: task.workspace })
      const lines = [
        result.added ? '✓ 教训已保存' : result.dedupe ? '· 重复教训，跳过（dedupe）' : '· 未保存',
        `lesson: ${result.lesson?.text ?? '（空）'}`,
      ]
      if (!scan.safe) lines.push(`  ⚠ 原内容含敏感信息（${scan.kinds.join(', ')}），已自动去敏后保存`)
      if (result.added && args.advance) {
        const fromLearn = task.phase
        const moved = advancePhase(task)
        if (moved.moved) {
          refreshNextAction(task)
          commit(task, 'transition', { from: fromLearn, to: moved.to, reason: 'wf_learn advance' })
          lines.push(`  已前进至 ${moved.to}`)
        }
      }
      if (result.added) commit(task, 'learn', { category: args.category })
      return lines.join('\n')
    },
  })

  // ── §5.1 eval ──────────────────────────────────────────────────────────────
  registerTool({
    name: 'wf_eval',
    description: '运行能力/回归 eval（§5.1/§10）：进程内机器判定 20+ 场景（状态机边/门禁/checkpoint 往返/dry-run/去敏/交付结构）。报告落盘 DSH_HOME/wf/evals/。任何 FAIL 都应先修再交付。',
    parameters: {},
    execute() {
      const report = runEvals()
      const path = store.saveEvalReport(report)
      return `${renderEvalTable(report)}\n报告：${path}`
    },
  })

  // ── 配置 / 审计 ────────────────────────────────────────────────────────────
  registerTool({
    name: 'wf_config',
    description: '工作流引擎配置：dry_run=true 时所有写入（checkpoint/审计/教训/交付）只演算不落盘（安全开关 §7）；root 可切换存储根（默认 DSH_WF_ROOT 或 ~/.dsh/wf）。',
    parameters: {
      dry_run: { type: 'boolean', description: '打开/关闭 dry-run（缺省不动）' },
      root: { type: 'string', description: '切换存储根目录（立即生效）' },
    },
    execute(args, exec) {
      if (args.root) {
        store = new Store(args.root, { dryRun: store.dryRun })
        store.ensure()
      }
      if (args.dry_run !== undefined) store.dryRun = Boolean(args.dry_run)
      const active = store.getActive(sessionKey(exec))
      return [
        `root=${store.root}`,
        `dry_run=${store.dryRun}`,
        `active=${active ?? '（无）'}`,
        `tasks=${store.listTasks().length}  lessons=${store.listLessons().length}`,
        store.dryRun ? '⚠ dry-run 开启：所有写入仅演算不落盘。' : '',
      ].filter(Boolean).join('\n')
    },
  })

  registerTool({
    name: 'wf_audit',
    description: '审计日志（§2.2 审计记录 / §8 可观测）：按任务拉取 activity.jsonl 尾部（已去敏）。',
    parameters: {
      task_id: { type: 'string', description: '任务 id（缺省显示全部）' },
      limit: { type: 'number', description: '条数（缺省 20）' },
    },
    execute(args, exec) {
      const rows = store.tailActivity(args.task_id, Math.max(1, Number(args.limit ?? 20)))
      if (rows.length === 0) return '（无审计记录）'
      return rows.map((l) => `[${l.ts}] ${l.event}${l.task ? ` task=${l.task}` : ''} ${JSON.stringify(l.data ?? {}).slice(0, 200)}`).join('\n')
    },
  })

  // ── §8 成本钩子：llm/stream 字符数 → 任务 cost（尽力而为，绝不抛） ────────
  ctx.on('llm/stream', (options, next) => {
    return (async function* () {
      let chars = 0
      let errored = false
      let taskId = null
      try { taskId = store.getActive(String(options?.sessionId || 'global')) } catch { /* 存储不可用则跳过成本记账 */ }
      const model = String(options?.model ?? '')
      try {
        for await (const chunk of next()) {
          if (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta') chars += (chunk.text ?? '').length
          if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') errored = true
          yield chunk
        }
      } finally {
        if (taskId && (chars > 0 || errored)) {
          try {
            const task = store.loadTask(taskId)
            if (task) {
              task.cost.tokens_estimated += Math.ceil(chars / 4)
              task.cost.streams += 1
              if (errored) task.cost.retries += 1
              if (model && !task.cost.model) task.cost.model = model
              task.cost.elapsed_seconds = Math.round((Date.now() - Date.parse(task.created_at)) / 1000)
              touchTimes(task)
              store.saveTask(task)
            }
          } catch { /* 成本记账失败不影响对话 */ }
        }
      }
    })()
  }, { global: true })
}
