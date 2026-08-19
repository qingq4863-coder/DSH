export type Flow = 'diagnosis' | 'tdd' | 'review' | 'research' | 'disclosure'

const bug = /bug|error|fail|broken|slow|regression|crash|异常|报错|失败|卡顿|回归/i
const build = /test|feature|implement|build|add|fix|功能|实现|新增|修复|测试/i
const review = /review|diff|audit|审查|评审|检查改动/i
const research = /research|investigate|look up|docs|source|调研|查资料|查官方文档|查文档|查询文档|研究|规范|引用|一手来源/i
const disclosure = /prompt|agent|skill|context|guide|instruction|提示词|技能|上下文|指令|指导|常驻/i
const explicitResearch = /investigate|look up|official docs|primary source|查官方文档|查文档|查询文档|一手来源|引用来源/i

export type RoutePlan = { primary: Flow[]; auxiliary: Flow[] }

export const flowTools: Record<Flow, string[]> = {
  diagnosis: ['matt_diagnosis_loop', 'matt_wf_evidence_map(diagnosis)'],
  tdd: ['matt_tdd_slice', 'matt_wf_evidence_map(tdd)'],
  review: ['matt_review_diff', 'matt_wf_evidence_map(review)'],
  research: ['matt_research_brief', 'matt_wf_evidence_map(research)'],
  disclosure: ['matt_disclosure_audit', 'matt_context_pointer', 'matt_wf_evidence_map(disclosure)'],
}

export function routeTools(task: string): string[] {
  return routeExecution(task).flatMap(flow => flowTools[flow])
}

export function routeWorkflow(task: string): string[] {
  const tools = routeTools(task)
  return ['matt_acceptance_contract', 'matt_contract_wf_plan', ...(tools.length ? tools : ['matt_task_route']), 'wf_review']
}

export type RouteCall = { tool: string; stage: string; conditional: boolean; args: Record<string, string> }

const allowedCallTools = new Set(['matt_acceptance_contract', 'matt_contract_wf_plan', 'matt_task_route', 'matt_diagnosis_loop', 'matt_tdd_slice', 'matt_review_diff', 'matt_research_brief', 'matt_disclosure_audit', 'matt_context_pointer', 'matt_wf_evidence_map', 'wf_review'])

export function validateRouteCalls(calls: RouteCall[]): string[] {
  const errors: string[] = []
  if (calls.length < 3) errors.push('calls must include contract, route work, and review')
  if (calls[0]?.tool !== 'matt_acceptance_contract') errors.push('first call must be matt_acceptance_contract')
  if (calls[1]?.tool !== 'matt_contract_wf_plan') errors.push('second call must be matt_contract_wf_plan')
  if (calls.at(-1)?.tool !== 'wf_review') errors.push('last call must be wf_review')
  const clarifyCalls = calls.filter(call => call.tool === 'matt_task_route')
  if (clarifyCalls.length > 1) errors.push('clarify fallback must be unique')
  if (clarifyCalls.length > 0) {
    const clarifyIndex = calls.indexOf(clarifyCalls[0])
    if (clarifyIndex !== calls.length - 2) errors.push('clarify fallback must immediately precede wf_review')
    if (calls.some(call => call.tool === 'matt_wf_evidence_map')) errors.push('clarify fallback cannot include evidence maps')
    if (calls.some(call => ['matt_diagnosis_loop', 'matt_tdd_slice', 'matt_review_diff', 'matt_research_brief', 'matt_disclosure_audit', 'matt_context_pointer'].includes(call.tool))) errors.push('clarify fallback cannot include route tools')
  }
  const evidenceCommands = new Set<string>()
  const contract = calls[0]?.args
  const expectedTask = contract?.requirement
  const expectedSeam = contract?.seam
  const expectedCommand = contract?.command
  if (calls[1]?.args.requirement !== expectedTask || calls[1]?.args.seam !== expectedSeam || calls[1]?.args.command !== expectedCommand) errors.push('contract and wf-plan args must match')
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]
    if (!allowedCallTools.has(call.tool)) errors.push('unsupported tool: '+call.tool)
    if (call.tool === 'matt_wf_evidence_map') {
      if (!call.args.command) errors.push('evidence map call requires command')
      else evidenceCommands.add(call.args.command)
      const previous = calls[i - 1]
      const routeToolsByStage: Record<string, string[]> = { diagnosis: ['matt_diagnosis_loop'], tdd: ['matt_tdd_slice'], review: ['matt_review_diff'], research: ['matt_research_brief'], disclosure: ['matt_disclosure_audit', 'matt_context_pointer'] }
      if (!previous || !routeToolsByStage[call.stage]?.includes(previous.tool)) errors.push('evidence map must follow matching route tool')
      if (call.args.discipline !== call.stage) errors.push('evidence map discipline must match stage')
      if (call.args.task !== expectedTask || call.args.command !== expectedCommand) errors.push('evidence map task and command must match contract')
      if (previous && previous.conditional !== call.conditional) errors.push('route tool and evidence map conditional flags must match')
    }
    if (['matt_diagnosis_loop', 'matt_tdd_slice', 'matt_review_diff', 'matt_research_brief', 'matt_disclosure_audit', 'matt_context_pointer'].includes(call.tool)) {
      const nextTool = calls[i + 1]?.tool
      const disclosureChain = call.tool === 'matt_disclosure_audit' && nextTool === 'matt_context_pointer'
      if (nextTool !== 'matt_wf_evidence_map' && !disclosureChain) errors.push('route tool must be followed by evidence map')
      if (call.tool === 'matt_diagnosis_loop' && (call.args.symptom !== expectedTask || call.args.seam !== expectedSeam)) errors.push('diagnosis args must match contract')
      if (call.tool === 'matt_tdd_slice' && (call.args.behavior !== expectedTask || call.args.seam !== expectedSeam)) errors.push('tdd args must match contract')
      if (call.tool === 'matt_review_diff' && (call.args.scope !== expectedTask || call.args.spec !== expectedTask)) errors.push('review args must match contract')
      if (call.tool === 'matt_research_brief' && call.args.question !== expectedTask) errors.push('research args must match contract')
      if (call.tool === 'matt_disclosure_audit' && call.args.document !== expectedTask) errors.push('disclosure args must match contract')
    }
    if (call.tool === 'matt_disclosure_audit' && !['matt_context_pointer', 'matt_wf_evidence_map'].includes(calls[i + 1]?.tool)) errors.push('disclosure audit must be followed by context pointer or evidence map')
    if (call.tool === 'matt_task_route' && (call.stage !== 'clarify' || call.args.task !== expectedTask)) errors.push('clarify args must match contract')
  }
  if (evidenceCommands.size > 1) errors.push('all evidence maps must use the same command')
  return [...new Set(errors)]
}

export function routeCalls(task: string, seam = '<observable seam>', command = '<exact focused verification command>'): RouteCall[] {
  const plan = routePlan(task)
  const auxiliary = new Set(plan.auxiliary)
  const calls: RouteCall[] = [
    { tool: 'matt_acceptance_contract', stage: 'contract', conditional: false, args: { requirement: task, seam, command } },
    { tool: 'matt_contract_wf_plan', stage: 'wf-plan', conditional: false, args: { requirement: task, seam, command } },
  ]
  for (const flow of [...plan.primary, ...plan.auxiliary]) {
    const conditional = auxiliary.has(flow)
    if (flow === 'diagnosis') calls.push(
      { tool: 'matt_diagnosis_loop', stage: flow, conditional, args: { symptom: task, seam } },
      { tool: 'matt_wf_evidence_map', stage: flow, conditional, args: { discipline: flow, task, command } },
    )
    if (flow === 'tdd') calls.push(
      { tool: 'matt_tdd_slice', stage: flow, conditional, args: { behavior: task, seam } },
      { tool: 'matt_wf_evidence_map', stage: flow, conditional, args: { discipline: flow, task, command } },
    )
    if (flow === 'review') calls.push(
      { tool: 'matt_review_diff', stage: flow, conditional, args: { scope: task, spec: task } },
      { tool: 'matt_wf_evidence_map', stage: flow, conditional, args: { discipline: flow, task, command } },
    )
    if (flow === 'research') calls.push(
      { tool: 'matt_research_brief', stage: flow, conditional, args: { question: task } },
      { tool: 'matt_wf_evidence_map', stage: flow, conditional, args: { discipline: flow, task, command } },
    )
    if (flow === 'disclosure') calls.push(
      { tool: 'matt_disclosure_audit', stage: flow, conditional, args: { document: task } },
      { tool: 'matt_context_pointer', stage: flow, conditional, args: { topic: task, branches: task, path: 'authoritative guidance' } },
      { tool: 'matt_wf_evidence_map', stage: flow, conditional, args: { discipline: flow, task, command } },
    )
  }
  if (plan.primary.length === 0 && plan.auxiliary.length === 0) {
    calls.push({ tool: 'matt_task_route', stage: 'clarify', conditional: false, args: { task } })
  }
  calls.push({ tool: 'wf_review', stage: 'review', conditional: false, args: {} })
  return calls
}

export function routePlan(task: string): RoutePlan {
  const s = task.toLowerCase()
  const primary: Flow[] = []
  const auxiliary: Flow[] = []
  const isBug = bug.test(s)
  if (isBug) primary.push('diagnosis')
  if (build.test(s)) primary.push('tdd')
  if (review.test(s)) primary.push('review')
  if (research.test(s)) {
    if (isBug && explicitResearch.test(s)) auxiliary.push('research')
    else if (!isBug) primary.push('research')
  }
  if (disclosure.test(s)) primary.push('disclosure')
  return { primary: [...new Set(primary)], auxiliary: [...new Set(auxiliary)] }
}

export function routeExecution(task: string): Flow[] {
  const { primary, auxiliary } = routePlan(task)
  return [...primary, ...auxiliary]
}

export function routeTask(task: string): Flow[] {
  return routeExecution(task)
}
