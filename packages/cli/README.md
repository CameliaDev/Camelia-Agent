# @camelia/cli

Camelia 的**命令行入口**（二进制名 `camelia`）。它是 Phase 1 的验收通道：在 UI 存在之前，任务引擎必须能在命令行完成真实编码任务。

## 命令

| 命令 | 作用 |
| --- | --- |
| `camelia run "<任务>"` | 规划并执行一个任务；`--json` 输出机器可读结果，`--mock` / `--spec` 提供离线确定性通道。 |
| `camelia replay [taskId]` | 从持久化事件日志回放一个任务的完整生命周期；无 taskId 时列出最近会话。 |
| `camelia doctor [--offline]` | 体检安装：home 目录、Provider 可用性，并可选跑一遍引擎自检。 |

## 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 完成 |
| `1` | 任务失败 |
| `2` | 用法错误 |

退出码是一等契约：命令失败绝不以 `0` 退出。

## 常用参数

- `--workspace <dir>`：任务工作区（默认当前目录）。
- `--db <file>`：SQLite 数据库路径（默认 `~/.camelia/camelia.db`）。
- `--yes`：自动批准工具调用（危险；交互模式默认逐次审批）。
- `--json`：输出机器可读结果。
- `--no-color` / `--color`：控制着色。

## 测试

```bash
pnpm --filter @camelia/cli test
pnpm --filter @camelia/cli test:coverage
```

命令模块在进程内被驱动以覆盖分支；`tests/acceptance/cli.e2e.test.ts` 则 spawn 真实二进制，验证「真实 fs + 真实 SQLite」的端到端契约。