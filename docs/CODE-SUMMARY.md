# Camelia 代码实现总结

> 本文档由通读当前工作区（含 Iteration 24/25 未提交改动）源码后整理，目的是给维护者一份「代码实际长什么样」的速查。
> 它描述**实现现状**，不是设计愿景——设计基线见 [`WHITEPAPER.md`](WHITEPAPER.md)，迭代历史见 [`ITERATION_LOG.md`](ITERATION_LOG.md)，实测数据见 [`ACCEPTANCE.md`](ACCEPTANCE.md)。
>
> 生成时间：2026-10-11。基准：`main`（HEAD `0849388`）+ 工作区未提交改动。

---

## 一、一句话与运行环境

Camelia 是一个以「任务完成」为第一目标的桌面 AI 编码 Agent：用户给一个目标，Agent 规划、执行、自检、纠错、交付，全过程可观测、可干预、可回滚、可回放。

| 项 | 值 |
| --- | --- |
| 包管理器 | pnpm `9.14.4`（`packageManager` 字段，`corepack enable` 可接管） |
| Node | `>=22.11`（`.nvmrc` / `.node-version` / `package.json#engines` / CI / Dockerfile 统一锁定为 22） |
| 构建 | Turborepo + pnpm workspace |
| 原生模块 | `better-sqlite3 ^12.6.2`——**必须与运行时 Node 大版本一致**，切换 Node 后先 `pnpm rebuild better-sqlite3`，否则报 `NODE_MODULE_VERSION` 不匹配 |
| 语言/类型 | TypeScript 5.7 `strict`，ESM（`"type":"module"`，内部 import 带 `.js` 后缀） |

工作区成员：`packages/{core,harness,agent,cli,ui}`、`apps/desktop`、`tests`。根脚本：`build` / `typecheck` / `lint` / `test` / `test:coverage` / `dev` / `acceptance`。

---

## 二、分层与依赖方向

**铁律：`ui → agent → harness → core`，单向，禁止反向。**（`cli` 是另一个驱动端，同样只依赖 `agent`/`harness`/`core`。）

| 包 | 层 | 角色 | 依赖 |
| --- | --- | --- | --- |
| `@camelia/core` | 契约与基础设施 | 领域类型、事件总线、任务状态机、端口（Port）、SQLite 持久化、可观测性 | 仅 `better-sqlite3` |
| `@camelia/harness` | 任务引擎 | 主循环、规划、执行、验证、上下文、工具、审批、可靠性、恢复、子 Agent、记忆、MCP | 仅 `@camelia/core` |
| `@camelia/agent` | 适配与组合根 | Provider 链、模型路由、Node 适配器、插件加载、运行时（`CameliaRuntime`）、状态投影（`view`） | `core` + `harness` |
| `@camelia/ui` | UI 投影 | React 19 界面，把事件流**纯折叠**为 `ProjectionSnapshot` | `agent`（`/view`）+ `core` |
| `@camelia/cli` | 驱动 | `camelia` 二进制：`run` / `replay` / `doctor` / `serve` | `agent` + `core` + `harness` |
| `@camelia/desktop` | 桌面外壳 | Tauri 2.x 原生窗口，装载 `@camelia/ui` 产物，注入启动参数 | 不依赖 harness，不读数据库 |
| `@camelia/e2e` | 验收 | 端到端套件（`tests/acceptance/cli.e2e.test.ts`） | 全部 workspace 包 |

设计要点：`harness` **只**依赖 `core` 的接口，所有具体实现（Provider / fs / shell / 数据库 / 时钟 / 日志）通过 `RunContext` 注入，因此可在无网络、无真实文件系统下用假件完整测试。`agent` 是唯一选择具体实现的地方（组合根）。

---

## 三、`@camelia/core`——契约与基础设施

### 3.1 领域类型（`types/domain.ts` 等）

关键枚举（精确字面量）：

- `TaskStatus`（12）：`received` / `clarifying` / `planning` / `awaiting-approval` / `executing` / `verifying` / `delivering` / `reflecting` / `paused` / `done` / `failed` / `cancelled`
- `TaskPhase`（7，UI 投影用）：`idle` / `planning` / `awaiting-approval` / `executing` / `verifying` / `delivering` / `paused`
- `StepStatus`（6）：`pending` / `running` / `verifying` / `done` / `failed` / `skipped`
- `VerdictStatus`（3）：`pass` / `fail` / `unknown`
- `RiskLevel`（5）：`read-only` / `write` / `destructive` / `network` / `privileged`
- `ToolCallStatus`（7）：`pending` / `awaiting-approval` / `approved` / `denied` / `running` / `ok` / `error`
- `MemoryKind`：`fact` / `lesson` / `preference` / `artifact` / `procedural`；`MemoryLayer`：`working` / `short` / `long` / `procedural`
- `AcceptancePoint.kind`：`file-exists` / `file-contains` / `command-exit-zero` / `test-pass` / `diff-nonempty` / `manual`

主要实体：`Task`、`Step`、`Plan`（`mode: 'fast'|'full'`）、`ClarifiedIntent`、`ToolCall`、`Message`、`Evidence`、`Verdict`、`StepResult`、`Artifact`、`FsManifest`、`Checkpoint`、`MemoryItem`、`SubAgentReport`、`Session`。

### 3.2 任务状态机（`state/TaskStateMachine.ts`）

显式状态机（不是 `while(true)`），迁移表内建；`paused` 特殊处理（只允许回到 `resumeTarget` 或 `cancelled`/`failed`）；`TERMINAL = [done, failed, cancelled]`。`phaseOf(status)` 把 12 状态映射到 7 阶段。要点：`planning → awaiting-approval → executing`，规划不再直连执行。

### 3.3 事件总线（`events/EventBus.ts`）

类型安全的 Command/Event 双通道，同步分发。`DomainEventMap` 覆盖全部事件，按域分组：

- 任务：`task.received` / `clarified` / `status_changed` / `phase_changed` / `progress` / `paused` / `resumed` / `intervened` / `completed` / `failed` / `cancelled`
- 计划：`plan.started` / `ready` / `revised` / `failed`；步骤：`step.started` / `routing.chosen` / `completed` / `failed` / `skipped`
- 工具：`tool.requested` / `approval_required` / `approved` / `denied` / `started` / `finished` / `failed` / `usage_injected`
- 验证：`verify.started` / `result` / `fix_required`；上下文：`context.budget` / `compaction_started` / `compacted` / `deduplicated`
- 可靠性：`reliability.drift_detected` / `loop_detected` / `hallucination_blocked` / `no_progress`
- 恢复：`recovery.classified` / `attempted` / `succeeded` / `failed` / `rollback_started` / `rollback_done`
- 子 Agent：`subagent.spawned` / `finished`；Provider：`provider.selected` / `fallback` / `capabilities`
- 记忆：`memory.written` / `recalled` / `forgotten` / `reactivated` / `downgraded` / `promoted`；自省：`selfreview.performed` / `skipped`
- 其它：`checkpoint.created`、`log`、`metric`（后两者不入持久化日志）

命令（`ui → agent`，snake_case）：`submit_task`、`approve_tool`、`deny_tool`、`approve_plan`、`reject_plan`、`edit_plan`、`set_plan_approval`、`pause_task`、`resume_task`、`cancel_task`、`intervene_goal`、`rollback_step`、`select_provider`，以及记忆面板命令（`list_memories`、`get_memory`、`list_forget_log`、`list_reactivation_due`、`mark_memory_incorrect`、`forget_memory`、`promote_memory`、`get_memory_health`）。

### 3.4 端口（`ports/`）

`LLMPort`（`id` / `capabilities()` / `listModels()` / `chat()` 返回 `AsyncIterable<ChatChunk>`）、`FsPort`、`ShellPort`、`SearchPort`、`ClockPort`、`LoggerPort`。harness 通过这些端口与外界交互。

### 3.5 持久化（`persistence/`）

SQLite（better-sqlite3），WAL + `foreign_keys=ON`，`SCHEMA_VERSION = 4`（V1→V4 前向迁移，幂等）。默认 DB `~/.camelia/camelia.db`（`SqliteSessionStore` 构造默认 `:memory:`，真实路径由上层注入）。

表：`sessions`、`tasks`、`steps`、`tool_calls`、`messages`、`verdicts`、`checkpoints`、`memories`、`events`、`metrics`、`memory_forget_log`、`failure_modes`（后两张由 V2/V4 引入）。`memories` 含 `strength`/`importance`/`correctness`/`layer`/`ttl`/`next_review_at` 等生命周期字段；`memories.embedding` 列存在但从未读写（残留）。

`SessionStore` 接口涵盖 Session/Task/Step/ToolCall/Message/Verdict/Checkpoint/Memory/Event/Metric/FailureMode 的增改查，及 `close()`。

### 3.6 可观测性（`observability/`）

`InMemoryTracer`（span 树、`traceCompleteness()`）、`InMemoryMetrics`（`inc`/`gauge`/`observe`，含 `percentile()`）、`RedactingLogger`（脱敏 API Key / token 等，深度截断）+ `CollectingLogger` + `streamSink`。注意：核心**未内置**固定 metric/span 名常量，指标名为调用方自由文本。

---

## 四、`@camelia/harness`——任务引擎

引擎把「一句话目标」变成「可验证的完成」。以下为各子系统（`src/` 下子目录）。

### 4.1 AgentLoop（`loop/`）

`AgentLoop.run(intent, options)` 驱动 `Plan → Execute → Verify → (Fix) → Deliver → Reflect`；永不抛（失败在 `TaskOutcome` 里报告）。`TaskOutcome.status ∈ {done, failed, paused, cancelled}`。支持 `pause()` / `cancel()` / `intervene(instruction)`（中途改目标，重写受保护槽）/ `rollback(checkpointId?)` / `runSubAgent()`。每步边界写 checkpoint → 步骤 `running` → 路由模型 → `executor.execute` → `verifier.verify`；失败按 `recovery.classify/strategy` 重试（**仅 `retry` 策略被循环实际执行**，其余策略触发退出），持续失败则做一次结构性重规划。循环检测、漂移检测、无进展检测在循环内触发。

### 4.2 规划（`planning/`）

- `Planner.plan/revise`：产出 `Step[]`，`mode` 由 `pickMode` 决定（`--plannerMode auto` 时：期望路径 ≤1 且目标 <160 字符 → `fast`，否则 `full`）。
- `Clarifier.clarify`：意图归一化；路径枚举始终来自真实 fs 列表，绝不来自模型文本；离线或 provider 不支持 JSON 时走确定性兜底。
- `PlanGate`：把运行停在 `awaiting-approval`；决策 `approve(once|session)` / `reject` / `edit(PlanEdit[])`。**「没有回答不等于同意」。**
- `plan-edits`（reorder/insert/delete/retitle/repath）、`plan-utils`（`breakCycles` 修环、`topologicalOrder`、`dagDepth`、`fallbackPlan`）、`json`（容错 JSON 抽取，刻意拒绝顶层数组）。

### 4.3 执行（`execution/`）

`Executor.execute(step, options)` 是单步**有界 ReAct 循环**（`maxIterationsPerStep` / `maxToolCallsPerStep` 双上限）。每次模型调用前按需压缩上下文；工具调用经「死循环检测 → preset 允许清单 → 审批门 → 带超时执行」；工具失败时注入该工具的 `usage` 文档一次。若模型只输出文本工具调用，用 `recoverTextToolCalls` 兜底解析。产物只从 `fs.write`/`fs.edit`（文件）与 `shell.exec`/`test.run`（stdout）提取。

### 4.4 验证（`verification/`）

`Verifier.verify(step, result)`：执行器「声称」，验证器「核查」。状态：有失败 → `fail`；否则有未知 → `unknown`；否则 `pass`。**无证据的完成声明由 `HallucinationGuard` 降级为 `unknown`**（发 `reliability.hallucination_blocked`）。逐验收点核查 `file-exists` / `file-contains`（字面优先、正则兜底）/ `command-exit-zero` / `test-pass`（默认 `npm test`，经审批门，`privileged`）/ `diff-nonempty` / `manual`（恒 `unknown`）。

### 4.5 上下文（`context/`）

`ContextManager`：**受保护槽 = goal / constraints / todos / artifacts**，压缩永不丢弃；压缩把超过最近 `keepRecent(6)` 条的非 pinned 消息折叠为确定性结构摘要（不调模型）。token 预算 `window`（默认 128 000）× `softLimitRatio(0.8)`，估算 `chars/3.6` 加 1.1 余量。`RunContext` 携带注入的 `ports`（llm/fs/shell/search/clock/logger）、`infra`（bus/store/tracer/metrics/logger）、`config`、`allowedTools`、`presetDirectives`。

### 4.6 模型访问（`model/`）

`ModelGateway.call`：按 `purpose` 选模型（`clarify`/`summarise`/`compact` → grunt 模型；其余 → 决策模型）；重试带指数退避（base 200ms）；provider 不支持工具时剥离 tools；`text-tool-calls.ts` 可从文本里恢复工具调用并剥离旁白。

### 4.7 工具与审批（`tools/`、`approval/`）

内置 **8 个工具**（无 `git.*`，无 `web.fetch`）：

| 工具 | risk | reversible |
| --- | --- | --- |
| `fs.read` | read-only | 是 |
| `fs.write`（自动建父目录、写前 journal） | write | 是 |
| `fs.edit`（字面替换 + 容错模糊回退） | write | 是 |
| `fs.list` | read-only | 是 |
| `search.glob` | read-only | 是 |
| `search.grep`（regex） | read-only | 是 |
| `shell.exec` | privileged | 否 |
| `test.run`（默认 `npm test`） | privileged | 否 |

`ToolEngine`：schema 校验在调用前；未知工具 / schema 不符分别返回不可重试 / 可重试错误。`ApprovalGate`：模式 `auto`/`ask`/`deny`；按风险默认（read-only/write=auto，destructive/network/privileged=ask）；硬性 `deniedPaths`（`.git/`、`node_modules/`、`.env` 等）与 `deniedCommands` 覆盖一切；会话内相同调用可批量记住；无 responder + ask → 拒绝。

### 4.8 检查点与回滚（`checkpoint/`）

`WorkspaceJournal.record()` 在写前备份文件（新建文件记为「原本不存在」）；`rollback()` 逆序还原。**注意：`AgentLoop.rollback(checkpointId)` 忽略传入 id，始终整本 journal 回滚。**

### 4.9 可靠性件（`reliability/`）

- `DriftDetector(threshold=0.45)`：`0.4·意图距离 + 0.4·文件集距离 + 0.2·无进展`。
- `LoopDetector(repeatThreshold=3)`：动作指纹重复；状态指纹出现第 2 次判循环。
- `HallucinationGuard`：中英文完成声明词 + 存在性声明，无工具证据即拦截。

### 4.10 错误恢复（`recovery/`）

`ErrorRecovery`：错误类 `transient` / `permanent` / `model` / `tool` / `policy`；策略 `retry` / `switch-provider` / `replan` / `rollback` / `ask-human` / `abort`（`degrade-readonly` 已声明但从未产出）。退避 base 400ms、上限 8000ms。

### 4.11 子 Agent（`subagent/`）

`SubAgentOrchestrator`：并发上限 `maxSubAgents(3)`（内部 `Semaphore`），报告按 `subAgentReportTokenCap(1200)` 截断；默认子任务超时 = `toolTimeoutMs × 10`（5 分钟）。

### 4.12 记忆（`memory/`，Iteration 20–22）

`MemoryService`：`value = importance × recency × correctness`；`recency = 1/(1+age/halfLife)`，半衰期默认 30 天；层 `working`/`short`/`long`/`procedural`；预算 200 条，超限淘汰最低价值（记入 `memory_forget_log`）；`markIncorrect` 后 `correctness=0`、不再召回；`promoteShortTerm(0.6)` 把重要短时记忆升为全局长期。

### 4.13 方案自审（`selfreview/`）

`PlanSelfReview`：`fast` 计划豁免；对 `full` 计划问四题——`scope` / `contract` / `simplicity` / `verifiability`（确定性、无模型），**仅当有 `fail` 才要求 revise**。

### 4.14 画像 / 回放 / 廉价优先 / MCP

- `profile/`：`ProjectProfile { name, conventions[], pitfalls[], verification[], forbidden[] }`，手写 YAML 子集，存 `~/.camelia/profiles/<name>.yaml`，注入规划提示。
- `replay/run-record`：`RunRecord { model, gruntModel?, prompts[], context, toolResults[] }` 写入 `<runRecordDir>/<taskId>/record.json`，供离线回放。
- `routing/cheap-first`：按难度分（权重/入度/文件数/历史失败）在决策/粗活模型间选，阈值 0.5。
- `mcp/`：`McpClient` 连接外部 MCP Server（`stdio` / `http`），协议版本 `2025-06-18`，工具名 `mcp.<server>.<tool>`，**强制 `approval: 'ask'`**；配置 `~/.camelia/mcp.json`。

### 4.15 配置默认值（`config.ts`）

`maxSteps 24`、`maxIterationsPerStep 8`、`maxToolCallsPerStep 12`、`toolTimeoutMs 30s`、`shellTimeoutMs 60s`、`contextWindow 128000`、`softLimitRatio 0.8`、`driftThreshold 0.45`、`loopRepeatThreshold 3`、`noProgressThreshold 3`、`maxRetries 3`、`maxSubAgents 3`、`plannerMode 'auto'`、`temperature 0`、`memoryBudget 200`、`planApproval 'always'`、`profileDir`/`runRecordDir` 默认 `undefined`。

---

## 五、`@camelia/agent`——适配与组合根

- **配置与密钥**（`config/`）：`CAMELIA_HOME` 默认 `~/.camelia`；`config.json`（配置）、`keys.json`（密钥，`Record<providerId, key>`）、`camelia.db`、`logs/`、`profiles/`、`presets/`、`plugins/`、`runs/`、`mcp.json`。零遥测。
- **默认 Provider 与回退链**（`load.ts` / `ProviderRegistry` / `FallbackLLMPort`）：`opencode-zen → openrouter → ollama`（`config.json` 里的额外 provider 追加在后，插件 provider 再靠后）。`FallbackLLMPort` 用持久游标推进——一次降级改变本次运行后续所有调用（不是简单重试）。不可用（无 key 且非 ollama/mock）的默认 provider 会被过滤。
- **模型路由**（`ModelRouter`）：按名字线索（`GRUNT_HINTS` / `DECISION_HINTS`）或配置 pn 选决策模型 / 粗活模型。
- **Node 适配器**（`adapters/`）：`NodeFs`（工作区根、相对路径、sha256 前 16 位）/ `NodeShell`（Windows `taskkill` 兜底，超时码 124）/ `NodeSearch`（零依赖 glob/grep）/ `logger`。
- **Provider 实现**（`providers/`）：`OpenAICompatibleProvider`（一个类讲三家 `/chat/completions`）、`MockProvider`、`ScriptedAgentProvider`（按系统提示阶段标记响应，离线跑通整条引擎）。
- **插件**（`plugins/`）：清单文件名 `camelia.plugin.json`，四类 kind（provider/tool/theme/agent-preset）；工具插件先经 **worker 线程沙箱探测**（blasting-radius 隔离，默认 5s 超时），但可运行的 `run` 仍来自进程内 import；权限（`fs:read`/`fs:write`/`shell:exec`/`net`）是真正的边界，缺权限的调用会抛错。默认根 `~/.camelia/plugins/<name>/camelia.plugin.json`。
- **预设**（`presets/`）：内置 3 个——`coder`（`['*']`，full）、`reviewer`（只读工具，fast）、`researcher`（只读工具，fast）；默认 `coder`；用户目录 `~/.camelia/presets/*.json` 覆盖。预设**opt-in**：只有显式指定才应用，未知 id 直接报错。
- **运行时**（`runtime/CameliaRuntime.ts`）：组合根，`static create(options)` 装配一切（config → 插件 → 预设 → Provider → SQLite → EventBus → FallbackLLMPort → ModelRouter → HarnessPorts → ToolEngine → Session）。实例方法：`run(rawIntent, {offlineClarify?, plan?, startStepIdx?, resumeTaskId?})`、`approvePlan`/`rejectPlan`/`editPlan`、`setPlanApproval`、`pause`/`cancel`/`intervene`、`flush`、`providerChain()`、`replay(taskId)`、`close()`。ABI 失配（`abi.ts`）会记入 `~/.camelia/logs/abi-mismatch.jsonl` 并落 `failure_modes` 表。
- **状态投影**（`view/`）：`snapshot.ts` 用 `applyEvent`/`reduceEvents` 把领域事件**纯折叠**为 `ProjectionSnapshot`（无 `node:` 依赖）；`wire.ts` 定义引擎/UI 共享的路由与帧名（`ENGINE_ROUTES`、`SSE_FRAME`、`ProviderStatus`、`EngineHealth`、`CommandAck`、`toProviderStatus`）。这是 webview 唯一可安全导入的 `agent` 子路径（`@camelia/agent/view`）。

---

## 六、`@camelia/cli`——命令行

二进制 `camelia`（入口 `dist/bin.js`）。命令：

| 命令 | 作用 |
| --- | --- |
| `camelia run "<任务>"` | 规划并执行；`--mock`/`--spec` 离线确定性通道；`--resume <id>` 续跑 |
| `camelia replay [taskId]` | 从事件日志回放；无 taskId 列最近会话 |
| `camelia doctor [--offline\|--mock]` | 体检 home/Provider/MCP，可选跑引擎自检 |
| `camelia serve` | 起 HTTP/SSE 引擎服务，供 UI/桌面端连接 |

常用参数：`-w/--workspace`（默认 `cwd`，必须存在）、`--db`（默认 `~/.camelia/camelia.db`）、`-y/--yes`、`--auto-approve-plan`、`-p/--provider`、`-m/--model`、`--grunt-model`、`--test-command`、`--json`、`-q/--quiet`、`--verbose`、`--no-color`、`--log-level`；`serve` 另有 `--host`、`--port`（默认 `7433`，`0` 取随机）、`--approval-timeout`（默认 300s）、`--auto-run`、`--origins`。

**退出码**（一等契约）：`0` 完成、`1` 失败、`2` 用法错误、`3` 暂停、`130` 取消。

### 引擎服务器（`serve` → `server/`）

`EngineServer` 路由（`@camelia/agent/view` 常量）：`GET /health`、`GET /events`（SSE，帧 `bootstrap`/`domain`/`status`，先订阅后回放，最多 2000 条）、`POST /command`（命令 → `CommandAck`，`ok?200:409`）。`ApprovalBroker`：挂起的工具审批，超时（默认 300s）**失败即拒绝**——「没回答≠同意」。命令映射覆盖 submit/plan/tool/pause/cancel/intervene/记忆面板；`rollback_step` 与 `select_provider` 目前返回「尚不可用」。

---

## 七、`@camelia/ui`——状态投影

UI 不发明业务状态：`snapshot` 唯一来源是事件流经 `reduceEvents` 的折叠。传输层 `fixture`（离线/截图/测试）与 `sse`（真实引擎，`?engineUrl=`）共用同一契约。`window.__CAMELIA_BOOT__`（外壳注入）优先级 > URL。

- **Zustand store**（`state/store.ts`）：`snapshot` / `status` / `sessions` / `memory` / `localPrefs` / `settingsOpen` + 动作 `dispatch` / `query`（查询命令 10s 超时）。
- **组件**（`components/`）：`TopBar`（顶栏，`h-9`=36px）、`ActivityBar`（活动栏/阶段与进度）、`SessionRail`（左栏会话）、`Conversation`（对话流 + `PlanReview`/审批/失败卡）、`Composer`（底栏）、`RightRail`（右栏：运行统计/步骤/上下文/子 Agent/记忆/事件）、`StepCard`、`ToolCard`、`MemoryPanel`、`PlanReview`、`Reliability`（`NoticeBanner`/`ApprovalCard`/`FailureCard`）、`SettingsDrawer`、`CodeBlock`/`DiffBlock`、`WindowEdges`、`RailDivider`。
- **可复现场景**（`transport/scenario.ts`）**10 个**：`empty` / `connecting` / `planning` / `plan` / `diff` / `running` / `approval` / `failure` / `error` / `done`。
- **主题**（`theme/presets.ts`）4 套：`warm-dark` / `cool-dark` / `light`（"Light Refined"）/ `high-contrast`；样式表 `index.css` 装的是山茶花暖色暗黑基线（`--color-base:#1a1514`、`--color-accent:#d96c5f` 等）；token 白名单 20 项（与 core 同步）。**默认 `themeId='light'`、`language='zh'`**——即新装默认是「浅色 + 中文」。
- **i18n**（`i18n/`）：`en` + `zh` 双语（`t(lang,key)`，缺词回退英文再回退 key）。
- **原生集成**（`window/`）：经 `window.__TAURI__` 调用窗口控制与 `read_model_settings` / `write_model_settings` / `read_key_status` / `write_provider_key` / `relaunch_app`。

---

## 八、`apps/desktop`——Tauri 2.x 桌面外壳

- 包 `camelia-desktop`（Tauri 2、Rust 2021、`rust-version 1.77.2`），标识 `com.camelia.desktop`，产品名 `Camelia`，`withGlobalTauri: true`。
- 主窗口在 Rust 侧创建（`tauri.conf.json` 的 `app.windows` 为空）：标题 `Camelia`，`inner_size(1280, 820)`，最小 `1024×680`，无边框 `decorations(false)`，暗色，初始隐藏 + 1500ms 兜底 `show()`。
- 启动参数（`--flag` 或环境变量）：`--engine-url`/`CAMELIA_ENGINE_URL`、`--scene`/`CAMELIA_SCENE`、`--session-id`/`CAMELIA_SESSION_ID`；序列化为 `window.__CAMELIA_BOOT__`。
- **无显式 engine-url 且无 scene 时自动 `spawn_engine()`**：CLI 来自 `CAMELIA_CLI` / `~/.camelia/desktop.json` `cli` / 上溯仓库；Node 来自 `CAMELIA_NODE` / `desktop.json` `node` / fnm·nvm **Node 22** / Program Files / PATH；spawn 前 **probe `better-sqlite3`**（ABI 不匹配则清晰失败，不假装 Live）；成功则 `node <bin> serve --port=0 --json` 读回 `{url, sessionId}`；失败则 boot 注入 `engineSpawnError`，UI 走 fixture + 横幅。日志：`~/.camelia/logs/engine.log`。`desktop.json` 须 UTF-8 **无 BOM**。
- 命令与权限：注册 `read/write_model_settings`、`read_key_status`、`write_provider_key`、`relaunch_app`（另有 `open_engine_log`/`read_engine_log`，但未在 capabilities 授权）；密钥/配置写 `~/.camelia/keys.json`、`~/.camelia/config.json`。
- 打包：NSIS、`currentUser` 安装到 `%LOCALAPPDATA%\Camelia`，产物 `Camelia_<version>_x64-setup.exe`；`custom-protocol` 特性决定加载内嵌产物还是 Vite `devUrl`。

---

## 九、测试与验收

- 单测：各包 `packages/*/test/`（Vitest）。端到端：`tests/acceptance/cli.e2e.test.ts`（spawn 真实二进制）。
- 门禁：`pnpm typecheck && pnpm lint && pnpm build && pnpm test` 全绿；核心包行覆盖率阈值 80%（分支 70%）。
- 验收：`pnpm acceptance`（`scripts/acceptance-report.ts`）跑真实测试与覆盖率产物，生成 **`docs/ACCEPTANCE.md`**（禁止手工填写），映射白皮书 §9 的 M1–M15。
- 本地评测脚本：`scripts/m1-local-eval.mjs`、`scripts/m2m3-local-eval.mjs`、`scripts/usable-check.mjs`。

---

## 十、已知不一致与待办（截至本次通读）

以下为**代码/文档内**存在的、值得注意的不一致，供维护者留意（本次已修正其中一部分文档侧问题）：

**代码内部注释与实现不符**
1. `packages/core` 无 `ConsoleLogger`（README 曾引用）。
2. `PluginLoader.ts` 头部注释称「进程隔离尚未实现」，实际工具插件已走 worker 线程加载。
3. `config/load.ts` 头部注释声称优先级「env → keys.json → config.json」，实际 `apiKey` 解析为 **keys.json → env → config.json**。
4. 两套退避函数（网关 base 200ms、恢复 base 400ms 上限 8000ms）与两套「可重试错误」子串（工具层漏 `socket hang up`，恢复层含）。
5. `ErrorRecovery` 的 `degrade-readonly` 策略声明了但从不产出；`AgentLoop.rollback(id)` 忽略传入 id。

**环境 / 启动**
0. 仓库锁定 **Node 22**（`.nvmrc`）。系统 `Program Files` 若为 Node 24 而 `better-sqlite3` 按 22 编译，桌面 spawn 会 ABI 崩溃；应用 `desktop.json.node` / `CAMELIA_NODE` 指向 Node 22，或在同一 Node 下 `pnpm rebuild better-sqlite3`。

**实现上的「尚不可用」**
6. `EngineServer` 对 `rollback_step`、`select_provider` 返回「尚不可用」。
7. ~~桌面端 `open_engine_log` / `read_engine_log` 未授权~~（已过时）：`capabilities/default.json` 已含 `allow-open-engine-log` / `allow-read-engine-log`。
8. `tauri.conf.json` 的 `app.windows` 为空，窗口配置只存在于 `main.rs`。

**文档侧（本次已核对/修正）**
9. `docs/ACCEPTANCE.md` 生成于较早日程，Iteration 25 未重跑验收；其头部声明「由脚本生成、禁止手工填写」，正确做法是重跑 `pnpm acceptance` 而非手改。
10. `DEFAULT_LOCAL_PREFS` 默认主题为 `light`（浅色）而非暖色暗黑，与「warm-dark projection」的直觉描述不同。

---

*本文档为代码现状速查，随实现演进而更新；架构意图仍以 `WHITEPAPER.md` 为准。*
