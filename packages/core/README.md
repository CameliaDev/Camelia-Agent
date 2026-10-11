# @camelia/core

Camelia 的**契约与基础设施层**。它定义一切接口与数据模型，并提供无业务逻辑的通用能力。

## 职责

- **类型契约**：Task / Step / ToolCall / Message / Session / Memory / Verdict 等领域模型
- **事件总线**：类型安全的 Command/Event 双通道
- **任务状态机**：显式 7+ 阶段状态与合法迁移
- **端口（Port）**：`LLMPort` / `FsPort` / `ShellPort` / `SearchPort` / `ClockPort` / `LoggerPort`
- **持久化**：`SessionStore` 接口 + better-sqlite3 实现
- **可观测性**：`Tracer` / `Metrics` / `Logger`

## 边界

`core` **不知道** `harness` 的存在。它只暴露接口，由上层注入实现。
`core` 内**禁止**任何业务判断（例如「该不该重试」属于 harness）。

## 依赖方向

```
core  ←  harness  ←  agent  ←  ui
```

`core` 不依赖任何内部包。

## 用法

```ts
import { EventBus, TaskStateMachine, SqliteSessionStore, ConsoleLogger } from '@camelia/core';
```