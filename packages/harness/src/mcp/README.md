# MCP 集成

> 白皮书 §8.5。Camelia 作为 **MCP Client** 连接外部 MCP Server，把它们的工具包装成原生 Camelia 工具。

## 一句话

配置在 `~/.camelia/mcp.json`，重启后 `camelia doctor` 会告诉你每个服务器是否真的连上、贡献了哪些工具。

## 配置

`~/.camelia/mcp.json`（**纯数据，不会被执行**；但 Camelia 会运行你写的 `command`）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "timeoutMs": 30000
    },
    "remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer …" },
      "timeoutMs": 30000
    },
    "paused": {
      "command": "node",
      "args": ["server.mjs"],
      "disabled": true
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `command` + `args` | **stdio**传输：在子进程里运行，行分隔 JSON-RPC |
| `url` + `headers` | **HTTP** 传输：Streamable HTTP，每次请求一个 POST，可返回 SSE 帧 |
| `env` | stdio 子进程的额外环境变量 |
| `timeoutMs` | 单次请求超时，**默认 30s，强制夹到 `[2s, 120s]`**。越界会夹紧并在 `doctor` 里报出来 |
| `disabled` | 跳过该服务器（**不会启动进程**），配置保留 |

写了 `url` 就按 HTTP 处理，即使 `transport` 字段写错——半填的条目不该被当进程启动。

## 诊断

```bash
camelia doctor
```

```
  mcp servers  2 configured
    ! broken         stdio server requires a command
    ✓ notes          stdio   2 tool(s) in 63ms
      · mcp.notes.read_note
      · mcp.notes.delete_all
    · offline        disabled
```

一个不可达的服务器**不会**让任务失败——MCP 是能力增强，不是依赖。但它会在这里显式报出原因，而不是静默地什么都不贡献。

## 三条安全规则

**1. 每个 MCP 工具都要审批，无论名字多无害。**
`wrapMcpTool()` 强制 `approval: 'ask'`。`mcpToolRisk()` 只影响 UI 上的风险标注，**不参与放行判断**——因为风险是按工具*名字*猜的（`delete_*` → destructive），而 MCP 服务器是安装后才出现的第三方代码。把审批门交给对方的命名习惯是不成立的。

**2. 服务器不可信，所以每个请求都有硬超时。**
不回答的服务器表现为任务挂死、用户看不到任何进度。超时后传输层会杀掉子进程，下一次尝试从干净状态开始。

**3. 工具名带命名空间。**
`mcp.<server>.<tool>`。两个服务器都暴露 `search` 时，不会因为重名把整个工具引擎搞挂。

## 失败模式

传输层处理了四个只有在真实管道上才会出现的故障：

| 症状 | 处理 |
| --- | --- |
| 服务器狂打 stderr | 持续 drain（8KB 环形缓冲）。管道写满会**阻塞**子进程写响应，症状与挂死完全一样 |
| 响应分多片到达 | 按行分帧，半行缓存到换行符到达为止，不当 JSON 解析 |
| 服务器中途死亡 | 立即拒绝所有挂起请求，不等满timeout |
| 任务被取消 | 请求携带调用方 `AbortSignal`，立刻拆除而非占位到 deadline |

## 编程接口

```ts
import { CameliaRuntime, loadMcpServers } from '@camelia/agent';

const { servers, issues } = loadMcpServers();
const runtime = await CameliaRuntime.create({ workspace, mcpServers: servers });

runtime.mcp;          // 每个服务器的连接结果，含失败原因
runtime.tools.sourceOf('mcp.notes.read_note');  // 'mcp:notes' —— UI 用它显示工具来源
await runtime.close();// 关闭连接（stdio 是子进程，泄漏会在长会话里累积）
```

`CameliaRuntimeOptions.mcpTransportFactory` 是测试注入点，可替换传输实现。

## 测试

```bash
pnpm --filter @camelia/harness test:mcp      # 50 例，含真实子进程夹具
pnpm --filter @camelia/agent test:mcp        # 9 例，真实 runtime
```

stdio 用例跑的是**真实子进程**，不是 mock：分帧缺陷只有在真实 pipe 上才暴露。