# Iteration 26 —— 目标模式提示词（Goal Prompt，v2）

> 用途：本文件是 **AI 开发中「目标模式」的输入**。把整个文件作为目标提示词交给
> 执行 Agent，它会按 5 个阶段**串行**推进，每阶段独立门禁。
>
> 本文件是**任务书**，不是设计文档。设计理由散落在 `WHITEPAPER.md` 与
> `ITERATION_LOG.md`，此处只写**做什么、约束是什么、怎么验收**。
>
> **本轮的五个阶段全部来自 Iteration 22→25 反复列为「仍开放」的项。不要扩大范围。**

### v2 相对 v1 的改动（需先读）

1. **更正阶段 2 的引擎侧假设**：`memory.recalled` 事件**已经**携带
   `{ count, ids, noise, provenance:{memoryId,layer,matchedBy}[] }`（Iteration 21 已加）。
   因此**不需要补事件字段**——真正的活是「读持久化事件 + join 后续 `memory.downgraded`」。
2. **把「可复现运行收口（run record 补原始意图）」前移为阶段 3**：原 v1 把它放在阶段 4，
   但阶段 5（长会话评估）要「基于真实运行记录」，而记录的原始意图恰恰是它才补——
   顺序冲突，故前移。
3. **新增「服务于核心竞争力」的对齐说明**（下一节）。
4. **明确「agent 覆盖率是持续约束」**，不是阶段 1 一次性任务。

---

## 为什么这轮服务于核心竞争力

Camelia 的命题是：**以任务完成率为北极星、面向弱 / 免费 / 本地模型的可靠性架构**。
三个支柱：不信任模型自述（独立验证 + 证据强制）、事件溯源（可回放 / 回滚 / 审计）、
全流程可观测可干预。**这轮各阶段的终点，是让这套架构在「弱模型真实任务」上被量出来。**

| 阶段 | 服务的竞争力 |
| --- | --- |
| 1 · agent 覆盖率 | 可靠性架构的**可信度底座**（覆盖率高 = 改动敢下） |
| 2 · recall 时间线 | **可观测 / 可干预**：用户看得见记忆如何影响决策 |
| 3 · 可复现运行 | **可回放 / 可审计**：任何失败可离线复现 |
| 4 · 长会话阈值评估 | **用架构补模型**：记忆 / 压缩在长任务上的可靠性 |
| 5 · 弱模型收口 | **核心命题本身**：弱模型 + 架构，能否把任务做成 |

> 说明：这是「为什么做」，不是设计文档。设计理由仍在 `WHITEPAPER.md` / `ITERATION_LOG.md`。

---

## 范围声明

**分 5 个阶段串行执行，每阶段独立门禁。**

| 线 | 内容 | 阶段 |
| --- | --- | --- |
| **A** | agent 覆盖率回升（投影 / 记忆纯函数单测） | 1 |
| **B** | 记忆面板内 recall 时间线 | 2 |
| **C** | 可复现运行收口（run record 纳入原始意图） | 3 |
| **D** | promote 阈值 / recall_noise 的真实长会话评估 | 4 |
| **E** | 弱模型编排收口 + grunt 模型可用性 | 5 |

**任一阶段门禁未过，禁止进入下一阶段。**

---

## 第零节 · 绝对约束（违反即失败）

1. **分层单向依赖** `ui → agent → harness → core`，**禁止反向**。
2. 技术栈锁定：Tauri 2.x / React 19 / Vite / Tailwind v4 / Zustand /
   better-sqlite3。**UI 侧禁止新增运行时 npm 依赖**。
3. **向后兼容硬要求**：既有测试的**预期行为不得修改**来迁就新代码。
   若必须改，**逐条说明「为什么这是行为演进而非回归」**。
4. **数据迁移必须可逆**：`SCHEMA_VERSION` 若递增，旧数据必须能读；
   新增事件 payload 字段必须可空、旧事件读为缺省。
5. **记忆面板是「查询面」**：面板状态**不得**混入事件投影的 `snapshot`
   （沿用 `packages/ui/src/state/store.ts` 对 `localPrefs` / `memory` 切片的例外约定）。
6. **数据源必须是真实引擎**：`SseTransport` → `EngineServer` → `SqliteSessionStore`。
   新增功能**不得用 fixture 顶替**（fixture 仅作离线演示与 UI 契约测试）。
7. **不得伪造真实数据**（尤其长会话与现场模型）：不可得就用**确定性用例**固定行为并
   **如实记录「未取得」**，绝不编造。
8. **API Key 只存 `~/.camelia/`，零遥测**。
9. **环境基线（开跑前先做，不凭记忆）**：
   - 记录 Node 版本与 `process.versions.modules`；`better-sqlite3` 必须与运行 Node
     大版本一致，**跨大版本先 `pnpm rebuild better-sqlite3`**。
   - 实跑 `node scripts/usable-check.mjs` 记录基线（当前口径 6/6）。
   - 记录 `pnpm test` 的**实测总数**作为本轮门禁下限（Iteration 25 记录为 1041；
     以开跑实测为准）。
10. **agent 覆盖率是持续约束**：本阶段之后每个阶段凡新增 agent 侧代码
    （`view/wire.ts` 类型、`view/snapshot.ts` 视图、record 字段映射等），
    **必须同步补 agent 包内单测**，不得让覆盖率在后续阶段被稀释。

---

## 阶段 1 · agent 覆盖率回升（A）

> 风险最低，先做。**本阶段只允许改动 `packages/agent/` 下的源码与测试。**

### 1.0 现状（实测，非抄文档）

- agent 行覆盖率 **87.65%** / 函数 **84.70%**（Linux 全通过实测，数字可用）。
- 目标：行 **≥ 90%**、函数 **≥ 88%**；其余四包不回归。
- 根因（Iteration 22 已定位）：记忆面板 / 投影视图的新代码路径主要由 cli 真实引擎
  测试与 ui 测试**经运行时驱动，agent 包内直接断言偏少**。
- Iteration 24 记录 agent functions 曾在 **80.11% 紧贴 80% 阈值**——functions 比行更脆。

### 1.1 做法（补纯函数单测，不新增运行时依赖）

优先对 `packages/agent/src/view/` 的**纯函数**补 agent 包内直接断言：

- `snapshot.ts`：`toMemoryView`（strength/recency 分解）、recall 摘要的
  `via`（matchedBy）与 layer 标注、`applyEvent` 中**全部 `memory.*` 事件分支**、
  `toSessionView`、`withProviderStatus`、`computeProgress`、`contextUsage`。
- `wire.ts`：`toProviderStatus`、`CommandAck`（含 `data`）路径。
- 若某分支无法从纯函数覆盖（例如只在 `CameliaRuntime` 内可达），
  **优先重构出可测纯函数**，而不是靠 cli/ui 间接驱动刷数字。

### 1.2 反作弊约束

- **不得**写「只执行不断言」的空测试；每个用例必须断言可观察行为。
- **不得**把测试塞进 `ui` / `cli` 来间接抬 agent 覆盖率——本轮要 agent 包内直接断言。
- 数字必须来自 `pnpm acceptance` 真实产物，不得手填。

### 阶段 1 门禁

- `pnpm typecheck` 10/10 · `pnpm lint` 6/6 · `pnpm build` 5/5
- `pnpm test` 全绿，**总数不低于开跑实测基线**（≥ 1041）
- `pnpm acceptance` 刷新，**M13 agent 行覆盖率 ≥ 90%**，M1–M15 其余不回归
- 报告含覆盖率前后对照表（core/harness/agent/cli/ui 五行）

---

## 阶段 2 · 记忆面板内 recall 时间线（B）

### 2.0 更正（相对 v1，**先读**）

`memory.recalled` 事件**已带** `{ count, ids, noise, provenance:{memoryId,layer,matchedBy}[] }`
（`packages/core/src/types/events.ts`）。因此**引擎侧不需要补事件字段**。真正的工作是：

1. 从持久化 `events` 表读取 `memory.recalled`（沿用 `recallNoise.ts` 的
   `computeRecallNoiseAggregate` 先例）；
2. **join 后续 `memory.downgraded`**，标注「该命中后来是否被判错 / 降级」；
3. 一条查询命令 + 一个服务方法 + 面板渲染。

### 2.1 引擎侧改动（自上而下）

- **core**：`CommandMap` 新增 `list_recall_history`
  （`{ memoryId?; sessionId?; since?; limit? }` 形状由实现定，报告说明）。
  若无必要**不改事件 payload**。
- **harness**：`MemoryService`（或 `recallNoise.ts`）新增 `recallTimeline(query)`，
  返回按时间排序的命中记录：
  `{ at, memoryId, layer, contentSnippet, matchedBy, noise, downgraded }`。
  **口径必须与既有 recall_noise 聚合一致**（`totalHits` / `downgradedHits` 定义）。
  纯函数优先，服务方法只做「读日志 → 调纯函数」。
- **cli**：`EngineServer.ts` dispatch 新增该命令分支，做**存在性 / 白名单校验**
  （未知命令 409，非法 layer 409），结果经 `CommandAck.data` 回传。
- **agent**：`view/wire.ts` 补类型；如需 `MemoryRecallView` 则补，**并补 agent 包内单测**
  （阶段 1 的持续约束在此生效）。
- **ui**：`MemoryPanel.tsx` 新增「recall 时间线」区；`store.ts` memory 切片扩展
  （沿用 `query()` 通道 + 10s 超时）；`fixture.ts` / `fixture-memory.ts` 补反应（仅离线演示）。

### 2.2 展示要求

每条命中至少可见：**时间**、命中记忆的**层 + 内容摘要**、**命中原因**
（matchedBy / via）、该次 recall 的 **noise**、以及「此后是否被判错 / 降级」的**标注**。

- 与 recall_noise 聚合口径一致。
- 折叠该区时**不丢信息**（Iteration 23 纪律：折叠掉的信息必须有明确去处）。

### 阶段 2 门禁

- 阶段 1 全部门禁（含 agent 覆盖率**不因本阶段稀释**）
- **新增测试**：harness 纯函数（排序 / 降级标注 / 口径一致）、cli serve 协议
  （新命令 + 409 护栏，真实 runtime）、ui 面板（时间线渲染 + 数据来自 `query` 通道）
- **真实引擎 e2e**：多次 recall → 关 runtime → 同一 `databaseFile` 冷重启 →
  面板时间线一致（沿用 `cli/test/memory-serve.test.ts` 冷重启先例）
- **截图**：面板含 recall 时间线（含命中与降级标注）至少 1 张，1280×820
- 向后兼容证明：既有 `?scene=` fixture 场景仍能渲染

---

## 阶段 3 · 可复现运行收口（C）

> **本阶段从 v1 的阶段 4 前移**：阶段 4（长会话评估）要「基于真实运行记录」，
> 而记录的**原始意图**恰恰本阶段才补。它是评估的地基。

### 3.1 RunRecord 纳入原始意图

现状 `RunRecord = { model, gruntModel?, prompts[], context, toolResults[] }`
（`packages/harness/src/replay/run-record.ts`）——**无原始意图**。

- 新增 `intentRaw`（用户原始输入）与规划输入，使任何一次现场失败**可离线重放**。
- `readRunRecord` 校验保持兼容：旧 record 缺 `intentRaw` 读为 `undefined`（不抛）。
- `writeRunRecord` **已在 `packages/harness/src/loop/AgentLoop.ts:1024` 接线**，
  本阶段只需扩展字段与来源（intent 来自 `run()` 入参 / `RunContext`）。

### 3.2 离线复现

挑一次现场失败（例如 Iteration 24/25 的 s2 两文件任务），用 `readRunRecord`
**离线重跑并复现同一结果**——这是「可回放 / 可审计」的实证。

### 阶段 3 门禁

- 阶段 1 全部门禁
- **run record 实测**：一次真实运行后 `record.json` 含 `intentRaw`
- **离线复现**：挑一次失败，离线重跑复现同一结果
- 向后兼容：旧 record（无 `intentRaw`）仍能读

---

## 阶段 4 · promote 阈值 / recall_noise 的真实长会话评估（D）

> 前置：阶段 3 完成（否则记录缺意图，评估不可复现）。**以「评估 + 如实记录」为主，
> 原则上不改默认行为。**

### 4.1 背景

`HarnessConfig.promoteShortTermThreshold` 默认 **0.6**；recall_noise 聚合口径已固定。
但两者在**真实长会话**上的表现**从未评估**（环境无真实长会话数据）。

### 4.2 数据获取（二选一，报告说明选了哪条与理由）

- **(a) 真实数据可得**：用真实长会话（本地 Ollama 长任务，或已落盘的 run record 积累）
  评估：给出阈值敏感度（0.5 / 0.6 / 0.7 下的升级率）与 recall_noise 趋势。
- **(b) 仍不可得**：**明确记录「未取得」**，改用确定性长会话模拟（脚本化 provider，
  多轮 recall + 命中后 `markIncorrect` 降级）固定行为，给阈值敏感度表。
  **必须标注为模拟，不得写成真实数据。**

### 4.3 硬约束

- **不擅自改 `promoteShortTermThreshold` 默认值**；认为 0.6 不合理**只在报告给建议**。
- **不重写记忆价值公式**（`importance × recency × correctness`）。

### 阶段 4 门禁

- 阶段 1 全部门禁
- **评估报告**：阈值敏感度 + noise 趋势；数据来源明确（真实 / 明确标注模拟）
- 结论写入 `ITERATION_LOG`

---

## 阶段 5 · 弱模型编排收口 + grunt 可用性（E）

> 前置：阶段 4 完成。**本阶段直接量「核心竞争力」那条命题，结论如实。**

### 5.1 grunt 模型可用性（二选一，报告说明）

`ollama` 默认 models 含 `llama3.2:3b`，本机**未安装**，导致「廉价优先」名义上每步
回落到决策模型。

- **(a) 安装并实测**：装上 `llama3.2:3b`，给出廉价优先**真落到 grunt** 的证据
  （路由日志 / RunSection 截图）。
- **(b) 保持未装**：如实记录「本机廉价优先每步落到决策模型」，并在文档标注该前置。

**禁止**把「未装 grunt」写成「动态路由已生效」。

### 5.2 弱模型两文件任务拆解失败（最小修复或如实记录）

- 现场（Iteration 24/25）：弱模型 `qwen2.5-coder:7b` 把**两文件任务拆成 4 步**，
  **第一步只 `fs.list` 就停**，任务失败、工作区为空。
- 要求：
  1. **先复现**（确定性脚本化用例或现场小样本造出同一现象）；
  2. 定位是 planning 粒度（`prompts/system.ts` 的 `granularityFor`）、executor 收敛、
     还是 todo 编排；
  3. 若能用**机制**（非提示词叮嘱）修，则修并补测试；否则**如实记录为开放**。

### 5.3 竞争力结论（**本轮的落点**）

在报告中给出**一句话竞争力判断**：弱模型 + 架构在本机真实任务上的完成率，
是否支撑「用架构补模型」这条命题。**如实**，允许结论是「尚不支撑」。

### 阶段 5 门禁

- 阶段 1 全部门禁
- 5.1 的选取结论明确、可核验
- 5.2 的结论（机制修复 / 如实记录）写入 `ITERATION_LOG`
- 5.3 的竞争力判断写入 `ITERATION_LOG`

---

## 最终验收（全部阶段完成后）

- [ ] `pnpm typecheck` 10/10 · `pnpm lint` 6/6 · `pnpm build` 5/5
- [ ] `pnpm test` 全绿，总数 ≥ 开跑实测基线（不低于 1041）
- [ ] `node scripts/usable-check.mjs` 全绿（UI 改动后先 `desktop:build` 重建 exe 再复验）
- [ ] `pnpm acceptance` 刷新，**M1–M15 不回归**（M13 agent 行覆盖率 ≥ 90%）
- [ ] 面板 recall 时间线截图 + harness/cli/ui/agent 新测试齐全
- [ ] run record 含 `intentRaw`，且有一次离线复现实测
- [ ] 长会话评估报告（真实或**明确标注为模拟**）
- [ ] 弱模型完成率结论 + 竞争力判断
- [ ] `docs/ITERATION_LOG.md` 新增 `Iteration 26` 完整记录（含负面结果）
- [ ] 全部改动可回滚

---

## 明确不做

- 不做 i18n / 多语言。
- 不做插件生态 / 第三方主题包。
- **不为了指标好看而用 mock 顶替真实模型，或编造长会话数据。**
- **不改 `promoteShortTermThreshold` 默认值**（只给建议）。
- **不重写记忆价值公式**。
- 不做 Multi-Plan、响应式断点、文件树 / Monaco / xterm 接入。
- **不处理 harness 测试的跨平台问题**（见「环境提示」）——属独立迭代。

---

## 环境提示（供执行者，务必先读）

1. **本项目测试是 Windows 原生的**：harness 测试夹具写死 `C:/workspace`
   并依赖 win32 路径语义。在 **Linux / WSL** 下 harness 会有约 **24 例**因路径语义失败
   （fs 工具 / verifier 的 `file-*` / executor / agent-loop / subagent /
   reliability-injection），**与产品逻辑无关**。请在**原生 Windows** 上跑门禁。
2. Node **22** 系列。跨 Node 大版本后 `better-sqlite3` 会 ABI 失配，先
   `pnpm rebuild better-sqlite3`。
3. `docs/ACCEPTANCE.md` 由 `pnpm acceptance` **自动生成，禁止手工填写**。

---

## 纪律（本项目血泪教训，贯穿全部阶段）

1. **「声明存在 ≠ 生效」已发生多次**：`supportsTools:false` 静默剥离工具 /
   `gruntModel` 已配置未接线 / `sandbox.ts` 有测试但从未被调用 / 字体声明未打包 /
   `writeRunRecord` 一度未被实时循环调用。**任何「已实现」必须有实跑路径证据。**
2. **如实记录负面结果**（Iteration 18.1 先例）。
3. **门禁不通过不得提交。**
4. **不许用测试通过代替功能可用**（Iteration 19 教训）。
5. **不伪造真实数据**——不可得就写「未取得」。
6. **单文件可靠 > 多文件勉强**。宁可承认边界，不要虚假达标。
