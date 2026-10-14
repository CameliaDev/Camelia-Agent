# Camelia UI Reform · 计划设计书

> **历史设计书（2026-10-12），不是当前壳。** 文中「现在顶栏是对话 / 计划模式 / 数模」已经过时。当前模式是会话栏上的 **Work / Math / Term**（`chat` / `plan` 归一为 `work`）。见 [`SHELL-UX.md`](SHELL-UX.md)（`main` `1b36ad2` / PR #4）。下文保留当时的改造记录。



> 交付者：Claude Opus（UI 一刀流任务）
> 日期：2026-10-12（Asia/Shanghai）
> 代码基线：`5762b47` + 本次 UI 提交
> 读者：后续用更便宜模型按里程碑实现后端接线与产品化的工程师 / agent
> 配套任务书：`OPUS-UI-REFORM-PROMPT-v2.md`

---

## 1. 执行摘要

### 1.1 这次改了什么

三件事，按重要性排序。

**第一，顶栏从「能聊的壳」变成任务工作台的主控台。** 改造前顶栏是：三个 mac 风格圆点占位、一个橙色虚线胶囊写着「名称与吉祥物 TBD」、会话标题、右侧 Offline、以及一个「按需滑出」橙色标签——中间一大片留白。现在顶栏是：品牌槽（过渡名，不再是 TBD 告示）、模式选择器（对话 / 计划模式 / 数模）、**一条 2px 进度轨 + 一行微文案**、连接徽章、窗控。高度从 `h-9`(36px) 到 `h-11`(44px)，并以 `--top-bar-h` 发布给网格的顶部内边距，两者不会再各说各话。

**第二，模式成为一等公民，数模被特化。** `chat` / `plan` / `math` 三套工作区，三套不同的中区结构，不是一个 label 的切换。数模模式有：四阶段芯片条 + 假设面板 + 变量表 + 方程（只读）+ 求解状态与输出 + 结果卡片，以及一个**显式加载**的演示课题。

**第三，进度只有一个真源。** `deriveProgress(task, mode, language, mathDemo)` 是唯一的派生入口，顶栏和活动栏都从它渲染。这不是风格选择：两处各算一遍，顶栏说「第 2/5 步」而活动栏说「第 3/5 步」时，用户没有任何办法判断哪个是真的。

### 1.2 三个刻意的「不做」

理解这一节比理解上面三件更重要，因为后续里程碑如果不守这三条，会把这个界面拆掉。

- **模式不写进 `snapshot`，也不发给引擎。** `ProjectionSnapshot` 是全局单例，三种模式读的是**同一个** `task`。所以切模式不需要后端记住任何东西，也确实没记。给引擎加 `set_ui_mode` 只会制造第二个真源。
- **数模演示不自动播放。** 进入数模模式看到的是空态（「暂无建模会话」+ 一个按钮）。点了才走阶段。自动播放的动画会让人合理地认为「求解器连上了」。
- **不可用的能力显示原因，不显示 enabled 的假按钮。** 数模的「运行本阶段」和「导出报告」恒为 disabled，带 tooltip 说明。这是 `c2127fa` 诚实干预的延续，不是新发明。

### 1.3 截图索引

本次改动可用 `?scene=<id>` 复现（`packages/ui` 的 transport 支持 query 选场景）：

| 目标 | 场景 / 操作 |
| --- | --- |
| 顶栏空闲（I 态） | `?scene=empty` |
| 对话运行中 + 进度轨 | `?scene=running` |
| 计划待批准（生命周期条 + 审阅面） | `?scene=plan` |
| 数模四阶段 + 演示角标 | `?scene=math-demo` |
| 离线诚实（Offline + 横条） | `?scene=error` |
| 右轨模型只读 tab | `?scene=math-demo` → 展开右轨 → 「模型」 |

`math-demo` 这个场景**刻意不产生任何领域事件**（见 §3.6），它只把 `mathDemo` 写进 store 的独立字段，所以截图里 `Offline` 徽章与 `演示` 角标同时存在——这正是它真实的样子。

### 1.4 后续便宜模型要做什么（一段话）

UI 侧已经完成，**不要重做 UI**。你要做的是把 UI 已经在消费、但引擎还没提供的三样东西补上：① 让引擎在 bootstrap（或新事件）里**自报能力**，把 `window/capabilities.ts` 的硬编码表降级为 fallback；② 实现 `math.*` 五个命令与六个事件（全部是**新增**，`EngineServer` 现在没有任何 math 分支），把数模从演示接到 `math.exec`；③ 把 `task.progress` 已有的 `{progress, currentStepIdx, totalSteps}` 补一个**可选** `label?: string`，让顶栏微文案不必自己猜步骤名。三件都做完，数模就是一个真功能，而不是一个做得很好的空壳。

---

## 2. 信息架构（IA）

### 2.1 总布局

```
┌─ TopBar (h-11 / 44px, overlay, 可隐藏) ───────────────────────────────────┐
│ [品牌] │ 对话 · 计划模式 · 数模 · +2 │ ▓▓▓▓▓░░░░ 第2/5步·校验中 │ ● Live │ ▭▢✕ │
└───────────────────────────────────────────────────────────────────────────┘
┌────────────┬──────────────────────────────────────────┬───────────────────┐
│ SessionRail│ ModeShell                                 │ RightRail         │
│  260px     │  ┌ EngineBanner（仅 offline 且期望 live）│  48px（默认折叠） │
│  · 置顶    │  ├ 跨模式条带（仅 math 且有任务在跑）     │  · 记忆           │
│  · 收藏    │  ├ 工作区（按模式）                       │  · 事件           │
│  · 今天/更早│  │   chat → Conversation                 │  · 运行           │
│  · 搜索    │  │   plan → 生命周期条 + PlanReview       │  · 上下文         │
│            │  │   math → 阶段条 + 四面板               │  · 子代理         │
│            │  └ Composer（按模式换 placeholder）      │  · 模型（仅 math） │
│ [→ 设置]   │                                          │  边缘拉手 →       │
└────────────┴──────────────────────────────────────────┴───────────────────┘
```

布局未变：三列 grid，`--rail-left-w / 1fr / --rail-right-w`。改动只在顶栏内部与中区的模式分派。

### 2.2 三模式差异表

差异必须是**结构性**的，否则「模式」只是装饰。

| 维度 | 对话 (chat) | 计划模式 (plan) | 数模 (math) |
| --- | --- | --- | --- |
| **中区主面** | 对话时间线 | 计划审阅（`PlanReview`）为主体 | 双栏：模型定义 / 求解与结果 |
| **进度含义** | 加权步骤 `task.progress` | 计划生命周期四站 | 引擎注入的 7 步 template 压缩为 4 段 |
| **进度来源** | `task.progress`（引擎已发） | `task.status` 映射 | 步骤计数派生；未来 `math.stage` |
| **顶栏微文案** | `第2/5步 · 校验中` | `待批准` / `执行中` | `求解 · 62%`（演示时带角标） |
| **主操作** | Composer 提交 / 引导 | 批准 / 编辑步骤 / 拒绝 | 加载演示 / 运行阶段（禁用） |
| **右轨可用 tab** | 全部 | 全部 | 全部 + **模型（只读）** |
| **空态** | 品牌过渡位 + 建议任务 | `起草中` + 说明 | `暂无建模会话` + 演示入口 |
| **后端就绪度** | ✅ 全通 | ✅ 引擎已实现审批 | ⚠️ 无任何 math 命令 |

最后一行的诚实记录很重要：**计划模式的审批路径引擎早就实现了**（见 §5.1），本次只是把 `PlanReview` 从「对话里的一个 tab」提升为模式主面。计划模式没有新增任何后端需求。

数模是唯一真正缺后端的模式，所以它的 `available: false`，并且工作区顶部**常驻**一条横幅写明这件事。

### 2.3 设置分区

保持 v2 的四分区不变（连接预设 / 语言与外观 / 引擎与日志 / 关于），仅在「语言与外观」内新增两组控件：

**模式组**
- `默认模式` — 下拉，`localPrefs.preferredMode`，选项来自 `MODE_REGISTRY`
- 说明文案：切模式不会中断正在运行的任务

**外观组（新增项）**
- `消息头像` — 复选框，`localPrefs.showAvatars`，默认开。关闭后头像从三处渲染点消失（用户意图卡、交付卡、代理叙述），气泡占满宽度而不是留一个洞。
- 顶栏隐藏说明 — 在 `topBar` 选择器下方加一行常驻文案，解释「即使设为自动隐藏，任务运行期间顶栏也会保持常显」。没有这行文案，用户会以为顶栏坏了。

### 2.4 空态 / Offline / Live 差异

| 状态 | 顶栏 | 中区 | 数模 |
| --- | --- | --- | --- |
| **Offline（无 engineUrl）** | `Offline` 灰点 | 空态（品牌过渡位 + 建议任务） | 横幅 + 演示入口 |
| **Offline（spawn 失败）** | `Offline` 灰点 | 空态 + `EngineBanner` 红条（含 ABI 错误原文） | 同上 |
| **Connecting** | `Connecting` 琥珀点 + 脉冲 | `LoadingState` | 同上 |
| **Live，无任务** | `Live` 蓝点脉冲 + `待命` | 空态 | 同上 |
| **Live，任务运行** | `Live` + 进度轨 | 按模式 | 按模式 |

关键约束：**fixture 与 offline 的诚实性未被削弱**。`submit_task` 在无 `engineUrl` 时仍然返回 `未连接引擎 — offline fixture cannot run a live model`（`fixture.ts` 原样保留），空态建议按钮在 demo 场景下点击仍然会被拒绝。

---

## 3. 组件清单（Component Inventory）

### 3.1 新增

| 文件 | 职责 | 关键 props | 依赖事件 / 命令 | i18n keys |
| --- | --- | --- | --- | --- |
| `mode/types.ts` | `AppModeId` = `'chat'\|'plan'\|'math'`；`isAppModeId()` 守卫；`DEFAULT_MODE` | — | — | — |
| `mode/ModeRegistry.ts` | 模式注册表：label / description / icon / `available` / `unavailableReasonKey`；`MODE_COMING_SOON` | — | — | 引用 `mode.*` |
| `mode/ModeTabs.tsx` | 分段控件。三个可用 tab + 一个 disabled 的「+2 即将推出」 | `mode`, `language`, `onSelect`, `taskRunning` | — | `mode.chat/plan/math/more/more.title` |
| `mode/useMode.ts` | 读/写当前模式与偏好模式；导出 `isTaskActive()` | — | — | — |
| `progress/types.ts` | `ProgressModel`（task / plan / math 三变体）、`ProgressResult`、`ProgressSource` | — | — | — |
| `progress/deriveProgress.ts` | **唯一进度派生入口**。含 `planStageOf()`、`taskInFlight()` | `{task, mode, language, mathDemo?}` | 读 `task.progress` / `task.status` / `task.steps` | — |
| `progress/TaskProgressBar.tsx` | 细轨 + `ProgressMicrocopy`（一行文案，演示角标在此） | `result`, `language` | — | `progress.*`, `approval.waiting`, `math.demo.badge` |
| `modes/ModeShell.tsx` | 按模式分派工作区；跨模式条带 | — | — | `mode.elsewhere*` |
| `modes/chat/ChatWorkspace.tsx` | 包装既有 `Conversation`（行为未变） | — | — | — |
| `modes/plan/PlanWorkspace.tsx` | 生命周期四站条 + `PlanReview` 主体 | — | 透传 `PlanReview` 的 `edit_plan`/`approve_plan`/`reject_plan` | `progress.plan.*`, `approval.waiting` |
| `modes/math/MathWorkspace.tsx` | 阶段条、演示控制、双栏面板、诚实横幅 | — | 读 `store.mathDemo` | `math.*` |
| `modes/math/MathPanels.tsx` | `AssumptionsPanel` / `VariablesPanel` / `EquationsPanel` / `SolverStatus` / `ResultCards` | 各见源码 | 读 `TaskView.assumptions`（live） | `math.*` |
| `modes/math/mathStageMap.ts` | **4 段 ↔ 引擎注入的 7 步**映射表；`stageForEngineStep` / `overallForEngineStep` | — | — | `progress.math.*`, `math.hint.*` |
| `modes/math/mathDemoFixture.ts` | 演示数据（SIR 玩具）+ 8 帧序列 | — | — | `math.demo.badge` |
| `modes/math/demoBoot.ts` | 场景引导：`?scene=math-demo` 时把演示写进 store（**不**进事件流） | `(store, scene)` | — | — |

### 3.2 修改

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `App.tsx` | `h-9` → `TOP_BAR_H = 44`；发布 `--top-bar-h`；`EngineBanner → ModeShell → Composer`；顶栏常显策略 | 进度条需要空间；模式分派需要入口 |
| `components/TopBar.tsx` | 重设计：品牌槽 / `ModeTabs` / 进度轨 / 连接 / 窗控；高 44px | 消灭空顶栏 |
| `components/ActivityBar.tsx` | 进度**兜底**：仅当 `topBar === 'hidden'` 时渲染进度轨；运行态/步数文案走 i18n | 顶栏隐藏时进度不能消失；避免双进度 |
| `components/Conversation.tsx` | 移除内部 tab 条与 `PlanReview` 引用；空态换成品牌过渡位；头像受 `showAvatars` 门控 | 计划面已上移到模式层；空态去掉橙色 TBD 脚手架 |
| `components/RightRail.tsx` | 新增第 6 个 tab `model`（仅 math 可见，只读）；tab 标签改走 i18n；移除 `.wf-orange-tag` | 数模观测面 |
| `components/SessionRail.tsx` | 设置入口从 `.wf-dash-brand` 换成正常按钮；空态改 i18n | 一个能用的导航控件不该长得像未完成稿 |
| `components/SettingsDrawer.tsx` | 新增「模式」小节；外观区新增「消息头像」；`topBar` 下加常显说明 | 让新偏好可被用户改到 |
| `components/primitives.tsx` | 新增图标 `sigma` / `flow` / `ruler` | 数模与计划阶段需要 |
| `i18n/strings.ts` | `StringKey` 联合 +78 键；`t()` 支持 `{token}` 插值 | 模式/进度/数模/设置中英文案 |
| `index.css` | 删除 `.wf-dash` / `.wf-dash-brand` / `.wf-orange-tag` | 线框脚手架下线 |
| `main.tsx` | 应用 `applySceneBoot()` | 让 `math-demo` 场景可截图 |
| `state/local-prefs.ts` | 新增 `preferredMode` / `showAvatars`（走 sanitize 白名单） | 窗口偏好 |
| `state/store.ts` | 新增 `mode`（ephemeral）、`mathDemo`（独立字段） | chrome 与投影分离 |
| `transport/scenario.ts` | 新增 `SceneId = 'math-demo'`（**零事件**） | 演示截图入口 |
| `window/capabilities.ts` | 从单轴改为**两轴**（live / fixture）；新增 `math_solve` / `math_export_report` / `plan_edit`；未知能力 fail-closed；导出 `capabilityMatrix()` | 数模在两个 transport 上都不支持，单轴表达不了 |
| `window/provider-presets.ts` | `let base` → `const base` | 修一条已存在的 lint error |

### 3.3 废弃 / 移除

| 对象 | 原因 |
| --- | --- |
| `.wf-dash-brand`（橙色虚线胶囊） | 线框脚手架。它是「顶栏空且刺眼」的直接来源之一 |
| `.wf-orange-tag`（橙色标签） | 同上 |
| `.wf-dash`（灰色虚线框） | 被 Tailwind `border-dashed border-line` 取代 |
| `Conversation` 内部 tab 条（对话 / 计划） | 计划面已提升为模式工作区，留在这里会与顶栏模式选择器语义重叠 |
| 空态的「待定：名字 / 吉祥物」文案 | 换成 `brand.transition` + `brand.placeholder.hint`（不喊 TBD，但也没定名） |

**刻意保留**：`.wf-avatar-user` / `.wf-avatar-agent` / `.wf-bubble-user` / `.wf-bubble-agent` / `.wf-step-circle`。这四个名字里的 `wf-` 是历史命名，但它们承载的是**真实产品样式**（微信式圆形头像与气泡、步骤圆圈），不是注解。改名会波及 `primitives.tsx` 与测试，收益为零。

---

## 4. 模式状态机

### 4.0 审批面的可达性（本次自检发现的回归，已修）

**背景（值得记住的教训）**：v2 的 `Conversation` 内部有一个「对话 / 计划」tab 条，
`task.phase === 'awaiting-approval'` 时自动切到计划 tab。本次把 `PlanReview` 上移到计划模式后，
**删掉了那个 tab 条但一开始没补自动路由** —— 结果是：默认的对话模式下，一个等待批准的任务
既没有 `[data-plan-review]`，也没有批准/拒绝按钮，用户只能自己猜到要去切模式。

**现状（已修）**：`ModeShell` 在任务进入 `awaiting-approval` 时自动切到计划模式。
但它不是「关住用户」的：

- 只对**当前任务**触发一次。用户手动切走后会被记入 `dismissed`，不会每次渲染都被拽回去。
- 任务终态或换新任务时 `dismissed` 清空，下一次审批仍是值得打扰的。
- 待批准期间不显示跨模式条带（那会与用户必须处理的审批抢注意力）。

`mode.test.tsx` 的 `plan approval is always reachable` 区块是这条行为的回归闸门——
把那几行自动路由注释掉，测试就会红。

**如果后续里程碑要动审批面，先读这一节。**

### 4.1 前端已实现（本次全部完成）

| # | 规则 | 实现位置 |
| --- | --- | --- |
| 1 | 模式是纯前端 chrome，不进 `snapshot` | `store.ts` 的 `mode` 字段；`derive-progress.test` / `mode.test` 断言 `snapshot` 无 `mode` |
| 2 | 空转时自由切换 | `ModeTabs` 无条件可点 |
| 3 | 任务运行中切换：任务继续运行，不取消不暂停 | `mode.test`：切换后 `snapshot.task` 引用不变，且 `lastCommand` 未产生 |
| 4 | 切到不显示该任务的模式时，顶部出现非模态条带 + 一键回看 | `ModeShell` 的 `data-cross-mode-strip`；仅 `mode === 'math'` 时出现（chat↔plan 共用对话面，没有东西被藏起来） |
| 5 | 跨模式持续可见的进度 | 顶栏常显策略（§4.3），activity bar 兜底 |
| 6 | 任务终态后不自动切模式 | 自动路由只在 `awaiting-approval` 触发；终态无任何自动切换 |
| 6b | 待批准时**自动路由到计划模式**（否则审批面不可达） | `ModeShell` 的 auto-route + `dismissed` 集合；`mode.test.tsx` 回归闸门 |
| 7 | 偏好模式持久化 | `localPrefs.preferredMode`，走 `sanitizeLocalPrefs` 白名单 |

**为什么 chat↔plan 不显示条带**：两者都渲染 `Conversation`（计划模式在其上加了生命周期条与主审阅面）。切过去时任务仍在眼前，弹一条「任务在别处运行」是噪音。只有 math 真正替换了中区。

### 4.2 后端必须暴露的部分

| 需求 | 状态 | 转移条件 |
| --- | --- | --- |
| 引擎感知当前模式 | **建议不做** | 唯一可能的驱动是「数模自动注入建模预设」。但 `looksLikeMathModeling()` 已经在服务端按任务文本判定，UI 不需要通知。若将来确实需要，走 `submit_task` 的**可选** `mode?` 字段，不新增 `set_ui_mode` |
| 引擎自报能力 | 提案 | 见 §5.4。UI 当前用硬编码表，可正常工作，不阻塞任何里程碑 |

### 4.3 顶栏可见性与「任务在跑」的冲突

这是 v1 任务书完全没提、但绕不过去的问题。`TopBar` 是 overlay，`topBar: 'auto'` 时鼠标移开 400ms 就整体上移隐藏。而进度条在顶栏里，于是「任务在跑（最需要看进度）」与「顶栏按用户偏好隐藏」直接冲突。

定案策略：

| `localPrefs.topBar` | 空闲 | 任务在跑 |
| --- | --- | --- |
| `pinned`（默认） | 显示 | 显示 |
| `auto` | 跟随鼠标 | **强制显示** |
| `hidden` | 隐藏 | 隐藏（尊重用户选择），**进度轨降级到活动栏** |

实现要点：`topVisible = topBar === 'hidden' ? false : topBar === 'pinned' || revealed || inFlight`，其中 `inFlight = taskInFlight(task)`。ActivityBar 只在 `topBar === 'hidden'` 时渲染自己的进度轨——**同一时刻全树只有一条活跃进度轨**，`app.test.tsx` 有断言守着这一点。

`hidden` 分支不新增常驻条，是因为「顶栏隐藏后凭空多出一条」本身就是坏体验；复用活动栏已有的位置更自然。

---

## 5. API / 事件契约

> **本节的「状态」列是硬约束。标「已存在」的一律不要新建。** v1 任务书把其中五条写成「需新建」，照做会造出重复命名并让进度条永远对不上引擎。

### 5.1 Command

| Command | 状态 | 位置 / 说明 |
| --- | --- | --- |
| `submit_task` | **已存在** | `core/types/events.ts:219`，payload `{ sessionId, intent, workspace }`。提案：增**可选** `mode?: 'chat'\|'plan'\|'math'`（可选以保证兼容）。UI 目前**不发**这个字段 |
| `approve_plan` / `reject_plan` / `edit_plan` / `set_plan_approval` | **已存在** | `cli/src/server/EngineServer.ts:329-341` 全部已处理；`harness/src/loop/AgentLoop.ts:214` 有 plan gate。**计划模式零后端需求** |
| `approve_tool` / `deny_tool` | **已存在** | 工具级审批，与计划审批不同层 |
| `pause_task` / `resume_task` / `cancel_task` / `intervene_goal` | **已存在** | 活动栏在用 |
| `rollback_step` / `select_provider` | **已存在** | live 引擎返回硬错误 → UI 禁用并显示原因（`c2127fa`） |
| `new_session` / `select_session` | **已存在** | |
| `list_memories` / `get_memory` / `list_forget_log` / `list_reactivation_due` / `mark_memory_incorrect` / `forget_memory` / `promote_memory` / `get_memory_health` / `list_recall_history` | **已存在** | 记忆面板 |
| `math.start_session` | **新增** | 创建数模会话（假设 / 变量容器）。返回 `{ sessionId }` |
| `math.update_model` | **新增** | 更新假设 / 变量 / 方程 |
| `math.solve` | **新增** | 触发求解；映射到现有 `math.exec` 工具 |
| `math.verify` | **新增** | 校验解 |
| `math.export_report` | **新增** | 报告导出 |
| `set_ui_mode` | **建议不做** | 见 §4.2 |

新增命令的唯一登记处是 `packages/core/src/types/events.ts` 的 `CommandMap`。

### 5.2 SSE / DomainEvent

**已存在，UI 正在消费，不要重建：**

| 事件 | payload（照抄） | UI 用途 |
| --- | --- | --- |
| `task.progress` | `{ progress: number(0..1), currentStepIdx: number, totalSteps: number }` | 对话模式进度轨的主数据源 |
| `task.status_changed` | `{ from, to, reason }` | 计划生命周期映射（`awaiting-approval` 经此回流） |
| `task.phase_changed` | `{ phase }` | 阶段显示 |
| `task.received` / `task.clarified` / `task.completed` / `task.failed` / `task.cancelled` / `task.paused` / `task.resumed` / `task.intervened` | 见源码 | 任务生命周期 |
| `plan.started` | `{ mode: 'fast' \| 'full' }` | 计划起草 |
| `plan.ready` | `{ plan }` | **计划模式用这个，不要造 `plan.drafted`** |
| `plan.revised` / `plan.failed` | 见源码 | |
| `step.started` / `step.completed` / `step.failed` / `step.skipped` | 见源码 | 步级进度 |
| `tool.*` / `verify.*` / `context.*` / `reliability.*` / `recovery.*` / `subagent.*` / `provider.*` / `checkpoint.created` / `memory.*` / `selfreview.*` / `tool.usage_injected` / `log` / `metric` | 见 `events.ts` | 右轨与可靠性面 |

**确实不存在，属新增（全部归 M-MATH-1）：**

| 事件 | payload 提案 |
| --- | --- |
| `math.stage` | `{ sessionId, stage: 'modeling'\|'solving'\|'verifying'\|'reporting', ratio: 0..1, message? }` |
| `math.variable_updated` | `{ sessionId, variables: {symbol,name,unit,value,source}[] }` |
| `math.equation_updated` | `{ sessionId, equations: {text,note}[] }` |
| `math.solver_status` | `{ sessionId, status: 'idle'\|'running'\|'converged'\|'failed', iter?, residual?, error? }` |
| `math.result` | `{ sessionId, cards: {label,value,unit?,hint?}[] }` |
| `math.failed` | `{ sessionId, code, message }` |

**兼容策略（强制）**：`deriveProgress` 必须能在「只有旧事件」的引擎上工作。当前实现是：有 `task.progress` 就按它映射到 7 步 template 轴，否则按已完成步数，否则 demo，否则空态。**任何情况下不得显示假进度**。`math.stage` 到位后只需改 `deriveProgress` 里的一个分支（已留好注释标记）。

可选提案：`task.progress` 增 `label?: string`（步骤短名）。当前 UI 自己从 `task.steps[currentStepIdx].title` 取，能工作，但引擎自己知道得更准。

### 5.3 错误码

| 机器可读 | 中文人话（UI 已实现的位置） |
| --- | --- |
| `engine unreachable` | 「未连接引擎 — offline fixture cannot run a live model」（`fixture.ts`，**保留**） |
| `engineSpawnError`（boot 注入） | `EngineBanner` 红条 + `engine.log` 一键打开。ABI 错误含 `Node/better-sqlite3 ABI mismatch` 原文与补救指引 |
| `rollback_step` 不可用 | 「实时引擎尚未提供回滚。」（`intervene.rollbackUnavailable`） |
| `select_provider` 不可用 | 「实时引擎尚未支持运行中切换服务商。」 |
| `math_solve` 不可用 | 「the engine exposes no math commands yet — math.exec is only a tool」 |
| `math_export_report` 不可用 | 「no report writer exists on the engine yet」 |
| 未知能力 | fail-closed：「this capability is not implemented」 |

规律：**机器可读码不进 UI**，UI 只显示可行动的句子。

### 5.4 引擎能力自报（提案，非现状）

现状：`ProviderCapabilities`（`core/types/domain.ts:336`）的形状是

```ts
{ supportsTools, textToolCalls?, supportsJson, supportsStreaming, maxContextWindow, quality }
```

它描述的是**模型调用的能力**，不是 UI 能力。不要往里塞 `rollback` / `mathModeling` / `planApproval`。UI 侧的能力门控是 `packages/ui/src/window/capabilities.ts` 的硬编码两轴表。

提案：新增一个 `ui.capabilities` 事件（或 bootstrap 字段）：

```ts
{ rollback, intervene, selectProvider, memory, planApproval, mathModeling, progressEvents, mathExport }
```

**迁移路径（必须保留 fallback）**：
1. 引擎开始发 `ui.capabilities` → store 存下来。
2. `capabilities.ts` 改为：有自报字段则以它为准；没有则用现有硬编码两轴表。
3. **未知一律视为不支持**。诚实优先于便利。

这条不阻塞任何里程碑——现有硬编码表能正常工作。

### 5.5 验收用 fixture 场景

`SceneId` 现有 10 个：`empty | connecting | planning | plan | diff | running | approval | failure | error | done`，本次新增 **`math-demo`**（共 11 个）。

**`math-demo` 刻意零事件。** 演示数据是窗口 chrome，不是引擎状态；如果让它走事件流，它会 fold 进 `snapshot`，于是一个脚本化的模型和真模型在投影层完全无法区分。所以它只做两件事：`store.setMathDemo(...)` 与 `store.setMode('math')`（`modes/math/demoBoot.ts`）。结果是这个场景下 `Offline` 徽章与 `演示` 角标同时显示——这是诚实的。

**不要新建 `plan-demo`**：`plan` 场景已存在且足够。

---

## 6. 里程碑计划（给便宜 AI）

### 6.0 与 CAMELIA-ROADMAP 的映射

本计划书用独立编号（派工粒度），每个里程碑标注它服务 ROADMAP 的哪一档（产品粒度）。

| 本计划书 | ROADMAP | 关系 |
| --- | --- | --- |
| M-UI-1 | 横切（M3/M4/M5 共同前置） | UI 尾巴。本次已基本完成，仅剩接线 |
| M-ENG-1 | M2（引擎诚实度） | `task.progress` 消费已通，这个里程碑是**补 `label`** 与自报能力 |
| M-ENG-2 | M4（记忆/事件/Checkpoint 闭环） | 计划审阅的 UI 真路径（引擎侧已实现） |
| M-MATH-1 | M8 第⑤项（数学预设产品化） | 真新增后端 |
| M-MATH-2 | M8 第⑤项延续 | 报告导出 / 可视化 |
| M-QA | M7（质量闸与真实模型回归） | 桌面 e2e 含模式切换与进度 |

统一规则：**每个里程碑只开一个新会话，做完就结。** 验收以 §7 勾选为准，不以模型自称 done 为准。

---

### M-UI-1 · UI 收尾（本次已交付，列此备查）

- **目标**：模式 + 进度 + 数模工作区落地，测试绿。
- **状态**：✅ 本次完成。`pnpm --filter @camelia/ui test` 200 passed / 17 files；`tsc --noEmit` 干净；`eslint src` 干净；`vite build` 成功。
- **遗留（下一里程碑可选）**：
  - [ ] 桌面壳窗口标题仍是默认值；可改为「Camelia (预览)」与品牌过渡一致（`apps/desktop/src-tauri/src/main.rs`，纯壳）
  - [ ] `?scene=math-demo` 尚未接进桌面壳的 `--scene=` 参数链路（浏览器预览可用）
- **禁止**：动 `agent` / `harness` / `core` / `cli`。
- **模型档位**：任一中档即可（工作量为零到极小）。

---

### M-ENG-1 · 进度事件接线（`progressEvents` + `label`）

- **目标**：让顶栏微文案不再自己猜步骤名，并让引擎自报能力。
- **前置事实**：`task.progress` **已存在**（`AgentLoop.ts:876` emit，`snapshot.ts:683` fold）。**不要新建它。**
- **任务**：
  - [ ] `core/types/events.ts`：`task.progress` payload 增**可选** `label?: string`（保持向后兼容，老引擎不发也能跑）
  - [ ] `harness/src/loop/AgentLoop.ts`：emit 时带上当前步骤的短标题
  - [ ] `agent/src/view/snapshot.ts`：fold 时存进 `TaskView`（新字段，如 `progressLabel?`）
  - [ ] `ui/src/progress/deriveProgress.ts`：`activeStepLabel()` 优先读 `progressLabel`，回退到现有 `steps[currentStepIdx].title` 逻辑
  - [ ] （可选）`ui.capabilities` 事件 + `window/capabilities.ts` 的 fallback 迁移，按 §5.4
  - [ ] 测试：老 payload（无 label）仍解析；新 payload 的 label 出现在顶栏文案
- **验收**：`running` 场景下顶栏微文案与活动栏都显示引擎给的步骤名；关掉 label 字段后仍不崩。
- **禁止**：改判定逻辑；改 UI 布局；新增必填字段。
- **模型档位**：中档（Composer / GLM / Kimi 级别足够）。

---

### M-ENG-2 · 计划审批的 UI 真路径

- **目标**：让计划模式在 **live 引擎**下可用（引擎侧早已实现，本次只补 UI 与端到端验证）。
- **前置事实**：`approve_plan` / `reject_plan` / `edit_plan` / `set_plan_approval` 在 `EngineServer.ts:329-341` 已全部处理。**这不是后端任务。**
- **任务**：
  - [ ] 桌面/浏览器连 live 引擎，提交一个会产出计划的真实任务
  - [ ] 验证：`plan.ready` → `task.status_changed → awaiting-approval` → 计划模式生命周期条显示「待批准」（琥珀）
  - [ ] 在 `PlanReview` 里编辑一步（改标题 / 顺序）→ 确认 `edit_plan` 到达引擎且投影更新
  - [ ] 批准 → 确认转为「执行中」并开始跑步骤
  - [ ] 拒绝 → 确认转「已拒绝」红态且任务终止
  - [ ] 切到对话模式再切回 → 确认审批状态没丢（同一投影）
  - [ ] 补 e2e 覆盖（见 M-QA）
- **验收**：live 引擎下四站全部可复现；`set_plan_approval: 'auto'` 时不再弹待批准。
- **禁止**：重写 `PlanReview` 的视觉；改 `AgentLoop` 的 plan gate 行为。
- **模型档位**：中档。

---

### M-MATH-1 · `math.*` 命令接 `math.exec`（真新增）

- **目标**：数模模式从演示变成真功能。
- **前置事实**（照抄，别猜）：
  - 工具名 `math.exec`，参数 `{ code, name?, timeoutMs? }`
  - 实现：写 `.camelia/math/<slug>.py` → `ctx.shell.exec('python <file>')`（Agg 后端）
  - 返回 `{ script, code, stdout, stderr, figurePaths[], timedOut }`
  - 求解器是 **Python + sympy/numpy/scipy/matplotlib**，不是专用 solver
  - 引擎真实注入的 pipeline 是 **7 步**（`MATH_MODELING_STEP_TEMPLATE`，由 `prompts/system.ts:167` 注入）。
    ⚠️ 同一文件里还有一个 8 项的 `MATH_MODELING_SYSTEM_SUFFIX`，但**它没有被任何代码引用**，只是 prompt 文本。
    不要照它做进度轴——UI 的 `mathStageMap.ts` 已经按 7 步对齐，并有测试读源码守着。
  - 探测器 `looksLikeMathModeling(task)` 已存在
  - `EngineServer.ts` 目前**没有任何 math 分支**
- **任务**：
  - [ ] `core/types/events.ts`：`CommandMap` 增 `math.start_session` / `math.update_model` / `math.solve` / `math.verify` / `math.export_report`
  - [ ] `core/types/events.ts`：`DomainEventMap` 增 §5.2 的六个 `math.*` 事件
  - [ ] `cli/src/server/EngineServer.ts`：五个命令的分派
  - [ ] `harness`：数模会话状态（假设 / 变量 / 方程容器），`solve` 走 `math.exec`
  - [ ] `harness`：阶段推进时 emit `math.stage`（映射到 7 步 template 轴；UI 的 `mathStageMap.ts` 已经是这个轴，
        且 `math-stage-map.test.ts` 会读 harness 源码验证对齐——改了 template 就要同步改 UI 表）
  - [ ] `agent/src/view/snapshot.ts`：fold `math.*` 到 `TaskView`（或独立投影切片）
  - [ ] `ui/src/progress/deriveProgress.ts`：接上 `math.stage` 分支（注释已标好位置）
  - [ ] `ui/src/modes/math/MathWorkspace.tsx`：把演示开关与真实会话分开——`mathDemo` 存在时显示演示，否则显示引擎数据
  - [ ] `ui/src/window/capabilities.ts`：live 侧把 `math_solve` / `math_export_report` 的 reason 清空
- **验收**：
  - [ ] 提交「建立 SIR 模型」类任务 → 数模模式出现真实假设/变量/方程
  - [ ] 点「运行本阶段」真的跑 `math.exec`，`stdout` 出现在求解输出面板
  - [ ] 进度条走四段，与引擎注入的 7 步一致（`math-stage-map.test.ts` 的断言继续通过）
  - [ ] 断网/无 Python 时诚实报错，不假成功
  - [ ] `figurePaths` 里的图至少能列出（渲染可延后到 M-MATH-2）
- **禁止**：伪造求解结果；跳过 `math.exec` 直接返回硬编码答案；改 §5.2 已有的旧事件。
- **模型档位**：**高档**（这是本次唯一真正复杂的后端切片，建议用较强模型）。

---

### M-MATH-2 · 报告导出与可视化

- **目标**：结果卡能导出、`figurePaths` 能显示。
- **任务**：
  - [ ] `math.export_report` 落地：把假设 / 变量 / 方程 / 结果 / 图写成 Markdown 或 HTML 到工作区
  - [ ] UI 的「导出报告」按钮启用（`capabilities.ts` 的 reason 清空）
  - [ ] `ResultCards` 支持图片预览（`math.exec` 返回的 `figurePaths`）
  - [ ] 导出成功后给出可点击的文件路径（沿用现有 artifact 行样式）
- **验收**：导出文件存在且内容完整；图片能显示；导出失败时说明原因。
- **禁止**：导出到工作区之外；静默覆盖已有文件。
- **模型档位**：中档。

---

### M-QA · 桌面 e2e 含模式切换与进度

- **目标**：把「测试绿」和「能干活」画等号（ROADMAP M7）。
- **任务**：
  - [ ] 冷启动 → Live → hello（已部分存在）
  - [ ] 模式切换 e2e：对话跑任务 → 切数模 → 确认任务存活 + 条带出现 → 切回 → 确认进度连续
  - [ ] 顶栏常显 e2e：`topBar: 'auto'` + 任务运行 → 等 >400ms → 确认顶栏仍可见
  - [ ] `topBar: 'hidden'` e2e：确认进度轨出现在活动栏
  - [ ] 计划审批 e2e（live 引擎）：待批准 → 批准 → 执行
  - [ ] 数模 e2e（M-MATH-1 后）：真实求解一次
  - [ ] 回归：右轨冷启折叠；`showAvatars: false` 后无头像元素
  - [ ] 失败自动归档截图 + `record.json`
- **验收**：三闸全绿（`pnpm test` + `usable-check` + 桌面 e2e）才允许标 RC。
- **禁止**：用 mock 冒充真实模型验收——ACCEPTANCE 必须分栏标注。
- **模型档位**：中档。

---

## 7. 验收清单（Acceptance）

### 7.1 UI 视觉 / 交互（本次交付，均已通过自动化或可手工复现）

- [x] 冷启动右轨折叠（`--rail-right-w = 48px`）——`app.test.tsx` 断言
- [x] 顶栏含品牌过渡位 + 三模式 Tabs + 进度区域 + 连接徽章
- [x] `.wf-dash-brand` / `.wf-orange-tag` / `.wf-dash` 已从代码与样式表移除
- [x] 有运行中任务时顶栏在 `topBar: 'auto'` 下常显（`taskInFlight` 参与 `topVisible`）
- [x] `topBar: 'hidden'` 时进度轨降级到活动栏，且**全树只有一条**（`app.test.tsx`）
- [x] 切换 对话/计划/数模：中区结构明显变化（`data-mode-shell` 断言）
- [x] 运行中切换任务不丢（`snapshot.task` 引用不变、无新命令）
- [x] 目标模式有回看条带 + 一键返回（`data-cross-mode-strip`）
- [x] 计划模式：生命周期四站 + `PlanReview` 主体 + 批准/拒绝入口
- [x] 数模模式：假设 / 变量 / 方程 / 求解状态 / 结果卡 + 阶段进度
- [x] 数模演示角标正确，且**不自动播放**
- [x] 数模四段映射到后端**注入的 7 步**（`math-stage-map.test.ts` 直接读 harness 源码断言，覆盖无缺口无重叠）
- [x] 进度条与任务步骤 / 数模阶段联动；顶栏与活动栏同源
- [x] 微信头像、Settings 四分区、连接预设、诚实干预未回归
- [x] zh 模式无新增英文裸串（右轨 tab 标签也已 i18n 化）
- [x] Offline / fixture 仍诚实，不假 live

### 7.2 契约兼容

- [x] 未新建任何已存在的事件或命令（对照 §5.1 / §5.2 的「已存在」列）
- [x] `deriveProgress` 在「只有旧事件」的引擎上工作（派生路径有测试）
- [x] 演示数据走 `store.mathDemo` 独立字段，**未** fold 进 `snapshot`
- [x] `prefs v4` 未被绕过；新字段走 `sanitizeLocalPrefs` 白名单

### 7.3 工程卫生

- [x] `pnpm --filter @camelia/ui test` → 17 files / 208 tests passed
- [x] `tsc -p tsconfig.json --noEmit` 干净
- [x] `eslint src` 干净（并修掉一条既存的 `prefer-const`）
- [x] `vite build` 成功（454 kB / gzip 134 kB）
- [x] diff 范围：仅 `packages/ui/**` + 本文档 + `OPUS-UI-REFORM-PROMPT-v2.md`，**未触碰** `agent` / `harness` / `core` / `cli` / `apps/desktop`
- [x] 经一次**独立核验**（第 11.5 节），核验发现的四类问题已全部修正

---

## 8. 非目标（Non-goals）

明确不做，且不因为「顺手」而做：

1. **不修 Node ABI / better-sqlite3** —— 已在 `2c20208` / `5762b47` 轨道完成。
2. **不实现真正的求解器或 `math.exec` 内部** —— 那是 M-MATH-1。
3. **不做插件市场、多人对战、移动端。**
4. **不把右轨改回默认展开。** 这是 `f5592c3` 的产品决策，`loadLocalPrefs` 每次启动强制折叠。
5. **不引入新桌面框架**（不换 Electron）。
6. **不换状态库。** Zustand 保留；模式与演示数据是新增字段，不是重构理由。
7. **不用 mock 冒充真实模型成功。**
8. **不新建 §5.1 / §5.2 中已存在的名字。**
9. **不改 `ProviderCapabilities` 的形状** —— UI 能力不走它（§5.4）。
10. **不做 LaTeX 渲染。** 方程面板当前是等宽纯文本。引入渲染器是一个独立决策（体积、字体、XSS 面），不该混在本次改动里。
11. **不做数模模型的编辑持久化。** 方程面板的编辑按钮恒为 disabled 并说明原因——没有后端模型存储时，一个能编辑却存不下去的输入框比禁用它更糟。

---

## 9. 风险与缓解

| ID | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | **进度双源不同步**（顶栏 vs 活动栏） | 用户无法判断哪个是真的 | 单一 `deriveProgress`；两处渲染点互斥（同时刻只有一条活跃轨）；`app.test.tsx` 断言 |
| R2 | **模式切换丢任务** | 用户以为工作停了 | 任务不在模式里，切模式不动 `snapshot`；跨模式条带显式告知 |
| R3 | **演示被当成 live** | 最严重的信任损失 | `mathDemo` 独立字段 + 永久角标 + 模式 `available: false` + 常驻横幅 + 显式加载 + `math-demo` 场景零事件 |
| R4 | **顶栏隐藏时进度消失** | 用户失去唯一进度来源 | `hidden` 分支降级到活动栏；顶栏在离屏时**不再挂载**进度节点，所以全树确实只有一条；断言守着这一点 |
| R5 | **数模阶段与后端 pipeline 错位** | 进度条永远到不了 100% 或提前到 | `mathStageMap.ts` 显式映射到 **7 步注入 template**；`math-stage-map.test.ts` **读取 harness 源码**断言步数与无缺口无重叠 + 单调递增。若只比对 UI 自己的常量，这个测试就是废的 |
| R6 | **品牌返工** | 文案与图标二次返工 | 只做过渡（`brand.transition` = Camelia）+ 候选表（§10）；不写死最终名 |
| R7 | **范围吞掉计划书** | 交付不全 | 先落 TopBar+ModeTabs+Progress 垂直切片，再写书；两者都已交付 |
| R8 | **新建重复事件 / 命令名** | 引擎与 UI 各认一套，契约撕裂 | §5.1 / §5.2 的「已存在」列是硬约束；M-MATH-1 开工前先对照 |
| R9 | **提交时带上 CRLF churn 与 `.tmp-*`** | diff 不可读，评审失效 | 提交前 `git diff --ignore-cr-at-eol` 自查；只 `git add` 实际改动文件。仓库有 **23 个 `.tmp-*` 已入库**（`.tmp-fix-*.mjs` / `.tmp-patch-*.mjs` / `.tmp-desktop-probe.png` / `.tmp-serve/`）；`.gitignore` 只忽略 `*.log` |
| R10 | **文档行尾噪音持续** | 每次 diff 都淹在 CRLF 里 | 建议补 `.gitattributes`：`* text=auto eol=lf`。当前 `docs/` 一批文件的 `M` 状态是**纯 CRLF churn，零内容差异**——不要「还原」它们，也不要提交 |
| R11 | **引擎自报能力长期缺席** | 能力门控靠硬编码，会过时 | 硬编码两轴表本身可工作；§5.4 给了迁移路径与 fallback；未知 fail-closed |
| R12 | **`math.exec` 依赖本机 Python** | 无 Python 的机器数模全废 | M-MATH-1 验收里明确要求「无 Python 时诚实报错，不假成功」；长期应进 doctor 检查 |

### 9.1 顺带发现的仓库卫生问题（本任务未改，请排期）

- **23 个 `.tmp-*` 文件已被 commit**，`.gitignore` 不覆盖。建议清理并补 `!.gitignore` 规则。
- **无 `.gitattributes`**，导致 docs 与 `.tmp-*` 大面积行尾 churn（见 R10）。
- **`.node-version` 实际字节是 `22\n\r\n`**（LF + CRLF 混用）。`nvm` / `fnm` 能解析，但建议规范为单行 `22\n`。
- **`AGENTS.md` 顶部的 turborepo 块由 turbo 自动写入并维护** —— 不要手改，改动会在下次 agent 调用时被重新加回；要关掉得设 `turbo.json` 的 `"agentGuidance": false`。

---

## 10. 品牌候选（仅选项，不锁死）

本次**没有**决定品牌名，只把「TBD 告示」换成了中性的过渡表现。

| 候选 | 调性 | 备注 |
| --- | --- | --- |
| **Camelia + 山茶花几何标**（过渡推荐） | 与代码名一致，零认知成本 | 最快去掉刺眼文案；`primitives.tsx` 已有 `camellia` 图标 |
| 山茶 / Camellia 中文名 | 更亲切，中国区友好 | 需查重名与商标 |
| 双名：中文产品名 + Camelia | 中国区 + 国际化兼顾 | 安装包名与 `desktop.json` 需一致 |

**当前实现状态**：`brand.transition` = `Camelia`，`brand.placeholder.hint` = 「最终名称与吉祥物待产品决策。」。三处使用（顶栏品牌槽、空态品牌位、设置 About）。

**禁止**：随机起新英文名并写死进产品。About 页应写「最终名称待产品决策」，而不是假装已定。

---

## 11. 交接说明

### 11.1 怎么把这本书喂给其他模型

1. **新会话，用更便宜 / 更快的模型。**
2. 粘贴本书全文，并**指定一个里程碑**（例如「只做 M-ENG-1」）。
3. 附一句约束：

   > 只实现该里程碑；UI 已由 Opus 完成，不要重做 UI；保持诚实干预与分层（ui → agent → harness → core）；测试 + 中文错误信息；注意 `task.progress` / `plan.ready` / `awaiting-approval` / `approve_plan` 等**已存在**，不要新建同名事件或命令。

4. **每个里程碑开新会话**，避免上下文腐烂。
5. 验收以 §7 勾选为准，**不以模型自称 done 为准**。

### 11.2 推荐工单顺序

```
M-ENG-1  (小, 中档模型)   → 补 label + 自报能力，拓扑独立
M-ENG-2  (小, 中档模型)   → 计划审批 e2e，引擎侧已就绪
M-MATH-1 (大, 高档模型)   → math.* 命令与事件，本次唯一真后端切片
M-MATH-2 (中, 中档模型)   → 报告导出与可视化
M-QA     (中, 中档模型)   → 桌面 e2e，可与上面并行推进
```

M-ENG-1 与 M-ENG-2 无依赖，可并行。M-MATH-2 依赖 M-MATH-1。M-QA 的对应用例应随各里程碑一起补，最后统一收口。

### 11.3 开工前必查

**在写第一行代码之前**，对照 §5.1 / §5.2 的「已存在」列确认没有重复造名。v1 任务书在这里错了五处，代价是契约撕裂——这类错误在引擎里不会报错，只会在某天让进度条对不上。

### 11.5 独立核验记录（本次交付的一部分）

交付前做了一次**独立核验**（由另一个 agent 完成，任务是「找出哪里不对」而不是「确认没问题」）。
它确认了 10 条主张中的大部分，并抓出以下问题——**全部已修正**，记录在此以便后续里程碑不重蹈：

| 问题 | 严重度 | 修正 |
| --- | --- | --- |
| **审批面在对话模式下不可达** —— 移除内部 tab 条后没有补自动路由，等待批准的任务没有任何批准/拒绝入口 | **P0 回归** | `ModeShell` 加 auto-route + `dismissed` 集合；新增 `plan approval is always reachable` 测试块（已验证：注释掉修复即红） |
| **阶段映射对错了 pipeline** —— UI 按 `MATH_MODELING_SYSTEM_SUFFIX` 的 8 项散文排进度，而引擎实际注入的是 `MATH_MODELING_STEP_TEMPLATE` 的 **7 步**；前者没有任何代码引用 | **高** | `mathStageMap.ts` 改按 7 步对齐；`ENGINE_MATH_STEPS = 7` |
| **漂移测试是废的** —— 它只比对 UI 自己声明的常量，改 harness 永远不会红（与它的注释承诺相反） | **高** | 测试改为**读取 `math-modeling.ts` 源码**解析 template，断言步数与覆盖范围 |
| **演示帧不同步** —— 顶栏/活动栏读 `MATH_DEMO_FIRST`，工作区自己走帧序列，于是进度轨停在第 0 帧并显示过期阶段 | 中 | 当前帧改由 **store 单一持有**（`setMathDemo(MATH_DEMO_FRAMES[i+1])`），三个消费者读同一个值 |
| **离屏仍挂载进度节点** —— `topBar:'hidden'` 时顶栏的进度轨仍在树里，`[data-progress-kind]` 会数出 2 个 | 低 | 顶栏在未 reveal 时不再挂载进度节点 |
| **导出按钮用错文案** —— 挂了方程面板的「需要后端模型存储」tooltip，而 `capabilities.ts` 里正确的导出原因从未被调用 | 低 | `ResultCards` 改调 `canIntervene('math_export_report')` / `interveneUnavailableReason(...)` |
| **一条同义反复断言** —— `expect(['modeling',...]).toEqual(order)` 比较两个字面量，永不失败 | 低 | 换成对 `MATH_DEMO_FRAMES` 的真实断言（阶段单调 + 覆盖四段 + 终帧 `done`） |
| 死代码：`void elapsed`、`void lang`、`MathStage` 未用导入 | 低 | 已删 |
| `cursor-not-allowed` 在「未禁用」分支 | 低 | 已改正（该控件恒为 inert） |
| 测试计数声称 200，实为 208（核验前） | 低 | 文档已更正 |

核验同时确认**没有**发现的问题（值得记录，因为它们是最要紧的）：

- 未新建任何已存在的事件/命令（`core/types/events.ts` 的 diff 为空）。
- `prefs v4` 未回退：持久化的 `{rightCollapsed:false, userSetRightRail:true}` 重启后确实被强制折叠。
- 演示数据**无任何路径**进入 `snapshot`；`math-demo` 场景确实零事件。
- 既有测试没有被削弱（唯一改动是跟随 `h-9 → h-11` 的高度断言，以及一处 `getByText → getAllByText`，
  因为步骤文案现在合理地出现两处）。

**关于仓库行尾**：核验指出 `git status` 有 86 个内容脏文件、其中大部分是 CRLF churn。
经核对 mtime，这些**在我本次 UI 编辑之前就已是脏的**（15:34–17:01，我的编辑从 18:52 起），
且 `git diff --ignore-cr-at-eol` 对这些文件为空。所以它们不是本次改动造成的——
但**提交时必须只 `git add` 实际改动的文件**，否则会把 CLI server、agent 投影、Rust 壳的
「改动」一起带进去（见 §9 的 R9 / R10）。

### 11.4 关键文件索引

| 你要找什么 | 去哪 |
| --- | --- |
| 唯一进度派生 | `packages/ui/src/progress/deriveProgress.ts` |
| 数模 4→7 步映射（含读 harness 源码的漂移测试） | `packages/ui/src/modes/math/mathStageMap.ts` + `packages/ui/test/math-stage-map.test.ts` |
| 能力门控（两轴） | `packages/ui/src/window/capabilities.ts` |
| 事件与命令登记处 | `packages/core/src/types/events.ts` |
| 投影（TaskView 等） | `packages/agent/src/view/snapshot.ts` |
| 命令处理 | `packages/cli/src/server/EngineServer.ts` |
| 数模工具 | `packages/harness/src/tools/builtin/math-tools.ts` |
| 数模 pipeline 预设 | `packages/harness/src/prompts/math-modeling.ts` |
| 产品方向书 | `docs/CAMELIA-ROADMAP.md` |
