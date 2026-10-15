# Camelia

> **Warm intelligence, sharp code.**
> 一个以「任务完成」为第一目标的桌面 AI 编码 Agent。

Camelia 不是「会聊天的代码工具」，而是「能把任务做到尽善尽美」的 Agent：用户给一个目标，Camelia 规划、执行、自检、纠错、交付，并在每一步都可观测、可干预、可回滚、可回放。

## 当前界面

桌面是 **Tauri 2** 壳 + Work 聊天。输入框旁有与 Max 同款的力度芯片（Max / High / Low），以及 **聊天 / 计划 / 目标** 模式芯片；**团队**可选用自定义团队配置（多角色编排 MVP）。Math 等工作区由扩展提供（例如扩展目录里的 Math modeling），装上后才出现侧栏入口，不是写死在顶栏。

会话从 `~/.camelia/camelia.db` 持久化：侧栏可切换并恢复消息；删除会真正清库。任务结束可打分；引擎侧有 **done gate**（宣称完成前会跑探测到的测试/类型检查，失败则继续修）。冗长 system / 推理块在 UI 里可折叠。

壳层细节见 [`docs/SHELL-UX.md`](docs/SHELL-UX.md)；桌面打包覆盖路径见 [`apps/desktop/README.md`](apps/desktop/README.md)。

### 相关仓库

- 扩展与技能目录：[camelia-extensions](https://github.com/CameliaDev/camelia-extensions)（默认 `catalog.json`）
- 应用内反馈目标仓：[camelia-feedback](https://github.com/CameliaDev/camelia-feedback)

## 运行环境

- **Node.js 22**（`>=22.11`，仓库以 `.nvmrc` / `.node-version` / `package.json#engines` / CI / Dockerfile 统一锁定）
- **pnpm 9.14.4**（`packageManager` 字段，可用 `corepack enable` 自动接管）

`better-sqlite3` 是原生模块，按 **ABI（`NODE_MODULE_VERSION`）** 加载：谁加载它，就必须与谁编译时用的 Node 大版本一致。仓库里有两处会加载**同一份** `packages/core` 的绑定，所以两侧必须同时是 **Node 22（ABI `process.versions.modules === 127`）**：

1. 桌面 exe 的引擎 sidecar（固定 Node 22）；
2. 开发 / 测试 shell（`pnpm test`、`node packages/cli/dist/bin.js`）。

**先校验再干活**：

```bash
node -p "process.versions.modules"   # 必须输出 127（Node 22）；输出 137 = Node 24，测试与引擎必报 ERR_DLOPEN
```

**本机没有 nvm-windows，版本管理是 fnm**（且 fnm 不在 PATH）。PowerShell 临时切到 Node 22：

```powershell
$env:PATH = "$env:LOCALAPPDATA\fnm\node-versions\22.18.0\node-v22.18.0-win-x64;$env:PATH"
node --version        # v22.18.0
```

**禁止在 Node 24 下执行 `pnpm rebuild better-sqlite3`** —— 那会把绑定编成 ABI 137，桌面 exe 启动即崩（`pnpm rebuild` 在本机还会因 prebuild-install 证书校验 + node-gyp 不在 PATH 而失败）。若绑定已被改坏，恢复方法见 `docs/ITERATION_LOG.md`（用 `NODE_TLS_REJECT_UNAUTHORIZED=0 node prebuild-install` 在 better-sqlite3 包目录取回 ABI 127 预编译产物）。

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

当前壳层见 [`docs/SHELL-UX.md`](docs/SHELL-UX.md)。设计意图见 [`docs/WHITEPAPER.md`](docs/WHITEPAPER.md)，产品/工程方向见 [`docs/CAMELIA-ROADMAP.md`](docs/CAMELIA-ROADMAP.md)，迭代记录见 [`docs/ITERATION_LOG.md`](docs/ITERATION_LOG.md)，验收数据见 [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)，代码实现速查见 [`docs/CODE-SUMMARY.md`](docs/CODE-SUMMARY.md)。

认知 Phase 4 的冻结规格是 [`docs/ARCH-Camelia-v7.md`](docs/ARCH-Camelia-v7.md)（开工锁）加 [`docs/ARCH-Camelia-v8.md`](docs/ARCH-Camelia-v8.md)（体验/运维）。实现顺序见 [`docs/PHASE4-SPEC.md`](docs/PHASE4-SPEC.md)，阶段计划见 [`docs/ROADMAP-30-PHASES.md`](docs/ROADMAP-30-PHASES.md)，落地与打脸记录见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。架构停在 v7+v8，不再另开 v9 叙事。

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

### 沙箱额外可写根（`extraAllowPaths`）

权限 **完全放行 / FULL** 只跳过审批，**不会**扩大可写目录。若评测目录在 workspace 外（例如桌面上的 `camelia-bench`），在 `~/.camelia/config.json` 增加：

```json
{
  "extraAllowPaths": ["C:/Users/你/Desktop/camelia-bench"]
}
```

详见 [docs/SANDBOX-ALLOW-PATHS.md](docs/SANDBOX-ALLOW-PATHS.md)。

API Key 只存于 `~/.camelia/`，**零遥测**，不在其他位置写入任何数据。

## 许可

Apache-2.0
