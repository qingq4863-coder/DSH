/**
 * 大型项目认知层：架构地图、影响分析、故障假设和验证矩阵。
 * 纯逻辑模块，不做 IO；旧 checkpoint 通过 ensureProjectIntelligence 懒迁移。
 */

function text(value) {
  return String(value ?? '').trim()
}

function strings(values) {
  return [...new Set((values ?? []).map(text).filter(Boolean))]
}

function now() {
  return new Date().toISOString()
}

function nextId(rows, prefix) {
  const used = new Set((rows ?? []).map((row) => text(row?.id)))
  let n = 1
  while (used.has(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

export function ensureProjectIntelligence(task) {
  if (!task.architecture_map) {
    task.architecture_map = { components: [], relations: [], entry_points: [], invariants: [], evidence: [], updated_at: null }
  }
  if (!Array.isArray(task.impact_analyses)) task.impact_analyses = []
  if (!Array.isArray(task.hypotheses)) task.hypotheses = []
  if (!Array.isArray(task.validation_matrix)) task.validation_matrix = []
  return task
}

export function applyArchitectureMap(task, input = {}) {
  ensureProjectIntelligence(task)
  const warnings = []
  const components = (input.components ?? []).map((row) => ({
    name: text(row?.name), path: text(row?.path), responsibility: text(row?.responsibility), owner: text(row?.owner),
  })).filter((row) => row.name)
  const names = new Set(components.map((row) => row.name))
  const relations = (input.relations ?? []).map((row) => ({
    from: text(row?.from), to: text(row?.to), type: text(row?.type), evidence: text(row?.evidence),
  })).filter((row) => row.from && row.to)
  for (const relation of relations) {
    if (!names.has(relation.from) || !names.has(relation.to)) warnings.push(`关系 ${relation.from}→${relation.to} 引用了未登记组件`)
  }
  if (components.length === 0) warnings.push('架构地图没有组件，无法支撑跨模块影响分析')
  task.architecture_map = {
    components, relations,
    entry_points: strings(input.entry_points),
    invariants: strings(input.invariants),
    evidence: strings(input.evidence),
    updated_at: now(),
  }
  return { task, architecture: task.architecture_map, warnings }
}

export function upsertImpactAnalysis(task, input = {}) {
  ensureProjectIntelligence(task)
  const id = text(input.id) || nextId(task.impact_analyses, 'impact')
  const existing = task.impact_analyses.find((row) => row.id === id)
  const change = text(input.change) || existing?.change || ''
  if (!change) throw new Error('影响分析必须说明 change')
  const status = text(input.status || existing?.status || 'draft').toLowerCase()
  if (!['draft', 'complete'].includes(status)) throw new Error('影响分析 status 必须是 draft 或 complete')
  const row = {
    id,
    change,
    status,
    affected: (input.affected ?? existing?.affected ?? []).map((item) => ({
      target: text(item?.target), kind: text(item?.kind), reason: text(item?.reason), confidence: text(item?.confidence || 'medium').toLowerCase(),
    })).filter((item) => item.target),
    required_tests: strings(input.required_tests ?? existing?.required_tests),
    unknowns: strings(input.unknowns ?? existing?.unknowns),
    updated_at: now(),
  }
  const warnings = []
  if (row.affected.length === 0) warnings.push('影响分析没有 affected 目标')
  if (status === 'complete' && row.unknowns.length > 0) warnings.push('标记 complete 前仍有 unknowns；交付门禁会保持关闭')
  if (existing) Object.assign(existing, row)
  else task.impact_analyses.push(row)
  return { task, analysis: existing ?? row, warnings }
}

function targetMatches(left, right) {
  const a = text(left); const b = text(right)
  return Boolean(a && b && (a === b || a.startsWith(b + '#') || b.startsWith(a + '#')))
}

/** Derive symbol, dependent, contract, and validation impact from explicit code evidence. */
export function deriveSemanticImpact(task, input = {}) {
  ensureProjectIntelligence(task)
  const symbols = (input.symbols ?? []).map((row) => ({
    target: text(row?.target) || [text(row?.file), text(row?.symbol)].filter(Boolean).join('#'),
    exported: Boolean(row?.exported), change_kind: text(row?.change_kind || 'behavior'), evidence: text(row?.evidence),
  })).filter((row) => row.target)
  const dependencies = (input.dependencies ?? []).map((row) => ({ from: text(row?.from), to: text(row?.to), type: text(row?.type || 'depends-on'), evidence: text(row?.evidence) })).filter((row) => row.from && row.to)
  const contracts = (input.contracts ?? []).map((row) => ({ target: text(row?.target), change: text(row?.change), evidence: text(row?.evidence) })).filter((row) => row.target)
  const mappings = (input.test_mappings ?? []).map((row) => ({ target: text(row?.target || '*'), command: text(row?.command), level: text(row?.level || 'targeted') })).filter((row) => row.command)
  const affected = new Map((input.affected ?? []).map((row) => [text(row?.target), { target: text(row?.target), kind: text(row?.kind), reason: text(row?.reason), confidence: text(row?.confidence || 'medium') }]).filter(([key]) => key))
  for (const symbol of symbols) affected.set(symbol.target, { target: symbol.target, kind: 'symbol', reason: `${symbol.change_kind} change${symbol.evidence ? ': ' + symbol.evidence : ''}`, confidence: 'high' })
  for (const contract of contracts) affected.set(contract.target, { target: contract.target, kind: 'contract', reason: contract.change || contract.evidence || 'contract changed', confidence: contract.evidence ? 'high' : 'medium' })
  let expanded = true
  while (expanded) {
    expanded = false
    const known = [...affected.keys()]
    for (const edge of dependencies) if (!affected.has(edge.from) && known.some((target) => targetMatches(edge.to, target))) {
      affected.set(edge.from, { target: edge.from, kind: 'dependent', reason: `${edge.type} on changed ${edge.to}${edge.evidence ? ': ' + edge.evidence : ''}`, confidence: edge.evidence ? 'high' : 'medium' })
      expanded = true
    }
  }
  const affectedTargets = [...affected.keys()]
  const selectedMappings = mappings.filter((mapping) => mapping.target === '*' || affectedTargets.some((target) => targetMatches(target, mapping.target)))
  const requiredTests = strings([...(input.required_tests ?? []), ...selectedMappings.map((row) => row.command)])
  const unknowns = strings(input.unknowns)
  for (const symbol of symbols.filter((row) => row.exported)) if (!dependencies.some((edge) => targetMatches(edge.to, symbol.target))) unknowns.push(`exported symbol ${symbol.target} has no dependent evidence`)
  for (const contract of contracts) if (!selectedMappings.some((mapping) => mapping.target === '*' || targetMatches(mapping.target, contract.target))) unknowns.push(`contract ${contract.target} has no mapped validation`)
  const result = upsertImpactAnalysis(task, { ...input, affected: [...affected.values()], required_tests: requiredTests, unknowns: strings(unknowns) })
  const validation = []
  const byCommand = new Map()
  const levelRank = ['targeted', 'contract', 'integration', 'regression', 'platform', 'performance']
  for (const mapping of selectedMappings) {
    const group = byCommand.get(mapping.command) || { ...mapping, targets: [] }
    if (!group.targets.includes(mapping.target)) group.targets.push(mapping.target)
    if (levelRank.indexOf(mapping.level) > levelRank.indexOf(group.level)) group.level = mapping.level
    byCommand.set(mapping.command, group)
  }
  for (const group of byCommand.values()) {
    const existing = task.validation_matrix.find((item) => item.command === group.command)
    const contractDetails = contracts.filter((contract) => group.targets.some((target) => target === '*' || targetMatches(target, contract.target))).map((contract) => `${contract.target}:${contract.change || contract.evidence || 'changed'}`)
    const signature = [...group.targets, ...contractDetails].sort().join(', ')
    const item = upsertValidationItem(task, { id: existing?.id, area: group.targets.join(', '), requirement: `Validate semantic impact on ${signature}`, command: group.command, level: group.level, required: true }).item
    validation.push(item)
  }
  return { ...result, validation }
}

export function upsertHypothesis(task, input = {}) {
  ensureProjectIntelligence(task)
  const id = text(input.id) || nextId(task.hypotheses, 'hyp')
  const existing = task.hypotheses.find((row) => row.id === id)
  const statement = text(input.statement) || existing?.statement || ''
  if (!statement) throw new Error('故障假设必须有 statement')
  const status = text(input.status || existing?.status || 'open').toLowerCase()
  if (!['open', 'supported', 'rejected', 'confirmed'].includes(status)) {
    throw new Error('假设 status 必须是 open/supported/rejected/confirmed')
  }
  const evidence = strings([...(existing?.evidence ?? []), ...(input.evidence ?? [])])
  const row = {
    id, statement, status, evidence,
    next_experiment: text(input.next_experiment ?? existing?.next_experiment),
    created_at: existing?.created_at ?? now(),
    updated_at: now(),
  }
  const warnings = []
  if (['open', 'supported'].includes(status) && !row.next_experiment) warnings.push('未关闭的假设应填写 next_experiment')
  if (['rejected', 'confirmed'].includes(status) && evidence.length === 0) warnings.push('关闭假设缺少 evidence')
  if (existing) Object.assign(existing, row)
  else task.hypotheses.push(row)
  return { task, hypothesis: existing ?? row, warnings }
}

export function upsertValidationItem(task, input = {}) {
  ensureProjectIntelligence(task)
  const id = text(input.id) || nextId(task.validation_matrix, 'val')
  const existing = task.validation_matrix.find((row) => row.id === id)
  const requirement = text(input.requirement) || existing?.requirement || ''
  if (!requirement) throw new Error('验证项必须有 requirement')
  const command = text(input.command ?? existing?.command)
  const level = text(input.level ?? existing?.level ?? 'targeted').toLowerCase()
  if (!['targeted', 'contract', 'integration', 'regression', 'platform', 'performance'].includes(level)) throw new Error('验证项 level 非法')
  const required = input.required === undefined ? (existing?.required ?? true) : Boolean(input.required)
  const contractChanged = Boolean(existing) && (
    requirement !== existing.requirement || command !== existing.command || level !== existing.level || required !== existing.required
  )
  const status = text(input.status ?? (contractChanged ? 'pending' : existing?.status) ?? 'pending').toLowerCase()
  if (!['pending', 'pass', 'fail', 'blocked'].includes(status)) throw new Error('验证项 status 必须是 pending/pass/fail/blocked')
  const row = {
    id,
    area: text(input.area ?? existing?.area),
    requirement,
    command,
    level,
    required,
    status,
    evidence: text(input.evidence ?? (contractChanged ? '' : existing?.evidence)),
    updated_at: now(),
  }
  const warnings = []
  if (row.required && !row.command) warnings.push('必需验证项缺 command，无法由 wf_test 自动回填')
  if (row.status === 'pass' && !row.evidence) warnings.push('手工标记 pass 但没有 evidence；建议通过 wf_test 绑定命令结果')
  if (existing) Object.assign(existing, row)
  else task.validation_matrix.push(row)
  return { task, item: existing ?? row, warnings }
}

export function syncValidationFromTest(task, record) {
  ensureProjectIntelligence(task)
  const matched = []
  for (const item of task.validation_matrix) {
    if (item.command && item.command === record.command) {
      item.status = record.outcome
      item.evidence = record.summary || (record.artifacts?.length ? record.artifacts.join(', ') : `wf_test ${record.outcome}`)
      item.updated_at = record.ts
      matched.push(item.id)
    }
  }
  return matched
}

export function computeProjectReadiness(task) {
  ensureProjectIntelligence(task)
  const impactIncomplete = task.impact_analyses.filter((row) => row.status !== 'complete' || (row.unknowns?.length ?? 0) > 0)
  const hypothesesOpen = task.hypotheses.filter((row) => ['open', 'supported'].includes(row.status))
  const validationIncomplete = task.validation_matrix.filter((row) => row.required !== false && row.status !== 'pass')
  const enabled = Boolean(
    task.architecture_map.updated_at || task.impact_analyses.length || task.hypotheses.length || task.validation_matrix.length
  )
  const ready = !enabled || (impactIncomplete.length === 0 && hypothesesOpen.length === 0 && validationIncomplete.length === 0)
  return { enabled, ready, impactIncomplete, hypothesesOpen, validationIncomplete }
}
