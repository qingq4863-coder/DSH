# DSH Plugins For TUI

这份文档给终端 TUI 使用，来源是当前机器上的实际插件 manifest、构建入口和 Cordis 入口代码。不要把纯 Web 客户端插件加入 headless/tui profile。

## Terminal Profile

当前终端 profile：

- Profile: headless
- Manifest: C:/Users/m1830/.dsh/profiles/headless/package.json
- VS Code entry: .vscode/settings.json
- Interactive alias in the VS Code profile: dshv
- Direct invocation: dsh --profile headless "<task>"

The profile currently contains these terminal-compatible bundles:

- @dsh-external/dsh-mode-boost
- dsh-wf-engine
- dsh-context-doctor

## dsh-wf-engine

- Package: plugins/dsh-wf-engine/package.json
- Runtime entry: plugins/dsh-wf-engine/lib/index.js
- Source README: plugins/dsh-wf-engine/README.md
- Bundle patch: plugins/dsh-wf-engine/cordis.patch.yml
- Runtime dependencies: tools, llm
- Purpose: engineering workflow state machine, checkpoints, validation evidence, review gates, delivery, audit, and evals.

### Tool Names

The plugin registers these tools. Tool parameters are defined in the registerTool({ name, description, parameters, execute }) blocks in the runtime entry.

    wf_start
    wf_status
    wf_transition
    wf_checkpoint
    wf_resume
    wf_architecture
    wf_impact
    wf_hypothesis
    wf_validation
    wf_plan
    wf_workunit
    wf_test
    wf_review
    wf_deliver
    wf_learn
    wf_eval
    wf_config
    wf_audit

Typical terminal workflow:

1. wf_start creates a task and records workspace/acceptance criteria.
2. wf_plan, wf_architecture, wf_impact, and wf_workunit record the engineering contract.
3. wf_test consumes host-attested command evidence; the command must match the registered validation item.
4. wf_review and wf_deliver close independent review and delivery gates.
5. wf_checkpoint and wf_resume preserve interruption recovery.

Persistent data is stored under DSH_HOME/wf/ (tasks, activity, lessons, evals, and deliveries). Sensitive values are redacted before audit/lesson persistence.

## dsh-mode... (line truncated to 2000 chars)
