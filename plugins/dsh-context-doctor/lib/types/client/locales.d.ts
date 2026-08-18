/**
 * Context Doctor locale dictionaries.
 * The audit panel intentionally renders its compact product vocabulary in
 * English so it remains stable alongside a localized DSH shell.
 */
export declare const NS = "context-doctor";
declare const copy: {
    readonly 'cd.title': "Context Doctor";
    readonly 'cd.residentTokens': "Context budget audit";
    readonly 'cd.instructions': "Instruction chain";
    readonly 'cd.skills': "Skills catalog";
    readonly 'cd.tools': "Tool schemas";
    readonly 'cd.mcp': "MCP tools";
    readonly 'cd.suggestions': "{n} suggestions";
    readonly 'cd.refresh': "Refresh";
    readonly 'cd.loading': "Auditing…";
    readonly 'cd.error': "Audit failed";
    readonly 'cd.empty': "No data yet";
    readonly 'cd.healthy': "Healthy";
    readonly 'cd.attention': "Review";
    readonly 'cd.review': "Review";
    readonly 'cd.healthyHint': "Your context is efficient and remains within the recommended budget.";
    readonly 'cd.reviewHint': "Some context entries are worth reviewing before they become expensive.";
    readonly 'cd.guideline': "of 50k";
    readonly 'cd.updated': "Last updated";
    readonly 'cd.catalog': "{n} skills";
    readonly 'cd.mcpTools': "{n} tools";
    readonly 'cd.files': "files";
    readonly 'cd.toolsCount': "tools";
    readonly 'cd.hint': "Open Context Doctor";
};
export declare const zh: {
    readonly 'cd.title': "Context Doctor";
    readonly 'cd.residentTokens': "Context budget audit";
    readonly 'cd.instructions': "Instruction chain";
    readonly 'cd.skills': "Skills catalog";
    readonly 'cd.tools': "Tool schemas";
    readonly 'cd.mcp': "MCP tools";
    readonly 'cd.suggestions': "{n} suggestions";
    readonly 'cd.refresh': "Refresh";
    readonly 'cd.loading': "Auditing…";
    readonly 'cd.error': "Audit failed";
    readonly 'cd.empty': "No data yet";
    readonly 'cd.healthy': "Healthy";
    readonly 'cd.attention': "Review";
    readonly 'cd.review': "Review";
    readonly 'cd.healthyHint': "Your context is efficient and remains within the recommended budget.";
    readonly 'cd.reviewHint': "Some context entries are worth reviewing before they become expensive.";
    readonly 'cd.guideline': "of 50k";
    readonly 'cd.updated': "Last updated";
    readonly 'cd.catalog': "{n} skills";
    readonly 'cd.mcpTools': "{n} tools";
    readonly 'cd.files': "files";
    readonly 'cd.toolsCount': "tools";
    readonly 'cd.hint': "Open Context Doctor";
};
export declare const en: {
    readonly 'cd.title': "Context Doctor";
    readonly 'cd.residentTokens': "Context budget audit";
    readonly 'cd.instructions': "Instruction chain";
    readonly 'cd.skills': "Skills catalog";
    readonly 'cd.tools': "Tool schemas";
    readonly 'cd.mcp': "MCP tools";
    readonly 'cd.suggestions': "{n} suggestions";
    readonly 'cd.refresh': "Refresh";
    readonly 'cd.loading': "Auditing…";
    readonly 'cd.error': "Audit failed";
    readonly 'cd.empty': "No data yet";
    readonly 'cd.healthy': "Healthy";
    readonly 'cd.attention': "Review";
    readonly 'cd.review': "Review";
    readonly 'cd.healthyHint': "Your context is efficient and remains within the recommended budget.";
    readonly 'cd.reviewHint': "Some context entries are worth reviewing before they become expensive.";
    readonly 'cd.guideline': "of 50k";
    readonly 'cd.updated': "Last updated";
    readonly 'cd.catalog': "{n} skills";
    readonly 'cd.mcpTools': "{n} tools";
    readonly 'cd.files': "files";
    readonly 'cd.toolsCount': "tools";
    readonly 'cd.hint': "Open Context Doctor";
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'context-doctor': keyof typeof copy;
    }
}
export {};
