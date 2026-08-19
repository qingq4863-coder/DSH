# @dsh-external/dsh-matt-skills

把 Matt Pocock 的工程纪律适配为 DSH 原生 toolkit。插件只生成计划、路由和证据清单；不会伪造测试结果，也不会绕过 wf-engine 的状态机与宿主回执。

## 综合后的默认工程协议

从 mattpocock/skills 中吸收的核心不是某个特定命令，而是一组可迁移的不变量：先对齐需求，再查事实；问题先变红，再提出可证伪假设；实现采用最小垂直切片；TDD 保持红-绿-重构；审查分 Standards 与 Spec 两轴；文档采用单一事实源和渐进披露；研究引用一手来源；交付必须有宿主验证证据。

统一入口是 `matt_engineering_protocol`。它只生成协议计划，不伪造证据，也不直接修改 wf 状态。

## 能力目录

- matt_task_route：输出面向执行者的最小工程流说明。
- matt_route_plan：输出机器可读的 task、primary、auxiliary、execution、tools、workflow、calls 路由计划。workflow 表示顺序；calls 进一步提供 tool、stage、conditional 和 args，可绑定 seam 与精确 command。
  - calls 的不变量：先 `matt_acceptance_contract`，再 `matt_contract_wf_plan`，每个路线工具紧跟对应 `matt_wf_evidence_map`，所有 evidence map 复用同一条 command，最后是 `wf_review`。路线参数必须与契约 task/seam 一致；参数漂移返回 `call_errors`。
  - 无法分类的任务不生成空路线，而是使用唯一的 `matt_task_route(stage=clarify)`，并紧邻最终 `wf_review`；clarify 不得混入路线工具或 evidence map。
- matt_compose_flow：按顺序组合多个工程流。
- matt_diagnosis_loop：建立红色可复现的诊断闭环。
- matt_tdd_slice：规划 Red-Green-Refactor 垂直切片。
- matt_review_diff：独立执行 Standards/Spec 双轴审查。
- matt_acceptance_contract：把需求转为可观察验收契约。
- matt_contract_wf_plan：把契约映射为 wf 执行清单。
- matt_wf_evidence_map：把 TDD、诊断、审查映射到 wf_*。
- matt_research_brief：组织一手来源研究和引用。
- matt_disclosure_audit：审计提示词和文档的渐进披露。
- matt_context_pointer：生成单一事实源的上下文指针。
- matt_grilling_plan：围绕当前决策前沿逐分支澄清目标、约束、失败模式和验收。
- matt_domain_model：校准领域术语、生命周期、不变量和边界场景。
- matt_codebase_design：识别深模块和小接口，明确依赖、契约、测试 seam 与回滚边界。
- matt_architecture_survey：扫描架构深化机会，输出有证据、可选择、可回滚的候选，不自动重构。
- matt_to_spec：把已确认的对话事实和决策综合成可实施规格，不补造缺失需求。
- matt_to_tickets：把规格拆成垂直 tracer-bullet tickets，声明阻塞边、验收证明和回滚。
- matt_writing_for_agents：审计 agent-facing 文档的术语、触发器、指针、不变量和完成标准。
- matt_wayfinder：在目标不清或路径分叉时，找出当前最小决策和下一步事实。
- matt_wait_what：重写没有落地的沟通，明确受众、行动、决策、门禁和可观察回应。
- matt_triage_plan：生成 tracker-neutral 的问题分诊计划，明确影响、证据缺口、下一动作和升级门槛；不写外部 tracker。
- matt_grill_with_docs：基于权威文档的约束生成逐分支决策访谈计划，避免重复询问已知事实。
- matt_prototype_plan：规划有时间盒、学习问题、观测信号和 go/stop/rework 门禁的 bounded prototype；不创建 UI 或部署产物。
- matt_merge_conflict_plan：按共同祖先、hunk 意图、不变量、聚焦测试和回滚点规划冲突处理；不执行 git merge/rebase。
- matt_upstream_inventory：固定上游 tree SHA，建立逐文件吸收矩阵，区分已吸收、部分吸收、有意排除和待审查。
- matt_upstream_sync_plan：比较 pinned refs，生成可审查的上游同步计划；不自动吸收 moving branch。
- matt_install_lifecycle_plan：规划安装、升级、回滚、热重载、GUI 刷新和 Web/headless 冷启动门禁。
- matt_external_operation_plan：规划 GitHub/Linear 等外部操作的授权、预览、幂等键、receipt、回读和补偿；不直接调用外部系统。

## 推荐执行顺序

普通工程任务：先调用 matt_task_route；按主路线调用具体工具；需要持久证据时调用 matt_acceptance_contract 和 matt_contract_wf_plan；最后用正式 wf_workunit、wf_validation、wf_test、wf_review 工具落地。

混合任务：路由会区分 Primary flows 与 Auxiliary flows。先完成主路线；辅助路线只在主路线需要它的额外事实时调用。例如 API 故障修复的主路线是 diagnosis + tdd；只有明确要求查官方文档、一手来源或引用时，research 才作为辅助路线随后执行。

故障任务：先让症状变红；最小化输入；提出可证伪假设；每次验证一个假设；修复前补回归测试；修复后使用同一个精确命令复验；通过 wf_test 消费宿主真实回执。

GUI 任务：必须观察真实刷新后的页面行为。后端文件列表、插件 active 或 API 200 不能替代 UI 证据。持久安装还必须做一次冷启动。

## wf-engine 证据约束

本插件不直接写入 wf-engine 内部存储。契约计划只生成以下执行顺序：

1. wf_workunit add
2. wf_validation
3. 精确验证命令的红/绿执行
4. wf_test 消费同一命令的宿主回执
5. wf_review 独立审查

验证命令必须保持字节级一致。不能用相近命令替代，也不能由模型自报 PASS 取代宿主证据。

## Web 与 headless 持久装配

插件是纯 toolkit：只依赖 tools，不依赖 Web UI、webServer 或 workspaceRegistry，可安装到 Web 和 headless profile。package.json 声明 dsh.bundle.patch，cordis.patch.yml 提供 bundle loader entry。

推荐顺序：dev_build_plugin；dev_install_package 到 web；dev_install_package 到 headless；用 dsh --profile headless 做冷启动；用 dsh --profile web --help 验证 Web profile 组合。冷启动需要宿主能写入 profile 下的 cordis.yml；sandbox 拒绝时只针对该命令升级权限，不要绕过结果。

## 设计边界

- 工具输出是工程执行建议和字段映射，不是测试证据。
- 不自动修改用户代码、wf 状态或项目文档。
- 不把 Claude Code 专用安装机制直接复制到 DSH。
- 工具面保持短 schema；详细规则放在结果和本 README。
- 新能力优先复用 wf-engine、sp_* 和现有 DSH 工具，不重复造状态机。

## 构建与回归

构建命令：DSH_CHECKOUT=<checkout> bash scripts/build.sh

唯一的本地回归命令：npm test。它覆盖双语任务路由、统一协议与验收/wf 文本契约、真实工具注册、五类路线、README 目录，以及持久 bundle manifest。

DSH 运行时回归至少覆盖 matt_task_route、matt_acceptance_contract、matt_contract_wf_plan、matt_wf_evidence_map、Web 热重载 active fiber，以及持久安装后的 headless/Web 冷启动边界。
