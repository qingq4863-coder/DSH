export const REQUIRED_PROTOCOL_MARKERS = [
    'Acceptance handoff:',
    'Preserve the exact command',
    'Safety: this protocol produces a plan only',
];
export const REQUIRED_CONTRACT_MARKERS = [
    'ACCEPTANCE CONTRACT',
    'Failure signal:',
    'Verification:',
    'Done:',
];
export const REQUIRED_WF_PLAN_MARKERS = [
    'WF CONTRACT EXECUTION PLAN',
    'wf_workunit add',
    'wf_validation:',
    'wf_test:',
    'Guard:',
];
export function hasMarkers(text, markers) {
    return markers.every(marker => text.includes(marker));
}
//# sourceMappingURL=protocol.js.map