# Camelia 认知架构设计书（预测—误差回路）

> **状态**：设计稿，未实施。本文只定义架构与接口，不含实现。
> **仓库**：`C:\Users\37963\Desktop\Camelia-Agent`
> **依据**：`docs/WHITEPAPER.md`（架构宪法）、`docs/CODE-SUMMARY.md`（实现现状，其中 `SCHEMA_VERSION` 记 4、余代码为 5）、`docs/ITERATION_LOG.md`（Iteration 20–22 记忆与自省）
> **读者**：负责实施的下游 AI。本文的接口签名是契约，不是示意。
> **版本**：v1 · 2026-10-14

---

## 0. 一句话结论

Camelia 现在是一台**记录机器**：它把每一步、每次工具调用、每个判决都完整记进事件日志，但它从不**预测**任何东西，因此从不**惊讶**，也就永远不会因为「事情和我以为的不一样」而改变自己。

**唯一要加的原语不是知识库，而是「先承诺、后观察」的预测。** 预测误差（惊讶）一旦存在，问题里那七个方向中的五个就都变成同一个机制的推论，而不是七个并列的架构。

本文定义：一个预测原语、它的评分规则、一个确定性可解释的估计器、五条把预测接到现有循环上的决策路径，以及对应的类型 / 事件 / 命令 / schema V6 / 移植路径。

---

## 1. 现状分析：这台机器已经有什么，缺什么

### 1.1 已经存在且不可重建的资产

实施者**必须**先理解这四样东西，否则会重复造轮子并破坏现有不变量。

**（1）事件溯源底盘 —— 这是最被低估的资产。**

`packages/core/src/types/events.ts` 的 `DomainEventMap` 是全部跨层通信的唯一注册表。`events` 表（schema V1）以 `seq INTEGER PRIMARY KEY AUTOINCREMENT` 持久化每一条事件，带 `session_id` / `task_id` / `type` / `payload` / `trace_id` / `ts`。

这意味着：**系统已经拥有一个带全序的（状态，动作，后果）三元组日志。** `step.started` → `tool.requested` → `tool.finished` → `verify.result` → `step.completed` 就是一条完整的转移记录。它现在只被当作审计与重放的材料，没有人把它当作**轨迹**去读。

第二层含义同样重要：`docs/WHITEPAPER.md:172-176` 记录了采用事件驱动的四个理由，其中「可重放」正是认知机制能被**离线回测**的前提——你可以在不跑任何模型的情况下，用历史事件流重放一遍新的估计器，直接看它当年会不会预测对。**这个能力是免费得到的，任何其他设计都要自己搭一套。**

**（2）`failure_modes` 表（schema V4）—— 唯一的结构化持久先验。**

```
failure_modes(id, kind, mechanism, workspace, created_at)
idx_failure_modes_workspace(workspace, kind)
```

`FailureModeKind` 是闭集：`path-hallucination` / `zero-tool-calls` / `context-exhaustion` / `declared-but-ineffective` / `abi-mismatch`。它的注释写着「The row points at a mechanism, not a prompt sentence」——这句话的精神正是本文要继承的。

它目前只被读两处：`Planner.plan` 追加一行警告，`AgentLoop.routeStep` 把它当作 `difficultyScore` 的 `historicalFailures`。**它是一个未被充分利用的 world model 雏形**：工作区级、持久、按机制分类。

**（3）`Verdict` / `Evidence` 对 —— 唯一的结构化观察通道。**

```ts
interface Evidence { kind: 'tool-call'|'command-output'|'file-hash'|'assertion'|'model-claim'; ref: string; detail?: string }
interface Verdict  { status: 'pass'|'fail'|'unknown'; evidence: Evidence[]; reason: string }
```

注意 `unknown` 是**一等公民**，与 `false` 严格区分（`ProviderView.connected?: boolean` 的注释强调过同样的纪律）。这个三值逻辑是诚实性的基础设施，预测机制必须沿用。

**（4）记忆生命周期 —— 一套已经在跑的「价值驱动遗忘」。**

`MemoryItem` 的 `strength = importance × recency × correctness`，配 `retrievable`（不可机械淘汰）、`nextReviewAt`（间隔重复）、`memory_forget_log`（每次遗忘留痕）。`memory.downgraded` 把 `correctness` 归零但**保留记录作为可审计的负事实**。

**为什么这四条决定架构走向：** 它们说明这个项目已经有一套成熟的「状态被持久化、被折叠、被审计、被降权」的纪律。**新机制必须嵌进这套纪律，而不是在旁边另起一套数据库。** 任何试图引入 embedding、向量库或独立推理进程的方案，都会与 `WHITEPAPER.md` 附录 A 的硬约束（禁止 Prisma、API Key 只在 `~/.camelia/`、零遥测）以及「用架构补模型」的第一性原则直接冲突。

### 1.2 完全不存在的东西（已逐一 grep 确认）

| 概念 | 状态 | 证据 |
| --- | --- | --- |
| 预测 / prediction | **不存在** | 全仓库 `predict` 唯一命中是 `approval.test.ts:129` 的一个测试名，与认知无关 |
| 期望 / expectation | **不存在** | 全部命中都是 `intent.expectedPaths`（路径白名单）或 vitest 的 `expect()` |
| 惊讶 / 预测误差 | **不存在** | 唯一命中是 `Verifier.ts:284` 一句关于正则语义的注释 |
| 假设 / hypothesis | **不存在** | 零命中 |
| 信念 / belief | **不存在** | 零命中 |
| 知识间矛盾 | **不存在** | 最接近的 `memory.critiqued` 是**跨会话适用性折扣**（0.7），不是两项之间的不一致 |
| 好奇 | **不存在** | 零命中 |
| 世界模型 | **不存在** | 零命中 |
| 技能 / 程序学习 | **部分** | `kind: 'procedural'` 存在，但只在 `reflect()` 写一次，且是一条**扁平字符串**（`When asked to "${goal}", a working approach is: A → B → C`），靠 `correctness` 做二值翻转 |
| 类比 / 反事实 | **不存在** | 零命中 |

**结论：** 现有的一切「看起来像认知」的东西，都可以归为三类之一——

1. **声明式后置条件**（`AcceptancePoint` + `Verdict`）：由规划模型写出来，事后机械核对；
2. **确定性的分歧度量**（drift 的 Jaccard 距离、loop 的指纹重复、no-progress 的连续计数）；
3. **存储字符串的生命周期记账**（value / decay / promote / downgrade）。

**三者都不是「关于未来的表示」。系统里没有任何地方存着一个「我以为会发生什么」，因此没有任何地方能把「我以为的」和「实际发生的」摆在一起比较。** 这是唯一的、也是根本的缺口。

### 1.3 现有架构的诚实短板（设计必须绕开）

- **`ErrorRecovery` 的梯子大半没接上。** `AgentLoop` 的 fixup 循环只对 `strategy.kind === 'retry'` 生效，其余 `switch-provider` / `degrade-readonly` / `ask-human` / `rollback` 被算出来、发了 `recovery.attempted` 事件，然后 `break`。所以「换模型」「降级只读」是**声明了但从未执行**的。本文的预测机制若要驱动这些动作，得顺手把它们接上（见 §6.3）。
- **`AgentLoop.rollback(checkpointId)` 忽略传入 id**，始终整本 journal 回滚（`CODE-SUMMARY.md` §10.5 自陈）。
- **`procedural` 记忆没有成功计数、没有变体库、没有适用条件。** 它是一条字符串加一个 0/1。
- **`memories.embedding BLOB` 字段声明了但从未读写**，召回是纯 SQL `LIKE`。
- **`MODE_COMING_SOON`、`mode.more*`、`isTaskActive` 等多个导出无消费者**（UI 层债务，与本文无关，但说明仓库存量死代码会被继承）。

---

## 2. 对七个方向的裁决

问题里给了七个方向。**我的判断是：它们不是七个选项，而是两个机制加上两个陷阱。** 逐条给出取舍与理由。

### 2.1 纳入：方向一（世界模型）+ 方向五（在线预测）是**同一个机制**

> 方向一：存「状态—动作—后果」的转移模型，而不是静态命题。
> 方向五：预测下一步、用观察修正、预测误差驱动学习。

**这两条必须合并实施，因为它们是同一件事的两半。** 「世界模型」不是一张要单独维护的表，它就是**预测的集合**；「在线预测」不是要在模型旁边加的一个循环，它就是**这个集合的读写时机**。

具体地：一条命题「`fs.write` 在 `packages/core/src/` 下会成功」和一条预测「下一步 `fs.write` 会返回 ok，置信度 0.9」是同一个东西的两种写法——**后者更好，因为它可被证伪，而前者不可**。这就是问题里那句话的技术含义：「知识不是三角形内角和 180 度，而是如果我对三角形做 X，会观察到 Y」。

**为什么这条路对本项目可行，而其余几条不可行：** 方向一和五的代价那栏写着「需要环境、需要模拟、需要大量交互数据」。**但 Camelia 已经有环境和数据了**——工作区就是环境，`events` 表就是交互记录，`seq` 保证全序，重放保证可离线回测。真正缺的只是一行「我预测 X」的记录。

**这是本文的主线。**

### 2.2 纳入：方向四（技能习得）——但要**嫁接**在既有 `procedural` 记忆上

> 方向四：学「如何证明一个定理」这样的策略，而不是「内角和 180 度」这样的事实。

方向四的洞见是对的：**技能和知识的区别在于前者带成功率。** 但实施上**不要新建技能系统**——`MemoryKind` 已经有 `'procedural'`，`MemoryLayer` 也有 `'procedural'`，`reflect()` 已经在写它，`applyMemoryOutcomeFeedback` 已经在做成功/失败反馈。缺的只是：

- 把那条扁平字符串变成**结构化的步骤序列**；
- 给每条技能挂上**样本数 n 与成功率**，而不是一个 `correctness` 0/1；
- 让技能带上**适用条件**（即 §4 的 `SituationSignature`），否则无法判断「这条技能在什么情况下管用」。

也就是说，**技能 = 一条被反复评分过的预测序列**。这正好落在 §2.1 的机制上，不需要第二套理论。

### 2.3 纳入：方向七（认知动力学）——但**降级为可观测性**

> 方向七：不关心知识库长什么样，关心知识如何流动；不关心冲突标记是什么，关心冲突如何传播。

作为架构，这是**空的**——它说不清要实现什么。但作为**仪表**它极有价值，而且极其便宜：一旦有了预测与残差的时间序列，下面这些量就是免费的：

- **学习曲线**：某个签名下的平均残差是否随任务数下降？（是 → 学到东西了）
- **世界漂移**：一个**曾经预测得很好**的签名，误差是否在上升？（是 → 环境变了，不是模型笨）
- **虚假胜任**：`confidence` 高但残差持续高？（是 → 置信度没有依据，是校准失败）

第二条尤其重要：**它能把「环境变了」和「模型不行」分开**，这是现有 `DriftDetector` 做不到的——后者只在单次任务内比较声明路径与实际路径，没有跨任务的历史。

所以方向七**不做成研究纲领，做成 §8 的三条统计断言 + 一个 UI 面板**。

### 2.4 条件纳入：方向三（多智能体社会）——只在 `term` 模式内，且判据是**预测校准**而非投票

> 方向三：多个异构智能体各有独立认知状态，互相辩论、协商、竞争。

现有代码已经有骨架：`SubAgentOrchestrator`（信号量 `maxSubAgents`，默认 3）、`team/plan.ts` 的 `parseTeamWorkers`（严格解析，**空列表视为失败而不是「自己编一个 worker」**）、`team/assign-roles.ts` 的 `RoleNeed` / `assignRoleModel`（按视觉/上下文/工具需求挑模型，挑不出就**拒绝**，绝不虚构模型）。这套「拒绝而不是编造」的纪律很好，应当保留。

**但方向三的问题在于：它没有说清多个智能体凭什么比一个强。** 「多个模型投票」在弱模型上通常是**降低**准确率的（多数派共享同一个错误）。所以只有在能**度量**谁更好的时候多智能体才有意义。

因此：**异构的来源是「不同的预测签名」**——批判者 agent 拿到的 `SituationSignature` 与执行者不同（它预测的是「这一步的 verdict」而不是「这个工具是否 ok」），于是两者的残差**在同一批观察上可比**。谁的历史残差低，谁的预测就有更高权重。**这是有原则的集成，不是投票。**

**边界**：只在 `term` 模式启用；**不得**让子 agent 拥有独立记忆库（会带来 `ITERATION_LOG` 反复强调的「双份真相」问题）；子 agent 的预测与残差必须挂在父任务的 `taskId` 上，保证 §9 的可审计性。

### 2.5 剔除：方向二（可微分推理）与方向六（潜在空间推理）

> 方向二：用向量表示命题、矩阵运算做推理、能量模型做冲突检测，端到端训练。
> 方向六：推理发生在隐空间，用向量运算做推理、注意力做依赖、熵做不确定性。

**两条都剔除，理由是决定性的、且与偏好无关：**

1. **它们需要训练，而本项目没有也不打算有训练基础设施。** 方向二自己的代价栏写着「需要机器学习背景、需要训练、需要大量算力，个人研究很难从头搞」；方向六写着「需要深入理解 Transformer 内部机制，需要修改模型结构」。Camelia 的模型是 **API 调用的和本地 Ollama 的第三方权重**（`qwen2.5-coder:7b`、`llama3.2:3b`），它不是自有模型，**无法修改模型结构**。方向六在物理上不可实施。
2. **它们与架构宪法直接冲突。** `WHITEPAPER.md:480` 的第一性原则是「能用代码确定性解决的，绝不交给模型」；§5.5 明确列出**绝不可委托给模型**的事项（代码解析、路径定位、diff 应用、语法校验、测试裁定、回滚）。方向二的「连续松弛做真值维护」会把**判决**变成可微的软分数，而 `Verdict` 的三值逻辑（`pass`/`fail`/`unknown`）正是本项目诚实性的支柱。把它软化，等于取消「客观可验证」这条验收标准（CCD-5 的 C2）。
3. **方向六还额外违反可审计性。** 本项目全部设计建立在「事件流是唯一真相、UI 是纯折叠」之上；隐空间推理的中间状态无法折叠、无法重放、无法向用户解释。这会让 `docs/CAMELIA-ROADMAP.md:346` 的「UI 侧禁止私造数据」升级为「引擎侧无法解释数据」。

**这不是说这两条方向在学术上错，而是说它们与本项目的约束集不相容。** 若将来 Camelia 变为自有模型训练项目，应重开此议题；在当前形态下，实施它们等于换一个项目。

### 2.6 裁决总表

| 方向 | 裁决 | 落位 |
| --- | --- | --- |
| 一 · 世界模型 | **纳入，为主线** | §3–§7 全部 |
| 五 · 在线预测 | **纳入，与方向一合并** | 同一个机制的两半，不可拆 |
| 四 · 技能习得 | **纳入，嫁接在 `procedural` 记忆上** | §4.5、§4.6、§6.4 |
| 七 · 认知动力学 | **纳入，降级为可观测性** | §8 三条统计断言 + UI 面板 |
| 三 · 多智能体社会 | **条件纳入**，仅 `term` 模式，判据为预测校准 | §9.2 |
| 二 · 可微分推理 | **剔除** | 需训练基础设施；违反第一性原则与三值判决 |
| 六 · 潜在空间推理 | **剔除** | 需修改模型结构（不可能）；违反可审计性 |

**一句话**：方向一与五是引擎，方向四是它的一种应用，方向七是它的仪表盘，方向三是它在多智能体下的特例；方向二与六是另一个项目。

---

## 3. 核心机制：预测—误差回路

### 3.1 回路的五个动作

```
    ┌─────────────────────────────────────────────────────────┐
    │  ① 情境签名   SituationSignature                         │
    │     「现在是什么局面」——能力/步骤类型/规模/工具集/入度      │
    └────────────────────────┬────────────────────────────────┘
                             ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ② 预测       Prediction                                │
    │     在动作之前，对某个「可观察量」作出可证伪的承诺           │
    │     带 confidence 与 basis（依据的人类可读解释）           │
    └────────────────────────┬────────────────────────────────┘
                             ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ③ 观察       ObservedValue                             │
    │     动作之后，从已有事件里读到的真实结果                    │
    │     来源：Verdict / ToolCall.status / Artifact / metrics   │
    └────────────────────────┬────────────────────────────────┘
                             ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ④ 残差       Residual                                  │
    │     score ∈ [0,1]，0 = 完全料到；按题型选评分规则           │
    │     surprise = score ≥ 该签名层面的自适应阈值              │
    └────────────────────────┬────────────────────────────────┘
                             ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ⑤ 适应       CognitiveAction                           │
    │     残差改变下一步的行为；同时更新情境统计表                │
    └─────────────────────────────────────────────────────────┘
```

**关键纪律（必须写进实现的注释里）：预测永远不是事实。** 在类型层面，`Prediction` 与 `Verdict` / `Evidence` 是不同的类型、不同的事件、不同的持久化表；在 UI 层面，两者必须视觉可分。这和仓库既有的「演示数据必须带 演示 角标、绝不折叠进 `snapshot`」是同一条纪律——**未经证实的估计绝不允许看起来像已证实的事实。**

### 3.2 预测什么：只预测**已经存在**的可观察量

这是本设计最重要的工程决策。**不要预测任何系统没有传感器去测量的东西。**

| 可观察量 | 取值域 | 现实来源 | 评分规则 |
| --- | --- | --- | --- |
| `verdict` | `pass` / `fail` / `unknown` | `verify.result` | 多类 Brier |
| `tool-outcome` | `ok` / `error` | `tool.finished` / `tool.failed` | Brier |
| `tool-call-count` | 非负整数 | `StepResult.toolCalls.length` | 归一化绝对误差 |
| `duration-ms` | 非负整数 | `ToolCall.durationMs` / step 起止 | 归一化绝对误差 |
| `cost-usd` | 非负实数 | **gateway 实测用量**（注意：**不是** `routing.chosen.estimatedUsd`，那是估算值，是预测而非观察） | 归一化绝对误差 |
| `touched-paths` | 工作区相对路径集 | `WorkspaceJournal` / `Artifact.path` | **Jaccard 距离** |
| `failure-mode` | `FailureModeKind` 闭集 | `failure_modes` 表 | Brier |

两个刻意的选择：

- **`touched-paths` 直接用 Jaccard 距离**，因为 `DriftDetector` 已经在用同一个度量（`1 − |期望∩实际| / |期望∪实际|`）。**复用已有的度量比引入新度量更容易被理解和信任**，而且能让「漂移」这个既有信号获得一个**预测性的**版本（不是事后说「你偏了」，而是事前说「我预计会碰这 3 个文件」）。
- **`failure-mode` 以闭集为目标**，所以它不是自由文本预测，而是对五个已知失败机制的分类预测。这让它天然继承 `failure_modes` 表的历史数据（§4.3）。

**明确不预测的东西**（写进文档以免实施者过度扩张）：**不预测「方案是否正确」**——那需要理解问题的语义，是 verifier 的职责，不是本机制的。本机制预测的是**自身操作环境**：这次编辑会不会让测试挂、这个工具在 30 秒内会不会超时、这步会碰几个文件。这正是「有经验的工程师」与「新手」的差别所在——**能预感到这次改动会炸**。这是诚实的、也是相当可观的：它是**关于 agent 自身操作域的世界模型**，不是关于世界的世界模型。

### 3.3 评分规则（三种，全部确定性、无模型）

**（1）Brier 分数** —— 用于分类（`verdict`、`tool-outcome`、`failure-mode`）：

```
score = Σ_i (p_i − o_i)²        对全部类别求和，o 是 one-hot
```

二值情形退化为 `(p − o)²`。选 Brier 而不用 0/1 命中率，是因为**它同时惩罚「猜错」和「过度自信」**：预测 `p=0.95` 而失败（score = 0.9025）远比预测 `p=0.5` 而失败（score = 0.25）更严重。**没有这一条，系统就学不会「我不确定」——它会一直报 0.9 然后在错的时候假装没事。**

值域天然是 [0,1]，二值下最大值 1。

**（2）归一化绝对误差** —— 用于数值（`tool-call-count`、`duration-ms`、`cost-usd`）：

```
score = min(1, |predicted − observed| / max(1, |observed|))
```

分母取 `max(1, |observed|)` 有三重作用：避免除零、避免小数值把误差放大成噪声、让「预测 3 实际 4」和「预测 300 实际 400」得到同样的 0.25。`min(1, ·)` 保证与 Brier 同值域。

**（3）Jaccard 距离** —— 用于集合（`touched-paths`）：

```
score = 1 − |predicted ∩ observed| / |predicted ∪ observed|
```

两侧皆空时定义为 0（「我预计什么都不碰，也确实什么都没碰」= 完全料到）。

### 3.4 惊讶的判定：**自适应阈值 + 最小样本**

一个固定阈值（例如 `surprise = score > 0.5`）在冷启动时会**处处报惊讶**，因为初始预测本身就很差——那会把机制变成噪声源。

因此：

```
在该签名层面的最近 M 条残差中，取第 P 百分位作为该层面的阈值
P = 80，M = 50（可配置）
样本不足 minSamples（默认 8）时：记录残差，但 surprise 恒为 false，不触发任何动作
```

这三条规则合起来保证：**机制在学会之前保持沉默。** 这是与 `reliability.no_progress`（阈值 3 次）一致的「先观察再断言」风格。

此外，**当预测来源是 `prior`（冷启动先验）时，`surprise` 强制为 false**——先验预测只用于显示与路由，绝不用来触发行为改变。理由：先验没有样本支撑，它的误差不反映系统的理解程度，把它当惊讶信号会污染学习信号。

### 3.5 从残差到行为：**这一步是机制成立的判据**

**如果预测只被记录下来而不改变任何行为，那它只是日志，不是认知。** 因此必须定义五条决策路径，且每条都可测试：

| 触发条件 | 动作 | 落位（现有代码） |
| --- | --- | --- |
| 预测 verdict 为 `fail` 的概率高（`p_fail ≥ 0.5`） | **为该步补一个机器可验证的验收点**（若原本只有 `manual`） | `SelfReview` 的 `verifiability` 问题；规划后、执行前 |
| 预测 `tool-call-count` 高 / 预测 verdict 方差大 | **拆分该步**（`plan.revised`） | `Planner.revise`，即现有 replan 路径 |
| 预测 `cost-usd` 超出剩余预算 | **提前用决策模型**（而不是先试便宜模型再升级） | `routeStep` / `modelForAttempt` |
| 某步的残差 `surprise = true` 且该步 verdict 为 `pass` | **追加一次独立复核** | `Verifier.verify` 再跑一次；这正是被记录的失败模式 `declared-but-ineffective` 的**事前版本** |
| 签名不确定度高（见 §5.4）且存在**只读**探针 | **探测**：执行最低成本的只读观察以降低不确定度 | 见下方安全约束 |

**安全约束（不可协商）**：最后一条的「探测」**只允许只读工具**（`fs.read` / `search.*` / `fs.list`），**禁止** `fs.write` / `shell.exec` / 网络工具。而且**它仍然必须走既有的审批闸门**——预测机制不得成为绕过 `ApprovalGate` 的通道。`ITERATION_LOG.md` 的护栏条款明确写着「privileged 审批、schema 校验、工作区白名单、密钥边界全部保持原样」，本文不得触碰。

---

## 4. 估计器：分层回退的经验表（为什么不是神经网络）

### 4.1 设计约束导致的结论

四个约束联合排除了学习式估计器：

1. 仓库存量是 TypeScript + better-sqlite3（`WHITEPAPER` 附录 A 禁止 Prisma 之外的 ORM，且 ABI 锁 Node 22）；
2. 项目目标是「用架构补弱模型」，**不训练模型**；
3. 预测必须在**热路径**上可用（每次 step 前），不能每次都调 LLM——否则认知机制的token 成本会超过任务本身；
4. 预测必须**可解释**（`basis` 要能对用户说清依据），否则无法审计。

于是只剩一个家族：**确定性经验统计 + 分层回退（hierarchical backoff）**。这在技术上就是 n-gram 语言模型里的 Kneser-Ney 平滑思想搬到状态空间——**从最具体的键开始查，样本不够就往更泛的键回退，最泛的层由先验锚定。**

**它的决定性优势是「n=1 就能工作」**：不需要训练、不需要环境预热、第一次预测就有合理的值（来自先验层），并且随着样本增加逐层接管。**这直接回答了方向一「需要大量交互数据」的成本担忧**——在本项目已有的历史事件上（`events` 表）甚至可以**离线重放回填**。

### 4.2 情境签名：把局面离散化成可回退的键

签名的设计目标是**泛化**——两个不同的任务如果「局面相似」，就应该共享预测经验。

```ts
export type CapabilityClass = 'tool-calling' | 'text-tool-calls' | 'no-tools';

export type StepArchetype =
  | 'read'      // 只读探查
  | 'write'     // 新建文件
  | 'edit'      // 修改既有文件
  | 'exec'      // 跑命令 / 测试
  | 'verify'    // 纯校验
  | 'research'; // 搜索 / 检索

export type ScopeClass = 'single-file' | 'few-files' | 'many-files' | 'unknown';

export interface SituationSignature {
  readonly capability: CapabilityClass;
  /** 由规划器给出的步骤标题/目标推断，采用确定性关键词规则（不得调用模型）。 */
  readonly archetype: StepArchetype;
  readonly scope: ScopeClass;
  /** 本步计划提供的工具名，排序后去重，作为稳定键。 */
  readonly toolset: readonly string[];
  /** 依赖入度：被多少后续步骤依赖（复用 difficultyScore 的 inDegree）。 */
  readonly inDegree: number;
}
```

**`capability` 必须在签名里**，这是从仓库已经吃过的亏里学到的：`ProviderCapabilities.textToolCalls` 的注释记录了一次实测——`qwen2.5-coder:7b` 能理解工具、但会用 prose 或 JSON 代码块回答，导致 `tool_calls` 为空。**同样的步骤在 tool-calling 模型和 text-tool-calls 模型上的成功率完全不同**，混在一起统计会把两者都预测错。`granularityFor` 已经按能力分支了，签名必须跟上。

### 4.3 回退键与统计表

签名序列化成**带通配尾的规范键**，于是回退就是一次字符串前缀游走，每层一行：

```
L3  "text-tool-calls|edit|few-files|3"          最具体：含入度
L2  "text-tool-calls|edit|few-files|*"          丢掉入度
L1  "text-tool-calls|edit|*|*"                  丢掉规模
L0  "text-tool-calls|*|*|*"                     只保留能力类别
L-1 "*"                                         全局先验
```

（`toolset` 的长度作为 `scope` 的补充信号参与 `scope` 的判定，不进键，避免键空间爆炸；`toolset` 本身记在 `predictions` 行里供解释与审计。）

**每一层独立维护自己的估计**，预测时从 L3 向下找到**第一个满足 `n ≥ minLevelSamples`（默认 3）的层**，用它的估计；并把实际用到的层记进 `basis`。

### 4.4 冷启动锚定（L-1 从哪来）

全局先验不应该是 `0.5` 这种无信息值——仓库里已经有几个人们已经算出来的先验，**必须复用**：

| 先验来源 | 用法 |
| --- | --- |
| `countFailureModes(workspace, kind)` | `failure-mode` 与 verdict 预测的基准：该工作区此类失败越多，`p_fail` 起手越高 |
| `ModelInfo.capabilitySource` / `ProviderCapabilities.quality` | 按能力类别给分层初值；**`quality` 是 0..1 启发式分数，可直接当 `p_pass` 的起点** |
| `difficultyScore`（`routing/cheap-first.ts`） | 已经综合了 weight / inDegree / fileCount / historicalFailures；**用它给 L-1 一个非零信息量的初值** |
| `granularityFor` | text-tool-calls 模型的步骤粒度已经被刻意压小，先验应反映其更低的单步复杂度 |

**纪律：`basis` 必须如实说明先验来自哪里**（例如 `"prior: quality 0.40, 3 recorded path-hallucination failure(s)"`），不能只说「基于历史数据」。这与仓库里 `MemoryEvidence` 的设计意图一致——面板要能显示「由任务 tsk_… 验证」而不是一个无解释的 1.0。

### 4.5 技能数据（方向四的落位）

`procedural` 记忆从「一条扁平字符串」升级为**带成败记录的策略**：

```ts
export interface SkillRecord {
  readonly memoryId: Id;                 // 既有 procedural MemoryItem 的 id
  readonly steps: readonly string[];     // 结构化步骤（取代 "A → B → C" 字符串）
  readonly signatureKey: string;         // 适用条件——关键新增
  readonly attempts: number;
  readonly successes: number;
  /** 与预测同源的评分：这条技能在它自己的签名下的平均残差。 */
  readonly meanResidual: number;
  readonly lastAttemptAt: Timestamp;
}
```

**门槛**：一条技能要 `attempts ≥ 3 && successes / attempts ≥ 0.5` 才允许被**推荐**给规划器（而不是像现在这样一次成功就写进全局记忆并永不淘汰）。这修正了一个现存缺陷：现在的 `retrievable: false` 让 procedural 记忆**永不机械淘汰**，但一条被证伪的技能只是 `correctness` 归零、永久留在库里——**新增的 `attempts` 记录让它能被「从未成功过」这个理由淘汰**，而不依赖用户手动清理。

### 4.6 ⚠️ 命名冲突警告：仓库已有另一个「skill」

实施者必须先知道这件事：`CommandMap` 里**已经存在** `list_skills` / `install_skill`（`events.ts:328-334`），它们指的是**用户安装的 SKILL.md 文件夹**（从用户 skills 目录、工作区、可选额外根目录发现，并可复制到 `~/.camelia/skills`）。

那是**外部技能的发现与安装**，和本文 §4.5 的 `SkillRecord`（系统自己从成功运行里学到的策略，带样本数与成功率）是**两个不同的东西**。

**因此**：

- 本文的 `skills` 表**不要**命名为 `installed_skills` 或任何与 SKILL.md 相关的名字；
- **不要**新增 `list_skill_records` 这类易混的命令名；
- 面板与文案必须区分二者：SKILL.md 是「已安装的技能包」，本文的是「学到的策略」。建议 UI 上后者叫**「经验」或「已学策略」**，避免用户以为系统在自学 SKILL.md；
- 若将来要把两者打通（例如学到的策略导出成 SKILL.md），那是一个**独立议题**，不在本文范围内。

---

## 5. 接口契约

以下是本文的**核心交付物**。实现者按此签名写代码；签名是契约，改动需走评审。

### 5.1 类型（落位：`packages/core/src/types/cognition.ts`）

```ts
import type { Id, Timestamp } from './common.js';
import type { FailureModeKind } from '../persistence/session-store.js';

/* ─────────────── 情境 ─────────────── */

export type CapabilityClass = 'tool-calling' | 'text-tool-calls' | 'no-tools';
export type StepArchetype = 'read' | 'write' | 'edit' | 'exec' | 'verify' | 'research';
export type ScopeClass = 'single-file' | 'few-files' | 'many-files' | 'unknown';

export interface SituationSignature {
  readonly capability: CapabilityClass;
  readonly archetype: StepArchetype;
  readonly scope: ScopeClass;
  readonly toolset: readonly string[];
  readonly inDegree: number;
}

/* ─────────────── 被预测的可观察量 ─────────────── */

export type Observable =
  | { readonly kind: 'verdict'; readonly stepId: Id }
  | { readonly kind: 'tool-outcome'; readonly tool: string }
  | { readonly kind: 'tool-call-count'; readonly stepId: Id }
  | { readonly kind: 'duration-ms'; readonly stepId: Id }
  | { readonly kind: 'cost-usd'; readonly taskId: Id }
  | { readonly kind: 'touched-paths'; readonly stepId: Id }
  | { readonly kind: 'failure-mode'; readonly workspace: string };

export type ObservableKind = Observable['kind'];

/* ─────────────── 预测 ─────────────── */

export type PredictionValue =
  | { readonly kind: 'categorical'; readonly p: number; readonly label: string }
  | { readonly kind: 'categorical-multi'; readonly probs: Readonly<Record<string, number>> }
  | { readonly kind: 'numeric'; readonly value: number; readonly unit: string }
  | { readonly kind: 'set'; readonly items: readonly string[] };

export type PredictionSource =
  | 'empirical-backoff'  // 分层统计表（主路径）
  | 'prior'              // 冷启动先验（quality / failure_modes / difficultyScore）
  | 'model'              // 显式询问过模型（昂贵，默认关闭，见 §7.4）
  | 'user';              // 用户在干预里陈述的期望

export interface Prediction {
  readonly id: Id;
  readonly taskId: Id;
  readonly sessionId: Id;
  readonly stepId?: Id;
  readonly subject: Observable;
  readonly signature: SituationSignature;
  readonly signatureKey: string;      // 规范化后的回退键
  readonly value: PredictionValue;
  /** 0..1：对「这个预测本身有多可信」的自评，用于校准诊断，不用于评分。 */
  readonly confidence: number;
  readonly source: PredictionSource;
  /** 人类可读依据，例如 "L2 n=12, pass 9/12" 或 "prior: quality 0.40"。 */
  readonly basis: string;
  /** 产生此预测的层，便于诊断。 */
  readonly level: number;
  readonly at: Timestamp;
}

/* ─────────────── 观察 ─────────────── */

export type ObservedValue =
  | { readonly kind: 'categorical'; readonly label: string }
  | { readonly kind: 'numeric'; readonly value: number }
  | { readonly kind: 'set'; readonly items: readonly string[] };

/* ─────────────── 残差 ─────────────── */

export type ScoringRule = 'brier' | 'categorical-brier' | 'nrmse' | 'jaccard';

/**
 * 一次预测的结算。
 *
 * `score` 与 `surprise` 分开存：score 是连续的原始信号（用于统计与校准），
 * surprise 是离散的、经过阈值判断后的行为触发器。混为一谈会让
 * "阈值调整" 变成 "重新计算历史"，而历史必须不可变。
 */
export interface Residual {
  readonly predictionId: Id;
  readonly taskId: Id;
  readonly signatureKey: string;
  readonly observed: ObservedValue;
  readonly score: number;             // 0..1
  readonly rule: ScoringRule;
  readonly surprise: boolean;
  /** 判定惊讶时所用的阈值；冷启动或先验预测时为 null。 */
  readonly threshold: number | null;
  /** 人类可读对照："expected pass (0.75) → observed fail"。 */
  readonly contrast: string;
  readonly at: Timestamp;
}

/* ─────────────── 决策 ─────────────── */

export type CognitiveAction =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'add-verification'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'split-step'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'use-decision-model'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'reverify'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'probe'; readonly probe: Observable; readonly reason: string }
  | { readonly kind: 'ask-user'; readonly question: string; readonly reason: string };

/* ─────────────── 胜任度与不确定度 ─────────────── */

export interface CompetenceReport {
  readonly signatureKey: string;
  readonly n: number;
  /** 平均残差：越小越准。 */
  readonly meanResidual: number;
  /** 残差标准差：越大越不稳定。 */
  readonly residualStdDev: number;
  /** 校准误差：mean(confidence) − mean(1 − residual)，正值 = 过度自信。 */
  readonly calibrationGap: number;
  readonly from: Timestamp;
  readonly to: Timestamp;
}

export interface Uncertainty {
  readonly signatureKey: string;
  readonly subject: Observable;
  /** 0..1，越高越不确定——由样本量与残差方差共同决定。 */
  readonly entropy: number;
  /** 探测该量的预期成本（token / 秒），用于选最便宜的探针。 */
  readonly probeCost: number;
}
```

### 5.2 端口（落位：`packages/core/src/ports/cognition.ts`）

遵循仓库存量端口风格（`ports/llm.ts`、`ports/fs.ts`）：**接口在 `core`，实现在 `harness`，由 `agent` 注入**（`WHITEPAPER.md:154-157` 的四条后果）。

```ts
export interface PredictionContext {
  readonly taskId: Id;
  readonly sessionId: Id;
  readonly workspace: string;
  readonly stepId?: Id;
  readonly capabilities: ProviderCapabilities;
  readonly model: string;
  readonly step: Step;
  readonly plan: Plan;
  readonly now: number;
}

export interface CognitionPort {
  /**
   * 在动作之前作出承诺。
   * 返回 undefined 表示本机制已关闭或该可观察量不值得预测——
   * 调用方必须容忍 undefined，并在没有预测时按原逻辑继续。
   */
  predict(
    subject: Observable,
    signature: SituationSignature,
    ctx: PredictionContext,
  ): Promise<Prediction | undefined>;

  /**
   * 把观察结算成残差，并更新统计表。
   * 没有对应预测时返回 undefined（不报错）——这是常态，
   * 例如任务在预测之后被用户取消。
   */
  observe(
    subject: Observable,
    observed: ObservedValue,
    ctx: PredictionContext,
  ): Promise<Residual | undefined>;

  /** 某一签名（或其回退链）的胜任度。 */
  competence(filter: CompetenceQuery): Promise<CompetenceReport>;

  /** 候选可观察量中不确定度最高、成本最低的若干个，供 §6.3 的探测路径使用。 */
  mostUncertain(
    candidates: readonly Observable[],
    ctx: PredictionContext,
    limit: number,
  ): Promise<readonly Uncertainty[]>;
}

export interface CompetenceQuery {
  readonly signatureKey?: string;
  readonly workspace?: string;
  readonly taskId?: Id;
  readonly since?: Timestamp;
  readonly limit?: number;
}
```

**`predict` 返回 `undefined` 而非抛错的理由**：认知机制必须是**可关闭、可失败的旁路**。任何情况下它不得让主循环失败。这与 `SelfReview.shouldReview`（fast 计划直接豁免并发 `selfreview.skipped` 事件）是同一设计哲学。

### 5.3 策略（落位：`packages/harness/src/cognition/CognitivePolicy.ts`）

把 §3.5 的五条决策路径编码成**纯函数**，以便单元测试（不依赖模型、不依赖 IO，风格照 `PlanSelfReview` 与 `ErrorRecovery`）：

```ts
export interface CognitivePolicy {
  /** 动作之前：由预测推导出要不要改变计划。 */
  beforeStep(prediction: Prediction | undefined, ctx: PredictionContext): CognitiveAction;
  /** 动作之后：由残差推导出要不要复核。 */
  afterResidual(residual: Residual | undefined, ctx: PredictionContext): CognitiveAction;
}
```

**必须保持纯函数**，理由与 `PlanSelfReview`（注释自称 "a guard, not a judgement"）和 `ErrorRecovery`（"no model, no randomness, no hidden state"）相同：**决策逻辑要能被穷举测试**。随机性与模型调用只能出现在 `CognitionPort` 的实现里，不能出现在策略里。

### 5.4 不确定度的定义（供好奇心使用）

```
entropy = clamp01( uncertaintyFromVariance(signatureKey) × shannonEntropy(value) )
```

- `uncertaintyFromVariance`：`1 − n / (n + K)`（K 默认 10）与 `残差标准差` 的加权——**样本少 或 波动大 都算不确定**；
- `shannonEntropy(value)`：分类分布 `−Σ p log p` 归一化；数值与集合类型用方差的归一化版本。

**探测的选择规则**：取 `entropy / probeCost` 最高者。**成本必须进分母**，否则机制会为了降低不确定度而无限观察——这正是「好奇心」在工程上失控的标准方式。

---

## 6. 与现有循环的接缝

### 6.1 落位：新增包还是扩展现有包？

**不新增包。** 理由：

1. `WHITEPAPER.md` 的依赖铁律是 `ui → agent → harness → core`。新增一个 `packages/cognition` 会引入第五条边，需要重新论证层次顺序，且会被 `^build` 顺序约束，收益不抵成本；
2. 认知机制**必须**读 `Step` / `Plan` / `Verdict` / `FailureModeKind`，这些都在 `core`；**必须**在 `AgentLoop` 的决策点上被调用，那是 `harness`。**它天然属于 `harness`**；
3. 类型与端口放 `core`，是因为 `ui` 需要显示它们（见 §8.4），而 `ui` 只能依赖 `core` 与 `agent/view`。

因此：

| 内容 | 位置 |
| --- | --- |
| 类型（`Prediction` / `Residual` / …） | `packages/core/src/types/cognition.ts` |
| 端口（`CognitionPort`） | `packages/core/src/ports/cognition.ts` |
| 实现（估计器 / 评分 / 策略 / 服务） | `packages/harness/src/cognition/*` |
| 持久化（V6 表） | `packages/core/src/persistence/schema.ts` + `SqliteSessionStore` |
| 事件与命令 | `packages/core/src/types/events.ts`（`DomainEventMap` / `CommandMap`） |
| 投影 | `packages/agent/src/view/snapshot.ts`（新增 `cognition` 切片，**不是**塞进 `task`） |
| UI | 新面板，见 §8.4 |

**注册清单（容易漏，逐条打勾）**：

1. `packages/core/src/index.ts` 用的是**显式 re-export 列表**，不是通配。新增两个文件后必须各加一行：
   ```ts
   export * from './types/cognition.js';
   export * from './ports/cognition.js';
   ```
   漏掉这一行会让 `@camelia/harness` 的导入在 `pnpm build` 时解析失败——**而这正是分层机制的兜底方式**：包解析失败，而不是 lint 报警。
2. `DomainEventMap` / `CommandMap` 各加对应条目（唯一注册处）。
3. `packages/harness/src/index.ts` 导出实现类。
4. `packages/core/src/persistence/schema.ts`：`SCHEMA_VERSION` 5 → 6，追加 `V6` 迁移分支，并**导出可独立构造旧库的常量**（仿 `V1_SCHEMA` 的既有做法，让 V5→V6 升级可被测试）。

### 6.2 在 `AgentLoop` 里的具体挂点

`AgentLoopDeps` 增加一个**可选**依赖（可选是为了让既有测试与 mock 全部继续工作）：

```ts
export interface AgentLoopDeps {
  // …既有字段不动…
  cognition?: CognitionPort;
  cognitivePolicy?: CognitivePolicy;
}
```

挂点（按执行顺序）：

```
plan.ready 之后
  └─ for each step: predict({kind:'verdict'}, sig(step)) → beforeStep
        ├─ add-verification → 改写该步 acceptance（发 plan.revised）
        ├─ split-step        → Planner.revise（复用现有路径）
        └─ use-decision-model → 影响 routeStep 的模型选择
                               （这一步同时修好了 §1.3 的「换模型从未执行」缺口）

step.started 之前
  └─ predict({kind:'tool-call-count' | 'touched-paths'})

每个 tool call 之后
  └─ observe({kind:'tool-outcome', tool}) → afterResidual
        └─ reverify / probe（probe 仅只读且仍过闸门）

verify.result 之后            ← 最重要的挂点
  └─ observe({kind:'verdict', stepId})
        ├─ surprise && verdict==='pass' → 追加一次独立复核
        └─ 更新签名统计

task 结束（reflect）
  └─ observe({kind:'cost-usd' | 'failure-mode'})
  └─ 更新 SkillRecord（方向四）
  └─ 写入 CompetenceReport 快照
```

### 6.3 顺手要修的两个既有缺口

本文的机制会**依赖**这两个目前没接上的部分，实施时应一并修复：

1. **`ErrorRecovery` 的梯子。** 目前只有 `retry` 被执行。`use-decision-model` 决策要真正生效，必须让 `switch-provider` 与 `degrade-readonly` 接上（至少接 `switch-provider`，因为它就是「换更强的模型」）。
2. **`AgentLoop.rollback(checkpointId)` 忽略参数。** 不是本机制的依赖，但既然 §6.2 会让「复核失败」更频繁地触发回滚路径，**先修它再开机制**，否则会放大一个已知缺陷。

### 6.4 `reflect()` 的改造（方向四落位）

现在：

```ts
if (plan.steps.length >= 3 && unverifiedSteps === 0) {
  remember({ kind: 'procedural', content: `When asked to "${goal}", a working approach is: A → B → C`, … });
}
```

改为：

```ts
if (plan.steps.length >= 3 && unverifiedSteps === 0) {
  rememberProcedural({
    steps: plan.steps.map(s => s.title),        // 结构化，不再是拼串
    signatureKey: dominantSignatureKey(plan),   // 适用条件
    attempts: 1, successes: 1,
    meanResidual: taskResidualMean,             // 与预测同源的评分
  });
}
// 且：失败时不是清零，而是 attempts+1 后重算成功率
```

**门槛**（§4.5）：`attempts ≥ 3 && 成功率 ≥ 0.5` 才允许推荐给规划器。

---

## 7. 事件、命令与持久化

### 7.1 事件（加入 `DomainEventMap`）

沿用既有点号命名、snake_case 后缀的惯例：

```ts
// ---- Cognition (prediction–error loop) -----------------------------------
/** 动作之前作出的可证伪承诺。事件本身即审计记录。 */
'cognition.predicted': { prediction: Prediction };
/** 承诺的结算：残差与是否惊讶。 */
'cognition.scored': { residual: Residual };
/**
 * 惊讶导致的行为改变。
 * 与 cognition.scored 分开，因为「记下误差」与「因此改变行为」是两件事，
 * 混在一个事件里会让「机制开着但没影响任何决策」无法被观测。
 */
'cognition.surprised': {
  signatureKey: string;
  score: number;
  contrast: string;
  action: CognitiveAction;
};
/** 某签名层面的胜任度快照（任务结束时写，不逐次写，避免事件洪泛）。 */
'cognition.competence': { report: CompetenceReport };
/** 技能记录更新（方向四）。 */
'cognition.skill_updated': { skill: SkillRecord };
/** 机制被跳过时的如实记录——与 selfreview.skipped 同款纪律。 */
'cognition.skipped': { reason: string; detail?: string };
```

**`cognition.skipped` 是必要的**：当机制因 fast 计划、样本不足、被用户关闭等原因没有运行时，必须留下痕迹。否则「没有预测」和「机制坏了」在事件流里长得一模一样——这正是仓库反复强调的诚实性纪律（`ProviderView.connected` 的 `undefined ≠ false` 是同一条）。

### 7.2 命令（加入 `CommandMap`）

```ts
// ---- Cognition panel -----------------------------------------------------
/** 响应数据 Prediction[]。 */
'list_predictions': { taskId?: Id; sessionId?: Id; onlySurprised?: boolean; limit?: number };
/** 单条预测的完整解释（含回退层与统计依据）。响应数据 ExplainedPrediction。 */
'explain_prediction': { predictionId: Id };
/** 胜任度报表。响应数据 CompetenceReport[]。 */
'get_competence': { workspace?: string; signatureKey?: string; limit?: number };
/**
 * 认知模式。分级自主是部署的前提：在机制被证明校准良好之前，
 * 不允许它改变行为。
 */
'set_cognition_mode': { mode: CognitionMode };
```

```ts
export type CognitionMode =
  | 'off'      // 完全不运行
  | 'observe'  // 只记录预测与残差，绝不改变行为
  | 'advise'   // 可追加验收点 / 拆分步骤，但不换模型、不探测
  | 'drive';   // 全部分支（探测仍限只读且过闸门）
```

**默认值必须是 `'observe'`**，并把当前值持久化到 `localPrefs`（它是窗口偏好，与 `themeId` 同类，**不进 snapshot**——遵守「store 不产生业务状态」）。

### 7.3 schema V6（前向迁移，`user_version` 5 → 6）

```sql
-- V6: cognition — prediction–error loop (ARCH-COGNITION §7.3)

CREATE TABLE predictions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  step_id        TEXT,
  signature_key  TEXT NOT NULL,
  level          INTEGER NOT NULL,
  subject_kind   TEXT NOT NULL,
  subject_key    TEXT,
  value_json     TEXT NOT NULL,
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL,
  basis          TEXT NOT NULL DEFAULT '',
  at             INTEGER NOT NULL
);
CREATE INDEX idx_predictions_signature ON predictions(signature_key, at);
CREATE INDEX idx_predictions_task      ON predictions(task_id, at);

CREATE TABLE residuals (
  prediction_id  TEXT PRIMARY KEY REFERENCES predictions(id) ON DELETE CASCADE,
  task_id        TEXT NOT NULL,
  signature_key  TEXT NOT NULL,
  score          REAL NOT NULL,
  rule           TEXT NOT NULL,
  surprise       INTEGER NOT NULL DEFAULT 0,
  threshold      REAL,
  observed_json  TEXT NOT NULL,
  contrast       TEXT NOT NULL DEFAULT '',
  at             INTEGER NOT NULL
);
CREATE INDEX idx_residuals_signature ON residuals(signature_key, at);
CREATE INDEX idx_residuals_surprise  ON residuals(surprise, at);

-- 每个签名层面一行；回退链是若干行，而不是一张嵌套表。
CREATE TABLE situation_stats (
  signature_key  TEXT PRIMARY KEY,
  subject_kind   TEXT NOT NULL,
  n              INTEGER NOT NULL DEFAULT 0,
  sum_score      REAL NOT NULL DEFAULT 0,
  sum_score_sq   REAL NOT NULL DEFAULT 0,   -- 免扫描算标准差
  sum_confidence REAL NOT NULL DEFAULT 0,   -- 校准诊断用
  estimate_json  TEXT NOT NULL,             -- 该层的当前估计
  updated_at     INTEGER NOT NULL
);

CREATE TABLE skills (
  memory_id      TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  signature_key  TEXT NOT NULL,
  steps_json     TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  successes      INTEGER NOT NULL DEFAULT 0,
  sum_residual   REAL NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_skills_signature ON skills(signature_key);
```

**注意 `sum_score_sq` 与 `sum_confidence` 的存在**：它们让 `CompetenceReport` 能**单行算出**均值、标准差与校准误差，而不用扫 `residuals` 表。这是借鉴 `metrics` 表的 `count` 列思路。

**注意 `residuals` 引用 `predictions` 并 `ON DELETE CASCADE`**：删任务时预测记录一起走，不留孤儿。但**不提供删除单条残差的命令**——残差是历史，历史不可改（`events` 表同理）。

### 7.4 成本上限

- `predict` / `observe` 的**热路径估计器不调用任何模型**，只在内存表 + SQLite 上做算术，成本约等于零；
- `source: 'model'` 是**默认关闭**的：只有当签名层面**完全没有任何样本**且用户开启了 `drive` 模式且显式允许模型预测时，才允许一次调用，且必须走 `gateway.usage` 记账；
- 新增配置（并入 `HarnessConfig`，默认全关或最保守）：`cognitionMode: 'observe'`、`cognitionMinSamples: 8`、`cognitionSurprisePercentile: 80`、`cognitionLevelSamples: 3`、`cognitionMaxProbesPerTask: 2`。

---

## 8. 可观测性：方向七的落位

### 8.1 三条统计断言（这是「认知动力学」的可实施形式）

**不做**动力学研究，**做**三条能自动检测的断言。每条都能在任务结束时用 SQL 直接算出来：

| 断言 | 计算 | 含义 | 检测到之后 |
| --- | --- | --- | --- |
| **在学习** | 同一 `signatureKey` 下，后 20 条的 `meanResidual` 显著低于前 20 条 | 机制确实在变准 | 无需动作；这是「机制有效」的正面证据 |
| **世界漂移** | 一个**曾经** `meanResidual` 低（< 0.2，n ≥ 20）的签名，最近 20 条升到 > 0.5 | **环境变了**，不是模型笨 | 发 `cognition.competence` 并提示用户；**不要**清空历史（漂移本身是信息） |
| **虚假胜任** | `calibrationGap > 0.3` 且 n ≥ 20 | `confidence` 高但残差也高——预测没有依据 | 下调该层 `confidence` 权重；这是机制自身的 bug 信号 |

第二条是**现有 `DriftDetector` 做不到的**（它只在单任务内比声明路径与实际路径）。它把一个模糊的判断（「最近怎么老出错」）变成一条可查的断言。

### 8.2 独立于业务指标的诊断指标（走既有 `metrics` 表）

```
cognition.predictions_made
cognition.residual_mean
cognition.surprise_rate
cognition.calibration_gap
cognition.backoff_level_used    // 分布：多少预测落在 L3 / L2 / … / prior
cognition.probes_per_task
```

`cognition.backoff_level_used` 尤其重要：**如果绝大多数预测长期落在先验层（L-1），说明样本永远攒不起来**——机制表面在跑，实际上什么也没学到。没有这个指标，这种情况不可见。

### 8.3 反事实回测（免费的可证伪性）

因为 `events` 表有全序日志，可以写一个**离线**工具：

```
读历史 events → 重放 → 在「只预测、不改变行为」模式下生成预测与残差
             → 输出：如果当年开着机制，它的平均误差是多少
```

**这是本文最有力的验收手段**：不需要新数据、不需要跑模型，用仓库已有的历史事件就能回答「这套机制在这个项目上到底准不准」。**建议作为实施的第一步（见 §11 Phase 0）。**

### 8.4 UI 落位（右栏新面板）

在 `panels.ts` 的 `PANEL_IDS` 增加 `'cognition'`（`needsTask: true`，`mathOnly: false`）。

**当前已占用的 id 与图标**（实施前请以此为准重新确认，本列表可能已变动）：

| id | icon | needsTask |
| --- | --- | --- |
| `run` | `layers` | true |
| `artifacts` | `file` | false |
| `memory` | `star` | false |
| `context` | `gauge` | true |
| `events` | `terminal` | false |
| `sub` | `bot` | true |

**选图标要避开已占用的六个**，也避开 `memory` 的 `star`——它与「收藏会话」的语义已经撞车，再叠一个星形会彻底失去区分度。

面板内容三块：

1. **本任务的预测清单**：每个 step 一行，显示 `期望 → 实际`，`surprise` 的行用色区分；展开可看 `basis`（依据）与 `level`（哪一层给出的预测）。
2. **校准图**：x 轴 `confidence`，y 轴 `1 − meanResidual`；完美校准时是一条对角线。**过度自信直观可见。**
3. **胜任度表**：按签名分组，n / meanResidual / calibrationGap，并标出「学习中 / 漂移 / 虚假胜任」三种状态。

**UI 纪律（必须遵守）**：
- 预测**绝不能**渲染成与 `Verdict` 相同的样式。预测是斜体或带问号标记的**估计**，verdict 是**结论**；
- 遵循 `CAMELIA-ROADMAP.md:346`：**禁止 UI 侧私造预测填充空态**——没有预测就显示「本任务暂无预测」，绝不编造；
- 引擎无数据时不得播放演示动画（与 math 演示同样的诚实性要求：那需要一个显式 `演示` 角标且永不自动播放）。

---

## 9. 分层、纪律与不变量

### 9.1 依赖方向

```
ui ──> agent ──> harness ──> core
        (view)     (cognition/*)   (types/cognition.ts, ports/cognition.ts)
```

- `core`：只有类型与端口，**无业务判断**（不知道何为「惊讶」的阈值策略，只定义 `Residual` 的形状）。
- `harness`：全部实现与判断。
- `agent`：把认知事件折叠进快照的 `cognition` 切片。
- `ui`：只读，只渲染。

**实施时必须自查**：`packages/core/src` 不得出现任何 `@camelia/` 导入（现状为 0，保持住）。层次违规目前**只由包解析与 `^build` 顺序兜底，没有 lint 规则**——所以这是纪律，不是自动化的保证。

### 9.2 多智能体（方向三）的边界

- 仅 `term` 模式的 `TeamOrchestrator` 路径启用；
- 每个 worker 有**自己的签名**（异构的真正来源），残差挂在父 `taskId` 上；
- 权重按历史 `meanResidual` 定，**不是投票**；
- 子 agent **不拥有独立记忆库**；
- 子 agent 的预测**不触发**写入类动作（`probe` 的子集进一步收窄为无副作用工具）。

### 9.3 不变量清单（评审时逐条检查）

1. **预测不是事实**：类型、事件、表、UI 四层可分。
2. **机制可关闭、可失败**：`CognitionPort` 的每个方法返回 `undefined` 是合法路径，主循环必须容忍。
3. **热路径不调模型**：默认零 token 成本；任何模型调用必须显式、记账、可关。
4. **探测只读且过闸门**：不得绕过 `ApprovalGate`，不得触碰白名单之外的路径。
5. **护栏零改动**：privileged 审批、schema 校验、工作区白名单、密钥边界保持原样（`ITERATION_LOG` 的既有条款）。
6. **历史不可变**：残差与事件只追加；「调整阈值」不得重写历史残差。
7. **先验不作惊讶**：`source === 'prior'` 时 `surprise` 恒 false。
8. **样本不足保持沉默**：`n < cognitionMinSamples` 时不触发行为。
9. **不新增包**：类型在 `core`，实现在 `harness`。
10. **诚实跳过**：未运行时发 `cognition.skipped`，与「没有预测」区分。
11. **UI 不私造数据**：无数据显示空态，空态不得由 fixture 填充。

---

## 10. 明确不做（防止实施者过度扩张）

- **不训练任何模型**，不引入 embedding / 向量库 / 微调。
- **不预测方案正确性**——那是 verifier 的职责。只预测自身操作环境。
- **不做自然语言式「信念」**：不存自由文本命题，不为知识建依赖图。**存的是带签名的统计预测**，这正是方向一批判的那种命题式知识库的反面。
- **不做哲学意义上的「理解」宣称**。本机制给出的是**校准过的操作预期**，不是意识、不是语义理解。任何文档或 UI 文案都不得暗示它「理解」了任务。
- **不引入自主写操作**。好奇心的作用域严格限于只读观察。
- **不改既有事件语义**。`verify.result` / `tool.finished` 的既有字段一律不动；新机制只**读**它们。
- **不做跨用户的统计聚合**（`WHITEPAPER` 附录 A：API Key 只在 `~/.camelia/`，**零遥测**）。统计严格限定在本机本工作区。

---

## 11. 分阶段实施与验收

### Phase 0 · 离线回测（先做这个）

**用历史事件流验证机制值不值得做**，零风险、零行为改变。

- 输入：`events` 表的历史记录；
- 处理：从中重建 (签名, 预测, 观察) 三元组，只用 §4.3 的回退表做预测，**不接任何行为**；
- 输出：各签名层面的平均 Brier 分数、预测覆盖率（多少步能预测）、回退层分布；
- **验收判据**：若 L2 及以上的平均残差显著低于 L-1 先验（例如低 0.1 以上），则机制有信息量，继续；否则**停下来重新设计签名**，不要进入 Phase 1。

**这一步是本文最重要的工程建议**：它把「世界模型这件事靠不靠谱」变成一个**在动一行生产代码之前就能回答**的问题。

### Phase 1 · 类型 / 端口 / schema V6

- 加 `types/cognition.ts`、`ports/cognition.ts`、schema V6 迁移、`SqliteSessionStore` 的读写方法（含 V5→V6 升级测试，照 `V1_SCHEMA` 导出的既有做法构造旧库）；
- 事件与命令登记进 `DomainEventMap` / `CommandMap`；
- **不加任何行为**；`CognitionMode` 默认 `'observe'`。
- 验收：`pnpm turbo test` 全绿；迁移可重入；新事件能被 `reduceEvents` 折叠而不崩。

### Phase 2 · 估计器 + 评分（纯函数）

- `BackoffTable` / `score.ts`（三种评分规则）/ `signature.ts`（签名构造，**确定性关键词规则，不调模型**）；
- 单元测试覆盖：Brier 的过度自信惩罚、`nrmse` 的 `max(1,|observed|)` 边界、Jaccard 的双空集定义为 0、回退层的选择与 `minLevelSamples`。
- 验收：纯函数测试全绿；无 IO、无模型、无随机。

### Phase 3 · 接入循环（`observe` 优先于 `predict` 的行为）

- 先只接**观察与结算**（`predict` + `observe`，策略恒返回 `proceed`）；
- 挂点见 §6.2；
- 验收：跑真实任务后 `predictions` / `residuals` 有数据；`cognition.skipped` 在 fast 计划上出现；**行为与打补丁前逐字节相同**（用既有 fixture 快照对比）。

### Phase 4 · 策略生效（`advise` 模式）

- 接上 `add-verification` / `split-step` / `use-decision-model`；
- **先修 §6.3 的两个既有缺口**（`ErrorRecovery` 梯子、`rollback` 参数）；
- 验收：能构造出让策略返回非 `proceed` 的测试用例；关闭机制后行为回到 Phase 3 基线。

### Phase 5 · UI 面板 + 胜任度

- `panels.ts` 增 `'cognition'`；校准图与胜任度表；`cognition.skipped` 可见；
- 验收：无数据时显示空态而非编造；预测与 verdict 视觉可分。

### Phase 6 · 技能与 `drive` 模式（可选，须先有 Phase 0 的数据支撑）

- `SkillRecord` 落库；`reflect()` 改造（§6.4）；`probe` 路径启用（只读 + 过闸门）；
- 验收：技能门槛（`attempts ≥ 3 && 成功率 ≥ 0.5`）生效；越权探测不可能被构造出来。

### 终止条件（什么情况下应该关掉这个机制）

工程诚实的做法是**事先写好放弃判据**：

- Phase 0 的回测显示残差与先验无显著差异（→ 签名设计无效）；
- `cognition.backoff_level_used` 长期压在先验层（→ 样本攒不起来，泛化失败）；
- `calibration_gap` 持续 > 0.3 且无法通过阈值调整收敛（→ 估计器有系统性偏差）；
- 机制开启后任务成功率**下降**（→ 决策路径在帮倒忙）。

**任何一条成立，就地把 `CognitionMode` 设为 `'off'` 并在本文件记录原因。** 保留一个不work的机制比删掉它更糟——它会伪装成「系统在思考」。

---

## 12. 附录：为什么这不是命题式知识库（对方向一批判的正面回应）

方向一的批评是准确的：**存事实、依赖、冲突、置信度，是命题式知识库，而人脑存的是可预测的世界模型。** 本文的设计直接回应了这一点，逐条对应：

| 方向一的批评 | 本文的做法 |
| --- | --- |
| 知识不是「内角和 180 度」，而是「做 X 会观察到 Y」 | 存的是 `Prediction{ subject: Observable, value }`——**每一行都是「做 X 会观察到 Y」**；不存在任何无动作的事实条目 |
| 冲突不是命题矛盾，而是预测失败 | 没有矛盾检测器。**当一个签名的残差持续高于阈值，那里就是「冲突」**（§8.1 世界漂移） |
| 质疑不是检测到两条命题冲突，而是模型预测与观察不一致 | §3.1 的第 ③→④ 步就是这个「不一致」；**`surprise` 就是质疑的触发条件**，没有独立的「质疑模块」 |
| 存的是「知道什么」vs「知道会发生什么」 | 全部表结构围绕「会发生什么」：`predictions` + `residuals` + `situation_stats`。**没有任何表用来存「知道什么」** |

**同时避开方向一自己的代价栏**（需要环境、需要模拟、需要大量交互数据）：环境是工作区，交互数据是既有的 `events` 表，模拟由重放免费提供（§8.3），而分层回退让 n=1 就能工作（§4.3）。

---

## 13. 事实核验记录（本文写到代码里的每一句话都核对过）

设计文档最大的风险是**把不存在的代码当成存在的**。以下是本文做出的事实性断言及核验结果；下游实施者在动手前应能复现这些结论。

| 本文的断言 | 核验方式 | 结果 |
| --- | --- | --- |
| 全仓库无预测/惊讶/假设/信念/世界模型机制 | grep `predict\|surpris\|hypothes\|belief\|contradict\|worldModel\|curiosit\|counterfactual` | ✅ 唯一命中是 `Verifier.ts:284` 一句正则注释与一个测试名 |
| `SCHEMA_VERSION = 5` | 读 `packages/core/src/persistence/schema.ts:10` | ✅ 确为 5（注意 `CODE-SUMMARY.md` 写 4，已过期） |
| `failure_modes` 表存在于 V4，含五类机制闭集 | 读 `schema.ts` V4 分支与 `FailureModeKind` | ✅ |
| `AgentLoopDeps` 字段名与本文 §6.2 一致 | 读 `AgentLoop.ts:60-78` | ✅ `gateway/planner/executor/verifier/recovery/context/journal/loop/drift/subAgents?/config/selfReview/memory/planGate?` |
| `reflect()` 只在 `steps.length >= 3 && unverifiedSteps === 0` 时写 procedural | 读 `AgentLoop.ts:806-817` | ✅ 且 content 是 `steps.map(title).join(' → ')` 的拼串，`retrievable: false` |
| `applyMemoryOutcomeFeedback` **只**处理 `kind === 'procedural'` | 读 `AgentLoop.ts:934` | ✅ `if (!item \|\| item.kind !== 'procedural') continue;` —— 所以 `markCorrect/markIncorrect` 实际上是 procedural-only |
| 已有 `list_skills` / `install_skill`（SKILL.md 发现与安装） | 读 `events.ts:328-334` | ⚠️ **是**。本文原稿未知此事，已补 §4.6 命名冲突警告 |
| `PANEL_IDS` 当前为 `run/artifacts/memory/context/events/sub` | 读 `panels.ts:9-27` | ⚠️ 与早期侦察不同：`artifacts` 已加入、`model` 已移除。§8.4 已按现状更新 |
| `routing.chosen.estimatedUsd` 是**估算**而非实测 | 读 `events.ts:110` 与字段名 | ⚠️ 是估算。**原稿误用作 `cost-usd` 的观察来源，已改**（估算值只能当预测，不能当观察） |
| 无 `cognition.*` 事件名冲突 | 枚举 `DomainEventMap` 全部键 | ✅ 无该前缀 |
| `core/index.ts` 是显式 re-export | 读 `packages/core/src/index.ts` | ✅ 新增文件必须手工登记，已补 §6.1 注册清单 |
| `ErrorRecovery` 只有 `retry` 被执行 | `CODE-SUMMARY.md` §4 + 子代理读 `AgentLoop` fixup 循环 | ✅ `if (strategy.kind !== 'retry') break;` |
| `AgentLoop.rollback` 忽略传入 id | `CODE-SUMMARY.md` §10.5（项目自陈） | ✅ 未独立复现，但项目方文档明确记载 |
| `memories.embedding BLOB` 声明但从未读写 | schema V1 表定义 + 召回为纯 `LIKE` | ✅ |

**未能核验的一项**：用户上传的 `ARCH-unified-cognition.md` 原文。该文件位于应用内部目录（文件工具不可达，且沙箱 VM 当时不可用），因此本文 §2 的裁决是基于**用户消息中给出的七点批评摘要**做出的，而非原文。若原文包含这七点之外的设计，§2 的裁决需要复核。

**实施者注意事项**：本文引用的行号会随代码演进漂移，**请以符号名（`AgentLoopDeps`、`PANEL_IDS`、`FailureModeKind`）为准检索**，不要直接跳转行号。

---

## 14. 参考

- `docs/WHITEPAPER.md` — 架构宪法。§2.1 分层、§2.3 事件、§5.1「用架构补模型」、§5.5 绝不可委托给模型的事项、§6.1 UI 不产生业务状态、附录 A 硬约束
- `docs/CODE-SUMMARY.md` — 实现现状（注意：其中 `SCHEMA_VERSION = 4` 已过期，代码为 5）
- `docs/ITERATION_LOG.md` — Iteration 20–22：记忆生命周期、自省四问、护栏零改动条款
- `docs/CAMELIA-ROADMAP.md` — §5.3 记忆面板、§6.1 多智能体、§6.6 工作区智能（项目画像写入 procedural memory，与本机制自然衔接）
- `packages/core/src/types/events.ts` — `DomainEventMap` / `CommandMap`，新增事件与命令的唯一注册处
- `packages/core/src/persistence/schema.ts` — 前向迁移与 `PRAGMA user_version`
- `packages/harness/src/loop/AgentLoop.ts` — 决策点与 `AgentLoopDeps`
- `packages/harness/src/selfreview/PlanSelfReview.ts` — 「确定性守卫」的风格范本
- `packages/harness/src/recovery/ErrorRecovery.ts` — 「无模型、无随机、无隐藏状态」的风格范本
- `packages/harness/src/routing/cheap-first.ts` — `difficultyScore`，冷启动先验的来源之一
- `packages/harness/src/reliability/DriftDetector.ts` — 已在用 Jaccard 距离，`touched-paths` 评分复用之
- `packages/harness/src/memory/MemoryService.ts` + `value.ts` — 价值公式与间隔重复，统计表的衰减策略参照之
