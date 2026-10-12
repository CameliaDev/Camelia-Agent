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

### 桌面壳用的 Node（重要）

桌面 exe **不会**自动跟随你当前 shell 的 `nvm use` / `fnm use`。它按下面顺序找 Node 来 `spawn camelia serve`：

1. 环境变量 **`CAMELIA_NODE`**（指向 `node.exe`）
2. **`~/.camelia/desktop.json`** 的 `"node"` 字段（与 `"cli"` 一起）
3. 本机 **fnm / nvm-windows 的 Node 22**（对齐 `.nvmrc`）
4. `C:\Program Files\nodejs\node.exe`（常见系统安装；若是 **Node 24** 而 `better-sqlite3` 按 22 编译 → ABI 崩溃）
5. `PATH` 里的 `node.exe`

**推荐**：在仓库根用 Node 22 执行：

```bash
node scripts/write-desktop-json.mjs
```

会写入 UTF-8 **无 BOM** 的 `~/.camelia/desktop.json`（含 `cli` + `node`）。不要用 Windows PowerShell 5.x 的 `Set-Content -Encoding utf8` 手写该文件——它会加 BOM，桌面壳会当成「找不到 CLI」。

也可设置环境变量（优先级更高）：`CAMELIA_CLI`、`CAMELIA_NODE`、`CAMELIA_ENGINE_URL`（跳过自启、直连已有 serve）。

若顶栏显示 **Offline** 且提交任务被拒（「未连接引擎 / offline fixture…」），**不要先怪 UI**：多数是引擎 spawn 失败（ABI / Node 路径 / CLI 路径）。打开设置 → 引擎与日志，或看 `~/.camelia/logs/engine.log`；壳会把 `engineSpawnError` 注入 boot 并在横幅展示。

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

## 当前状态 · Iteration 26（目标模式四阶段收口）

四阶段串行门禁全部通过，最终验收全绿：typecheck 10/10 · lint 6/6 · build 5/5 · `pnpm test` **1105** 全绿 · `pnpm acceptance` M1–M15 全 pass（M13 agent 行覆盖率 **94.14%**）· `node scripts/usable-check.mjs` 6/6。

本轮新增能力：

- **记忆面板 recall 时间线**：面板内直接回放持久化 `memory.recalled` 历史（时间 / 层 / via / noise / 降级标注），数据只来自真实引擎事件日志（SseTransport → EngineServer → SqliteSessionStore），不含 UI 本地拼凑。
- **运行记录可离线重放**：`record.json` 现含用户原始意图（`intentRaw`）与规划输入（`planInput`），现场失败可离线复现；旧记录缺字段读为 `undefined`。
- **长会话记忆评估**：`packages/harness/scripts/evaluate-memory-longsession.ts`（确定性模拟，输出明确标注）给出 promote 阈值敏感度与 recall_noise 随会话推进的趋势。
- **弱模型编排收敛守卫**：fixup 以零工具调用失败验证时立即停止重试轮次，不再空转至 `maxRetries`。

如实记录的边界（负面结果，详见 ITERATION_LOG）：本机无 `llama3.2:3b`（廉价优先每步回落决策模型）；真实长会话命中数据未取得（评估走明确标注的模拟）；弱模型两文件任务拆解失败仍可能发生（模型能力边界，非 harness 机制可修成通过）。

详细记录见 [`docs/ITERATION_LOG.md`](docs/ITERATION_LOG.md)（Iteration 26），验收数据见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)。

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
| `@camelia/core`    | 契约与基础设施 | 领域类型、事件总线、任务状态机、端口、SQLite 持久化、可观测性         |
| `@camelia/harness` | 任务引擎       | Agent 主循环、规划、执行、验证、上下文、子 Agent、工具引擎、记忆、可靠性件 |
| `@camelia/agent`   | 适配与组合根   | Provider 三路径回退、模型路由、Node 适配器、插件加载、MCP、配置与密钥 |
| `@camelia/ui`      | UI 投影        | React 19 界面，把后端任务状态投影为可视界面（`@camelia/agent/view` 纯折叠） |
| `@camelia/cli`     | 驱动           | `run` / `replay` / `doctor` / `serve`                          |
| `apps/desktop`     | 桌面外壳       | Tauri 2.x 原生窗口，装载 `@camelia/ui` 构建产物并注入启动参数         |

设计文档见 [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md)，产品/工程方向见 [`docs/CAMELIA-ROADMAP.md`](docs/CAMELIA-ROADMAP.md)，迭代记录见 [`docs/ITERATION_LOG.md`](docs/ITERATION_LOG.md)，验收数据见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)，代码实现速查见 [`docs/CODE-SUMMARY.md`](docs/CODE-SUMMARY.md)。

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
