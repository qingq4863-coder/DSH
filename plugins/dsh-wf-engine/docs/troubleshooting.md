# 故障排查

## 工具没有出现在目录里

- 注入后需**新会话**或重启 DSH web 进程才装配（bundle 在启动时装配；dev_install_package 的 loader.create 对当前会话立即生效，但工具 schema 缓存到下一次请求）。
- 检查装配状态：`dev_plugin_status` 应看到 `wf-engine` fiber active。
- 检查插件目录路径**不含空格**（Windows 装配限制）。

## `node --test` / `npm test` 报 spawn EPERM

- 是 PowerShell 沙箱对「子进程 pipe 捕获」的边界（Node test runner 会 spawn 子进程）。
- 对策：在沙箱内逐文件直跑 `node tests/xxx.test.mjs`，或经 `dev_build_plugin` 在宿主进程内跑 build.sh（host 无此限制），或在沙箱外跑 `npm test`。

## 找不到 active 任务 / 想恢复旧任务

- `wf_status`（不传参）列出全部任务（按 updated_at 排序）；`wf_resume task_id=…` 显式恢复。
- active 指针在 `~/.dsh/wf/active.json`；误删后任务 JSON 仍在 `tasks/` 里。

## 状态转移被拒

- 检查 `wf_status` 输出的「可转移」清单；尤其 VERIFY→DELIVERY 必须绕道 INDEPENDENT_REVIEW（设计如此）。
- BLOCKED 只能走受控恢复边（用户决策后 resume）。

## 交付被门禁拦截

- 按 `wf_deliver` 返回的缺口清单逐项处理：验证未过→跑测试记 pass；有 blocker/high→REPAIR；medium 未确认→acknowledge_medium=true（须已向用户知情）。

## dry-run 忘关

- `wf_config` 查看 `dry_run`；`wf_config dry_run=false` 恢复写入。（dry-run 期间所有工具只演算不落盘。）

## 存储根被改 / 数据去哪了

- 默认 `~/.dsh/wf`（`DSH_HOME` 优先）；架构文档的 `defaultRoot()` 决定了所有路径；`wf_config root=…` 可切换（保存的旧文件不会迁移）。

## 成本/审计没有更新

- 成本估算依赖 `llm/stream` 钩子，仅在有 active 任务且流产生 text/reasoning delta 时记账；retries 只在 finish 为 error 时 +1。审计按任务过滤需 task_id 精确匹配。