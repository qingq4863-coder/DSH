export declare const REQUIRED_PROTOCOL_MARKERS: readonly ["Acceptance handoff:", "Preserve the exact command", "Safety: this protocol produces a plan only"];
export declare const REQUIRED_CONTRACT_MARKERS: readonly ["ACCEPTANCE CONTRACT", "Failure signal:", "Verification:", "Done:"];
export declare const REQUIRED_WF_PLAN_MARKERS: readonly ["WF CONTRACT EXECUTION PLAN", "wf_workunit add", "wf_validation:", "wf_test:", "Guard:"];
export declare function hasMarkers(text: string, markers: readonly string[]): boolean;
