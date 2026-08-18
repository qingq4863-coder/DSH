# 架构（面向维护者）

## 模块分层

```text
lib/
├─ state-machine.js   状态机图（PHASES/STATE_DEFS/TRANSITIONS/SUCCESS_NEXT）
│                     + 失败分类表（classifyFailure）+ 迭代预算（budgetExceeded）
├─ redact.js          去敏（9 类模式：私钥/github/openai/aws/jwt/bearer/赋值/env 行/URI 凭据）
├─ store.js           Store 类：checkpoint 原子写（tmp+rename）、active 指针、
│                     activity.jsonl 审计（写前去敏）、lessons.jsonl（去重+去敏）、交付/eval 落盘
├─ project-intelligence.js  架构地图/影响分析/假设账本/验证矩阵纯逻辑与 readiness
├─ engine.js          纯决策函数：workunit/plan/test/review 门禁、advancePhase、
│                     computeGate、buildDelivery（§12 结构）
├─ evals.js           30 个机器判定场景（与 wf_eval 同源）
└─ index.js           插件入口：18 个 wf_* 工具注册 + llm/stream 成本钩子
```

依赖方向：`index.js → engine/project-intelligence/store/evals → state-machine/redact`；engine/store 互不依赖。所有模块零运行时依赖（仅 node:fs/os/path/crypto）。

## 状态机

- 14 个阶段（含 DONE/BLOCKED），每个阶段有 inputs/outputs/entry/exit/failure（`STATE_DEFS`）。
- 转移是显式边集（`TRANSITIONS`），`wf_transition` 强制校验；**VERIFY 不能直达 DELIVERY**——必须先 `INDEPENDENT_REVIEW`（双审查门禁，§2.3/§5.3）。
- `advancePhase` 是成功路径便利器（`SUCCESS_NEXT`），仅在边合法且门禁满足时移动：
  - VERIFY→INDEPENDENT_REVIEW 要求 `verify.passed && open_failures===0`
  - INDEPENDENT_REVIEW→DELIVERY 要求无 blocker/high 且 medium 已确认

## Checkpoint 数据模型（§3.2）

```json
{
  "task_id": "task-…", "goal": "", "phase": "INSPECT",
  "acceptance_criteria": [], "constraints": [], "touched_files": [],
  "work_units": [{"id":"wu-1","title":"","risk":"","inputs":"","file_scope":[],
                  "verify_command":"","done_criteria":"","status":"pending|done|needs-attention","evidence":""}],
  "commands_run": [], "test_results": [{"command":"","outcome":"pass|fail","summary":"","artifacts":[],"ts":""}],
  "review_findings": [{"severity":"blocker|high|medium|low","area":"","description":"","reviewer":"","ts":""}],
  "pending_approvals": [], "assumptions": [], "risks": [],
  "architecture_map": {"components":[],"relations":[],"entry_points":[],"invariants":[],"evidence":[]},
  "impact_analyses": [], "hypotheses": [], "validation_matrix": [],
  "plan": {"scope":"","out_of_scope":"","risks":[],"rollback":"","verify_actions":[],"how_to_prove_done":""},
  "verify": {"passed":false,"open_failures":0,"last_run":null},
  "next_action": "", "cost": {"model":"","tokens_estimated":0,"streams":0,"retries":0,"elapsed_seconds":0},
  "workspace": "", "created_at": "", "updated_at": "", "version": 1
}
```

每次变更工具都会 `commit()`：改 `updated_at` → 原子保存 → 审计追加。因此任何时刻 `wf_resume` 都能从最近安全边界继续。

## 门禁（computeGate）

`canShip = verifyPassed && !blockers && mediumHandled && reviewDone && project.ready`。`reviewDone` 要求任务处于审查/交付阶段且至少执行过一次 `wf_review`；每次新审查替换当前 findings，旧轮次进入 `review_history`，因此修复后重审可解除历史 blocker，medium ack 只对当前轮有效。`project.ready` 要求所有影响分析为 complete 且无 unknowns、所有假设为 rejected/confirmed、所有 required 验证矩阵项为 pass；四项能力均未启用的旧任务默认 ready。

`verifyPassed = verify.passed && open_failures===0`；引擎按 command 分组取各自最新结果，任一命令的最新结果为 fail 都保持门禁关闭，直到同一命令通过。手工 `wf_transition` 在 VERIFY→INDEPENDENT_REVIEW 以及任何目标为 DELIVERY 的路径上复用相同业务门禁；`advancePhase` 进入 DELIVERY 时也要求 `gate.canShip`，不能通过 BLOCKED 恢复边或 `wf_test advance=true` 绕过。

## 失败恢复（§6）

- `wf_test outcome=fail` 会调 `classifyFailure` 输出策略：test→存复现再修 / transient→退避 / permission→dry-run+批准 / recurring（repeats≥2）→回退诊断 / 其余→unrecoverable 兜底。
- `budgetExceeded` 提供迭代/token/墙钟/外部调用四维预算，达到即停（工具调用方应据此自限）。

## 扩展点

1. 新增工具：`registerTool({name, description, parameters, execute})`（spec→JSON Schema 自动编译）。
2. 新增状态/边：改 `state-machine.js` 的 `PHASES/STATE_DEFS/TRANSITIONS/SUCCESS_NEXT`——eval `sm-*` 场景会自动覆盖边集一致性。
3. 新增去敏模式：`redact.js` 的 `PATTERNS`（支持 `placeholder` 回调）。
4. 新增 eval 场景：`evals.js` 加一个 `scenario(...)`；`wf_eval`/`run_eval.mjs`/`tests/evals.test.mjs` 全链路自动包含。
5. UI 面板：数据全部可读（tasks/*.json、activity.jsonl），hybrid 形态叠加只读面板即可。

## 宿主集成

- `inject: ['tools', 'llm']`；`ctx.tools.register` 经 `ctx.effect` 包装（dispose 自动清理）。
- `llm/stream`（`{global:true}`）对每个流做字符计数，流结束把估算 token/streams/retries 累加进 active 任务 cost——尽力而为，任何异常都不影响对话。
