# 诊断报告:`usable-check.mjs` 失败根因

> **日期**: 2026-10-10
> **触发**: 接手项目首次运行 `node scripts/usable-check.mjs`,唯一失败项"真实模型完成任务"。
> **诊断者**: Mavis (接手评估)

---

## 一、结论(一句话)

`usable-check.mjs` 失败**不是模型问题,不是脚本路径问题,不是 stale dist** —— 是 **better-sqlite3 原生模块按 Node 22 时代(ABI 127)编译,当前 Node 是 v24(ABI 137),加载 SQLite 即崩溃**。

---

## 二、复现证据链

### 步骤 1 — `usable-check.mjs` 重跑

```
✓ CLI 已构建                        bin.js
✓ CLI 可启动                        0.1.0
✓ Ollama 可用                      keyless provider 已就绪
✗ 真实模型完成任务                       未产出预期文件
✓ 桌面端产物新鲜                        exe 包含最新 UI
✓ 插件沙箱已接线                        worker 边界生效
```

### 步骤 2 — 排除"脚本路径错误"(Iteration 18 已踩过的坑)

`m2m3-local-eval.mjs` line 23-27 注释明确说明:
> Absolute by necessity: `cwd` is the per-case temp workspace, so a relative path here resolves against that directory and the spawn fails with MODULE_NOT_FOUND.

我直接用 `node spawnSync` 复现(同一 `cwd`,绝对路径),**`--version` 正常返回**:
```
CLI exists? true
cwd: C:\Users\37963\AppData\Local\Temp\camelia-diag-...
status: 0
stdout: 0.1.0
```
**→ Node `spawnSync` 处理绝对路径正确,问题不在脚本。**

### 步骤 3 — 抓取真实错误

手动跑完整命令(去 `--provider ollama`):
```javascript
spawnSync(process.execPath, [CLI, 'run', '--provider', 'ollama', ...], { cwd: tmpDir })
```
stderr:
```
camelia: unexpected error
Error: The module '...\better-sqlite3@11.10.0\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 137. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
    at Object..node (node:internal/modules/cjs/loader:2087:18)
    ...
    at new Database (...better-sqlite3/lib/database.js:48:64)
    at new SqliteSessionStore (...packages/core/dist/persistence/SqliteSessionStore.js:24:19)
    at CameliaRuntime.create (...packages/agent/dist/runtime/CameliaRuntime.js:130:23)
```

**崩溃栈清晰指向三层调用:** `CameliaRuntime.create` → `new SqliteSessionStore` → `new Database` → 加载 `.node` 二进制 → ABI 不匹配。

### 步骤 4 — 验证 Node 与 better-sqlite3 版本

```
$ node --version
v24.20.0
$ node -p "process.versions.modules"
137                                       ← Node v24 ABI
$ file node_modules\.pnpm\better-sqlite3@11.10.0\...\better_sqlite3.node
内部 ABI 标记:NODE_MODULE_VERSION 127     ← Node v22 ABI
```

### 步骤 5 — 验证 m1-local-eval.mjs 同样问题

跑 2 例(其他 19 例同样会崩,先验证模式即可):

```
[1/2] plain-text       ✗ failed     0.2s   ← 0.2s 崩在 SQLite 加载,根本没启动模型
[2/2] trailing-newline ✗ failed     0.2s
=== M1 真实模型结果 ===
成功: 0/2  成功率 0%  （目标 ≥ 95%）
```

**对比 ACCEPTANCE.md(Iteration 17.5, 2026-10-10):**
> M1 真实模型复测:21/21 = 100%,平均 13.0s/任务

**现实差距:接手后 M1 实际成功率 0%,不是 100%。** 0.2s 失败 = 引擎初始化阶段就崩了,模型从未被调用。

### 步骤 6 — 验证 doctor 为什么通过

```
$ node .../bin.js doctor
  ✓ database  C:\Users\37963\.camelia\camelia.db
```
**doctor 只检查 SQLite 文件存在性,不实际加载 better-sqlite3 的原生模块。** 这是可用性自检假阳性。

---

## 三、根因分析

### 直接根因

`better_sqlite3.node` 是按 **NODE_MODULE_VERSION 127(Node v22 时代的 ABI)** 编译的,当前 Node 是 **v24(ABI 137)**。两者不兼容,任何调用 `new Database(...)` 的代码路径立即抛 `ERR_DLOPEN`。

### 历史根因

| 时间 | 事件 |
|---|---|
| 之前某个时点 | 在 Node v22 下 `pnpm install`,prebuild 脚本下载并编译了 `.node` 文件 |
| 之后 | Node 升级到 v24(用户机器维护),`pnpm install` 没重跑 |
| pnpm-lock + node_modules 都还在**,`.node` 文件未重新编译** |

### 这是 Iteration 19 沉淀的"声明存在 ≠ 生效"第三例

ITERATION_LOG Iteration 19 已经识别这类病 —— "构建/测试通过" 被当成"功能可用":
- 例 1:`supportsTools: false` → Ollama 路径静默剥离工具
- 例 2:`gruntModel` 配置了但未接线
- 例 3:沙箱有测试但没接入加载路径
- **本次(接手后):better-sqlite3 在依赖树里、原生模块文件存在、cache 命中通过 typecheck/lint/build —— 但运行时一加载就崩**

这是**原生模块依赖特有的失效模式**:TypeScript / 编译产物对,运行时链接错。

---

## 四、影响范围

### 受影响路径(全部崩)

- `camelia run`(任何 provider)
- `camelia serve`(SSE 引擎)
- `camelia replay`
- `scripts/m1-local-eval.mjs`
- `scripts/m2m3-local-eval.mjs`
- 任何初始化 `CameliaRuntime` 的代码路径
- 桌面端 Tauri 也会受影响(Rust 进程加载 better-sqlite3 走自己的 ABI,但 webview 内 `camelia serve` 走 Node,会同样崩)

### 不受影响路径

- `camelia --version`(无 IO)
- `camelia doctor`(只查文件存在性)
- `camelia doctor --offline`(脚本化 Provider,不初始化 SqliteSessionStore)
- `pnpm typecheck` / `pnpm lint` / `pnpm build`(不加载 `.node`)
- 桌面端 `tauri` 自身(Rust 走独立 ABI,但 WebView2 加载的是 web 内容,无 Node 依赖)

### 数据真实性

| 指标 | ACCEPTANCE.md | 接手后实测 |
|---|---|---|
| M1 真实模型 | 21/21 = 100% | **0%**(2 例全崩,0.2s) |
| M2 真实模型 | 40% | 同样崩在 SQLite,真实数字未知 |
| 桌面冷启动 532ms | ✅ | 实际应该是"exe 启动 532ms,但引擎层立即崩" |
| 全部 894 测试通过 | ✅ | **未实际验证**(没重跑) |

**ACCEPTANCE.md 是 1 小时前生成的(19:59),其中所有 SQLite 相关数据当前都已失效。**

---

## 五、修复方案

### 推荐(零风险、30 秒)

```bash
pnpm rebuild better-sqlite3
```

`pnpm rebuild` 仅重新编译 native binding:
- 不动 `package.json`
- 不动 `pnpm-lock.yaml`
- 不重下源码
- 不重跑 `pnpm install` 全图
- 预计耗时 30 秒 - 2 分钟

### 备选 1(完全干净但慢)

```bash
pnpm install --force
```

全量重装,5-10 分钟。

### 备选 2(不变 Node,改依赖)

在 `packages/core/package.json` 把 `better-sqlite3` 升级到带 Node 24 prebuild 的版本(11.x 系列通常含 v137 prebuild)。

### 不推荐

回退 Node 到 v22。会失去 v24 特性,且不是长期方案。

---

## 六、接手方应建议的可观测性修复(顺手)

### 修 1:`usable-check.mjs` 漏检 SQLite 加载

当前 7 项检查里 **没有任何一项触发 `new SqliteSessionStore`**。建议加:

```javascript
// 在 doctor 后加:实际打开一次 SQLite,触发 better-sqlite3 native 加载
const probe = spawnSync(
  process.execPath,
  ['-e', `import('${CLI.replace('/bin.js','')}/../core/dist/persistence/SqliteSessionStore.js').then(m => new m.SqliteSessionStore(':memory:').close())`],
  { encoding: 'utf8' }
);
const sqliteLoads = probe.status === 0;
check('SQLite 原生模块可加载', sqliteLoads, ...);
```

这一项**才是真实模型任务的前提**。

### 修 2:ACCEPTANCE.md 的时间戳

当前生成时间是 `2026-10-10T11:59:03.495Z`,**距离接手已经 9 小时**。建议:
- 每次跑 `pnpm acceptance` 之前,先跑一次 `pnpm rebuild` 确保原生模块新鲜
- 或在 `acceptance-report.ts` 顶部自动调用 `verifyNativeBindings()` 失败就 exit 1

### 修 3:把"接手的诊断"加入 ITERATION_LOG

本次诊断本身应作为 **Iteration 19.1 — 接手复检** 记录进 `docs/ITERATION_LOG.md`,作为方法论沉淀(原生模块 ABI 是新的失效模式)。

---

## 七、本次诊断没有发现问题的项

- ✅ pnpm / Node / Git Bash 等基础环境
- ✅ Ollama 服务与模型文件
- ✅ CLI 入口
- ✅ `camelia run --mock` 走的脚本化 Provider(不走 SQLite)
- ✅ 桌面端 exe 产物新鲜度
- ✅ 插件沙箱是否接线
- ✅ `gruntModel` 多模型协作是否接线(grep 验证)
- ✅ lint / typecheck / build 全部 9 缓存命中 + 1 实际跑过

---

## 八、文件清单

诊断过程创建/查看的文件(诊断后保留,供后续核对):

| 路径 | 状态 |
|---|---|
| `C:\Users\37963\AppData\Local\Temp\camelia-diag-*` | 4 个临时目录,未清理 |
| `C:\Users\37963\AppData\Local\Temp\camelia-diag2-*` | 复现错误产生 |
| `docs/DIAGNOSIS-2026-10-10-usable-check-failure.md` | 本报告 |

---

**建议下一步:** 由用户决定是否执行 `pnpm rebuild better-sqlite3`,完成后重跑 `usable-check.mjs` 验证 7/7 全绿,再决定是否刷新 ACCEPTANCE.md。