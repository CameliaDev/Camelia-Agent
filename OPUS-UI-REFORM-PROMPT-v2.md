Camelia-Agent · Claude Opus 一刀流任务书 v2（已消歧 + 已对齐真实代码）
UI 重构（wireframe v3+）+ 长程《计划设计书》
============================================================
用途：整份复制粘贴给 Claude Opus / 顶级 coding UI agent，一次跑完。
范围：只做 UI（packages/ui + 必要时 desktop 壳 chrome）与「给其他 AI 的计划设计书」。
禁止：后端 / engine / harness / agent / cli 实现代码。
生成：2026-10-12（Asia/Shanghai）· v2 已修正 v1 的 6 处与真实代码冲突的契约命名。
============================================================

你是 Claude Opus（或同等顶级 UI/产品 coding agent）。你在本机仓库工作：

C:\Users\37963\Desktop\Camelia-Agent

技术栈：pnpm monorepo + Turborepo + Tauri 2 桌面壳。Windows；PowerShell 用 ; 不用 &&。

本次任务是一刀流（one-shot）：读完本文件即可开工，尽量少翻源码。
§2 是「已核对源码的地面真相」，v1 里凡是与 §2 冲突的写法，一律以 §2 为准。
你交付两样东西后即可结束：

1. UI 全面改革落地（wireframe v3，前端可运行、可截图验收）
2. 长程《计划设计书》（给更便宜模型后续实现后端/引擎/里程碑用）

============================================================
0. 硬约束（违反即失败）
============================================================

0.1 只做 UI

| 允许 | 禁止 |
| --- | --- |
| 改 packages/ui/**（组件、状态 chrome、i18n、样式） | 改 packages/agent / harness / core / cli 的业务实现 |
| 必要时改 apps/desktop 的窗口 chrome / 标题 / 拖拽区（纯壳） | 重写引擎 spawn、SSE server、AgentLoop、SQLite、provider 调用 |
| 新增 UI 侧 mock/fixture 场景以演示「计划 / 数模」进度（必须角标「演示」） | 把 fixture 改成「假装 live 成功」 |
| 在《计划设计书》里写 API / SSE 契约 / 接口草稿 / 验收清单 | 在本任务里实现这些后端接口 |
| 输出品牌候选列表 + 推荐过渡方案 | 擅自拍板最终品牌名并写死进产品 |

分层宪法（不可破）：

```
packages/ui  →  packages/agent  →  packages/harness  →  packages/core
apps/desktop (Tauri)  --spawn-->  packages/cli serve (HTTP/SSE)
```

UI 经 SseTransport | FixtureTransport 连引擎；UI 从不直接碰 SQLite。

0.2 一刀流信息充足

§2 已列出所有你需要的真实标识符（事件名、命令名、接口字段、文件路径）。
你默认信任本文件；只有实现细节（具体 className、现有 hook 签名）才读对应文件。不要做全仓考古。

0.3 必须产出的两件套

(a) Full UI reform（前端落地）——见 §5
(b) 《计划设计书》——见 §8，路径 `docs/UI-REFORM-PLAN-BOOK.md`

0.4 绝对禁止

- 重写 engine / harness / AgentLoop / SqliteSessionStore。
- Fake live success（fixture 假装调用了 Ollama/阿里云）。
- 发明最终品牌名且不给候选列表。
- 扩大后端代码范围「顺便修一点 ABI / provider」。
- 引入 Electron、换状态库大爆炸、把右轨改回默认展开。
- 删除诚实干预（c2127fa）行为：引擎 stub 的动作必须禁用并显示真实错误。
- **新建已存在的事件名或命令名**（见 §2.4 冲突表——这是 v1 的最大错误）。

============================================================
1. 产品北星与本次定位（已锁定）
============================================================

对外北星（选项 A）：弱模型可靠性桌面 Agent —— 面向本地/免费/中等模型，用架构（验证、回滚、事件、记忆）把任务做成。

默认体验包装：B（Ollama-first 本地）+ D（中国区双引擎：阿里云 + Ollama）。
UI 叙事：C（可观测可干预的任务操作系统）。

本次 Opus 聚焦：把 UI 从「能聊的壳」升级为 多模式任务工作台，并特别把 数模（数学建模）做成一等公民模式；同时产出长程计划书，让后端接线留给便宜模型。

成功指标（UI 侧可演示）：

- 顶栏一眼看出：品牌、当前模式、任务进度、Live/Offline。
- 三种模式切换有明确视觉与信息架构差异，而不是只改一个 label。
- 数模模式能展示：假设 / 变量 / 方程 / 求解状态 / 结果卡片 + 阶段进度。
- fixture/demo 场景能完整演示进度条与数模卡片（角标「演示」）；live 时进度绑定真实事件。

============================================================
2. 地面真相（已逐条核对源码，2026-10-12）
============================================================
本节的每一条都已在仓库里验证过。v1 提示词的错误对照见 §2.4。

2.1 仓库与分层

| 包 | 职责 |
| --- | --- |
| apps/desktop | Tauri 壳；spawn camelia serve；注入 `__CAMELIA_BOOT__` |
| packages/ui | React UI；Zustand store；Sse/Fixture transport |
| packages/agent | CameliaRuntime、投影（ProjectionSnapshot）、配置、记忆查询 |
| packages/harness | AgentLoop、工具、校验 |
| packages/cli | serve / run / doctor；EngineServer 处理命令 |
| packages/core | 事件、命令类型、SQLite 抽象 |

2.2 近期提交（后端/壳已做完，UI 任务不要重做）

| SHA | 含义 |
| --- | --- |
| 5762b47 | fix(desktop): harden Node 22 spawn + docs ABI/offline audit |
| 2c20208 | fix(desktop): prefer Node 22 for engine spawn（M0 ABI） |
| c1e561a | feat(math): math.exec tool + modeling preset + model library |
| 8bab744 | memory critique 跨会话 |
| 64ce1fb | session hot-swap + 中文错误 + step score events |
| d597049 | 右轨 tab 分离 + degrade-readonly |
| 51e7678 / e2af4c4 | wireframe v2 UI + IA |
| b0b69e8 | settings 日志 / about / 中文预设 |
| d89c11a | checkpoint timeline + 可过滤事件审计 |
| c2127fa | honest intervene |
| f5592c3 | prefs v4 每次启动强制折叠右轨 |
| 3560f90 | connection presets → config.json providers[] |

2.3 关键真实接口（照抄，不要臆造）

**TaskStatus**（packages/core/src/types/domain.ts:10）
```
'received' | 'clarifying' | 'planning' | 'awaiting-approval' | 'executing'
| 'verifying' | 'delivering' | 'reflecting' | 'paused' | 'done' | 'failed' | 'cancelled'
```
注意：`awaiting-approval` **已存在**，不要另造 `awaiting_approval` 状态名。

**TaskPhase**（domain.ts:31）
```
'idle' | 'planning' | 'awaiting-approval' | 'executing' | 'verifying' | 'delivering' | 'paused'
```

**StepStatus**（domain.ts:33）
```
'pending' | 'running' | 'verifying' | 'done' | 'failed' | 'skipped'
```

**StepView**（packages/agent/src/view/snapshot.ts:43）
```
{ id, idx, title, goal, status, weight, acceptance[{description,kind,path?}],
  deps?, startedAt?, endedAt?, verdict?{status,reason}, error? }
```

**TaskView**（snapshot.ts:187）——你几乎只需要这几个字段：
```
{ id, sessionId, intentRaw, goal?, assumptions[], constraints[], status, phase,
  progress (0..1 加权), currentStepIdx, stepsTotal, steps: StepView[],
  toolCalls, context, subAgents, failures, approvals, notices, narration,
  checkpoints, artifacts, summary?, pausedReason?, interventions[],
  activity: {kind, detail, since}, routing?, startedAt, updatedAt }
```

**ProviderCapabilities**（domain.ts:336）——**注意形状与 v1 提示词假设的不同**：
```
{ supportsTools, textToolCalls?, supportsJson, supportsStreaming, maxContextWindow, quality }
```
这里没有 rollback / intervene / mathModeling 之类的 UI 能力位。见 §5.7 与 §7.4。

**现有 UI 能力门控**（packages/ui/src/window/capabilities.ts）——已有的诚实模式，请扩展而不是新造：
```
type InterveneCapability = 'rollback_step' | 'select_provider' | 'intervene_goal'
const LIVE_UNAVAILABLE = {
  rollback_step:    'rollback is not available from the live engine yet',
  select_provider:  'provider switching mid-session is not available yet',
  intervene_goal:   '',
}
isLiveEngine() / canIntervene(cap) / interveneUnavailableReason(cap)
```

**数模后端真实形态**（packages/harness/src/tools/builtin/math-tools.ts）
- 工具名 `math.exec`；参数 `{ code, name?, timeoutMs? }`
- 实现：把代码写入 `.camelia/math/<slug>.py`，`ctx.shell.exec('python <file>')`，Agg 后端
- 返回：`{ script, code, stdout, stderr, figurePaths[], timedOut }`
- 求解器 = **Python + sympy/numpy/scipy/matplotlib**，不是专用 solver。

**数模真实 pipeline**（packages/harness/src/prompts/math-modeling.ts）
```
1 问题重述 → 2 模型假设 → 3 变量与符号 → 4 建立模型 → 5 求解（必须 math.exec）
→ 6 校验 → 7 灵敏度 → 8 报告
```
以及探测器 `looksLikeMathModeling(task: string): boolean`（关键词命中：建模 / 数学模型 / 优化 / 求解 / 微分方程 / 线性规划 / 灵敏度 / optimize / sensitivity …）。

**❗ 重要**：v1 提示词说的「四阶段：建模→求解→校验→报告」**与后端真实 pipeline 不一致**，照 v1 做会导致进度条永远对不上引擎。v3 的 UI 阶段必须是真实 pipeline 的**压缩视图**，见 §5.5。

2.4 v1 提示词的错误对照表（已修正，务必按「正确做法」列）

| v1 的写法 | 真实情况 | 正确做法 |
| --- | --- | --- |
| 新建 SSE 事件 `task.progress {taskId,current,total,label,status}` | **已存在**：`'task.progress': { progress: number; currentStepIdx: number; totalSteps: number }`（events.ts:66），AgentLoop.ts:876 已 emit，snapshot.ts:683 已 fold | **不要新建**。UI 侧直接消费。若要补「阶段标签」只在计划书里提议加 **可选** `label?: string`，且必须向后兼容 |
| 新建 `plan.drafted` | **已存在** `plan.ready { plan }`（events.ts:76），Planner 三处 emit | 用 `plan.ready` |
| 新建 `plan.awaiting_approval` | 已有 `task.status_changed → 'awaiting-approval'`；TaskPhase 也有该值 | 用现有 status/phase |
| 新建 `plan.approved` / `plan.rejected` | 审批是命令驱动（`approve_plan` / `reject_plan`），状态经 `task.status_changed` 回流 | 从 status 派生，不新建事件 |
| 「M-ENG-2：plan approval 真路径」当作未实现 | **引擎已实现**：EngineServer.ts:329-341 已处理 `approve_plan`/`reject_plan`/`edit_plan`/`set_plan_approval`；AgentLoop.ts:214 有 plan gate | 该里程碑实为 **UI 侧**工作：把 PlanReview 提升为模式工作区 |
| 新建能力位 `supports: { rollback, intervene, selectProvider, memory, planApproval, mathModeling, progressEvents }` | 现有 `ProviderCapabilities` 形状完全不同；UI 侧已有 `window/capabilities.ts` 门控模式 | 不塞进 ProviderCapabilities。写进计划书作为**新**的 `ui.capabilities` 事件提案，并说明与现有门控的迁移路径 |
| 数模阶段「建模→求解→校验→报告」四段 | 后端 8 步 pipeline（重述/假设/变量/建模/求解/校验/灵敏度/报告） | UI 用 4 段**压缩视图**，每段显式映射到后端步骤号（§5.5） |
| 新建 `scene: 'plan-demo'` | `SceneId` 已有 `'plan'` 场景 | `plan` 复用；只新增 `'math-demo'` |
| 顶栏进度条 | TopBar 是 **overlay 且可整体隐藏**（`localPrefs.topBar: 'auto'\|'pinned'\|'hidden'`，App.tsx 用 `paddingTop: 36` 让位） | 进度条放顶栏会随顶栏隐藏而消失。必须实现 §5.3 的「运行中强制常显」策略 |
| 保留 v2 的 wireframe 注解类 | `.wf-dash-brand`（橙色虚线品牌胶囊，字面写着「名称与吉祥物 TBD」）、`.wf-orange-tag`（「按需滑出」）是**线框脚手架**，正是「顶栏空/刺眼」的来源之一 | v3 移除 `.wf-*` 注解类（`wf-avatar-*` / `wf-bubble-*` / `wf-step-circle` 等真实样式类可保留） |

2.5 用户痛点（本次 UI 要直接解决）

当前 chrome 观感「空」：左侧品牌占位 + 会话标题，右侧 Offline，中间大片留白。没有模式、没有进度、没有任务感。
你必须把顶栏区域重设计为信息密度合理、不拥挤、中文友好的 品牌 + 模式 Tabs + 进度条 + 连接 组合，并清掉线框脚手架残留。

2.6 路径速查

| 用途 | 路径 |
| --- | --- |
| 仓库 | C:\Users\37963\Desktop\Camelia-Agent |
| UI | packages/ui |
| 桌面壳 | apps/desktop/src-tauri/src/main.rs |
| 用户配置 | %USERPROFILE%\.camelia\（config.json / keys.json / desktop.json / logs/engine.log） |
| 事件与命令定义 | packages/core/src/types/events.ts |
| 投影 | packages/agent/src/view/snapshot.ts |
| 命令处理 | packages/cli/src/server/EngineServer.ts |
| 数模工具 | packages/harness/src/tools/builtin/math-tools.ts |
| 数模预设 | packages/harness/src/prompts/math-modeling.ts |
| 产品方向书 | docs/CAMELIA-ROADMAP.md（M0–M8） |

2.7 工程卫生（顺手记进计划书，但本任务不改）

- 仓库根目录有 **23 个 `.tmp-*` 文件已被 commit**（`.tmp-fix-*.mjs`、`.tmp-patch-*.mjs`、`.tmp-desktop-probe.png`、`.tmp-serve/…` 等）。`.gitignore` 只忽略 `*.log`，不忽略 `.tmp-*`。建议在计划书 §风险 里列为清理项。
- **`git status` 显示的 docs/ 与 `.tmp-*` 的 `M` 状态是纯 CRLF 行尾churn，无任何内容差异**（`git diff --ignore-cr-at-eol` 为空）。不要花时间「还原」它们，也不要提交这些行尾变化——那会污染本次 UI 提交的 diff。建议在计划书里提议补一个 `.gitattributes`（`* text=auto eol=lf`）一劳永逸。
- `AGENTS.md` 顶部的 turborepo 块是**由 turbo 自动写入并维护**的，不要手改。
- `.node-version` 与 `.nvmrc` 均为 `22`，已对齐。小瑕疵：`.node-version` 实际字节是 `22\n\r\n`（多一个 LF + CRLF 混用），nvm/fnm 能正常解析，但建议顺手规范成单行 `22\n`。

============================================================
3. 已锁定的 Wireframe v2 决策（v3 必须继承，只能进化）
============================================================

3.1 布局骨架（不可推翻）

```
┌─ TopBar（品牌 | 模式 Tabs | 进度 | 连接 | 窗控）─────────────┐
│ Left SessionRail │ Center（Activity / 模式工作区 / Composer）│ [Right Data Rail 默认折叠] │
│  会话列表         │                                            │  记忆/事件/运行/上下文/子代理 │
│  左下 → Settings │                                            │  边缘「数据详情」拉手        │
└──────────────────┴────────────────────────────────────────────┴────────────────────────────┘
```

3.2 锁定点

- 左会话轨保留；今天/更早分组可保留或微调。
- **右数据轨每次冷启动默认折叠**（`localPrefs.ts:157 loadLocalPrefs` 强制 `rightCollapsed: true, userSetRightRail: false`）；仅会话内用户展开。**prefs v4 逻辑不得回退**。
- `LOCAL_PREFS_VERSION = 4`。你新增 `preferredMode` / `showAvatars` 时**必须**走 `sanitizeLocalPrefs` 的白名单 + 默认值，不要降低/绕过 version 逻辑。
- Settings = 多分区整页/大抽屉，从左下进入，不是右上小面板。分区至少：连接预设 / 语言与外观 / 引擎与日志 / 关于。
- 微信式圆形头像（用户右对齐、代理左对齐）；「消息头像」开关在「语言与外观」，默认开。
- 连接预设 = CC Switch 风格卡片，进设置，不进主铬；主铬只留引擎状态摘要。
- 品牌未锁死：顶栏 / 空态 / 关于三处同一占位语言；输出候选，不发明最终名。

3.3 v2 → v3 必须新增（本次核心）

| 区域 | v2 | v3（你要做） |
| --- | --- | --- |
| TopBar | 品牌占位 + 会话名 + Offline | + 模式选择器 + 进度条；清掉 `.wf-*` 注解；消灭「空顶栏」 |
| Center | 通用对话 + ActivityBar 步骤圆点 | 按模式切换：对话 / 计划 / 数模 三套工作区 |
| ActivityBar | 任务标题 + 步数 + 暂停/引导/取消 | 与顶栏进度条数据同源（单源派生）；避免重复吵闹 |
| 数模 | 几乎无产品入口（后端有 math.exec 苗头） | 一等模式工作区 |
| 扩展性 | 无 | 模式注册表：后续可加「评测 / 教学」等而不改壳 |

============================================================
4. packages/ui 文件地图（优先改这些）
============================================================
（已与实际 `find packages/ui/src -type f` 输出核对）

4.1 入口与壳

| 文件 | 角色 | 本次预期 |
| --- | --- | --- |
| src/App.tsx | 总布局（3 列 grid + TopBar overlay + `paddingTop`） | 接入 ModeShell；按模式渲染中区；处理顶栏常显策略 |
| src/main.tsx | 启动 | 通常不动 |
| src/index.css | 全局样式 / `wf-*` 线框类 | 新增进度条、模式 tab、数模卡片 token；标注并移除注解类 |
| src/components/TopBar.tsx | 主战场（现为 overlay，`revealed` 驱动显隐） | 重设计：品牌、ModeTabs、Progress、连接、窗控 |
| src/components/ActivityBar.tsx | 任务条（`task` + onPause/onResume/onCancel/onIntervene） | 与顶栏进度同源；计划/数模时显示阶段 |
| src/components/SessionRail.tsx | 左轨 | 可标模式徽章（会话上次模式） |
| src/components/Conversation.tsx | 对话气泡 | 保留头像；数模结果卡可插入时间线 |
| src/components/Composer.tsx | 输入（现 placeholder「描述一个任务…」） | 模式相关 placeholder / 快捷芯片 |
| src/components/RightRail.tsx | 右轨（现 5 tab） | 见 §5.6 数模 tab 决策 |
| src/components/SettingsDrawer.tsx | 设置壳 | 可加「模式默认值」小节 |
| src/components/ConnectionsSection.tsx | 连接预设 | 原则上不动逻辑 |
| src/components/PlanReview.tsx | 计划审阅（`task: TaskView`，发 `edit_plan` 命令） | 计划模式强化复用 |
| src/components/StepCard.tsx / ToolCard.tsx / MemoryPanel.tsx / Reliability.tsx / EngineBanner.tsx / IconSheet.tsx / CodeBlock.tsx / WindowEdges.tsx / RailDivider.tsx / primitives.tsx | 既有 | 按需接入；EngineBanner 保持诚实 Offline/错误 |
| src/state/store.ts | UI store（宪法：不发明业务投影） | 可加 frontend-only mode slice；不发明业务投影 |
| src/state/local-prefs.ts | 窗口偏好（v4） | 可持久化 preferredMode、头像开关；**勿破坏 v4 右轨折叠** |
| src/state/UiProvider.tsx | Context | 接 mode |
| src/state/session-marks.ts | pin/favorite/hidden（localStorage） | 可作为「会话 lastMode」的家，或另开 |
| src/i18n/strings.ts / plan-copy.ts | 文案（StringKey 联合类型） | 模式/数模/进度中英 key |
| src/lib/format.ts / status.ts | 格式化 / `CONNECTION_META`+`TONE_TEXT` | 进度与状态色调复用 |
| src/transport/{types,sse,fixture,fixture-memory,scenario,boot,index}.ts | SSE/Fixture | 仅可扩展 fixture 演示场景 + 消费新事件类型（类型声明）；不实现服务端 |
| src/window/{capabilities,engine,model-settings,provider-presets,shell}.ts | Tauri 桥 | 壳级小改可接受；capabilities 见 §5.7 |
| src/theme/{apply-theme,presets,light-refined.css} | 主题 | 数模卡片/进度条 token |

4.2 建议新建（前端）

```
packages/ui/src/mode/
  types.ts          # AppModeId = 'chat' | 'plan' | 'math'
  ModeRegistry.ts   # 可扩展注册表
  ModeTabs.tsx
  useMode.ts
packages/ui/src/progress/
  types.ts          # ProgressModel（步骤/阶段/百分比/状态）
  TaskProgressBar.tsx
  deriveProgress.ts # 唯一派生入口（见 §6.3）
packages/ui/src/modes/chat/
  ChatWorkspace.tsx
packages/ui/src/modes/plan/
  PlanWorkspace.tsx        # 复用 PlanReview，提升为模式工作区
packages/ui/src/modes/math/
  MathWorkspace.tsx
  AssumptionsPanel.tsx
  VariablesPanel.tsx
  EquationsPanel.tsx
  SolverStatus.tsx
  ResultCards.tsx
  mathStageMap.ts          # 四段压缩视图 ↔ 后端 8 步映射
  mathDemoFixture.ts       # 演示数据，角标「演示」
```

命名可调整，但**职责分割必须清晰**，便于便宜模型后续接线。

4.3 Desktop 壳（仅当需要）

窗口标题可暂用「Camelia (预览)」——与品牌候选一致。
不要在本任务重编复杂 Rust spawn 逻辑；顶栏拖拽区（`data-tauri-drag-region`）保留。

============================================================
5. 模式 UX 深设计（必须设计透，并实现前端）
============================================================

5.1 模式选择器（TopBar 中央偏左）

- 形态：分段控件 / Tabs：`对话 · 计划模式 · 数模`；右侧预留 `⋯` 表示「更多模式」（禁用或弹「即将推出」）。
- 当前模式高亮；切换有轻微过渡；尊重 `localPrefs.motion === 'reduce'`。
- 切换规则（**已定，不再留给你假设**）：见 §6.4。

5.2 进度条（TopBar 中央偏右，或 Tabs 下方整宽 2–3px 细轨）

对话模式
- 无任务：进度条隐藏或 0% 极细低对比占位。
- 有任务：`task.progress`（0..1）或 `currentStepIdx / stepsTotal` → 百分比。
- 状态色：运行=强调、成功=绿、失败=红、暂停=琥珀。
- 文案微标：`第 2/5 步 · 校验中`（与 ActivityBar 同源，TopBar 更短）。

计划模式
- 进度 = 计划生命周期：`起草 → 待批准 → 执行中 → 完成`。
- **必须映射自真实字段**，不要造状态：
  - 起草 ↔ `status === 'planning'`（且 `task.steps` 尚未 ready）
  - 待批准 ↔ `status === 'awaiting-approval'`
  - 执行中 ↔ `status === 'executing' | 'verifying' | 'delivering'`
  - 完成 ↔ `status === 'done'`；失败/取消单独色
- 未批准前不假装执行。

数模模式
- 四段压缩视图：`建模 → 求解 → 校验 → 报告`。
- **每段必须显式映射到后端 8 步 pipeline**（见 `mathStageMap.ts`）：

| UI 段 | 后端步骤（math-modeling.ts） |
| --- | --- |
| 建模 | 1 问题重述 · 2 模型假设 · 3 变量与符号 · 4 建立模型 |
| 求解 | 5 求解（`math.exec`） |
| 校验 | 6 校验 · 7 灵敏度 |
| 报告 | 8 报告 |

- 进度条显示阶段名 + 段内比例；`SolverStatus` 显示状态/耗时；live 时若有 `stdout` 则展示尾部若干行，demo 用假数据但必须角标。

数据优先级（前端，**单一入口**）
1. 引擎事件（`task.progress` / `task.status_changed` / `task.phase_changed`）
2. 从 `TaskView` 派生（`progress` / `currentStepIdx` / `stepsTotal` / `status` / `phase`）
3. demo overlay（仅数模/计划演示场景，**必须**常驻「演示」角标）

5.3 顶栏常显策略（**新增，v1 遗漏的关键冲突**）

现状：TopBar 是 overlay，`localPrefs.topBar` 为 `'auto'` 时鼠标移开 400ms 后整体上移隐藏（App.tsx）；`'pinned'` 默认常显；`'hidden'` 永不显示。

冲突：进度条放在顶栏，若顶栏隐藏则进度消失——但「任务在跑」恰恰是最需要看到进度的时刻。

**已定策略**：当存在**运行中的任务**（`status` 不属于 `done | failed | cancelled`）时，顶栏**强制常显**，忽略 `topBar: 'auto'` 的自动隐藏；任务进入终态后恢复用户偏好。
实现要点：`topVisible = prefs.topBar === 'pinned' || revealed || hasActiveTask`；`'hidden'` 时仍尊重用户完全隐藏，但那时进度条须降级到 ActivityBar 显示一条（不新增常驻条，避免顶栏隐藏后凭空多一条）。
在 Settings 的「语言与外观」里给一行说明文案，避免用户以为顶栏坏了。

5.4 对话模式（Chat）

- 保持现有主路径：气泡 + 头像 + Composer「描述一个任务…」。
- ActivityBar 在有任务时出现。
- 顶栏进度轻量绑定 task steps。这是默认模式。

5.5 数模模式（Math Modeling）——专项深做

中区建议 双栏或上中下：

```
┌─ 数模工具条：阶段芯片 建模|求解|校验|报告 + 运行/停止 ─┐
│ 左：假设 / 变量表 / 方程编辑（Markdown+LaTeX 纯展示可先） │
│ 右：求解状态 · 日志 · 结果卡片（数值/图表占位/敏感度）   │
└─ 底部：Composer 变为「建模指令」占位 ────────────────────┘
```

面板最低要求

- `AssumptionsPanel`：条目列表，可标记「已确认/待定」。数据源 live 时优先 `TaskView.assumptions`（真实字段，`string[]`）。
- `VariablesPanel`：名称、符号、单位、值、来源（假设/拟合/用户）。
- `EquationsPanel`：方程列表；只读渲染优先；编辑可先 textarea。
- `SolverStatus`：`idle / running / converged / failed`；进度与错误诚实。
- `ResultCards`：关键指标卡片 +「复制/导出」。**导出若后端未实现则禁用并说明原因**（延续 `window/capabilities.ts` 的诚实门控模式，见 §5.7）。live 时结果应能承载 `math.exec` 的真实返回形状 `{ script, code, stdout, stderr, figurePaths, timedOut }`——`figurePaths` 是图表排版的锚点。

演示路径（**已定**）

- 进入数模模式且无 live 会话时，显示**空态 + 一个「加载演示课题」按钮**。
- **不自动播放动画**（自动播放会让人误以为已连上 solver）。
- 点击后走完四段（映射到 8 步）动画/分步，工作区头部常驻「演示」角标，直到加载真实会话。
- 不得声称连接了真实 solver，除非 live 事件到达。

与后端关系（只写进计划书 + UI 类型）

- 已有：`math.exec` 工具、`looksLikeMathModeling()` 探测器、`MATH_MODELING_SYSTEM_SUFFIX` 预设、模型库。
- **EngineServer.ts 目前完全没有 math 相关命令处理**（已 grep 确认）。所以 `math.*` 命令确实是新增工作——这部分写进计划书，本任务不实现。

5.6 右轨在数模模式下的扩展（**已定**）

现状：右轨已有 5 个 tab：`'memory' | 'events' | 'run' | 'context' | 'sub'`（RightRail.tsx:543）。

**决策**：新增第 6 个 tab `'model'`（标签「模型」），**只读展示**变量/方程快照，**不提供编辑**。
理由：右轨是「观测轨」，主工作区是「操作台」；编辑能力分散到两处会立刻造成双源。且右轨冷启强制折叠，不会拥挤。
在仅数模模式可见（其他模式隐藏该 tab），并在计划书里写清这条边界。

5.7 UI 能力门控的扩展方式（**已定，防止你新造一套**）

不要往 `ProviderCapabilities` 里塞 UI 能力位（形状不兼容）。
扩展现有 `window/capabilities.ts`：

```ts
export type InterveneCapability =
  | 'rollback_step' | 'select_provider' | 'intervene_goal'
  | 'math_solve' | 'math_export_report' | 'plan_edit';   // 新增项
```

保持同一个 `LIVE_UNAVAILABLE` 映射 + `canIntervene()` / `interveneUnavailableReason()` 的道具。
fixture 可支持、live 未实现的项，一律：**控件禁用 + 显示真实原因**，不静默。
把「需要一个引擎自报能力的 `ui.capabilities` 事件」作为**提案**写进计划书 §5，并说明迁移路径。

5.8 TopBar 信息架构推荐（消灭空顶栏）

从左到右：窗控点（Tauri 或留白）· 品牌槽（圆标 + 短名占位）· 分隔线 · ModeTabs · 弹性区（TaskProgressBar + 一行微文案）· 连接徽章（Live/Offline/Connecting，点击保留现有信任面板）· 可选「打开数据轨」· 窗控按钮。
高度可从 `h-9` 增至 `h-11`，但不要变成第二套工具站；进度条用 Tabs 下方 2–3px 轨道省纵向空间。
同时**移除** `.wf-dash-brand` 与 `.wf-orange-tag` 两个线框注解元素。

视觉气质参考（勿抄像素）：Linear 的密度、ChatGPT/Claude 桌面的平静、CC Switch 的卡片清晰度。保持现有 Light Refined token，除非主题需要小幅扩展。

============================================================
6. 前端状态机（Mode）——纯前端
============================================================

6.1 类型（建议）

```ts
export type AppModeId = 'chat' | 'plan' | 'math';

export interface ModeDefinition {
  id: AppModeId;
  labelKey: string;        // i18n
  descriptionKey: string;
  icon: string;
  enabled: boolean;
}

export type ProgressModel =
  | { kind: 'task'; current: number; total: number; label: string;
      status: 'idle' | 'running' | 'paused' | 'done' | 'failed' }
  | { kind: 'plan'; stage: 'draft' | 'awaiting_approval' | 'executing' | 'done' | 'rejected' }
  | { kind: 'math'; stage: 'modeling' | 'solving' | 'verifying' | 'reporting';
      ratio: number; status: 'idle' | 'running' | 'done' | 'failed' };
```

`plan` 的 stage 由 §5.2 的 status 映射函数产出，**不要**在 store 里另存一份布尔量。

6.2 Store 边界（白纸规则）

`store.ts` 宪法：不发明业务投影。

- `localPrefs.preferredMode` / `showAvatars` → 窗口偏好（允许，走 sanitize + default）。
- `ui.mode` 当前模式 → ephemeral UI chrome（类 `settingsOpen`），允许。
- 任务步骤、求解结果、记忆 → 必须来自引擎事件或 query。
- demo 场景单独 `demoOverlay` 字段，且 UI 显式「演示」。
- **禁止**：在 store 里伪造 snapshot 让用户以为 live 已求解。

6.3 与 ActivityBar 去重（单一真源）

**`deriveProgress(task, mode, overlays)` 是唯一进度派生入口**，TopBar 与 ActivityBar 都调用它。禁止各自算一遍。

| 信息 | TopBar | ActivityBar |
| --- | --- | --- |
| 模式 | ✅ 唯一切换入口 | ❌ |
| 总进度 | ✅ 细条 + 短文案 | 可选更详步骤条 |
| 暂停/继续/取消/引导 | ❌（或仅图标） | ✅ 主操作 |
| 打开数据轨 | 可选 | ✅ 已有 |

6.4 模式切换与任务保持（**已定，v1 留白项**）

核心事实：`ProjectionSnapshot` 是**全局单例**，对话/计划/数模读的是同一个 `task`。所以切模式**不需要也不应该**让后端记住模式。

规则：

1. **模式是纯前端 chrome**：不进 snapshot，不作为命令发给引擎。
2. **空闲时**：自由切换。
3. **任务运行中切换**：任务**继续运行**，不取消、不暂停。顶栏进度条跨模式持续可见（§5.3）。
4. 切到与当前任务无关的模式（例如任务在对话模式跑，用户切到数模）时，在目标模式工作区顶部显示一条**非模态条带**：「对话模式有一个任务正在运行 · 查看」，一键切回。**禁止**静默把任务藏起来导致用户以为它没了。
5. **会话记住 lastMode**：优先复用 `session-marks.ts`（localStorage，非领域事件）；若按会话粒度记不方便，则退化为 `localPrefs.preferredMode` 全局默认。
6. 任务终态后不自动切模式（避免抢焦点）。

在计划书 §4 里把 1–6 写成表格，标注「前端已实现」/「需后端」——本任务全部属前者。

============================================================
7. 后端必须在未来暴露的契约（本任务只定义，不实现）
============================================================
写入《计划设计书》。**所有已存在的名字照抄，只标出真正的新增**。

7.1 模式相关 Command

| Command | 状态 | 说明 |
| --- | --- | --- |
| `submit_task` | **已存在** | 现 payload `{ sessionId, intent, workspace }`。提案：增**可选** `mode?: 'chat' \| 'plan' \| 'math'`（可选以保证兼容） |
| `approve_plan` / `reject_plan` / `edit_plan` / `set_plan_approval` | **已存在**（EngineServer.ts:329-341、AgentLoop.ts:214） | 计划模式直接复用；不要新建 |
| `set_ui_mode` | 建议**不做** | 模式是前端 chrome（§6.4）；若未来引擎需要感知（例如数模默认注入预设），再补 |
| `math.start_session` | 新增 | 创建数模会话（假设/变量容器） |
| `math.update_model` | 新增 | 更新假设/变量/方程 |
| `math.solve` | 新增 | 触发求解（映射到 `math.exec`） |
| `math.verify` | 新增 | 校验 |
| `math.export_report` | 新增 | 报告导出 |

新增命令必须加进 `packages/core/src/types/events.ts` 的 `CommandMap`（那是唯一登记处）——**由后续模型实现**。

7.2 SSE / DomainEvent

| 事件 | 状态 | 说明 |
| --- | --- | --- |
| `task.progress` | **已存在** `{ progress, currentStepIdx, totalSteps }` | UI 直接消费。可选提案：加 `label?: string` |
| `plan.ready` | **已存在** `{ plan }` | 计划模式用这个 |
| `task.status_changed` / `task.phase_changed` | **已存在** | `awaiting-approval` 经此回流 |
| `step.started` / `step.completed` / `step.failed` / `step.skipped` | **已存在** | 步骤级进度 |
| `math.stage` | 新增 | `{ sessionId, stage, ratio, message? }` |
| `math.variable_updated` | 新增 | `{ sessionId, variables[] }` |
| `math.equation_updated` | 新增 | `{ sessionId, equations[] }` |
| `math.solver_status` | 新增 | `{ sessionId, status, iter?, residual?, error? }` |
| `math.result` | 新增 | `{ sessionId, cards[] }` |
| `math.failed` | 新增 | `{ sessionId, code, message }` |

**兼容策略**：`deriveProgress` 必须能在「只有旧事件」的引擎上工作——即没有 `math.*` 时，数模进度退化为从 `step.*` + `task.progress` 派生，绝不显示假进度。

7.3 现有事件的 payload 一眼表（照抄）

```
task.received        { task }
task.clarified       { intent }
task.status_changed  { from, to, reason }
task.phase_changed   { phase }
task.progress        { progress, currentStepIdx, totalSteps }
task.paused          { reason }
task.resumed         { fromStatus }
task.intervened      { instruction, previousGoal, newGoal }
task.completed       { summary, artifacts[] }
task.failed          { reason, recoverable }
task.cancelled       { reason }
plan.started         { mode: 'fast' | 'full' }
plan.ready           { plan }
plan.revised         { previousRevision, plan, reason }
plan.failed          { reason }
step.started/completed/failed/skipped
tool.requested/approval_required/approved/denied/started/finished/failed
verify.started/result/fix_required
context.budget/compaction_started/compacted/deduplicated
reliability.drift_detected/loop_detected/hallucination_blocked/no_progress
recovery.classified/attempted/succeeded/failed/rollback_started/rollback_done
subagent.spawned/finished
provider.selected/fallback/capabilities
checkpoint.created
memory.written/recalled/forgotten/reactivated/downgraded/promoted/critiqued
selfreview.performed/skipped
tool.usage_injected
log / metric
```

7.4 引擎能力自报（提案，非现状）

现状：`ProviderCapabilities` **不是**这个用途（见 §2.3），UI 侧能力门控是 `window/capabilities.ts` 的硬编码表。

计划书要求新增一个 `ui.capabilities` 事件（或 bootstrap 字段），声明：
```
{ rollback, intervene, selectProvider, memory, planApproval,
  mathModeling, progressEvents, mathExport }
```
并写清：UI 从硬编码表迁移到自报字段的路径（保留硬编码作为 fallback，未知一律视为不支持——诚实优先）。

7.5 验收用 fixture 场景

- `SceneId` 现有 10 个：`empty | connecting | planning | plan | diff | running | approval | failure | error | done`（scenario.ts）。
- 新增 `'math-demo'`（走完数模四段）。`plan` 场景**已存在**，复用，不要新建 `'plan-demo'`。
- 场景经 `?scene=<id>` 选择（已有机制）。
- 角标与 boot 文案必须标明演示；`submit_task` 在无 `engineUrl` 时**仍不得假装 live 模型**（现状：返回 `'未连接引擎 — offline fixture cannot run a live model'` —— 保持这个行为）。

============================================================
8. 《计划设计书》强制目录（Opus 必须写满）
============================================================
文件：`docs/UI-REFORM-PLAN-BOOK.md`（中文主文，关键标识符可英文）。

```
# Camelia UI Reform · 计划设计书（Opus 交付）
## 1. 执行摘要
- 本次 UI 改了什么、为什么、截图索引
- 后续便宜模型要做什么（一段话）
## 2. 信息架构（IA）
- 总布局
- 三模式差异表
- 设置分区
- 空态 / Offline / Live 差异
## 3. 组件清单（Component Inventory）
- 新增 / 修改 / 废弃（含被移除的 .wf-* 注解类）
- 每个组件：职责、props、依赖事件、i18n keys
## 4. 模式状态机
- 前端-only 部分（已实现）
- 后端必须暴露的部分（未实现，附转移条件）
- 切换规则与边界（§6.4 的 1–6 表）
## 5. API / 事件契约
- Command 表（**明确标注「已存在」vs「新增」**）
- SSE/DomainEvent 表（名字、payload、兼容策略）
- ui.capabilities 提案 + 从硬编码门控迁移的路径
- 错误码（机器可读 + 中文人话）
## 6. 里程碑计划（给便宜 AI）
对每个里程碑写：目标、任务列表（勾选级）、验收、禁止项、建议模型档位，
并标注它对应 CAMELIA-ROADMAP 的哪一档（M2–M8）。
  - M-UI-1：…
  - M-ENG-1：progress 事件**消费**接线（注意：事件已存在，不是新增）
  - M-ENG-2：计划审批的 **UI** 真实路径（引擎侧已实现）
  - M-MATH-1：math.* 命令接 math.exec（真新增）
  - M-MATH-2：报告导出 / 可视化
  - M-QA：桌面 e2e 含模式切换与进度
## 7. 验收清单（Acceptance）
- UI 视觉/交互勾选
- 契约兼容勾选
- 回归：右轨折叠、诚实干预、连接预设、i18n
## 8. 非目标（Non-goals）
## 9. 风险与缓解
- 进度双源不同步、模式切换丢任务、demo 被当成 live、品牌返工、
  .tmp-* 垃圾文件已入库、顶栏隐藏与进度条冲突
## 10. 品牌候选（仅选项，不锁死）
## 11. 交接说明
- 如何把本书喂给其他模型
- 推荐工单顺序
```

**里程碑编号规则（已定）**：用独立的 `M-UI-*` / `M-ENG-*` / `M-MATH-*`，但每个里程碑**必须**标注映射到 ROADMAP M2–M8 的哪一档（给一张映射表）。
理由：ROADMAP 是产品级，计划书是派工级，粒度不同，强行共用一套编号会打架。

============================================================
9. 品牌（只给选项，不锁死）
============================================================

| 候选 | 调性 | 备注 |
| --- | --- | --- |
| Camelia + 山茶花几何标（过渡推荐） | 与代码名一致 | 最快去掉刺眼 TBD 文案 |
| 山茶 / Camellia 中文名 | 更亲切 | 需查重名/商标 |
| 双名：中文产品名 + Camelia | 中国区友好 | 安装包名需一致 |

UI 文案：可用「Camelia」+ 小花标作为过渡；About 写「最终名称待产品决策」。
**禁止**随机起新英文名写死。同时**移除**橙色虚线的 `.wf-dash-brand` 线框胶囊。

============================================================
10. 实现步骤建议（Opus 自行编排，但须覆盖）
============================================================

1. 读最少文件：`TopBar.tsx`、`ActivityBar.tsx`、`App.tsx`、`local-prefs.ts`、`store.ts`、`strings.ts`、`PlanReview.tsx`、`RightRail.tsx`（tab 区）、`scenario.ts` 头尾。
2. 落地 mode 基建：types + registry + prefs + store chrome。
3. 重做 TopBar：品牌 + ModeTabs + Progress + 连接 + 移除线框注解；实现 §5.3 常显策略；截图对照「空顶栏」前后。
4. 三模式 Workspace：chat 包装现有；plan 强化；math 新做 + demo fixture。
5. 进度派生：`deriveProgress` + 与 ActivityBar 对齐；写测试。
6. i18n：所有新文案中英；默认 zh。
7. 测试：组件/派生函数单测；prefs v4 回归；勿降 agent 覆盖率（你不该动 agent）。
8. build：`pnpm --filter @camelia/ui build`；若改壳再 desktop:build 并覆盖用户常用 exe（仅当环境允许）。
9. **写《计划设计书》全文**。
10. 提交：`feat(ui): mode tabs + progress + math workspace (v3)` 与 `docs: UI reform plan book for follow-on agents`。不要 force-push。提交前用 `git diff --ignore-cr-at-eol` 自查，只 `git add` 你真正改动的文件——仓库里现有 23 个 `.tmp-*` 文件和一批 CRLF 行尾 churn 会污染 diff。

============================================================
11. Definition of Done（验收）
============================================================

11.1 UI

- [ ] 冷启动：右轨折叠；顶栏见品牌过渡位 + 三模式 Tabs + 进度区域（空闲极低调）+ 连接徽章；`.wf-dash-brand` / `.wf-orange-tag` 已移除
- [ ] 有运行中任务时，顶栏在 `topBar: 'auto'` 下仍常显
- [ ] 切换 对话/计划/数模：中区结构明显变化；运行中切换任务不丢，且目标模式有回看条带
- [ ] 计划模式：可见计划步骤与批准/拒绝（demo 或 live）
- [ ] 数模模式：假设/变量/方程/求解状态/结果卡 + 阶段进度；演示角标正确；四段映射到后端 8 步
- [ ] 进度条与任务步骤或数模阶段联动（demo 可证明交互）；TopBar 与 ActivityBar 同源
- [ ] 微信头像、Settings 四分区、连接预设、诚实干预均未回归破坏
- [ ] zh 模式下无新增英文裸串
- [ ] Offline/fixture 仍诚实，不假 live

11.2 计划设计书

- [ ] §8 目录齐全
- [ ] 事件/命令表明确区分「已存在」与「新增」，可直接派给其他模型实现
- [ ] 含 M-UI/M-ENG/M-MATH 里程碑 + ROADMAP M2–M8 映射表
- [ ] 含「如何喂给其他模型」小节

11.3 工程卫生

- [ ] diff 主要在 `packages/ui`（+ 文档 + 极少 desktop chrome）
- [ ] 测试绿（至少 ui 包）
- [ ] 提交说明清楚

============================================================
12. 非目标（再强调）
============================================================

- 不修 Node ABI / better-sqlite3（已在 2c20208 / 5762b47 轨道）
- 不实现真正的求解器或 `math.exec` 内部
- 不做插件市场、多人对战、移动端
- 不把右轨改回默认展开
- 不引入新桌面框架
- 不用 mock 冒充 ACCEPTANCE 里的真实模型成功
- 不新建 §2.4 表中已存在的事件/命令名

============================================================
13. 风险（实现时自行规避）
============================================================

| ID | 风险 | 缓解 |
| --- | --- | --- |
| U1 | 顶栏变拥挤 | 进度用细条；次要进溢出菜单 |
| U2 | 进度双源不一致 | 单一 `deriveProgress` |
| U3 | demo 被当成 live | 永久角标 + fixture 文案 |
| U4 | 模式状态写进 snapshot | 审查 store；chrome 与投影分离 |
| U5 | 品牌返工 | 只过渡 + 候选表 |
| U6 | 范围吞掉计划书 | 先切 UI 垂直切片，再写书；两者都要交付 |
| U7 | 顶栏隐藏时进度消失 | §5.3 常显策略；`'hidden'` 时降级到 ActivityBar |
| U8 | 数模阶段与后端 pipeline 错位 | `mathStageMap.ts` 显式映射 8 步 |
| U9 | 新建重复事件名 | 开工前对照 §2.4 / §7.2 的「已存在」列 |
| U10 | 提交时误带上 CRLF churn 与 `.tmp-*` | 提交前 `git diff --ignore-cr-at-eol` 自检；只 add 你真正改的文件 |

============================================================
14. 如何喂给 Opus / 如何把计划书交给其他模型
============================================================

14.1 喂给 Opus（本任务）

1. 打开 Claude Opus（或 Cursor/Camelia 里绑定的顶级 UI 模型）。
2. 工作目录设为 `C:\Users\37963\Desktop\Camelia-Agent`。
3. 整份粘贴本文件。
4. 附加一句：「严格按硬约束，只做 UI + 计划设计书；开工前先对照 §2.4 确认没有重复造事件名；完成后列出 commit 与验收勾选。」
5. 不要拆成多次「先讨论再写」——除非撞上环境红灯（build 崩）。

14.2 把《计划设计书》交给其他模型（后续）

1. 新会话使用更便宜/更快模型。
2. 粘贴 `docs/UI-REFORM-PLAN-BOOK.md` 全文，并指定一个里程碑（如 M-ENG-1）。
3. 附加约束：「只实现该书该里程碑；UI 已由 Opus 完成；保持诚实干预与分层；测试+中文错误；注意 `task.progress` 等事件已存在，不要新建。」
4. 每完成一个里程碑开新会话，避免上下文腐烂。
5. 验收以计划书 §7 Acceptance 勾选为准，而不是模型自称 done。

14.3 给人类的最短口令

```
@OPUS-UI-REFORM-PROMPT.md
按硬约束一刀流：UI v3（模式+进度+数模）+ docs/UI-REFORM-PLAN-BOOK.md
禁止动 agent/harness/core/cli 实现。
开工前对照 §2.4 冲突表，不要新建已存在的事件/命令名。
```

后续：

```
@docs/UI-REFORM-PLAN-BOOK.md 只做 M-ENG-1，完成后打勾验收。
```

============================================================
15. 附录 A · 现有 TopBar 行为（改造前）
============================================================
文件：`packages/ui/src/components/TopBar.tsx`
内容：mac 三点占位 · `.wf-dash-brand` 品牌占位胶囊 · 会话标题 · 连接面板（engineUrl/session/log/restart）· `.wf-orange-tag`「按需滑出」 · 窗控。
显隐：`revealed` prop + `localPrefs.topBar: auto|pinned|hidden`；App.tsx 用 `paddingTop: 36` 让位。
缺：ModeTabs、ProgressBar、模式感知微文案；且带有线框脚手架残留。

============================================================
15.1 附录 B · 现有 ActivityBar 行为
============================================================
文件：`packages/ui/src/components/ActivityBar.tsx`
props：`{ task, onPause, onResume, onCancel, onIntervene }`。
内容：任务标题、运行态、第 i/n 步、步骤圆圈、暂停/继续/引导/取消、打开数据轨。
时间源于事件时间戳（确定性，利于测试）——保持。会用到 `rightRailUserPatch`。

============================================================
15.2 附录 C · Prefs v4 不可回归
============================================================
`LOCAL_PREFS_VERSION = 4`；`loadLocalPrefs` 每次启动强制 `rightCollapsed: true` / `userSetRightRail: false`（会话内展开才持久化）。
你新增 `preferredMode` / `showAvatars` 时走 `sanitizeLocalPrefs` 的白名单 + 默认值，不要降低 version 逻辑。
注意 `sanitizeLocalPrefs` 里的 boot 重写条件（`prefsVersionOf(parsedRaw) < LOCAL_PREFS_VERSION || …`）——新增字段会被 `...parsed` 正常带过。

============================================================
15.3 附录 D · 文案方向（可直接当 i18n 草稿）
============================================================
```
mode.chat            = 对话
mode.plan            = 计划模式
mode.math            = 数模
mode.more            = 更多模式
progress.idle        = 待命
progress.step        = 第 {current}/{total} 步 · {label}
progress.math.modeling  = 建模
progress.math.solving   = 求解
progress.math.verifying = 校验
progress.math.reporting = 报告
math.demo.badge      = 演示
math.demo.load       = 加载演示课题
math.assumptions     = 假设
math.variables       = 变量
math.equations       = 方程
math.solver          = 求解状态
math.results         = 结果
plan.awaiting        = 待批准
plan.approve         = 批准执行
plan.reject          = 拒绝
brand.transition     = Camelia
brand.placeholder.hint = 最终名称待定
```
注意：`strings.ts` 的 `StringKey` 是联合类型，新增 key 要同时扩展该联合。

============================================================
15.4 附录 E · 与 CAMELIA-ROADMAP 的关系
============================================================
Roadmap 状态（2026-10-12 16:55 CST 更新）：**M0 已完成**（Node 22 spawn + ABI probe + 诚实 engineSpawnError），**M1 已完成（CLI）**（Ollama qwen2.5-coder:7b run 成功；桌面冷启 Live + /health 报 ollama 已连；建议人工点验 UI 内 hello）。
不在本任务；不要重做。

本任务产出的计划书应咬合 Roadmap M2–M8，并把「模式 / 进度 / 数模产品化」拆成可派工切片，避免再叫 Opus 做设计。
UI 叙事继续服务北星 A + 体验 B/D + 可观测 C。

============================================================
15.5 附录 F · 提交与报告格式（结束时贴给用户）
============================================================
```
## 交付报告
- Commits: <sha> ...
- UI 截图: 顶栏空闲 / 对话运行 / 计划待批准 / 数模四阶段
- 计划设计书路径: docs/UI-REFORM-PLAN-BOOK.md
- 主要改动文件: ...
- 验收勾选: （粘贴 11.1 / 11.2）
- 未做（非目标）: ...
- 与 §2.4 冲突表的核对结果: 无重复造名 / 有则说明
- 给下一模型的第一张工单: M-ENG-1 ...
```

============================================================
16. 开始指令（对 Opus）
============================================================
立即开始。不要问「是否要做数模」——要做。不要问品牌最终名——给候选并过渡。不要改后端实现——写进计划书。
开工前先扫一眼 §2.4 冲突表；第一提交前先完成 TopBar + ModeTabs + Progress 的可运行垂直切片；结束前必须留下完整《计划设计书》。

去吧。
