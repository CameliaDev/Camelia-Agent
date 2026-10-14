# @camelia/ui

Camelia 的**任务状态投影层**（React 19 + Vite + Tailwind v4 + Zustand）。

它不是「壳」：UI 不发明任何业务状态。它渲染的 `ProjectionSnapshot` 是领域事件流的**纯折叠**（whitepaper §6.1）。同一段事件序列折叠两次得到逐字节相同的快照，因此界面可复现、可测试、可审计。

## 职责

- **状态投影**：`snapshot` 的唯一来源是 `agent` 层推送的领域事件，经 `reduceEvents` 折叠而来；`store` 里没有隐藏的客户端真相。
- **命令下发**：所有用户动作（发送意图 / 审批 / 暂停 / 续跑 / 干预 / 回滚）以 `Command` 形式向上发送到 `agent` 层。
- **架构暴露**：把「任务阶段、步骤列表与状态、当前步与进度、工具输入/输出/耗时、上下文用量、子 Agent 运行、失败原因与恢复建议、压缩提示」投影为可读界面——这是第五节架构层自检清单的实现面。
- **可复现场景**：`?scene=<id>` 选择一段固定时间戳的事件脚本，供截图与测试使用；桌面外壳通过 `window.__CAMELIA_BOOT__` 传入同一选择（优先级：外壳 > URL > 默认 `empty`）。

## 边界

`ui` 依赖 `agent`（仅投影与传输类型）与 `core`（仅类型），**不**依赖 `harness`，也**不**触碰数据库。投影模块 `@camelia/agent/view` 是纯类型折叠、无 `node:` 依赖，因此能跨层被 webview 安全导入。

## 依赖方向

```
core  ←  harness  ←  agent  ←  ui
```

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/App.tsx` | 四列网格：48px 图标活动栏 / 会话栏（收起为 0）/ 工作区 / 右侧抽屉（关闭为 0）。顶栏是 36px 浮层，不是模式条。当前壳层见 [`docs/SHELL-UX.md`](../../docs/SHELL-UX.md) |
| `src/components/` | 顶栏、会话栏、对话流、右栏、活动栏、步骤卡片、工具卡片、可靠性表面、代码/Diff 块、作曲家 |
| `src/state/store.ts` | Zustand store：`snapshot + status + sessions`，事件归约为唯一状态源 |
| `src/transport/` | 传输契约与实现：`fixture`（离线/截图/测试）与 `sse`（真实引擎，同一接口） |
| `src/transport/boot.ts` | 桌面外壳注入的启动参数契约（`window.__CAMELIA_BOOT__`） |
| `src/transport/scenario.ts` | 9 个可复现场景的确定性事件序列 |
| `src/index.css` | Tailwind v4 山茶花暖色暗黑主题 Token |

## 主题 Token

暖调近黑 `#1A1514`（绝非纯黑）、暖白文字 `#F7EFE9`、山茶红主强调 `#D96C5F`；语义色复用同一暖色族：暖绿 `#7FA86B`、暖红 `#C4554A`、暖黄 `#D9A15F`。

## 运行

```bash
pnpm --filter @camelia/ui dev          # 开发服务器
pnpm --filter @camelia/ui build        # 生产构建
pnpm --filter @camelia/ui preview      # 预览构建产物
```

场景切换：`http://localhost:5173/?scene=approval`（可用：`empty` / `connecting` / `planning` / `diff` / `running` / `approval` / `failure` / `error` / `done`）。

## 测试

```bash
pnpm --filter @camelia/ui test
pnpm --filter @camelia/ui test:coverage
```

单测覆盖 store 归约、fixture 命令派发、场景确定性与关键组件渲染（diff 可见、错误/加载态可见）。截图由 `scripts/screenshot.mjs` 逐场景采集，落到 `tests/screenshots/`。