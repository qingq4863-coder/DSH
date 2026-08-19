export type Flow = 'diagnosis' | 'tdd' | 'review' | 'research' | 'disclosure';
export type RoutePlan = {
    primary: Flow[];
    auxiliary: Flow[];
};
export declare const flowTools: Record<Flow, string[]>;
export declare function routeTools(task: string): string[];
export declare function routeWorkflow(task: string): string[];
export type RouteCall = {
    tool: string;
    stage: string;
    conditional: boolean;
    args: Record<string, string>;
};
export declare function validateRouteCalls(calls: RouteCall[]): string[];
export declare function routeCalls(task: string, seam?: string, command?: string): RouteCall[];
export declare function routePlan(task: string): RoutePlan;
export declare function routeExecution(task: string): Flow[];
export declare function routeTask(task: string): Flow[];
