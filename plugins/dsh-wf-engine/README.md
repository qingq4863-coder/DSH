# dsh-wf-engine — 编程 Agent 工作流引擎（DSH 插件）

把《强大编程Agent插件制作指令.md》的规格移植到 DSH（DeepSeek Harness）宿主平面的**零依赖工具包插件**：任务状态机、checkpoint/resume、项目架构地图、变更影响分析、故障假设账本、验证矩阵、角色化审查门禁、eval 质量门禁、失败分类恢复、去敏审计与成本记录。目标是让宿主 agent（也就是「我」）在处理非平凡编程任务时**稳定地理解代码库 → 提出可验证计划 → 最小正确修改 → 测试与独立审查发现 → 可审计交付**，中断后可恢复。

- 形态：toolkit（18 个 `wf_*` 工具 + 1 个 `llm/stream` 成本钩子）
- 存储：`~/.dsh/wf/`（可用 `DSH_WF_ROOT` 或 `wf_config root=` 覆盖）
- 运行：`inject: ['tools', 'llm']`，宿主平面，零运行时依赖

## 安装

```text
# 方式一（热装配 + 重启持久，推荐）：
dev_install_package dir=D:\develop\Deepseek Harness\plugins\dsh-wf-engine

# 方式二（仅运行时注入，不持久）：
dev_inject_plugin dir=D:\develop\Deepseek Harness\plugins\dsh-wf-engine

# 卸载（fiber dispose + 清 junction + patch disabled，免重启）：
dev_uninject_plugin match=dsh-wf-engine
```

安装后新会话（或重启 web 进程）的工具目录中出现 `wf_*` 工具即生效。构建与自检：`dev_build_plugin dir=...`；`node scripts/run_eval.mjs`（30 场景）；逐文件运行 `node tests/<name>.test.mjs`（37 单测）。

## 快速上手（一次非平凡任务的完整调用流）

```text
1. wf_start  goal=... acceptance_criteria=[...] constraints=[...]
      → 建任务、进入 INSPECT（只读侦察）
2. 只读侦察代码库（入口/依赖/测试/配置），记录风险
3. wf_architecture components=[...] relations=[...] entry_points=[...] invariants=[...] evidence=[...]
4. wf_impact change=... affected=[...] required_tests=[...] unknowns=[] status=complete
5. 疑难故障：wf_hypothesis statement=... next_experiment=...，用证据更新为 rejected/confirmed
6. wf_validation requirement=... command=... level=...（必需项由同命令 wf_test 自动回填）
7. wf_checkpoint  next_action="侦察完成：…"  touched_files=[...]
8. wf_plan  scope=... rollback=... how_to_prove_done=... advance=true   → PLAN
9. wf_transition to=RESEARCH reason=...  （有未决问题才需要）
10. wf_transition to=BASELINE_EVAL reason=...   → 记录基线（wf_test outcome=fail 的基线签名）
11. wf_transition to=IMPLEMENT reason=...
12. wf_workunit action=add title=... verify_command=... done_criteria=... risk=...
13. 实现 → wf_workunit action=complete title=... evidence=...
14. wf_test command=pytest outcome=pass advance=true   → 同步验证矩阵并尝试前进
15. wf_review findings=[{severity,area,description},…] acknowledge_medium=… advance=true
16. wf_deliver   → §12 交付摘要落盘（默认不推送）
17. wf_learn lesson=… advance=true   → LEARN→DONE
```

简单问答可短路（不建任务），但要在回复中说明短路原因（§2.2）。

## 命令入口（§2.1 语义 → 工具）

| 入口 | 工具 | 触发时机 |
|---|---|---|
| start | `wf_start` | 新任务建立上下文 |
| understand | `wf_checkpoint`（侦察事实）+ INSPECT 阶段行为 | 只读侦察、问题复述 |
| plan | `wf_plan` / `wf_transition to=PLAN` | 生成可审阅计划 |
| research | `wf_transition to=RESEARCH` + 网络/文档调研 | 未决问题带来源回答 |
| implement | `wf_workunit`（add/complete）+ 实际编辑 | 小步可验证单元 |
| test | `wf_test` | 定向/回归/静态检查，记录证据 |
| review | `wf_review` | 独立审查，严重度分级 |
| repair | `wf_test outcome=fail` → 失败分类 → `wf_transition to=REPAIR` | 证据支撑的修复 |
| ship | `wf_deliver` | 门禁通过后交付摘要 |
| resume | `wf_resume` | 中断后从 checkpoint 继续 |
| status | `wf_status` | 阶段/阻塞/门禁/成本/待批准 |
| learn | `wf_learn` | 提炼去重去敏教训 |

## Codex→DSH 能力映射（规格差异记录）

| Codex 插件层 | DSH 等价实现 | 差异说明 |
|---|---|---|
| `.codex-plugin/plugin.json` | `package.json` + `lib/index.js`（`name/inject/apply`） | DSH 无 manifest 校验器；装配经 cordis bundles |
| `commands/*.md` | `wf_*` 工具 + `docs/commands.md` | 语义保留；调用方从用户变为 agent |
| `hooks/*` | `ctx.on('llm/stream', …, {global:true})` | 成本记账钩子；宿主另有 sandbox/approval 平面 |
| `agents/*.md` | 宿主 `subagent`/`subagent_fork` 设施 + `wf_review` | 审查记录结构化落盘；角色提示词交给 agent |
| `skills/*` | `docs/` + 工具描述 | DSH skill 目录未启用时以工具语义承载 |
| `scripts/*` | `scripts/build.sh`、`scripts/run_eval.mjs` | 跨平台：`node` 在 PowerShell/Unix 均可跑 |
| `evals/` | `lib/evals.js` + `wf_eval` + `~/.dsh/wf/evals/*.json` | 进程内机器判定，无 fixture 仓库依赖 |
| checkpoint | `~/.dsh/wf/tasks/<id>.json`（原子写） | 语义相同，路径不同 |
| 记忆分级 | `lessons.jsonl`（去重+去敏）+ 宿主 mnemon | 项目/全局记忆建议交由宿主 mnemon 管理 |
| 可观测 | `activity.jsonl` + `wf_audit` + cost 字段 | 写入前自动去敏 |

## 工具清单

`wf_start` `wf_status` `wf_transition` `wf_checkpoint` `wf_resume` `wf_architecture` `wf_impact` `wf_hypothesis` `wf_validation` `wf_plan` `wf_workunit` `wf_test` `wf_review` `wf_deliver` `wf_learn` `wf_eval` `wf_config` `wf_audit`

## 安全边界（§1.2 / §7）

- 工作流工具只写 `~/.dsh/wf/` 自己的数据，不读 `.env`/密钥/凭据（去敏模块拦截写入）。
- 代码修改/命令执行仍由宿主 sandbox/approval 平面管辖——本插件不自行扩大权限。
- `wf_config dry_run=true`：全部写入只演算不落盘。
- 交付默认不推送远程；推送属 L3/L4，必须走宿主批准。

## 已知限制（未实现清单）

- 未做 UI 面板（hybrid 形态可后续叠加；数据都在 `~/.dsh/wf/` JSON 里，UI 只读即可）。
- 未自动触发：本插件是**工具驱动**，agent 需要按 `docs/commands.md` 主动调用（不注入 system prompt 改写）。
- 成本记账是字符估算（tokens ≈ chars/4），非精确 token 计量。
- 角色化「双独立审查」由 agent 用宿主 subagent 派发、用 `wf_review` 记录——插件保证记录与门禁，不保证派发本身。
- 许可证 MIT；最低运行时：DSH web（cordis ≥4.0.0-rc）。
