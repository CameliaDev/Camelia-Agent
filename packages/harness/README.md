# @camelia/harness

Camelia 的**任务引擎层**。它把「一句话目标」变成「可验证的完成」，是任务完成率的主战场。

## 职责

- **Agent 主循环（AgentLoop）**：驱动任务状态机走完 `planning → executing → verifying → delivering`，处理 replan、回滚、暂停、取消、干预、resume。
- **规划器 / 澄清器（Planner / Clarifier）**：把意图归一化为有序、可独立验证的步骤；把模糊意图收敛为可执行目标。
- **执行器（Executor）**：单步有界 ReAct 循环——构造提示、调用模型、审批工具、检测死循环、执行工具、收敛。
- **验证器（Verifier）**：执行器「声称」，验证器「核查」；无证据的完成声明降级为 `unknown`，绝不静默升级为 `pass`。
- **上下文管理器（ContextManager）**：token 预算、压缩、去重、优先级、受保护槽位。
- **子 Agent 调度器（SubAgentOrchestrator）**：隔离上下文的并行子任务，只把 digest 合并回父上下文。
- **工具引擎（ToolEngine）**：schema 校验在调用前，审批闸门，工作区 journal 回滚。
- **可靠性件**：目标漂移检测（DriftDetector）、死循环检测、错误恢复（ErrorRecovery）、幻觉抑制（HallucinationGuard）。

## 边界

`harness` **只依赖** `core`。它不选择任何具体实现（Provider / fs / shell / 数据库），而是通过 `RunContext` 接收端口（ports），因此可以在无网络、无真实文件系统的环境下用假件完整测试。

## 依赖方向

```
core  ←  harness  ←  agent  ←  ui
```

## 测试

```bash
pnpm --filter @camelia/harness test
pnpm --filter @camelia/harness test:coverage
```

集成测试通过 `test/helpers/engine.ts` 按生产组合根的方式装配整条引擎，断言「任务经历了什么」，而不是「函数被调了几次」。