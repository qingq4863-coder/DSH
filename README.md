# DSH Plugins

本仓库保存 DeepSeek Harness 插件源码，按终端 TUI/headless 兼容性整理。

## Included

- plugins/dsh-mode-boost: model routing and effort behavior. Terminal-compatible host bundle.
- plugins/dsh-wf-engine: engineering workflow engine with wf_* tools, checkpoints, validation evidence, review gates, delivery, audit, and evals. Terminal-compatible host bundle.
- plugins/dsh-context-doctor: context injection audit and context_audit tool. The package is distributed separately and is included here for the current local integration reference.

Web-only plugins and Web-service-dependent plugins are intentionally excluded from terminal use. See docs/dsh-plugins-for-tui.md for the compatibility boundary and API notes.

## Install

Use the package directory as a local DSH bundle source, or install the published package into a profile that provides the required DSH host peers. For the current terminal setup, use the headless profile and verify a fresh process after installation:

    dsh --profile headless "run a small task"

Do not commit credentials, API keys, tokens, local profile state, node_modules, or generated tgz files.

## Verification

- dsh-mode-boost: 29 tests passed.
- dsh-wf-engine: all 8 test files passed in the original dependency-complete development checkout. The publication tree intentionally excludes node_modules; run npm install before testing from the published source.
