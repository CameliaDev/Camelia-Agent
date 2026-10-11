# Camelia 架构与任务完成白皮书

> **Warm intelligence, sharp code.**
> 版本：v1.0 · 状态：定稿基线 · 适用范围：Camelia v0.1 → v1.0

本文档是 Camelia 的**架构宪法**。所有代码实现、评审、验收都以本文档为准。
核心命题只有一句：**架构必须为「任务完成率」服务，而不是为「功能列表」服务。**

---

## 目录

- [第一章 任务完成模型](#第一章-任务完成模型)
- [第二章 架构总览](#第二章-架构总览)
- [第三章 核心引擎设计](#第三章-核心引擎设计)
- [第四章 任务可靠性的关键机制](#第四章-任务可靠性的关键机制)
- [第五章 免费模型下的架构适配](#第五章-免费模型下的架构适配)
- [第六章 UI 与架构的映射](#第六章-ui-与架构的映射)
- [第七章 数据模型](#第七章-数据模型)
- [第八章 扩展点](#第八章-扩展点)
- [第九章 验收标准](#第九章-验收标准)

---

## 第一章 任务完成模型

### 1.1 什么算「尽善尽美地完成了一个任务」

Camelia 拒绝把「模型吐出一段文本」当作完成。一个任务被判定为完成，必须**同时**满足以下五条
（下称 **CCD-5 判据**，Completion Criteria Definition）：

| 编号 | 判据 | 含义 | 反例 |
|---|---|---|---|
| C1 | **目标达成** | 交付物满足用户原始意图（经澄清后的意图） | 用户要「加个登录页」，Agent 只写了个 README |
| C2 | **客观可验证** | 存在可执行的验证手段（测试通过 / 构建通过 / 文件存在 / 命令退出码为 0） | 只有「我觉得改好了」 |
| C3 | **无回归** | 未破坏既有能力（回归测试或构建未失败） | 改 A 文件导致 B 模块编译不过 |
| C4 | **状态可追溯** | 每一步的输入、输出、工具调用、决策都有持久化记录，可回放 | 关掉软件就丢失了过程 |
| C5 | **可交付** | 产出落到用户可访问的位置（文件/仓库/命令输出），而非停留在对话里 | 代码只存在于聊天记录中 |

> **关键设计含义**：C2 要求 Verifier 子系统必须存在且独立于 Executor。
> C4 要求 Session & Persistence 与 Observability 是一等公民而非事后补丁。
> C5 要求 Tool Engine 的写操作必须真实落盘并可回滚。

### 1.2 任务生命周期

```
接收 → 澄清 → 规划 → 执行 → 验证 → 交付 → 复盘
 │      │      │      │      │      │      │
 └──────┴──────┴──────┴──────┴──────┴──────┘
       任一阶段均可触发：回退 / 重规划 / 中断恢复
```

| 阶段 | 输入 | 输出 | 失败处理 |
|---|---|---|---|
| **接收 Receive** | 用户自然语言 / CLI 参数 / 文件引用 | `Task` 实体（含原始意图、目标工作区、约束） | 空输入 → 拒绝并提示；超长输入 → 分片摘要 |
| **澄清 Clarify** | `Task` | `ClarifiedIntent`（可选项 + 默认假设列表） | 信息不足且无法默认 → 生成最小澄清问题（最多 3 个），不阻塞执行可默认部分 |
| **规划 Plan** | `ClarifiedIntent` + 上下文快照 | `Plan`（有序 `Step[]`，每步含验收点、工具需求、风险） | 规划失败 → 降级为「单步探索式计划」；计划空 → 直接进入执行单步 |
| **执行 Execute** | `Plan` + 当前 `Step` | `StepResult`（工具调用记录 + 产物） | 工具失败 → 按错误分类重试/降级/回滚（见第四章） |
| **验证 Verify** | `StepResult` + 该步验收点 | `Verdict`（pass/fail/unknown + 证据） | 无法验证 → 标记 `unknown` 并降级为人工确认；fail → 触发修复循环 |
| **交付 Deliver** | 全部通过的 `Verdict` | 交付清单（文件 diff / 命令 / 报告） | 交付物缺失 → 回退到执行阶段补齐 |
| **复盘 Reflect** | 完整 trace | `Reflection`（成功要素、失败模式、记忆写入） | 复盘失败不影响交付，但记录告警 |

**生命周期是状态机，不是流水线。** 任何阶段可以 `back-edge` 回到前面阶段：
- 执行中发现计划错误 → 回到**规划**
- 验证失败 → 回到**执行**（局部修复）
- 用户干预改需求 → 回到**澄清/规划**
- 复盘发现系统性问题 → 写入记忆，影响下次规划

### 1.3 三个范例走完整生命周期

#### 范例 A：简单任务（单文件修改）

> 用户输入：`给 src/utils/date.ts 加一个 formatISO 函数，返回 ISO8601 字符串`

| 阶段 | 实际动作 |
|---|---|
| 接收 | 解析出目标文件 `src/utils/date.ts`、动作 `新增函数`、名称 `formatISO` |
| 澄清 | 无需提问；默认假设：导出为 named export、使用原生 `Date#toISOString` |
| 规划 | 1 步：`读取文件 → 定位插入点 → 写入 → 类型检查` |
| 执行 | `fs.read` → `fs.edit`（结构化补丁）→ `shell: tsc --noEmit` |
| 验证 | 验收点：① 函数存在 ② 被 export ③ tsc 退出码 0 ④ 已有测试仍通过 |
| 交付 | 输出 diff + 文件路径 |
| 复盘 | 记录：小任务无需 Planner，走 fast-path |

**架构含义**：简单任务必须走 **fast-path**（跳过完整 Planner，直接单步执行），否则 95% 成功率目标会被规划开销拖垮。

#### 范例 B：中等任务（多文件重构）

> 用户输入：`把项目里所有 axios 调用换成我们封装的 request 模块`

| 阶段 | 实际动作 |
|---|---|
| 接收 | 解析出动作 `批量替换`、源 `axios`、目标 `@/lib/request` |
| 澄清 | 默认假设：保留相同调用签名；不处理 `axios.create` 实例（标记为待人工确认项） |
| 规划 | Planner 产出：`扫描引用 → 分类（可直接替换/需人工）→ 逐文件改写 → 更新 import → 构建 → 跑测试` |
| 执行 | 对每个文件执行结构化改写；`search` 工具先做全仓库引用定位（不依赖模型猜路径） |
| 验证 | ① 无残留 `from 'axios'` ② 构建通过 ③ 既有测试通过 ④ 差异清单可读 |
| 交付 | 输出逐文件 diff + 人工确认清单 |
| 复盘 | 记录：「需人工确认项」应作为一等输出 |

**架构含义**：中等任务必须依赖 **确定性代码定位能力**（search/regex/AST），不能靠模型记忆文件路径。

#### 范例 C：复杂多步任务（跨模块新功能）

> 用户输入：`给 Camelia 加一个「任务回放」功能：能选中历史任务，按步骤重放工具调用并对比结果`

| 阶段 | 实际动作 |
|---|---|
| 接收 | 解析出跨模块特性：数据层（读历史）+ 逻辑层（重放引擎）+ UI 层（回放界面） |
| 澄清 | 生成 3 个关键问题：回放是否重新执行副作用工具？对比粒度到 diff 还是到退出码？失败时是否停止？ |
| 规划 | Planner 产出分层计划：`[数据] 查询 Task/ToolCall → [核心] ReplayEngine（沙箱模式）→ [UI] 回放视图 → [测试] 回放一致性用例`，并标注依赖 DAG |
| 执行 | 用 **Sub-Agent 隔离**：数据层子 Agent、核心子 Agent、UI 子 Agent 各自独立上下文，主 Agent 只收摘要 |
| 验证 | 分层验证 + 端到端验证：重放历史任务，比对工具调用序列一致性 ≥ 95% |
| 交付 | 功能 + 测试 + 文档 + 演示 |
| 复盘 | 记录：跨模块任务的最大风险是「接口契约漂移」，需在规划阶段冻结接口 |

**架构含义**：复杂任务必须依赖 **Sub-Agent Orchestrator + 接口冻结 + 分层验证**，主上下文只保留摘要以防溢出。

---

## 第二章 架构总览

### 2.1 分层图

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ui  (@camelia/ui)                           │
│  React 19 · Vite · Tailwind v4 · Zustand · Monaco · xterm.js         │
│  职责：把后端任务状态「投影」为可视化界面；只读状态 + 派发意图事件      │
└───────────────────────────▲──────────────────────────────────────────┘
                            │ 意图事件 (Intent)  ↑   状态快照 (Snapshot) ↓
┌───────────────────────────┴──────────────────────────────────────────┐
│                       agent  (@camelia/agent)                        │
│  编排层：TaskOrchestrator · ProviderRegistry · ModelRouter            │
│  职责：会话级编排、模型选择与回退、审批决策、把 harness 事件翻译为状态   │
└───────────────────────────▲──────────────────────────────────────────┘
                            │ 领域事件 (DomainEvent) ↑ 命令 (Command) ↓
┌───────────────────────────┴──────────────────────────────────────────┐
│                     harness  (@camelia/harness)                      │
│  AgentLoop · Planner · Executor · Verifier · ContextManager           │
│  SubAgentOrchestrator · ToolEngine · ApprovalGate · ErrorRecovery     │
│  职责：单任务内的「规划→执行→验证→纠错」闭环；纯逻辑，无 IO 细节         │
└───────────────────────────▲──────────────────────────────────────────┘
                            │ 端口接口 (Port) ↑ 实现注入 ↓
┌───────────────────────────┴──────────────────────────────────────────┐
│                       core  (@camelia/core)                          │
│  契约与基础设施：Types · EventBus · TaskStateMachine · Ports          │
│  Persistence(SQLite) · Observability(Trace/Log/Metrics) · Memory      │
│  职责：定义一切接口与数据模型；提供无业务逻辑的通用能力                 │
└──────────────────────────────────────────────────────────────────────┘
```

**依赖方向铁律：`ui → agent → harness → core`，禁止任何反向依赖。**
- `core` 不知道 `harness` 存在，只暴露 Port 接口。
- `harness` 只依赖 `core` 的接口，通过构造注入获得 `LLMPort`、`FsPort`、`ShellPort` 等实现。
- `agent` 把具体 Provider 实现注入 harness。
- `ui` 只与 `agent` 的会话 API 通信，绝不直接触碰 harness。

### 2.2 每层职责与边界

| 层 | 该做 | 绝不该做 |
|---|---|---|
| `core` | 类型定义、事件总线、状态机、端口接口、SQLite 读写、trace 采集 | 任何业务判断（如「该不该重试」） |
| `harness` | 规划、执行、验证、纠错、上下文管理、工具调度 | 直接 `fetch`、直接 `fs`（必须经 Port）、知道 UI 存在 |
| `agent` | 会话编排、Provider 选择/回退、审批策略、事件→状态翻译 | 实现工具逻辑、做代码解析 |
| `ui` | 渲染、交互、本地视图状态 | 直接读写数据库、直接调用模型 |

### 2.3 层间通信协议

**选择：异步事件 + 命令（Command/Event 双通道），而非同步函数调用。**

理由：
1. **可观测性**：一切跨层交互都变成可记录的事件，天然支持 trace / 回放 / 审计。
2. **解耦与可测试**：harness 可以在无 UI、无网络的情况下用假事件驱动测试。
3. **长任务非阻塞**：执行是流式的，事件让 UI 能实时看到「第 3/7 步」而不是等最终结果。
4. **中断与恢复**：事件流持久化后，进程重启可从事件重放恢复。

```ts
// 命令：向下（意图）        事件：向上（事实）
interface Command<TPayload> { type: string; payload: TPayload; traceId: string; }
interface DomainEvent<TPayload> { type: string; payload: TPayload; traceId: string; ts: number; }
```

- **命令**：`ui → agent`（`SubmitTask`, `ApproveTool`, `PauseTask`, `InterveneGoal`, `RollbackStep`）
- **事件**：`harness → agent → ui`（`StepStarted`, `ToolCallRequested`, `ToolCallFinished`,
  `VerificationFailed`, `ContextCompacted`, `PlanRevised`, `TaskCompleted`）
- **函数调用**仅用于**同层内**高频紧耦合路径（如 Executor 调 ToolEngine），避免事件总线成为性能瓶颈。

### 2.4 与 Claude Code 架构对照

| 能力维度 | Claude Code（推断/公开信息） | Camelia | 更强在哪 |
|---|---|---|---|
| 主循环 | 单一 agent loop，工具调用驱动 | AgentLoop + 显式 **TaskStateMachine**（7 态） | 状态显式化 → 可中断、可恢复、可审计 |
| 规划 | 隐式（模型在 loop 内自行规划） | **显式 Planner** 产出结构化 `Plan`/`Step` DAG | 计划可被人审阅、可局部重规划 |
| 验证 | 依赖模型自述 + 测试命令 | **独立 Verifier 子系统**，验收点前置声明 | 验证不依赖被验证者的自述（防自证） |
| 上下文 | 自动压缩 | ContextManager：分片 + 摘要 + 优先级 + 外部记忆 | 压缩策略可配置、被压缩内容可查看 |
| 子任务 | subagent（上下文隔离） | SubAgentOrchestrator + **结构化摘要回传契约** | 子 Agent 的中间态在 UI 可见 |
| 审批 | 工具权限提示 | ApprovalGate：策略化（规则+风险分级+批量授权） | 可按风险等级配置，支持审计与回放 |
| 可观测 | 有 trace/日志 | Trace/Log/Metrics 三支柱 + **事件回放** | 事件持久化 → 可重放整个任务 |
| 持久化 | 会话文件 | SQLite 结构化（Task/Step/ToolCall/Message/Memory） | 可查询、可统计、可跨会话记忆 |
| 扩展 | MCP + 斜杠命令 | **四层插件** Provider/Tool/Theme/AgentPreset + MCP | 扩展点更多、隔离更清晰 |
| 免费模型 | 不适用 | 三路径回退 + 能力自适应分解 | 为弱模型专门设计「架构补模型」 |

**结论**：Camelia 不比 Claude Code「更聪明」，但**更透明、更可控、更可验证、更可扩展**——
这正是「任务完成率」导向的架构红利。

---

## 第三章 核心引擎设计

以下 11 个子系统，每个给出：**职责 / 关键接口 / 失败模式 / 可观测指标**。

### 3.1 Agent 主循环（AgentLoop）

- **职责**：驱动 `Plan → Execute → Verify → (Fix|Next) → Deliver` 的循环，是 harness 的心跳。
- **关键接口**
  ```ts
  interface AgentLoop {
    run(task: Task, plan: Plan, ctx: RunContext): AsyncIterable<DomainEvent>;
    pause(): void; resume(): void; abort(reason: string): void;
  }
  ```
- **失败模式**：无进展空转、验证恒失败、事件风暴。
- **可观测指标**：`loop.iterations`、`loop.iteration_duration_ms`、`loop.steps_completed`、`loop.no_progress_streak`。

### 3.2 任务规划器（Planner）

- **职责**：把 `ClarifiedIntent` 转成有序 `Step[]`（含依赖 DAG、验收点、所需工具、风险等级）。
- **关键接口**
  ```ts
  interface Planner {
    plan(intent: ClarifiedIntent, snapshot: ContextSnapshot): Promise<Plan>;
    revise(plan: Plan, feedback: Verdict | Intervention): Promise<Plan>;
  }
  ```
- **失败模式**：产出空计划、步骤粒度失衡（太粗→执行失败；太细→开销爆炸）、依赖环。
- **可观测指标**：`plan.step_count`、`plan.granularity_score`、`plan.revision_count`、`plan.dag_depth`。

### 3.3 任务执行器（Executor）

- **职责**：执行单个 `Step`，编排工具调用，收集 `StepResult`。
- **关键接口**
  ```ts
  interface Executor {
    execute(step: Step, ctx: RunContext): Promise<StepResult>;
    rollback(step: Step, checkpoint: Checkpoint): Promise<void>;
  }
  ```
- **失败模式**：工具参数幻觉、工具失败、副作用不可逆、执行超时。
- **可观测指标**：`exec.step_duration_ms`、`exec.tool_calls_per_step`、`exec.rollback_rate`、`exec.timeout_rate`。

### 3.4 结果验证器（Verifier）

- **职责**：**独立于 Executor** 判定 `StepResult` 是否满足该步验收点；产出带证据的 `Verdict`。
- **关键接口**
  ```ts
  interface Verifier {
    verify(step: Step, result: StepResult): Promise<Verdict>;
    // Verdict: { status: 'pass'|'fail'|'unknown'; evidence: Evidence[]; reason: string }
  }
  ```
- **失败模式**：无法验证（标记 `unknown` 而非假装 pass）、验证点与意图不符、验证成本过高。
- **可观测指标**：`verify.pass_rate`、`verify.unknown_rate`、`verify.false_pass_rate`（人工抽查）。

### 3.5 上下文管理器（ContextManager）

- **职责**：装配每次模型调用的上下文；负责**压缩、去重、优先级排序、记忆注入**。
- **关键接口**
  ```ts
  interface ContextManager {
    build(query: ContextQuery): Promise<ModelContext>;
    compact(ctx: ModelContext, budget: TokenBudget): Promise<CompactionResult>;
    remember(item: MemoryItem): Promise<void>;
    recall(query: RecallQuery): Promise<MemoryItem[]>;
  }
  ```
- **压缩策略**（分层）：
  1. **系统层**：永不被压缩（系统提示、工具 schema、当前任务目标、当前计划）。
  2. **任务层**：计划、未完成步骤、验收点 —— 强保留。
  3. **证据层**：已完成步骤的**摘要 + 产物引用**（文件路径 + diff hash），原文按需回捞。
  4. **对话层**：滚动窗口 + 语义去重。
  5. **记忆层**：跨会话事实，向量/关键词召回。
- **失败模式**：压缩丢关键信息、摘要失真、token 估算偏差、记忆污染。
- **可观测指标**：`ctx.tokens_before/after`、`ctx.compaction_ratio`、`ctx.key_info_retention`（见第九章）、`ctx.dedup_hits`。

### 3.6 子 Agent 调度器（SubAgentOrchestrator）

- **职责**：把可隔离的子任务分派给独立上下文运行的子 Agent，回收**结构化摘要**而非全量对话。
- **关键接口**
  ```ts
  interface SubAgentOrchestrator {
    spawn(spec: SubAgentSpec): Promise<SubAgentHandle>;
    await(handle: SubAgentHandle): Promise<SubAgentReport>;
    // SubAgentReport: { summary, artifacts[], verdicts[], tokensUsed, status }
  }
  ```
- **约束**：并发上限可配（默认 3）；子 Agent 不得直接改主上下文；报告必须有 token 预算上限。
- **失败模式**：子 Agent 死循环、报告过长污染主上下文、并发资源争抢、结果不一致。
- **可观测指标**：`subagent.spawned`、`subagent.concurrent_peak`、`subagent.report_tokens`、`subagent.failure_rate`。

### 3.7 工具引擎（ToolEngine）

- **职责**：注册、发现、校验、执行工具；统一参数 schema 校验与结果归一化。
- **关键接口**
  ```ts
  interface Tool<TIn, TOut> {
    name: string; description: string;
    schema: JSONSchema; risk: RiskLevel; reversible: boolean;
    run(input: TIn, ctx: ToolContext): Promise<TOut>;
  }
  interface ToolEngine {
    register(tool: Tool<any, any>): void;
    list(): ToolDescriptor[];
    invoke(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult>;
  }
  ```
- **内置工具**：`fs.read` `fs.write` `fs.edit`（结构化补丁）`fs.list` `search.grep` `search.glob`
  `shell.exec` `git.*` `test.run` `web.fetch`（可选）。
- **失败模式**：schema 不匹配、路径越界、命令注入、超时、输出截断。
- **可观测指标**：`tool.invocations`、`tool.p95_latency_ms`、`tool.error_rate`、`tool.schema_reject_rate`。

### 3.8 审批与安全（ApprovalGate）

- **职责**：在工具执行前依据**风险策略**决定放行/拦截/需审批；防止越界与破坏性操作。
- **关键接口**
  ```ts
  interface ApprovalGate {
    decide(call: ToolCall, policy: Policy): ApprovalDecision; // allow | deny | ask
    request(call: ToolCall): Promise<ApprovalOutcome>;
  }
  ```
- **风险分级**：`read-only`（自动放行）/ `write`（可配自动或审批）/ `destructive`（默认审批）/
  `network`（可配）/ `privileged`（强制审批）。
- **安全边界**：工作区路径白名单、Shell 命令黑名单、密钥永不进入模型上下文、API Key 仅存 `~/.camelia/`。
- **失败模式**：误放行破坏性操作、审批疲劳、策略绕过。
- **可观测指标**：`approval.asked/denied/allowed`、`approval.median_wait_ms`、`approval.bypass_attempts`。

### 3.9 会话与持久化（SessionStore）

- **职责**：把 Task/Step/ToolCall/Message/Session/Memory 持久化到 SQLite，支持恢复与查询。
- **关键接口**
  ```ts
  interface SessionStore {
    createSession(meta: SessionMeta): Promise<Session>;
    appendEvent(sessionId: string, e: DomainEvent): Promise<void>;
    saveCheckpoint(taskId: string, cp: Checkpoint): Promise<void>;
    resume(taskId: string): Promise<ResumeState>;
    query(q: SessionQuery): Promise<unknown[]>;
  }
  ```
- **失败模式**：写入中断导致状态不一致、schema 迁移失败、并发写锁、磁盘满。
- **可观测指标**：`store.write_ms`、`store.events_persisted`、`store.resume_success_rate`、`store.db_size_mb`。

### 3.10 可观测性（Observability）

- **职责**：trace（因果链）、log（结构化日志）、metrics（聚合指标）三支柱；支撑回放与审计。
- **关键接口**
  ```ts
  interface Tracer { startSpan(name: string, parent?: SpanId): Span; end(span: Span, status: SpanStatus): void; }
  interface Metrics { inc(name: string, tags?: Tags): void; observe(name: string, v: number, tags?: Tags): void; }
  ```
- **设计**：每个命令/事件携带 `traceId`；span 树还原「任务→步骤→工具调用」因果。
- **失败模式**：埋点缺失、基数爆炸、日志含敏感信息。
- **可观测指标**：`obs.spans_per_task`、`obs.trace_completeness`（无孤儿 span 比例）、`obs.log_redactions`。

### 3.11 错误恢复（ErrorRecovery）

- **职责**：错误分类 → 策略选择（重试 / 降级 / 换模型 / 回滚 / 请求人工）→ 状态机迁移。
- **关键接口**
  ```ts
  interface ErrorRecovery {
    classify(err: unknown): ErrorClass;         // transient | permanent | model | tool | policy
    strategy(cls: ErrorClass, ctx: RunContext): RecoveryStrategy;
    apply(strategy: RecoveryStrategy, ctx: RunContext): Promise<RecoveryOutcome>;
  }
  ```
- **策略矩阵**：

  | 错误类 | 首选策略 | 升级策略 | 兜底 |
  |---|---|---|---|
  | transient（超时/限流） | 指数退避重试（≤3） | 切换 Provider | 降级为只读模式 |
  | model（幻觉/格式错） | 结构化重提示 | 换更强模型 | 请求人工 |
  | tool（命令失败/文件不存在） | 参数修正重试 | 换等价工具 | 回滚该步 |
  | policy（越界/拒绝） | 缩小范围 | 请求审批 | 终止并报告 |
  | permanent | 立即回滚 | 重规划 | 终止并报告 |

- **失败模式**：重试风暴、回滚不彻底、降级后能力静默丢失。
- **可观测指标**：`recovery.attempts`、`recovery.success_rate`、`recovery.rollback_success_rate`（目标 100%）、`recovery.escalations`。

---

## 第四章 任务可靠性的关键机制

> 本章是「任务完成率」的主战场。每节给出：**检测信号 → 判定规则 → 干预动作 → 可观测性**。

### 4.1 目标漂移检测（Goal Drift）

- **检测信号**
  1. **意图相似度**：当前步骤产出与 `ClarifiedIntent` 的语义相似度持续下降。
  2. **触及文件集**：实际编辑文件集与计划声明文件集的 Jaccard 距离增大。
  3. **步骤无进展**：连续 N 步未推进任何验收点。
  4. **新目标词**：模型开始产出与原始意图无关的新特性。
- **判定规则**：`driftScore = w1·(1−intentSim) + w2·fileSetDistance + w3·noProgressStreak`，
  超过阈值 `θ_drift`（默认 0.45）触发。
- **干预动作**：① 注入「目标回锚」提示（重述原始意图 + 当前计划）；② 若仍漂移 → 触发
  `PlanRevised` 事件，回退到规划阶段；③ 记录漂移点，UI 高亮提示用户。
- **可观测性**：`drift.score`、`drift.events`、`drift.recovered`、`drift.false_positive`。

### 4.2 幻觉抑制（Hallucination Suppression）

- **检测信号**：引用了不存在的文件/符号、工具参数指向不存在的路径、声称「已完成」但无工具证据、
  测试结果被自述而非命令输出。
- **判定规则**：**证据强制原则** —— 任何「完成」声明必须绑定一条 `ToolCall` 证据（文件 hash / 命令退出码）。
  无证据的声明降级为 `claim`，Verifier 判为 `unknown`。
- **干预动作**：① 幻觉引用 → 用 `search.glob/grep` 强制回捞真实路径；② 参数不存在 → 拒绝执行并回提示；
  ③ 重复幻觉 ≥ 2 次 → 升级到更强模型或要求人工确认。
- **可观测性**：`hallucination.blocked`、`hallucination.evidence_missing`、`hallucination.escalations`。

### 4.3 工具失败处理

| 失败 | 处理 |
|---|---|
| Shell 非 0 退出 | 捕获 stderr → 分类（语法/依赖/权限/超时）→ 修正参数重试 ≤3 → 换等价命令 → 回滚该步 |
| 文件不存在 | `fs.read` 失败 → 自动 `search.glob` 定位相似路径 → 若仍无 → 判为永久错误并重规划 |
| 网络超时 | 指数退避 + jitter；连续失败 → 切换 Provider 路径；再失败 → 标记离线并降级 |
| 权限拒绝 | 触发 ApprovalGate；用户拒绝 → 缩小范围或跳过并标记 |
| 输出过大 | 截断 + 落盘为 artifact，上下文只留摘要 + 引用 |

### 4.4 死循环检测（Loop Detection）

- **检测信号**
  1. **动作指纹**：`hash(toolName + normalizedArgs)` 连续重复。
  2. **状态指纹**：`hash(planHash + completedSteps + contextDigest)` 重复出现。
  3. **无进展步数**：`noProgressStreak` 超阈值。
- **判定规则**：动作指纹连续 3 次相同 → 警告；状态指纹出现第 2 次 → 判定循环。
- **干预动作**：① 注入「你正在重复」提示 + 强制换策略；② 打破循环：换工具/换模型/缩小任务；
  ③ 仍循环 → 中止该步并向上报告，UI 展示「疑似死循环」并提供人工接管。
- **可观测性**：`loop.detected`、`loop.break_success`、`loop.aborted`。

### 4.5 上下文溢出处理

- **检测信号**：估算 token 达窗口的 `softLimit`（默认 80%）。
- **处理流程**（渐进式）
  1. 去重（相同内容只留一份 + 引用）。
  2. 证据层降维：完成步骤原文 → 摘要 + artifact 引用。
  3. 对话层滚动压缩：老对话 → 结构化摘要。
  4. 仍超限 → 触发子 Agent 隔离（把重上下文任务外移）。
  5. 极端情况 → 硬截断，但**系统层与任务层永不截断**。
- **关键信息保留**：压缩前抽取「决策、约束、待办、产物路径、失败教训」写入**受保护槽位**，
  压缩后校验这些槽位存在（保留率目标 ≥ 95%）。
- **可观测性**：`ctx.overflow_events`、`ctx.compaction_ratio`、`ctx.protected_slot_retention`。

### 4.6 长任务进度追踪

- **机制**：`Plan` 的每个 `Step` 有明确状态（`pending/running/verifying/done/failed/skipped`），
  事件流实时更新；`progress = doneWeight / totalWeight`（按步骤权重而非数量）。
- **UI 投影**：步骤列表 + 当前步 + 百分比 + 阶段成果（每完成一步即产出可查看 artifact）。
- **可观测性**：`progress.percent`、`progress.stall_seconds`（停滞告警）、`progress.stage_artifacts`。

### 4.7 中断与恢复

- **触发场景**：用户暂停 / 改需求 / 关软件 / 崩溃。
- **机制**：每个 Step 边界写 `Checkpoint`（计划、已完成步骤、上下文摘要、文件系统快照 hash）。
  恢复时 `resume(taskId)` 重建 `RunContext`，从最后 Checkpoint 续跑。
- **改需求处理**：`InterveneGoal` 命令 → 冻结当前步 → 重新澄清/规划 → 保留已完成产物。
- **可观测性**：`resume.attempts`、`resume.success_rate`（目标 ≥ 90%）、`resume.lost_steps`。

### 4.8 多模型协作

- **分工**：**弱模型做粗活**（摘要、分类、格式化、简单改写），**强模型做决策**（规划、关键代码生成、纠错）。
- **调度**：`ModelRouter` 按 `(任务类型, 风险, 上下文长度, 剩余配额)` 选模型；失败按回退链降级。
- **成本/配额感知**：免费模型限流时自动把粗活移到本地 Ollama，保留强模型配额给决策点。
- **可观测性**：`router.choices`、`router.fallback_count`、`router.quota_saved`、`router.quality_gate_failures`。

---

## 第五章 免费模型下的架构适配

> **核心判断**：免费模型能力弱、限流、不稳定。若架构假设「模型足够强」，任务完成率必然崩塌。
> 因此 Camelia 的第一性原则是：**能用代码确定性解决的，绝不交给模型；能拆解的，绝不整体交给模型。**

### 5.1 用「架构补模型」

把弱模型串起来完成强模型才能做的任务：

| 强模型能力 | 弱模型下的架构替代方案 |
|---|---|
| 一次性生成复杂代码 | **分而治之**：先由代码解析器（AST）定位插入点，弱模型只生成局部片段，再由确定性拼接器写回 |
| 长上下文理解 | **检索增强**：只把相关片段（grep/AST 命中）喂给模型，而非整仓 |
| 精准文件路径 | **确定性定位**：`search.glob/grep` 找出真实路径，模型只做选择 |
| 结构化输出稳定 | **Schema 约束 + 修复器**：JSON Schema 校验 + 自动修复/重提示 |
| 复杂计划 | **模板化规划**：常见任务用计划模板（Plan Template），模型只填槽 |
| 自我验证 | **外部验证**：tsc/tests/git diff 作为客观裁判，不信任模型自述 |

### 5.2 任务分解粒度自适应

- **能力探针**：对每个 Provider 维护 `capabilityProfile`（是否支持 tool-calling、JSON mode、
  最大上下文、历史成功率、平均延迟）。
- **粒度规则**：`granularity = f(modelCapability, taskComplexity)`。
  - 弱模型 + 复杂任务 → **细粒度**（单文件/单函数级步骤，每步 ≤1 个写操作）。
  - 强模型 + 复杂任务 → **粗粒度**（模块级步骤）。
- **动态调整**：若某粒度下步骤失败率 > 阈值，自动**细化**下一轮；若步骤过于琐碎导致开销过大，自动**粗化**。
- **可观测性**：`adaptive.granularity_changes`、`adaptive.failure_rate_by_granularity`。

### 5.3 回退链与任务状态机结合（非简单重试）

回退链：`OpenCode Zen → OpenRouter → Ollama`。

关键：**回退发生在状态机层面，而非循环层面。**

```
Step 执行失败
  ├─ 错误可重试(transient) → 同 Provider 重试 → 成功则继续
  ├─ 重试耗尽 → Provider 降级 → 状态机进入 RETRY_WITH_FALLBACK
  │     ├─ 新 Provider 成功 → 回到 EXECUTING
  │     └─ 全链失败 → 状态机进入 DEGRADED（只读/摘要模式）
  └─ 错误不可重试(permanent/model) → 直接 REPLANNING
```

- **状态机迁移是有语义的**：`RETRY_WITH_FALLBACK` 会**重述任务上下文**给新模型（避免上下文不兼容）。
- **配额感知**：切换前检查目标 Provider 配额，避免「换了个也限流」的空转。
- **可观测性**：`fallback.chain_depth`、`fallback.success_by_provider`。

### 5.4 免费模型上的长上下文

四层组合拳：
1. **分片（Chunking）**：大文件/大仓库按 AST 或行窗口分片，按需检索。
2. **摘要（Summarization）**：历史步骤压缩为结构化摘要（弱模型即可胜任）。
3. **外部记忆（External Memory）**：SQLite + 向量/关键词索引，跨会话召回事实与教训。
4. **受保护槽位（Protected Slots）**：目标、约束、待办、产物路径永不压缩。

### 5.5 必须自己实现的能力（不能依赖模型）

| 能力 | 为什么不能靠模型 | Camelia 的实现 |
|---|---|---|
| 代码解析 | 模型会幻觉符号 | Tree-sitter / TypeScript AST |
| 文件定位 | 模型会编造路径 | `glob` + `grep` + 索引 |
| Diff 应用 | 模型写的 patch 经常不适用 | 结构化补丁（精确 old/new 匹配 + 模糊回退） |
| 语法校验 | 模型无法保证 | `tsc --noEmit` / linter |
| 依赖分析 | 模型看不清图 | import 图构建 |
| 测试判定 | 模型自述不可信 | 命令退出码 + 报告解析 |
| 回滚 | 模型不负责 | 文件快照 + git |

---

## 第六章 UI 与架构的映射

### 6.1 UI 是任务状态的投影，不是壳

原则：**UI 不产生业务状态，只渲染后端状态并派发意图。**
Zustand store 的唯一数据来源是 `agent` 层推送的状态快照（由事件流归约而来）。

```
harness 事件流 ──► agent 事件归约器 ──► Zustand snapshot ──► React 渲染
                                              ▲
ui 交互 ──► Command(意图) ──► agent ──► harness
```

### 6.2 UI 组件 ↔ 后端状态映射

| UI 组件 | 后端状态来源 | 说明 |
|---|---|---|
| 顶栏 TopBar | `session.title`、`task.status`、`provider.active`、`metrics.tokens` | 全局态 |
| 左栏 会话列表 | `Session[]` | 历史会话/任务 |
| 中间 对话流 | `Message[]` + 归约后的 `EventView[]` | 全宽卡片 |
| 阶段指示器 | `task.phase`（planning/executing/verifying） | 用户可见「现在在干什么」 |
| 步骤列表 StepsPanel | `Step[]` + 每步 `status` | 当前步高亮 + 进度百分比 |
| 工具调用卡片 ToolCallCard | `ToolCall{input,output,duration,status}` | 输入/输出/耗时可见 |
| 右栏 上下文面板 | `ctx.tokens`、`ctx.windowUsage`、`ctx.compactionLog`、`compaction.droppedPreviews` | 用量 + 被压缩内容可查（摘要 + 被丢弃原文，有界） |
| 子 Agent 面板 | `SubAgentReport[]` | 并发子任务运行情况 |
| 审批面板 ApprovalPanel | `ApprovalRequest` | 放行/拒绝/批量授权 |
| 失败卡片 FailureCard | `ErrorInfo{reason,retry,degrade}` | 原因 + 重试 + 降级方案 |
| 底栏 输入区 Composer | 用户意图 → `Command` | 支持 `/` 命令 |
| Diff 视图 | `FileDiff[]` | 新增暖绿 / 删除暖红 |
| 回滚/分支控件 | `Checkpoint[]` | 任意步骤可回滚、可分支探索 |

### 6.3 用户如何「看见」Agent

- **在想什么**：阶段指示器 + 当前步骤目标 + 计划列表。
- **在做什么**：工具调用卡片实时流式（命令、参数、耗时、状态）。
- **卡在哪**：失败卡片（原因 + 重试按钮 + 降级建议）；停滞告警（`progress.stall_seconds`）。

### 6.4 关键交互

- **审批**：工具执行前弹审批（按风险分级）；支持「本会话批量授权同类」。
- **干预**：任意时刻暂停 / 修改目标（`InterveneGoal`）/ 编辑当前步骤。
- **回滚**：选任一 Checkpoint 回滚文件系统 + 任务状态。
- **分支探索**：从某 Checkpoint 派生新分支计划，对比两条路径结果。

### 6.5 暖色暗黑设计 Token（山茶花色系）

```css
/* Background */
--c-bg-base:      #1A1514;  /* 暖调近黑，非纯黑 */
--c-bg-elevated:  #221B19;
--c-bg-panel:     #2A2220;
--c-bg-hover:     #332A27;

/* Text */
--c-text-primary: #F7EFE9;  /* 暖白 */
--c-text-secondary:#C9B8AE;
--c-text-muted:   #8A7A72;

/* Accent — 山茶红 */
--c-accent:       #D96C5F;
--c-accent-hover: #E27D70;
--c-accent-dim:   #8C4239;

/* Semantic */
--c-success:      #7FA86B;  /* 暖绿：diff 新增 */
--c-danger:       #C4554A;  /* 暖红：diff 删除 */
--c-warning:      #D9A15F;
--c-info:         #7FA3C4;

/* Diff */
--c-diff-add-bg:  rgba(127,168,107,0.14);
--c-diff-del-bg:  rgba(196,85,74,0.14);

/* Geometry */
--radius-md: 10px; --radius-lg: 14px;
--topbar-h: 48px; --leftbar-w: 260px;
```

**布局**：顶栏 48px / 左栏 260px / 中间对话（弹性）/ 右栏上下文（320px）/ 底栏输入。

---

## 第七章 数据模型

存储：**SQLite（better-sqlite3）**，位于 `~/.camelia/camelia.db`。
所有表带 `created_at` / `updated_at`；软删除用 `deleted_at`。

### 7.1 实体关系

```
Session 1─* Task 1─* Step 1─* ToolCall
                    │
                    ├─* Message
                    ├─* Checkpoint
                    └─* Verdict
Session 1─* Memory (scope=session)
Global  1─* Memory (scope=global)
```

### 7.2 表设计

**sessions**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | uuid |
| title | TEXT | 会话标题 |
| workspace | TEXT | 工作区根路径 |
| provider | TEXT | 当前 provider |
| model | TEXT | 当前模型 |
| created_at / updated_at | INTEGER | epoch ms |

**tasks**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| session_id | TEXT FK | → sessions.id |
| intent_raw | TEXT | 用户原始输入 |
| intent_clarified | TEXT(JSON) | 澄清后意图 + 默认假设 |
| status | TEXT | received/clarifying/planning/executing/verifying/delivering/reflecting/done/failed/paused |
| phase | TEXT | 当前阶段（UI 投影） |
| plan_json | TEXT(JSON) | 当前 Plan |
| progress | REAL | 0..1 |
| created_at / updated_at | INTEGER | |

**steps**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| task_id | TEXT FK | → tasks.id |
| idx | INTEGER | 顺序 |
| title | TEXT | 步骤标题 |
| status | TEXT | pending/running/verifying/done/failed/skipped |
| acceptance_json | TEXT(JSON) | 验收点 |
| weight | REAL | 进度权重 |
| deps_json | TEXT(JSON) | 依赖步骤 id |
| started_at / ended_at | INTEGER | |

**tool_calls**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| step_id | TEXT FK | → steps.id |
| name | TEXT | 工具名 |
| input_json | TEXT(JSON) | 入参（脱敏后） |
| output_json | TEXT(JSON) | 出参（截断后） |
| status | TEXT | pending/approved/running/ok/error/denied |
| risk | TEXT | read-only/write/destructive/network/privileged |
| duration_ms | INTEGER | |
| trace_id | TEXT | |
| created_at | INTEGER | |

**messages**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| task_id | TEXT FK | |
| role | TEXT | system/user/assistant/tool |
| content | TEXT | |
| tokens | INTEGER | |
| compacted | INTEGER | 是否已被压缩 |
| created_at | INTEGER | |

**checkpoints**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| task_id | TEXT FK | |
| step_idx | INTEGER | 步骤边界 |
| ctx_summary | TEXT | 上下文摘要 |
| fs_manifest | TEXT(JSON) | 文件 hash 清单 |
| created_at | INTEGER | |

**memories**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| scope | TEXT | global/session |
| session_id | TEXT NULL | |
| kind | TEXT | fact/lesson/preference/artifact |
| content | TEXT | |
| embedding | BLOB NULL | 可选向量 |
| keywords | TEXT | 关键词（FTS） |
| created_at / updated_at | INTEGER | |

**verdicts**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | |
| step_id | TEXT FK | |
| status | TEXT | pass/fail/unknown |
| evidence_json | TEXT(JSON) | 证据 |
| reason | TEXT | |
| created_at | INTEGER | |

**metrics**（聚合快照，便于验收报告）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| task_id | TEXT | |
| name | TEXT | 指标名 |
| value | REAL | |
| tags_json | TEXT | |
| created_at | INTEGER | |

---

## 第八章 扩展点

四个扩展点 + MCP，全部插件化。统一插件清单文件 `camelia.plugin.json`：

```json
{ "name": "@camelia/plugin-x", "kind": "tool|provider|theme|agent-preset",
  "entry": "./dist/index.js", "permissions": ["fs:read","shell:exec"] }
```

### 8.1 Provider 插件

```ts
interface ProviderPlugin {
  id: string;                       // 'opencode-zen' | 'openrouter' | 'ollama'
  capabilities: CapabilityProfile;  // tool-calling? json-mode? ctx window? 
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
  // 必须实现流式；必须支持 tool-calling 或声明不支持
}
```
- **加载**：`ProviderRegistry` 启动时扫描 `~/.camelia/providers/*/camelia.plugin.json`。
- **隔离**：插件在独立 `child_process`/worker 中运行（崩溃不拖垮主进程）；网络权限显式声明。

### 8.2 Tool 插件

```ts
interface ToolPlugin {
  id: string;
  tools: Tool<any, any>[];
  permissions: Permission[];        // fs:read / fs:write / shell:exec / net
}
```
- **加载**：`ToolEngine.register` 时校验权限；`risk` 与 `reversible` 必填。
- **隔离**：高风险工具（`shell.exec`、`fs:write`）经 ApprovalGate；插件工具默认 `ask`。

### 8.3 Agent 预设（AgentPreset）

```ts
interface AgentPreset {
  id: string;                       // 'coder' | 'reviewer' | 'researcher'
  systemPrompt: string;
  allowedTools: string[];
  plannerMode: 'fast' | 'full';
  modelPreference: { decision: string; grunt: string };
}
```
- **用途**：不同任务用不同「人格 + 工具集 + 模型偏好」，实现多模型协作。
- **加载**：内置 3 个 + 用户目录 `~/.camelia/presets/*.json`。

### 8.4 主题（Theme）

```ts
interface ThemePlugin { id: string; tokens: Record<string, string>; }
```
- **加载**：`ui` 启动时注入 CSS 变量；默认 `camellia-dark`。
- **隔离**：只允许覆盖白名单 token，禁止任意 CSS 注入（防 XSS）。

### 8.5 MCP 集成

- **客户端角色**：Camelia 作为 MCP Client 连接外部 MCP Server（stdio / SSE）。
- **适配**：把 MCP 工具包装为 `ToolPlugin`，统一走 ToolEngine + ApprovalGate + trace。
- **隔离**：每个 MCP Server 独立进程；超时与错误隔离。

---

## 第九章 验收标准

> 本章是**唯一的验收裁判**。每条指标必须可测量、有测试用例、有目标值、有当前达成情况。

### 9.1 指标表

| # | 指标 | 定义 | 测量方法 | 测试用例 | 目标值 | 当前 |
|---|---|---|---|---|---|---|
| M1 | 简单任务成功率 | 单文件修改类任务，CCD-5 全满足 | 批量跑用例集，统计通过率 | `tests/e2e/simple/*`（≥20 例） | ≥ 95% | 待测 |
| M2 | 中等任务成功率 | 多文件重构类任务 | 同上 | `tests/e2e/medium/*`（≥15 例） | ≥ 80% | 待测 |
| M3 | 复杂任务成功率 | 跨模块新功能 | 同上 | `tests/e2e/complex/*`（≥10 例） | ≥ 60% | 待测 |
| M4 | 中断后恢复率 | 中途 kill 进程，重启 resume 成功续跑 | 注入中断点，统计恢复成功 | `tests/e2e/resume/*` | ≥ 90% | 待测 |
| M5 | 压缩后关键信息保留率 | 受保护槽位（目标/约束/待办/产物路径）在压缩后仍存在 | 压缩前后对比槽位集合 | `tests/unit/context/compaction.test.ts` | ≥ 95% | 待测 |
| M6 | 误操作可回滚率 | 写操作均可回滚到 checkpoint | 制造破坏性写操作后回滚，校验 fs hash | `tests/e2e/rollback/*` | 100% | 待测 |
| M7 | 干预后目标纠正成功率 | 中途改需求后任务按新目标完成 | 注入 `InterveneGoal`，统计达成 | `tests/e2e/intervene/*` | ≥ 90% | 待测 |
| M8 | 死循环检出率 | 注入循环场景被检出并打断 | 构造重复动作场景 | `tests/unit/harness/loopdetect.test.ts` | ≥ 95% | 待测 |
| M9 | 幻觉拦截率 | 无证据的「完成」声明被判 unknown | 注入幻觉响应 | `tests/unit/harness/hallucination.test.ts` | ≥ 95% | 待测 |
| M10 | 上下文压缩比 | 压缩后 token / 压缩前 token | 长会话压缩统计 | `tests/unit/context/*` | ≤ 40% | 待测 |
| M11 | 工具失败自恢复率 | 工具失败后经重试/降级最终成功 | 注入失败（超时/非0退出/文件不存在） | `tests/e2e/recovery/*` | ≥ 85% | 待测 |
| M12 | 回退链成功率 | 主 Provider 失败后成功切换 | mock Provider 故障 | `tests/unit/agent/fallback.test.ts` | ≥ 95% | 待测 |
| M13 | 核心模块单测覆盖率 | 行覆盖 | Vitest coverage | 全量单测 | ≥ 80% | 待测 |
| M14 | 任务可追溯完整性 | 每任务 trace 无孤儿 span | trace 校验 | `tests/unit/core/trace.test.ts` | 100% | 待测 |
| M15 | 冷启动时间 | 应用启动到可交互 | 计时 | 手动/脚本 | ≤ 2.5s | 待测 |

### 9.2 测量基础设施

- **用例集**：`tests/e2e/{simple,medium,complex,resume,rollback,intervene,recovery}/`
- **裁判**：每条用例声明 `acceptance` 断言（文件存在 / 构建通过 / 测试通过 / diff 匹配）。
- **报告生成**：`scripts/acceptance-report.ts` 跑全量用例 → 输出 `docs/ACCEPTANCE_REPORT.md`。
- **当前达成情况**：每个 Phase 结束更新本表「当前」列。

### 9.3 门禁规则

- Phase N 结束必须跑全量验收；**不达标不得进入 Phase N+1**（除 M1–M3 依赖真实模型配额，
  可用 mock Provider 先测架构正确性，真实模型结果单独标注）。
- 任何指标回归超过 5% → 视为缺陷，必须修复。

---

## 附录 A：架构硬约束清单（不可协商）

1. Tauri 2.x（**禁止 Electron**）
2. React 19 + Vite + Tailwind v4 + TypeScript `strict`
3. Zustand（**禁止 Redux/MobX/Recoil**）
4. Monaco Editor 按需加载
5. xterm.js
6. better-sqlite3（**禁止 Prisma**）
7. Turborepo + pnpm workspace
8. 分层单向依赖 `ui → agent → harness → core`，**禁止反向**
9. 免费模型三路径：`OpenCode Zen → OpenRouter → Ollama`，自动回退
10. 四层扩展点：Provider / Tool / Theme / AgentPreset，全插件化
11. 支持 MCP 协议
12. API Key 只存 `~/.camelia/`，**零遥测**
13. 许可证 Apache 2.0

## 附录 B：开发顺序（任务完成导向）

```
Phase 1 核心任务引擎（无 UI）→ CLI 验证真实编码任务
Phase 2 可靠性机制 → 故意制造失败，验证自恢复
Phase 3 任务可视化（Tauri UI）→ 通过架构层截图检查清单
Phase 4 扩展与打磨 → 第九章指标全部达标
```

---

*本白皮书为 Camelia 的架构基线。任何偏离需在 `docs/ITERATION_LOG.md` 中记录决策与理由。*