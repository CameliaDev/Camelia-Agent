# Camelia

> **Warm intelligence, sharp code.**
> 一个以「任务完成」为第一目标的桌面 AI 编码 Agent。

Camelia 不是「会聊天的代码工具」，而是「能把任务做到尽善尽美」的 Agent：用户给一个目标，Camelia 规划、执行、自检、纠错、交付，并在每一步都可观测、可干预、可回滚、可回放。

## 运行环境

- **Node.js 22**（`>=22.11`，仓库以 `.nvmrc` / `.node-version` / `package.json#engines` / CI / Dockerfile 统一锁定）
- **pnpm 9.14.4**（`packageManager` 字段，可用 `corepack enable` 自动接管）

`better-sqlite3` 是原生模块，**必须与运行时的 Node 大版本一致**。切换 Node 大版本后请先执行 `pnpm rebuild better-sqlite3`，否则会报 `NODE_MODULE_VERSION` 不匹配。

```bash
nvm use            # 读取 .nvmrc → Node 22
pnpm install
pnpm rebuild better-sqlite3
```

## 三条命令跑起来

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js doctor --offline
```

`doctor --offline` 会用脚本化 Provider 在隔离工作区里跑通整条引擎，无需任何 API Key。

想跑一个真实任务（离线确定性通道）：

```bash
node packages/cli/dist/bin.js run --mock "写一个 hello.txt" --yes --json --workspace .
```

接入真实免费模型（OpenCode Zen → OpenRouter → Ollama 自动回退）后：

```bash
node packages/cli/dist/bin.js run "给这个仓库补一份 CONTRIBUTING.md"
```

## 核心能力

- **长任务不丢目标**：显式任务状态机 + 目标漂移检测。
- **复杂任务能拆解**：规划器把意图归一化为有序、可独立验证的步骤。
- **执行中能自我纠错**：验证器核查每一步；失败触发重试 / 重规划 / 回滚。
- **上下文爆了不丢关键信息**：受保护槽位 + 压缩 + 去重。
- **子任务隔离**：子 Agent 用独立上下文，只把 digest 合并回主上下文。
- **工具调用可审批、可回放、可审计**：一切跨层交互落事件日志，`camelia replay` 完整重建。

## 架构

分层单向依赖，禁止反向：

```
ui  →  agent  →  harness  →  core
```

| 包                   | 层             | 职责                                                                 |
| -------------------- | -------------- | -------------------------------------------------------------------- |
| `@camelia/core`    | 契约与基础设施 | 领域类型、事件总线、任务状态机、端口、SQLite 持久化、可观测性        |
| `@camelia/harness` | 任务引擎       | Agent 主循环、规划、执行、验证、上下文、子 Agent、工具引擎、可靠性件 |
| `@camelia/agent`   | 适配与组合根   | Provider 三路径回退、模型路由、Node 适配器、配置与密钥               |
| `@camelia/cli`     | 驱动           | `run` / `replay` / `doctor`                                    |
| `apps/desktop`     | UI（Phase 3）  | Tauri 2.x 暖色暗黑界面，任务状态的可视化投影                         |

设计文档见 [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md)，迭代记录见 [`docs/ITERATION_LOG.md`](docs/ITERATION_LOG.md)，验收数据见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

## 技术栈

Tauri 2.x · React 19 · Vite · Tailwind v4 · TypeScript strict · Zustand · Monaco · xterm.js · better-sqlite3 · Turborepo + pnpm workspace。

## 开发

```bash
pnpm typecheck   # 类型检查（含 test）
pnpm lint        # ESLint
pnpm build       # 构建全部包
pnpm test        # 单测 + 集成测试 + 端到端
pnpm acceptance  # 生成 docs/ACCEPTANCE.md（数据来自真实测试产物）
```

## 隐私

API Key 只存于 `~/.camelia/`，**零遥测**，不在其他位置写入任何数据。

## 许可

Apache-2.0
