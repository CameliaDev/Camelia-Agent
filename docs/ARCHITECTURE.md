# Camelia 运行机制（PR #6 之后）

壳层行为见 [`SHELL-UX.md`](SHELL-UX.md)。这里只记引擎怎么把一次用户目标跑完，以及新工具该挂在哪里。

## 组合根

`CameliaRuntime`（`packages/agent`）是唯一选具体实现的地方：模型链、Node 适配器、SQLite、`ToolEngine`、插件、MCP。`EngineServer`（`packages/cli`）把命令收成 HTTP `POST /command`，事件用 SSE 推回界面。界面不自己发明任务状态。

一条命令进 `EngineServer.dispatch`。未识别的类型返回 `不支持的命令: <type>`，不会静默成功。`set_workspace`、`new_session`、`rename_session`、`delete_session`、`list_skills`、`install_skill`、`list_memories` 都在这条分发里。

## 任务循环

`AgentLoop` 仍是任务循环，顺序是计划 → 执行 → 校验 → 必要时重规划。反思阶段会写三种记忆：

- `artifact`：这次任务产出了多少产物。这是运行日志。设置页用 `isCuratedMemory` 把它滤掉。
- `lesson`：校验有缺口或自检要求修改时。
- `procedural`：多步成功后的做法。

不要为了设置页干净而停写 `artifact`。任务记忆面板还要这份记录。

## 子代理与团队

`SubAgentOrchestrator` 跑隔离子代理。`TeamOrchestrator` 用在 Term：协调者向决策模型要一份工人 JSON，`assignRoleModel` 按视觉、上下文和工具能力选模型，工人再交给子代理。至少一名工人 `ok` 才发 `task.completed`。Term 标签保留；不把这条路径折进 Work / Math 的输入框。

## 工具

`ToolEngine` 是唯一执行入口。注册顺序：

1. 内置工具（或测试传入的那一套）。
2. `MechanismHost` 上的机制工具。名字已被占用则跳过，来源 id 是机制 id。
3. 插件工具。不能覆盖内置。
4. MCP 工具，名字空间是 `mcp.<server>.<tool>`。

`Mechanism` 只有 `id`、`description` 和 `tools()`。新的工具族实现这个接口并交给 `CameliaRuntimeOptions.mechanisms`，不要再往 `AgentLoop` 里加分支。`TeamOrchestrator` 仍然留在循环旁边，它不是一个工具族。

## 会话与工作区

会话带 `kind`：`work` | `math` | `term`。没有 kind 的旧行是 work。`newSession` 只复用标题为「新会话」/ New chat / New session 的空行。`deleteSession` 删会话行和事件（任务经外键级联），不自动再建空白；界面自己要下一条。`setWorkspace` 在有任务或对话进行时拒绝。

## 记忆的两个表面

`MemoryService.listByLayer` 是存储查询。设置页传 `curated: true`，只留 `fact` / `preference` / `lesson` / `procedural`。右侧任务记忆面板不传这个标志，所以运行日志还在那里。
