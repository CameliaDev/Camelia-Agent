# Iteration 23 —— 目标模式提示词（Goal Prompt）

> 用途：本文件是 **AI 开发中「目标模式」的输入**。把整个文件作为目标提示词交给
> 执行 Agent，它会按 5 个阶段串行推进，每阶段独立门禁。
>
> 本文件是任务书，不是设计文档。设计理由散落在 `WHITEPAPER.md` 与
> `ITERATION_LOG.md` 中，此处只写**做什么、约束是什么、怎么验收**。

---

## 范围声明

本迭代同时推进四条线，**分 5 个阶段串行执行，每阶段独立门禁**：

| 线 | 内容 | 阶段 |
| --- | --- | --- |
| **A** | UI 地基重构（布局 / 折叠 / 拖拽 / 设置 / 主题 / 图标 / 字体） | 阶段 1 |
| **B** | 计划门（状态机 + 命令 + 计划审阅视图） | 阶段 2 |
| **E** | 路径枚举（攻 M2，Iteration 18.1 的未实施修法） | 阶段 3 |
| **C** | 动态模型路由（便宜先试 / 难度路由 / 可观测 / 成本预算） | 阶段 4 |
| **D** | 失效模式注册表 + 项目档案 + 可复现运行 + 卫生 | 阶段 5 |

**任一阶段门禁未过，禁止进入下一阶段。**

---

## 第零节 · 绝对约束（违反即失败）

1. **分层单向依赖** `ui → agent → harness → core`，**禁止反向**。
2. 技术栈锁定：Tauri 2.x / React 19 / Vite / Tailwind v4 / Zustand /
   better-sqlite3。**UI 侧禁止新增运行时 npm 依赖**（含图标库）。
3. **向后兼容硬要求**：任何既有测试的**预期行为不得修改**来迁就新代码。
   若某测试因新功能必须改，**必须在报告中逐条说明"为什么这是行为演进而非回归"**。
4. **数据迁移必须可逆**：`SCHEMA_VERSION` 递增时，旧数据必须能读。
5. 设计令牌**名不变**：`--color-base:#1a1514`、`--color-elevated:#221b19`、
   `--color-panel:#2a2220`、`--color-ink:#f7efe9`、`--color-accent:#d96c5f`。
   值可被主题覆盖，**令牌名不得重命名**。
6. **API Key 只存 `~/.camelia/`，零遥测**（延续既有约束）。
7. 全英文界面文案（本轮不做 i18n）。

---

## 阶段 1 · UI 地基（纯 UI，零引擎改动）

> 风险最低，先做。**本阶段不得触碰 `packages/*/src` 中除 `ui` 外的任何包。**

### 1.1 宽度收敛为单一来源

现状三处硬编码且互不感知：

```
packages/ui/src/App.tsx                     grid-cols-[260px_1fr_360px]
packages/ui/src/components/SessionRail.tsx  w-[260px] shrink-0
packages/ui/src/components/RightRail.tsx    w-[360px] shrink-0
```

**要求**：改为由 CSS 自定义属性驱动（`--rail-left-w` / `--rail-right-w`）
或等价内联 style。**不得留在 Tailwind 静态类名里**（静态类无法在拖拽时变化）。

### 1.2 两侧可全折叠

- 折叠态 = 48px 竖条，只保留展开图标（+ 必要计数 / 状态点），点击展开。
- 中栏在**任何折叠组合**下都自适应占满剩余（`1fr` 语义不变）。
- 过渡 ≤ 180ms；`prefers-reduced-motion` 时禁用。
- 折叠态竖条必须可悬停 tooltip。

### 1.3 两侧可拖拽调宽

- 分隔条：视觉 1px，**命中区 ≥ 6px**，光标 `col-resize`。
- 范围：左 200–420px，右 280–560px。拖动时**不得触发文本选中**。
- 双击分隔条 = 恢复默认（左 260 / 右 360）。折叠态下不可拖。

### 1.4 Composer 与 TopBar 范围修正

- **Composer 只占中栏宽度**，不再横跨全窗。
- **TopBar 默认隐藏**：鼠标进入窗口顶部 8px 热区或按快捷键时出现；
  离开 / Esc 后收起（延迟 ≥ 400ms 防闪）。**隐藏态窗口仍可拖动。**
- TopBar 常驻元素砍到 **3 项**：品牌图标、当前 phase（或 task status）、连接状态点。
  session 标题 / provider chip / ctx 用量**移入右栏顶部**。
- **删除装饰性标语** `"Warm intelligence, sharp code."`（可移入品牌 tooltip）。

### 1.5 窗口行为

- `tauri.conf.json`：`decorations: false`；顶栏自绘
  最小化 / 最大化-还原 / 关闭（仅图标，Windows 惯例靠右）。
- 四边四角可拖拽缩放（`startResizeDragging` 或等价能力）。
- **Windows hit-test / snap 必须真机实测**：拖到屏幕上边缘贴边最大化，
  拖到左 / 右边缘半屏。**不得仅凭代码推断。**
- 默认窗口尺寸：`1440×900` → **`1280×820`**。`min_inner_size` 保持 `1024×680`。

### 1.6 偏好持久化机制（**新建**，当前不存在）

现状：无 `tauri-plugin-store`，无 localStorage 封装。

**要求**：新建持久化层，存：窗口位置 / 尺寸 / 最大化状态、折叠状态、
两侧宽度、主题选择、TopBar 显隐偏好。

**方案选择（必须二选一并在报告中说明理由）**：

- (a) 前端 `localStorage` 封装（零新依赖，**推荐**——本轮偏好均为本窗口级）；
- (b) Tauri 侧持久化（需引入插件，**引入插件必须在报告中显式标注**）。

### 1.7 架构诚实：localPrefs 切片

`packages/ui/src/state/store.ts` 的注释写明「store 不发明业务状态」。
本轮的折叠 / 宽度 / 主题 / 窗口偏好是**唯一新增的合法例外**，必须：

- 在 store 中划出独立的 `localPrefs` 切片；
- 在模块注释中说明为何是例外（对齐 `MemoryPanel`「查询面」的先例）；
- **不得与事件投影的 `snapshot` 混在一起**。

### 1.8 设置面板与主题（内置 4 套）

- 设置入口固定在顶栏或右栏底部（二选一，报告中说明理由）。
- 形态：右侧抽屉（360–420px）或居中模态，**可 Esc 关闭**。
- 面板内容（本轮范围）：
  - **外观**：主题选择、字体、TopBar 显隐、动效开关；
  - **布局**：左右栏默认宽度、默认折叠状态、「恢复默认布局」按钮；
  - **关于**：版本号、`~/.camelia` 位置、零遥测声明、许可证。
- **4 套内置主题**：`Warm Dark`（默认，即现值）/ `Cool Dark` / `Light` /
  `High Contrast`。
- **必须复用既有令牌通道** `packages/ui/src/theme/apply-theme.ts`
  （引擎侧下发 + 白名单校验）。**不得绕过白名单硬改 CSS。**
- **严禁静默失败**：若有令牌被拒，设置面板必须显示「N 个令牌被拒绝」及原因
  （读 `activeTheme.rejected`）。切换需即时预览（无需刷新）。

### 1.9 图标重绘

`packages/ui/src/components/primitives.tsx` 的 `PATHS` 有 29 个手写 SVG。

**全部重绘**为统一视觉语言：统一 `stroke-width: 2`、`stroke-linecap="round"`、
`stroke-linejoin="round"`、16×16 viewBox、内容不超出 14×14 安全区。

`camellia` 品牌图标重绘为同一语言（保留识别度）。

**新增图标**（折叠 / 展开、设置、主题、拖拽手柄）同样遵循规范。

交付**图标总览图**（全部图标同尺寸并排）供人工校验。

### 1.10 字体真实生效（「声明存在 ≠ 生效」第 4 例）

`packages/ui/src/index.css:47,60` 声明 `'Inter'` / `'JetBrains Mono'`
但**未打包字体**，实际回退 Segoe UI / Consolas。二选一，报告中说明理由：

- (a) 纳入打包（静态资源 + `@font-face`）；
- (b) 删除未生效字体名，改用系统字体栈并如实声明。

**不允许保留「声明了但用不上」的状态。**

### 阶段 1 门禁

- `pnpm typecheck` 10/10 · `pnpm lint` 6/6（**本轮不得新增 warning**，
  顺手修掉既有 1 个 `Region` unused）· `pnpm build` 5/5
- `pnpm test` 全绿，**总数不低于 986**
- `pnpm --filter @camelia/desktop desktop:build` 重建
- `node scripts/usable-check.mjs` **6/6 全绿**
- **截图证据**（写入 `docs/`，`ITERATION_LOG` 引用）：
  改前 / 后 同分辨率（1280×820）空态各 1 张；左折 / 右折 / 双折 各 1 张；
  两侧加宽后 1 张；4 套主题各 1 张（同一界面状态）。
- **Windows 贴边最大化真机实测**
- **持久化实测**：改布局 → 关窗口 → 重开 → 布局保持
- **既有任务运行态无回归**：用 `?scene=<id>` fixture 截图对比

---

## 阶段 2 · 计划门（B）

### 2.0 前置决定（已定，直接执行）

| 决定 | 结论 | 理由 |
| --- | --- | --- |
| 新状态的 `TaskPhase` 命名 | **`awaiting-approval`**（不带 `-plan-`） | 与既有 `ACTIVITY_META['waiting-approval']` 语义对齐；未来「预算超限待确认」「子 Agent 待父决策」可复用同一 phase，避免 phase 膨胀 |
| 是否新增 `TaskPhase` 成员 | **新增**（不归入 `planning`） | 归入 `planning` 会制造「UI 无法表达的引擎状态」，违反 `TaskStateMachine` 模块注释所声明的 §2.4 原则「每个状态都必须可投影到 UI」；且会让 Task 层表达能力低于 Activity 层 |
| `paused` 是否一并提升 | **一并提升为独立 phase** | 同一症状（需用户介入却归入 `idle`，视觉 tone 最弱）。同一次改动内修完成本更低；但**必须标注为行为变更**并接受回归风险 |

#### phase 提升门槛（写入代码注释，作为长期约定）

> 一个状态可以提升为独立 `TaskPhase`，**当且仅当**同时满足两条：
>
> 1. **它需要用户 / 系统的外部介入才能离开**（而非纯引擎内部推进）；
> 2. **它在 UI 上需要一个与其它 phase 不同的呈现**（不同的中栏视图 /
>    不同的可操作项）。

按此门槛复核本轮两个候选：`awaiting-approval` 与 `paused` **均满足**；
`planning` 内部的「澄清中」不满足（无需外部介入），**不提升**。

### 2.1 状态机改造（**最高风险项，单独提交**）

现状 `packages/core/src/state/TaskStateMachine.ts`：

```ts
planning: ['executing', 'failed', 'cancelled'],   // ← planning 只能去 executing
```

**要求**：在 `planning` 与 `executing` 之间引入 `awaiting-approval`。

必须同步处理（编译器穷尽性检查会协助定位，但 `TRANSITIONS` 表需手工改）：

- `TRANSITIONS` 表：
  - `planning → awaiting-approval`
  - `awaiting-approval → executing | planning | cancelled | failed`
  - （`awaiting-approval` 是唯一的「计划门」通道，`planning` 不再能直连 `executing`）
- `phaseOf()` 新增分支：`awaiting-approval → 'awaiting-approval'`；
  **`paused` 由 `'idle'` 改为 `'paused'`**（行为变更，见 2.0）
- `TaskPhase` 类型（`packages/core/src/types/domain.ts`）新增两个成员：
  `'awaiting-approval'`、`'paused'`
- UI 侧 `packages/ui/src/lib/status.ts`：
  - `PHASE_META` 补两条（`awaiting-approval` → tone `warn`；`paused` → tone `warn`）
  - `ACTIVITY_META` **已存在 `waiting-approval`，无需改**
- `pause() / resume()` 的 `resumeTarget` 逻辑：确认从 `awaiting-approval` 暂停后
  能正确恢复到 `awaiting-approval`（而非 `planning`）
- **所有既有断言状态转移的测试**：逐条列出，说明是否需要更新、为什么

### 2.2 新命令（沿用 `approve_tool` 的形状）

在 `packages/core/src/types/events.ts` 的 `CommandMap` 中新增：

```ts
'approve_plan': { taskId: Id; scope: 'once' | 'session' };
'reject_plan':  { taskId: Id; reason: string };
'edit_plan':    { taskId: Id; edits: PlanEdit[] };  // PlanEdit 具体形状由实现定义
```

`scope` 语义对齐既有 `approve_tool`：`'session'` = 本项目后续计划默认自动批准。

### 2.3 硬门，但可配置关闭

- **默认：必须人工确认才执行。**
- 设置面板 + 配置文件提供 `planApproval: 'always' | 'auto'`，默认 `always`。
- CLI 批量任务通过 `--yes` / `--auto-approve-plan` 绕过
  （**不得改变默认行为**）。

### 2.4 UI：计划从「副产品」升级为「主视图」

现状：计划只出现在右栏 `StepsSection`（辅助栏、执行中才显示）。

**要求**：`awaiting-approval` 时，中栏展示**计划审阅视图**：

- 步骤列表（含依赖关系、预计涉及文件、验证方式）；
- 每步可**编辑**（改标题 / 改路径 / 删步骤 / 调顺序 / 加步骤）；
- **Approve**（按 scope 区分）/ **Reject**（附理由）/ **Edit** 三个动作。

中栏要同时容纳「计划审阅」与「对话」，需明确切换或分区规则（在报告中说明决策）。

### 阶段 2 门禁

- 同阶段 1 全部门禁
- **新增状态转移测试**，覆盖：
  - `planning → awaiting-approval → executing`
  - `awaiting-approval → planning`（重新规划）
  - `awaiting-approval → cancelled`
  - `awaiting-approval` 下 `pause / resume` 恢复到 `awaiting-approval`
  - `scope: 'session'` 后的自动放行
  - **`paused` phase 变更的回归测试**（明确标注：这是行为变更）
- **端到端**：CLI 下 `--yes` 与默认人工确认两条路径各有实测记录
- **截图**：计划审阅视图（含编辑态）至少 2 张
- **向后兼容证明**：既有 `?scene=` fixture 场景全部仍能渲染

---

## 阶段 3 · 路径枚举（攻 M2）

> 背景：`ITERATION_LOG.md` Iteration 18.1 已证明「加提示词规则」无效
> （M2 从 40% 降到 20%）。**根因是模型把 `src/` 当作项目惯例的强先验，
> 提示词压不过先验。正确修法是把路径从自由文本变成受限枚举。**

### 3.1 Clarifier 产出显式路径清单

- `packages/harness/src/planning/Clarifier.ts` 阶段输出**项目内可用路径清单**。
- 来源必须是**确定性来源**（文件系统扫描 + 目标解析），**不是模型猜测**。
- 若目标涉及新建文件，清单中给出**允许的父目录**（同样来自确定性来源）。

### 3.2 Planner 只能从清单中选

- `packages/harness/src/planning/Planner.ts` 的提示词与**输出 schema**
  双重约束：步骤中的路径字段只能是清单中的枚举值。
- **schema 层校验**（不只是提示词叮嘱）：
  产出非法路径 → **校验失败并触发重规划**，而不是静默接受。
  **这是「机制」与「叮嘱」的分界。**
- 需在报告中说明：当模型坚持输出清单外路径时的**降级路径**
  （重规划 N 次后如何失败、如何上报）。

### 3.3 与阶段 2 的衔接

路径清单必须在**计划审阅视图**中可见（用户能看到「这步会写哪个文件」）。
这是阶段 2 与阶段 3 的接口。

### 阶段 3 门禁

- 同阶段 1 全部门禁
- **M1 不得回归**（真实模型 ≥ 95%，基线为 100%）
- **M2 真实模型复测**：至少 15 例，**如实记录**结果
  （包括「没有提升」或「变差」——Iteration 18.1 的先例必须延续）
- `pnpm acceptance` 数据刷新
- **新增测试**：清单外路径被 schema 拒绝并触发重规划的用例

---

## 阶段 4 · 动态模型路由（C）

> 现状：Iteration 18.2 已做**静态**按 `purpose` 路由
> （`plan` / `execute` → decision，`clarify` / `summarise` / `compact` → grunt）。
> 本轮做**动态**路由。

### 4.1 便宜先试，失败升级（**先做这条**）

在 `packages/harness/src/loop/AgentLoop.ts` 的失败重试循环中：

```
attempt 0: grunt      ← 便宜
attempt 1: decision   ← 升级
attempt 2: decision + 更详细的反思提示
```

- 复用既有 `fixAttempt` 循环位置，**不新增循环**。
- **前置依赖**：`Verifier` 必须足够硬。**若 Verifier 会放行「看起来对但实际错」
  的结果，本策略会变成「用便宜模型制造垃圾」**——必须在报告中评估该风险。

### 4.2 按难度动态选择

用**既有信号**估算难度（**不新增数据采集**）：

- `step.weight`（`plan-utils.ts` 已有加权概念）
- 依赖入度、涉及文件数（Planner 已知）
- 该步骤类型在本项目的历史失败次数（从阶段 5 的失效模式库读取）

### 4.3 路由可观测（**必须先于 4.2**）

右栏 Run 区新增每个步骤的**模型路由说明**：

```
step 3 · executed by grunt (qwen2.5-coder:7b)
   └ 难度 0.32 < 阈值 0.5 → 选便宜模型
step 4 · executed by decision (deepseek-v4)
   └ 难度 0.71 ≥ 0.5，历史失败 2 次 → 选强模型
```

**没有这一层，后续所有路由改动都无法验证。**

### 4.4 成本可见与预算

- 右栏 `RunSection` 新增 `cost` 格（tokens + 折合金额）。
- 配置新增 `maxCostPerTask`；超预算 → **强制降级**（非直接失败）。

### 阶段 4 门禁

- 同阶段 1 全部门禁
- **成本对比**：同一批用例在「静态路由」vs「动态路由」下的 token 消耗对比数据
- **质量不回归**：M1 真实模型仍 ≥ 95%
- **风险结论**：如 4.1 导致质量下降，**如实记录并说明是否回退**

---

## 阶段 5 · 失效模式与项目档案（D）

### 5.1 失效模式注册表

- 现有 `MemoryService` 的记忆是**任务级**的（artifact / lesson / procedural）。
- **新增**：把失败归入**失效模式**（路径虚构 / 零工具调用 / 上下文耗尽 /
  声明≠生效 / ABI 失配 …），每个模式关联**机制修复**（不是提示词）。
- 下次规划前，**先查询相关失效模式**，作为规划的确定性输入。
- **必须接进阶段 3 的路径枚举与阶段 4 的难度估算。**

### 5.2 项目档案（Project Profile）

- 形态：`~/.camelia/profiles/<name>.yaml`，声明项目约定 / 已知陷阱 /
  验证方式 / 禁用动作。
- 来源：把 `docs/ITERATION_LOG.md` 的 22 轮教训**编译**为可加载输入。
- **这是阶段 3「确定性来源」的落地形态之一。**

### 5.3 可复现运行（**阶段 3 / 4 的前置**）

- 一次任务的完整输入（模型 / 提示词 / 上下文快照 / 工具结果）全部落盘。
- 任何失败可**离线重跑**，用于验证机制改动是否真的生效。
- **注意**：若此条未做，阶段 3 / 4 的「M2 是否提升」只能靠小样本通过率判断，
  而 Iteration 18.1 已证明小样本噪声极大（40% ↔ 20% 无法区分）。

### 5.4 卫生与文档

- 删除根目录全部 `*.log`（`test-*22.log` 等）与
  `scripts/_diag_rebuild.mjs`、`scripts/_rebuild_check.mjs`。
- **创建 `AGENTS.md`**：写入 Iteration 19.1 的 4 条预防清单
  （native binding 探针 / acceptance 前置 `verifyNativeBindings()` /
  跨 Node 大版本先 `pnpm rebuild` / 「声明存在 ≠ 生效」识别法）。
- **修正文档矛盾**：`packages/agent/src/plugins/PluginLoader.ts:19` 注释声称
  进程隔离未实现，而 `docs/ITERATION_LOG.md` Iteration 18 声称已实现。
  **已确认「日志是对的」**，即**代码注释是错的**，需修正注释并在
  `ITERATION_LOG` 中记录哪一方错了、为什么。
- **更新 `docs/ITERATION_LOG.md`** 新增 `Iteration 23`，如实记录：
  已做 / 未做 / 为什么 / 负面结果。

### 阶段 5 门禁

- 同阶段 1 全部门禁
- **失效模式库有至少 1 条完整闭环**：失败 → 入库 → 下次规划时被读取并影响决策
- **可复现运行实测**：挑一次真实失败，离线重跑并复现同一结果

---

## 最终验收（全部阶段完成后）

- [ ] `pnpm typecheck` / `lint` / `build` / `test` 全绿，测试总数 ≥ 986
- [ ] `node scripts/usable-check.mjs` 6/6
- [ ] `pnpm acceptance` 数据刷新，**M1 不回归，M2 如实记录**
- [ ] 上述 5 个阶段的截图证据齐全
- [ ] `docs/ITERATION_LOG.md` Iteration 23 完整
- [ ] `AGENTS.md` 已创建
- [ ] 全部改动可回滚

---

## 明确不做

- 不做 i18n / 多语言。
- 不做第三方主题包导入（只做内置 4 套 + 设置面板）。
- 不做插件生态 / 第三方 Tool 市场。
- 不做 Multi-Plan（一次生成多个候选计划供选择）。
- 不做响应式断点（只保证 ≥ 960px 窗口内布局不破）。
- 不做文件树 / Monaco / xterm 接入（依赖已在 `package.json`，属独立迭代）。
- 不为了 M2 数字达标而调整测试用例或用 mock 顶替真实模型。

---

## 纪律（本项目血泪教训，贯穿全部阶段）

1. **「声明存在 ≠ 生效」已发生 4 次**：`supportsTools:false` 静默剥离工具 /
   `gruntModel` 已配置未接线 / `sandbox.ts` 有测试但从未被调用 /
   字体声明未打包。**任何声称「已实现」的项，必须有一条实跑路径证明它
   在执行链路上。**
2. **如实记录负面结果**。Iteration 18.1 记录「加了规则反而更差」是本项目
   最珍贵的文档，**必须保护这个习惯**。
3. **门禁不通过不得提交**。任一失败项必须在报告中说明，不得绕过。
4. **不许用测试通过代替功能可用**（Iteration 19 的教训）。
5. **单文件可靠 > 多文件勉强**。宁可承认边界，不要虚假达标。
6. **不为了好看牺牲可追踪**。折叠可以，但折叠掉的信息必须有明确去处。
