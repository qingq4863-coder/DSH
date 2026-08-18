# 命令入口协议（§2.1）

本文件定义 12 个用户入口的语义与调用序列。agent 处理非平凡任务时按此协议走，**简单问答可短路但须说明原因**。

## start
- 时机：收到新任务。产出：task_id + 上下文（goal/验收标准/约束/假设）。
- 调用：`wf_start goal=… acceptance_criteria=[…] constraints=[…]` → 自动进入 INSPECT。
- 退出条件：goal 与 constraints 已持久化，next_action 指向侦察。

## understand
- 时机：INSPECT 阶段。只读：目录树、入口文件、依赖清单、测试、配置、git 历史变更。
- 产出：依赖清单、风险笔记、问题复述（确认「我理解的任务」）。
- 调用：侦察工具 + `wf_architecture` 固化组件/关系/入口/不变量/证据；对拟议变更用 `wf_impact` 追踪受影响目标、必需测试与 unknowns；再用 `wf_checkpoint next_action=… touched_files=[…]`。
- 疑难故障：每个候选根因用 `wf_hypothesis` 记录可证伪陈述、证据和下一实验，最终更新为 rejected/confirmed。
- 退出条件：侦察事实落盘；关键事实缺失 → `wf_transition to=CLARIFY`（≤3 个高信息量问题，§6）。

## plan
- 时机：INSPECT/CLARIFY 之后。产出：可审阅计划（§4.1 八问）。
- 调用：`wf_plan scope=… out_of_scope=… risks=[≤3] rollback=… how_to_prove_done=… verify_actions=[…] advance=true`。
- 退出条件：计划经用户审阅；未审阅的假设标为假设。

## research
- 时机：存在未决问题。优先级：仓库内实现 → 依赖官方文档(锁版本) → 官方示例/迁移/安全公告 → 高可信社区。保留来源（问题/查询词/来源/结论/版本/不确定性），不能只给链接列表（§4.2）。
- 调用：`wf_transition to=RESEARCH` → 网络/文档调研 → `wf_checkpoint` 记录带来源结论 → 回到 PLAN/BASELINE_EVAL。

## implement
- 时机：BASELINE_EVAL 后。以 ≤15 分钟可验证工作单元推进；每个单元单一主风险、明确文件范围、独立验证命令、done 条件（§4.1）。
- 调用：`wf_workunit action=add title=… risk=… file_scope=[…] verify_command=… done_criteria=…` → 编辑 → `wf_workunit action=complete … evidence=…`。
- 纪律：不顺手重构无关区域；不可逆动作先 dry-run（§4.3）。

## test
- 时机：单元完成。产出：命令 + 结果 + 证据路径（§1.3 证据原则）。
- 调用：先用 `wf_validation` 建立 targeted/contract/integration/regression/platform/performance 矩阵，再执行 `wf_test command=pytest outcome=pass|fail artifacts=[…] advance=true`；完全相同的 command 会自动回填矩阵项。
- 未安装工具时给出不改变系统的替代检查并说明降级的保障（§5.2）。

## review
- 时机：VERIFY 通过后。至少两个独立审查通道（§2.3），覆盖 §5.3 七类问题；发现按 blocker/high/medium/low。
- 调用：宿主 subagent 双轨派发 → `wf_review findings=[{severity,area,description},…] acknowledge_medium=… advance=true`。
- 退出条件：无 blocker/high，medium 已用户知情；否则 → REPAIR。

## repair
- 时机：测试失败/审查发现。纪律：先分类失败（`wf_test outcome=fail` 的提示），保存最小复现+摘要+diff，禁止盲目重试（§6 反复失败 ≥2 次回退诊断）。
- 调用：`wf_transition to=REPAIR` → 修复 → `wf_test` → `wf_transition to=VERIFY`（或 REPAIR→IMPLEMENT 重做单元）。

## ship
- 时机：全门禁通过（verifyPassed && 无 blocker/high && medium 已处理 && 独立审查完成 && 影响分析/故障假设/必需验证矩阵已收敛）。
- 调用：`wf_deliver` → 交付摘要落盘 `~/.dsh/wf/deliveries/<task>.md`。
- 纪律：默认不推送；远程操作属 L3/L4 需宿主批准。输出必须区分已验证事实/推断/假设（§1.3）。

## resume
- 时机：中断后。`wf_resume [task_id]` → 返回 phase/next_action/触碰文件/审计尾部；从 next_action 继续，绝不从头猜（§3.2）。

## status
- 时机：随时。`wf_status [task_id]` → 阶段/门禁/阻塞点/已完成/测试/成本/待批准/下一步。

## learn
- 时机：交付后（DELIVERY→LEARN→DONE）。只提炼可复用规律，不存秘密与一次性噪声（§3.3）。
- 调用：`wf_learn lesson=… category=… advance=true`（自动去重+去敏）。