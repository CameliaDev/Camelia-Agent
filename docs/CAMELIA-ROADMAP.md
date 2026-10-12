# Camelia-Agent 产品 + 工程方向书（v1）

> **生成时间**：2026-10-12 16:41（CST / Asia/Shanghai）  
> **仓库**：`C:\Users\37963\Desktop\Camelia-Agent`（`main`；M0/M1 已于 2026-10-12 落地，见 `2c20208` 及后续 harden）  
> **证据基线**：`~/.camelia/logs/engine.log`（2026-10-12 16:38:55）、`%TEMP%\camelia-engine-debug.log`、`docs/REVIEW-2026-10-12.md`、`docs/DIAGNOSIS-2026-10-10-usable-check-failure.md`、wireframe v2 UI 实机截图  
> **原则**：具体 > 空泛；能跑通一次端到端优先于堆功能；fixture 永远不能假装 live。

---

## 状态更新（2026-10-12 16:55+ CST）

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| **M0 引擎复活** | **已完成** | 桌面 `find_node` 优先 Node 22（`CAMELIA_NODE` / `desktop.json.node` / fnm·nvm）；spawn 前 probe `better-sqlite3`；ABI 失败写入 `engineSpawnError`，不假装 Live |
| **M1 首条 hello** | **已完成（CLI）** | Ollama `qwen2.5-coder:7b` `run` 成功；桌面冷启 Live + `/health` 报 ollama 已连。UI 内再发一条 hello 建议人工点验 |
| Offline 根因 | 已澄清 | **不是** fixture「坏了」；是 Node 24 ABI 137 vs sqlite ABI 127 → spawn 崩 → 无 `engineUrl` |

推荐写入：`node scripts/write-desktop-json.mjs`（UTF-8 无 BOM）。下文 §0–§1 保留事故现场叙述，勿删。

---

## 0. 可执行摘要（先看这里）

| 优先级 | 动作 | 验收 |
| --- | --- | --- |
| **P0 今天** | 对齐 Node ↔ `better-sqlite3` ABI，让桌面成功 spawn `camelia serve` | 顶栏/徽章显示 **Live**，不再 Offline |
| **P0 今天** | 用 Ollama `qwen2.5-coder:7b` **或** 阿里云 `qwen-plus` 跑通首条「hello」对话 | 任务 `done`，非「失败 — 已耗尽」 |
| **P1 本周** | 引擎启动失败时 UI **诚实展示根因**（ABI / CLI 缺失 / Node 缺失），禁止静默回落 fixture | 用户能从界面一键打开 `engine.log` 并看到可行动提示 |
| **P1 本周** | 决定品牌占位（名称 + 吉祥物）候选并冻结一项试用 | 顶栏不再显示「名称与吉祥物 TBD」 |
| **P2 两周内** | Provider 热切换、引擎诚实度、记忆/事件轨、打包与冒烟测试成轨 | 见 §3 / §7 |

**一句话诊断**：UI wireframe v2 已可用，但桌面壳 spawn 的引擎在加载 SQLite 时因 **Node 24 (ABI 137) vs better-sqlite3 (ABI 127)** 崩溃 → 无 `engineUrl` → UI 走 **FixtureTransport** → 用户打「hello」被诚实拒绝（「未连接引擎 — offline fixture cannot run a live model」）→ 显示 Offline / 失败已耗尽。右侧显示的 `ollama · qwen2.5-coder:7b` 是连接预设/UI 状态，**不是** live 引擎已连上。

---

## 1. 当前诊断：为什么 Offline / fixture 挡住 live run

### 1.1 症状（与截图一一对应）

| 截图现象 | 代码/日志含义 |
| --- | --- |
| **Offline** | `ConnectionStatus = 'offline'`（`packages/ui/src/lib/status.ts`） |
| 「未连接引擎 — offline fixture cannot run a live model」 | `FixtureTransport` 对 `submit_task` 的硬拒绝（`packages/ui/src/transport/fixture.ts` ~L261–283） |
| 任务 hello →「失败 — 已耗尽」 | i18n `failure.exhausted`；fixture 立刻 `task.failed` + `recoverable: false` |
| 右轨 `ollama · qwen2.5-coder:7b` | 连接预设/模型库 UI；**不等于** SSE 已连上引擎 |
| Brand **TBD** | `brand.placeholder` =「名称与吉祥物 TBD」（刻意占位，见 Sprint 规则） |

### 1.2 因果链（已用本机日志坐实）

```
桌面冷启动 (camelia-desktop.exe)
  → find_engine_path() ✅
       CAMELIA_CLI / ~/.camelia/desktop.json
       → C:\Users\37963\Desktop\Camelia-Agent\packages\cli\dist\bin.js
  → find_node() ✅
       C:\Program Files\nodejs\node.exe   (= Node v24.20.0, ABI 137)
  → spawn: node bin.js serve --port=0 --json
  → CameliaRuntime.create → new SqliteSessionStore
  → better-sqlite3.node 按 ABI 127 编译（Node 22 时代）
  → ERR_DLOPEN / NODE_MODULE_VERSION mismatch
  → 进程stderr崩溃，stdout 无 ready JSON {url, sessionId}
  → spawn_engine() → None
  → boot: "could not spawn engine — offline mode"
  → __CAMELIA_BOOT__ 无 engineUrl
  → createTransport() → FixtureTransport({ scene: 'empty' })
  → 用户提交 "hello"
  → fixture 故意失败（诚实，不假装跑模型）
```

**关键日志摘录**（`~/.camelia/logs/engine.log`，2026-10-12 16:38:55 CST）：

```
NODE_MODULE_VERSION 127 … This version of Node.js requires NODE_MODULE_VERSION 137
… at new SqliteSessionStore … at CameliaRuntime.create
[boot] could not spawn engine — offline mode
```

### 1.3 次要/混淆因素（容易误判）

1. **「声明存在 ≠ 生效」第三例再现**（见 `DIAGNOSIS-2026-10-10`）：`typecheck`/`build`/`pnpm test` 全绿，但原生模块运行时链接失败。  
2. **仓库锁定 Node 22**（`.nvmrc` / `.node-version` = 22），但桌面 `find_node()` **硬偏好** `C:\Program Files\nodejs\node.exe`，本机该路径是 **v24**。即使 nvm 切到 22，桌面壳仍可能用系统 Node 24。  
3. **`config.json` 首选阿里云**（`preferredProvider: aliyun`, `model: qwen-plus`），右轨却常显示 Ollama——UI 展示与引擎实际 provider 链可能不一致，加剧「看起来有模型却跑不动」的错觉。  
4. **Ollama 本身是好的**：`qwen2.5-coder:7b` 已装、API 可达、历史实测 ~29.5 tok/s（RTX 3060 Laptop 6GB）。阻塞点不在模型服务。  
5. **阿里云 key 已存在**（`~/.camelia/keys.json` 含 `aliyun`）。引擎起来后应能走 DashScope compatible-mode。  
6. **Fixture 的拒绝是正确产品行为**：`c2127fa honest intervene` 路线——宁可失败提示，也不伪造成功。问题在「为何落到 fixture」，不在 fixture 文案。

### 1.4 架构事实（写路线图的边界条件）

```
apps/desktop (Tauri)  --spawn-->  packages/cli serve (HTTP/SSE)
packages/ui  --SseTransport|FixtureTransport-->  EngineServer
cli → agent (CameliaRuntime) → harness (AgentLoop) → core (SQLite/events)
```

- UI **从不**直接碰 SQLite；无 `engineUrl` 就只能 fixture。  
- 分层硬约束：`ui → agent → harness → core`，禁止反向。  
- 近期有价值提交：`f5592c3` prefs v4 右轨折叠、`c2127fa` 诚实干预、`d89c11a` checkpoint/events、`b0b69e8` presets/settings、`51e7678` wireframe v2 + P0/P1 wiring、其后 memory/session/math 等。

---

## 2. North-star / 产品定位（3–5 选项，已排序）

> 排序标准：① 与白皮书「任务完成率」一致性；② 差异化（相对 Cursor/Cline/Continue）；③ 本机硬件与免费/本地模型现实；④ 6 个月内可验证。

### 选项 A — **首选：弱模型可靠性桌面 Agent**（推荐北星）

- **一句话**：面向本地/免费/中等模型，用架构（验证、回滚、事件、记忆）把任务做成。  
- **Why #1**：白皮书与 Iteration 26 已押注此命题；本机 RTX 3060 + Ollama 7B 是目标用户画像的缩影。  
- **成功指标**：CCD-5 任务完成率；M1≥95% / M2≥80%（真实模型，非 mock）；「首条对话成功率」仪表盘。  
- **不做**：变成「又一个 ChatGPT 壳」。

### 选项 B — **本地优先编码副驾驶（Ollama-first）**

- **一句话**：零云、隐私默认、开箱连本机 Ollama，云端仅作可选加速。  
- **优势**：与当前硬件/文档（`OLLAMA-SETUP.md`）契合；合规叙事清晰。  
- **风险**：7B 工具调用需提示词约束（已踩坑）；复杂任务上限低——必须靠 harness 补。  
- **建议**：作为 A 的**默认交付形态**，而非独立北星。

### 选项 C — **可观测可干预的「任务操作系统」**

- **一句话**：每一步可看、可批、可回滚、可回放；工程师信任过程甚于盲信模型。  
- **优势**：wireframe v2（会话轨 / 对话气泡 / 数据轨 / checkpoint / events）已铺路。  
- **风险**：若不先跑通 live，可观测性只是「好看的死仪表盘」。  
- **建议**：A 的体验层口号；品牌与 Onboarding 可借此叙事。

### 选项 D — **中国区双引擎工作台（阿里云 + Ollama）**

- **一句话**：同一 UI，本地 7B 打草稿/隐私任务，阿里云 Qwen 打复杂任务；一键降级/升级。  
- **优势**：`config.json` 已有 aliyun preset；keys 已就位；国内网络友好。  
- **风险**：两套能力/价格/延迟；需诚实的 provider 状态机（见 §5）。  
- **建议**：作为 A 的 **Go-to-Market 包装**（「中国开发者默认路径」）。

### 选项 E — **（暂缓）插件/Marketplace 平台**

- **一句话**：第三方工具与 Agent 技能市场。  
- **为何垫底**：平台冷启动成本高；在 E2E 未绿前做 marketplace = 空壳。  
- **保留为 stretch**（§6），不进北星。

**决策建议**：对外北星锁定 **A**；默认体验走 **B+D**；UI 叙事用 **C**；E 进远期。

---

## 3. 多阶段路线图（8 个里程碑）

> 每阶段含：目标 · 关键交付 · 验收标准 · 风险。阶段门禁未过不进下一阶段。

### M0 — 引擎复活（Unblock Live）· **0.5–1 天**

| 项 | 内容 |
| --- | --- |
| **目标** | 桌面冷启动必得 Live 引擎；fixture 仅在显式 `--scene` / 无 CLI 时出现 |
| **关键交付** | ① `pnpm rebuild better-sqlite3`（或锁定 Node 22 + 让 `find_node` 尊重 `.nvmrc`/桌面配置的 node 路径）② `usable-check` 增加「真实加载 SqliteSessionStore」项 ③ 启动失败时 UI 展示 `engine.log` 末 N 行 + ABI 提示 |
| **验收** | 冷启动徽章 Live；`engine.log` 有 `url` ready；提交「hello」不再走 fixture 拒绝文案 |
| **风险** | 只 rebuild 不修 `find_node` → 下次换 Node 再炸；只改 UI 文案不修 ABI → 假进展 |

### M1 — 首条成功对话（Hello Green）· **1–2 天**

| 项 | 内容 |
| --- | --- |
| **目标** | 两条路径至少一条稳定：Ollama 本地 / 阿里云 Qwen |
| **关键交付** | ① Settings 明确「当前生效 provider + model」与右轨一致 ② Ollama health probe（`/api/tags`）③ 阿里云 key 掩码展示 + 最小 chat 探测 ④ 预设「hello 冒烟」按钮（写 `hello.txt` 或纯对话） |
| **验收** | Ollama：`hello` → 助手回复或产出文件，任务 `done`；阿里云：同上；失败时错误含 HTTP/鉴权/超时，而非「已耗尽」空壳 |
| **风险** | 工具调用格式（Ollama 无原生 tool_calls）导致「会聊不会干」——需确认 supportsTools + 提示词路径仍接线 |

### M2 — 引擎诚实度与连接韧性 · **3–5 天**

| 项 | 内容 |
| --- | --- |
| **目标** | 连接/断开/重连/降级全程诚实；零假成功 |
| **关键交付** | ① spawn 失败分类：CLI缺失 / Node缺失 / ABI / serve崩溃 / 端口占用 ② 自动重试 spawn（指数退避，上限 3）③ SSE 断线横幅 +「打开日志 / 重启引擎 / 重启应用」④ `select_provider` 持久化到 `config.json` ⑤ 干预/回滚/降级：引擎未实现则禁用并显示真实错误（延续 `c2127fa`） |
| **验收** | 人为杀掉引擎进程 → UI 30s 内进 Offline 并提示；恢复后可重连；切换 provider 重启后仍生效 |
| **风险** | 重连时 bootstrap 重放导致会话闪烁（已知限制，需 `switchSession` 去抖） |

### M3 — Provider 产品化（阿里云 / Ollama / 回退链）· **1 周**

| 项 | 内容 |
| --- | --- |
| **目标** | CC Switch 级连接预设真正驱动引擎，而非「能存不能用」 |
| **关键交付** | ① presets CRUD 热更新（尽量免重启）② Fallback 链可视化（谁主谁备、为何切换）③ 能力矩阵：`supportsTools` / context / 延迟探针 ④ 中国区默认模板：阿里云兼容 + Ollama ⑤ grunt/decision 双模型在 UI 可配 |
| **验收** | 断阿里云 → 自动落到 Ollama（或反之按策略）；右轨始终显示**引擎回报**的 provider，而非仅本地 prefs |
| **风险** | 静默剥离 tools（历史坑）复发——加 doctor 与 UI 双告警 |

### M4 — 记忆 / 事件 / Checkpoint 体验闭环 · **1–1.5 周**

| 项 | 内容 |
| --- | --- |
| **目标** | 数据轨从「好看」变成「排障与信任」工具 |
| **关键交付** | ① recall 时间线（已有方向）接 live 事件 ② checkpoint 时间线可一键 rollback（引擎路径真执行）③ 事件审计：过滤 / 复制 / 打开 `record.json` ④ 跨会话 memory critique 结果可读 ⑤ fixture **禁止**冒充这些面板的数据源（除 demo 模式角标） |
| **验收** | 一次失败任务可在 UI 内定位到失败 step + 工具输出 + 可回滚；离线打开 `record.json` 可 `camelia replay` |
| **风险** | UI 本地拼凑记忆（违反 Iteration 26 约束）——评审必查数据源 |

### M5 — 品牌与 Onboarding · **3–5 天（可与 M3 并行）**

| 项 | 内容 |
| --- | --- |
| **目标** | 去掉 TBD；新用户 5 分钟内完成「安装 → 选模型 → 第一条成功任务」 |
| **关键交付** | ① 品牌三选一决策记录（见 §5.4）② 空态 Checklist：工作区 / doctor / Ollama或Key / 引擎 Live ③ 首次运行向导（不强制账号）④ About：版本 + commit（修掉写死的旧 sha `f5592c3`）⑤ 中文默认文案审计 |
| **验收** | 干净 Windows 用户按 README 3 步 + 向导完成 hello；顶栏品牌非 TBD |
| **风险** | 过早拍板吉祥物导致返工——先用「Camelia + 山茶花几何标」过渡 |

### M6 — 包装、分发与环境门禁 · **1 周**

| 项 | 内容 |
| --- | --- |
| **目标** | 安装版不依赖开发者碰巧有正确 Node ABI |
| **关键交付** | ① 捆绑或探测 Node：优先 `CAMELIA_NODE` / `desktop.json.node` / 仓库 `.nvmrc` 对应路径 ② NSIS 安装后写入 `desktop.json`（cli + node）③ `usable-check` / doctor：**真实** `new Database(':memory:')` ④ CI：Node 22 matrix + native rebuild ⑤ 发布产物双哈希（AppData exe + Desktop exe）写进 ACCEPTANCE |
| **验收** | 在「仅安装包、无 clone」机器上：要么自带 runtime，要么清晰指引安装 Node 22；ABI 错误在 UI 可懂 |
| **风险** | 捆绑 Node 增大安装包；不捆绑则环境债永存——需二选一写进发布策略 |

### M7 — 质量闸与真实模型回归 · **持续 / 里程碑周**

| 项 | 内容 |
| --- | --- |
| **目标** | 「测试绿」与「能干活」同义 |
| **关键交付** | ① 桌面 Playwright/脚本：冷启动 → Live → hello ② M1 真实模型集每周跑（Ollama）③ 阿里云冒烟（密钥在 CI 用 OIDC/自托管 runner，或本地 nightly）④ 覆盖率门禁保持 agent ≥90% ⑤ 失败自动归档 `record.json` + 截图 |
| **验收** | `pnpm test` + `usable-check` + 「桌面 hello e2e」三闸全绿才允许标 Release Candidate |
| **风险** | 用 mock 冒充真实模型验收——ACCEPTANCE 必须分栏标注 |

### M8 — 产品深化（多会话真切换 / 弱模型编排）· **2 周**

| 项 | 内容 |
| --- | --- |
| **目标** | 从「能跑」到「能托付长任务」 |
| **关键交付** | ① runtime 进程级 session 真正热切换（修已知限制）② 弱模型 fixup 收敛（已有守卫，扩到 UI 可见）③ 子 Agent 摘要在对话中的呈现 ④ 长会话记忆评估从模拟走向抽样真实 ⑤ 数学/工具预设（`c1e561a`）产品化入口 |
| **验收** | 30 分钟长任务不丢目标；切换会话无串台；弱模型两文件任务完成率可度量 |
| **风险** | 范围膨胀吞掉包装与品牌——用周计划锁范围（§7） |

---

## 4. 近线解阻计划：真正跑通一次端到端

> 目标顺序：**引擎启动 → Provider（Ollama 或阿里云）→ 首条成功对话**。  
> **不要重编 exe 也能先验证 CLI**；确认 CLI 绿后再重启桌面。

### 4.1 步骤 A — 修 ABI（必做，约 2–10 分钟）

```powershell
cd C:\Users\37963\Desktop\Camelia-Agent
node --version                    # 当前预期：v24.20.0
node -p "process.versions.modules"  # 137

# 路径 1（最快）：按当前系统 Node 重编原生模块
pnpm rebuild better-sqlite3

# 验证：内存库必须能 new 出来
node -e "import('better-sqlite3').then(m => { const d=new m.default(':memory:'); d.close(); console.log('sqlite ok', process.versions.modules) })"
```

**路径 2（与仓库 engines 对齐，更稳）：**

```powershell
# 若已装 nvm-windows / fnm：切到 22.20.0 后
nvm use 22.20.0   # 或等价命令
pnpm rebuild better-sqlite3
```

并改桌面配置，避免壳子仍抓 Node 24：

```json
// ~/.camelia/desktop.json 建议扩展（实现见 M2/M6；临时可用 CAMELIA_NODE）
{
  "cli": "C:\\Users\\37963\\Desktop\\Camelia-Agent\\packages\\cli\\dist\\bin.js",
  "node": "C:\\路径\\到\\node22\\node.exe"
}
```

> 现状：`find_node()` **尚未**读 `desktop.json.node`——短期用「rebuild 到 ABI 137」或改 Rust 后重编桌面。若坚持不重编 exe：**必须让 `C:\Program Files\nodejs\node.exe` 与 better-sqlite3 ABI 一致**。

### 4.2 步骤 B — CLI 级引擎冒烟（不经 UI）

```powershell
# 离线脚本化（不证明模型，证明引擎+SQLite）
node packages\cli\dist\bin.js doctor --offline

# 起 serve，应打印 JSON：{"url":"http://127.0.0.1:....","sessionId":"..."}
node packages\cli\dist\bin.js serve --port=0 --json

# 另开终端：Ollama 路径
$env:OLLAMA_HOST="127.0.0.1:11434"
node packages\cli\dist\bin.js run --provider ollama "只用一句话回复：你好" --yes --workspace $env:TEMP\camelia-hello

# 或阿里云路径（使用 config.json preferredProvider）
node packages\cli\dist\bin.js run "只用一句话回复：你好" --yes --workspace $env:TEMP\camelia-hello-aliyun
```

**门禁**：serve 不崩；run 退出码 0；工作区或 stdout 有可见回复。

### 4.3 步骤 C — 桌面接 live

1. 确认 Ollama 在跑：`http://127.0.0.1:11434/api/tags` 含 `qwen2.5-coder:7b`。  
2. 关掉所有 `camelia-desktop` 进程。  
3. 启动 `%LOCALAPPDATA%\Camelia\camelia-desktop.exe`（或 Desktop 上的 `Camelia-Agent-new.exe`）。  
4. 看顶栏/连接：**Live**；打开设置 → 引擎与日志 → 确认 log 无 ABI 错误。  
5. 在 Settings 启用 **一条** 预设（建议先 Ollama 本地，排除云网络变量）。  
6. 输入 `hello`（或「写一个 hello.txt，内容为 hi」）。  
7. **期望**：任务规划/执行可见；结束为成功；数据轨有事件。  
8. **若仍 Offline**：读 `~\.camelia\logs\engine.log` + `%TEMP%\camelia-engine-debug.log`；用  
   `camelia-desktop.exe --engine-url=http://127.0.0.1:<port>` 指向手工 serve 做旁路验证。

### 4.4 步骤 D — 成功判据（写进 ITERATION_LOG）

- [ ] `engine.log` 无 `NODE_MODULE_VERSION`  
- [ ] UI 状态 Live ≥ 1 分钟稳定  
- [ ] 首条任务状态 `done`（非 exhausted）  
- [ ] `~/.camelia/runs/<taskId>/record.json` 存在且含 `intentRaw`  
- [ ] 右轨 provider 与引擎一致  

### 4.5 明确不做（本解阻窗口）

- 不重做 wireframe  
- 不改品牌最终稿（仅可临时隐藏 TBD）  
- 不引入 Electron  
- 不把 fixture 改成「假装调用 Ollama」——那是产品诚实性倒退  

---

## 5. 中期功能轨道（Mid-term tracks）

### 5.1 Engine honesty（引擎诚实度）

| 主题 | 具体项 |
| --- | --- |
| 启动 | spawn 错误分类码；UI 映射中文行动建议 |
| 运行 | SSE heartbeat；lastEventAt；僵尸连接检测 |
| 能力 | 引擎声明 `supports: { rollback, intervene, selectProvider, memory }`；UI 按声明启禁控件 |
| 失败 | `task.failed.reason` 机器可读 code + 人话；废除含糊「已耗尽」作为唯一文案 |
| 已知债 | runtime 进程级 session 切换；select_provider 持久化；bootstrap 重放去抖 |

### 5.2 Providers

| Provider | 近线动作 |
| --- | --- |
| **Ollama** | 默认本地；模型列表实时拉取；context 默认 8192（显存友好）；工具走提示词通道保持回归测试 |
| **阿里云 DashScope** | compatible-mode 模板完善；额度/429 友好提示；作为复杂任务默认云 |
| **OpenRouter / Zen** | 保留回退链；设置里标「社区/免费不稳定」 |
| **路由** | cheap-first（grunt/decision）UI 可见；手动钉死模型「勿自动降级」开关 |

### 5.3 Memory / Events

- 记忆层：working / short / long / procedural 在面板用同一套引擎事件。  
- Recall 时间线 + downgrade 标注（Iteration 26 方向继续）。  
- Checkpoint：mark / rollbackTo 与 Conversation 步骤条双向跳转。  
- Event audit：按 type 过滤、复制 JSON、导出 task bundle。  
- **禁止** UI 侧私造「假记忆」填充空态——空就显示空 +「尚无 recall」。

### 5.4 Branding

| 候选 | 调性 | 备注 |
| --- | --- | --- |
| **Camelia + 山茶花几何标**（过渡推荐） | 已有代码名与图标脚本 `gen-icons.mjs` | 最快去掉 TBD |
| **山茶 / Camellia 中文名** | 更亲切 | 需检查商标/重名 |
| **双名：中文产品名 + Camelia 英文** | 中国区友好 | About 与安装包名需一致 |

规则（已有 Sprint）：未文档化前不随机发明新名。M5 输出一页决策：最终名、图标、窗口标题、安装目录名。

### 5.5 Packaging

- NSIS `currentUser` 保持（无 UAC）。  
- 安装后写 `desktop.json`（cli、node、可选 enginePort）。  
- 发布清单：exe SHA256、附带 Node 要求、`pnpm rebuild` 说明。  
- 「开发者模式」vs「用户模式」：用户模式隐藏 scene/fixture 入口。

### 5.6 Tests

| 层 | 内容 |
| --- | --- |
| 单位 | 保持 ≥826+；agent 行覆盖 ≥90% |
| 契约 | FixtureTransport 与 SseTransport 同 Command 集 |
| 冒烟 | `usable-check` 含 SQLite native load + Ollama tags + 可选阿里云 ping |
| 桌面 e2e | 截图脚本升级为断言 Live + 首条任务 |
| 真实模型 | 周更 M1 子集；结果写入 ACCEPTANCE 分栏 |

---

## 6. 长线赌注 / Stretch（设计宁多勿少）

> 以下不阻塞 M0–M2；每项先写 ADR 再动工。

### 6.1 Multi-agent

- 主 Agent + 专职子 Agent（检索 / 编辑 / 测试 / 文档）。  
- DAG 计划可视化；子 Agent 卡片进对话流。  
- 接口冻结仪式：跨模块任务强制先产出 `contract.md`。  
- 资源预算：并行子 Agent 数受显存/API rate 限制。

### 6.2 Plugins

- 现有 worker 沙箱产品化：权限清单（fs/net/shell）UI 审批。  
- 插件清单格式 + 本地目录 `~/.camelia/plugins`.  
- 签名/哈希（先本地信任，后可选远程）。  
- 官方插件：Git、浏览器只读、Issue 同步（只出草稿）。

### 6.3 Marketplace（最晚）

- 技能包（prompt + tools + 验收模板），不是「提示词菜市场」。  
- 每个技能强制带：CCD-5 验收脚本 + 回放夹具。  
- 收入/分成以后再谈；先做「本地技能注册表」。

### 6.4 团队与协作

- 任务记录导出给同事（脱敏 bundle）。  
- 共享 provider 策略文件（无 key）。  
- 「教学模式」：逐步展示 plan/verify，适合培训。

### 6.5 智能体评测台

- 内置 harness 把本机变成持续评测器：弱模型集、回归集、夜间跑。  
- 产出雷达图：完成率 / 成本 / 延迟 / 干预次数。  
- 这是选项 A 的护城河内容。

### 6.6 工作区智能

- 项目画像（语言、测试命令、构建命令）写入 procedural memory。  
- 「打开仓库就知道怎么验收」。  
- 与 math.exec / modeling preset 同类：领域工具深化。

### 6.7 移动/远程（极远）

- 同一引擎协议上的远程控制台（只读旁观 / 审批）。  
- 不做第二套业务逻辑；只做薄客户端。  
- 安全模型未想清前不动工。

### 6.8 商业化草图（非承诺）

- 开源核心（Apache-2.0）+ 可选云路由订阅。  
- 本地永远可用；云是加速器不是开关。  
- 与「零遥测」冲突的功能直接砍。

---

## 7. 未来两周：逐周计划（2026-10-12 起）

### Week 1（10/12 – 10/18）— **跑通 + 诚实**

| 日 | 焦点 | 产出 |
| --- | --- | --- |
| D1（今天） | ABI rebuild；CLI serve/run 冒烟；桌面 Live | 日志截图；ITERATION_LOG 短记「引擎复活」 |
| D2 | Hello Green：Ollama 路径端到端；修右轨/Settings 显示一致性 | 首条 `done` 任务；`record.json` |
| D3 | 阿里云路径冒烟；失败文案 code 化；spawn 失败分类 | UI 不再只说「已耗尽」 |
| D4 | 引擎断线横幅/重连；`usable-check` 加 SQLite native 项 | usable-check 含新门禁 |
| D5 | Provider 热切换持久化；手动钉死模型开关 | 重启后 preferredProvider 生效 |
| D6 | 桌面 hello 自动冒烟脚本；修 About 里写死的 commit sha | 脚本进 `scripts/` |
| D7 | 缓冲 + 文档：更新 README「桌面 Live 排障」一节；周回顾 | 问题清单进 M2/M3 |

**Week 1 门禁**：Live 冷启动稳定；Ollama hello 绿；阿里云 hello 绿或有明确 key/网络缺陷记录；fixture 仅在显式 demo 出现。

### Week 2（10/19 – 10/25）— **产品感 + 包装地基**

| 日 | 焦点 | 产出 |
| --- | --- | --- |
| D8 | 品牌决策页（三选一）+ 去掉 TBD 占位 | 顶栏新文案/图标 |
| D9 | Onboarding Checklist + doctor 入口打通 | 空态可引导至 Live |
| D10 | 记忆/事件轨：live 数据源审计；rollback 真路径 | 数据轨可排障 |
| D11 | `find_node` 读 `desktop.json` / `CAMELIA_NODE`；安装脚本写配置 | 减 ABI 再发 |
| D12 | Fallback 链可视化；能力探针 | 用户懂「为何切模型」 |
| D13 | NSIS/安装版回归：装 → 启 → Live → hello | 截图 + SHA256 |
| D14 | 冻结 RC 清单；开 M8 范围评审；stretch ADR 各写 1 页提纲 | 路线图 v1.1 |

**Week 2 门禁**：品牌非 TBD；安装版路径可复现 Live；事件/checkpoint 至少一条真回滚；发布门禁三闸定义落地。

---

## 8. 风险总表（跨阶段）

| ID | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | Node 大版本漂移 ↔ native ABI | 桌面再次静默 Offline | doctor 实测加载；`find_node` 可配置；CI matrix |
| R2 | Fixture 被当成产品模式 | 用户以为坏掉 / 或假成功 | 角标「演示」；无 engineUrl 时强提示 |
| R3 | Ollama 工具格式不稳定 | 「会聊不会改代码」 | 提示词通道 + probe-tools 回归 |
| R4 | 云 key/额度 | 阿里云路径红 | 本地 Ollama 为默认兜底 |
| R5 | 范围膨胀（marketplace 过早） | 永久跑不通 | M0–M2 完成前禁止平台化 |
| R6 | session 热切换债 | 多会话串台 | M8 专修；此前 UI 限制「一任务一会话」文案 |
| R7 | 测试绿幻觉 | ACCEPTANCE 失真 | 真实模型分栏；桌面 e2e 进门禁 |

---

## 9. 附录：关键路径速查

| 用途 | 路径 |
| --- | --- |
| 仓库 | `C:\Users\37963\Desktop\Camelia-Agent` |
| CLI | `packages\cli\dist\bin.js` |
| 桌面配置 | `%USERPROFILE%\.camelia\desktop.json` |
| 模型/Provider | `%USERPROFILE%\.camelia\config.json` |
| Keys | `%USERPROFILE%\.camelia\keys.json` |
| 引擎日志 | `%USERPROFILE%\.camelia\logs\engine.log` |
| Spawn 调试 | `%TEMP%\camelia-engine-debug.log` |
| 安装版 exe | `%LOCALAPPDATA%\Camelia\camelia-desktop.exe` |
| 架构宪法 | `docs\WHITEPAPER.md` |
| 今日审查 | `docs\REVIEW-2026-10-12.md` |
| ABI 旧诊断 | `docs\DIAGNOSIS-2026-10-10-usable-check-failure.md` |

### 附录：与截图字段的「对症药」

| 看见 | 先做 |
| --- | --- |
| Offline + fixture 文案 | §4.1 rebuild + §4.3 重启桌面 |
| 失败已耗尽 | 先 Live，再谈模型；仍失败则看 `task.failed.reason` / record |
| 右轨有 ollama 但仍 Offline | 忽略右轨，先看连接徽章与 engine.log |
| Brand TBD | 不阻塞解阻；进 M5 |

---

## 10. 建议的立即命令块（可复制）

```powershell
cd C:\Users\37963\Desktop\Camelia-Agent
pnpm rebuild better-sqlite3
node -e "import('better-sqlite3').then(m => { const d=new m.default(':memory:'); d.close(); console.log('OK ABI', process.versions.modules) })"
node packages\cli\dist\bin.js doctor --offline
node packages\cli\dist\bin.js serve --port=0 --json
# 另窗：
node packages\cli\dist\bin.js run --provider ollama "写一个 hello.txt，内容为 hi" --yes --workspace $env:TEMP\camelia-e2e
# 然后重启桌面 exe，确认徽章 Live，再在 UI 发 hello
```

---

*本文件为产品 + 工程方向书 v1，基于 2026-10-12 实机日志与仓库只读勘察。执行时以 M0→M1 为最高优先级；未 Live 前不开展 stretch。*
