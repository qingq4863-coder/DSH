export const REQUIRED_PROTOCOL_MARKERS = [
  'Acceptance handoff:',
  'Preserve the exact command',
  'Safety: this protocol produces a plan only',
] as const

export const REQUIRED_CONTRACT_MARKERS = [
  'ACCEPTANCE CONTRACT',
  'Failure signal:',
  'Verification:',
  'Done:',
] as const

export const REQUIRED_WF_PLAN_MARKERS = [
  'WF CONTRACT EXECUTION PLAN',
  'wf_workunit add',
  'wf_validation:',
  'wf_test:',
  'Guard:',
] as const

export function hasMarkers(text: string, markers: readonly string[]): boolean {
  return markers.every(marker => text.includes(marker))
}
