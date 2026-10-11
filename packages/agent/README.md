# @camelia/agent

Camelia 的**适配层与组合根**。它把 `harness` 的抽象契约接到真实世界：真实 Provider、真实 Node 文件系统/进程、真实 SQLite。

## 职责

- **组合根（CameliaRuntime）**：唯一决定「用哪个 Provider、哪个 fs/shell 适配器、哪个数据库」的地方；harness 通过 `RunContext` 接收，保持可测。
- **Provider 三路径回退**：`OpenCode Zen → OpenRouter → Ollama` 的 `FallbackLLMPort`，主路径失败自动切换，与任务状态机结合而非简单重试。
- **模型路由（ModelRouter）**：按任务阶段选择决策模型 / 粗活模型——强模型做规划与决策，弱模型做摘要与机械改写。
- **Node 适配器**：`FsPort` / `ShellPort` / `SearchPort` / `ClockPort` / `LoggerPort` 的 Node 实现。
- **配置与密钥**：`~/.camelia/config.json` 与 `~/.camelia/keys.json`；密钥只落本机，零遥测。
- **Mock / Scripted Provider**：无需 API Key 即可端到端跑通整条引擎，用于离线验收与 doctor 自检。
- **任务状态投影（view）**：`@camelia/agent/view` 把领域事件流**纯折叠**为 `ProjectionSnapshot`（任务阶段、步骤、工具调用、上下文、子 Agent、失败与通知）。它无 `node:` 依赖、仅类型导入 `core`，因此 `ui` 可跨层安全消费——这是「UI 是任务状态的投影而非壳」的落点。

## 边界

`agent` 依赖 `core` 与 `harness`，**不被** `harness` 依赖。所有对操作系统的副作用都收敛在本层，便于审计与替换。

## 依赖方向

```
core  ←  harness  ←  agent  ←  ui
```

## 用法

```ts
import { CameliaRuntime } from '@camelia/agent';

const runtime = await CameliaRuntime.create({ workspace: process.cwd() });
const result = await runtime.run('给 README 补一段 Quick Start');
await runtime.close();
```

## 测试

```bash
pnpm --filter @camelia/agent test
pnpm --filter @camelia/agent test:coverage
```