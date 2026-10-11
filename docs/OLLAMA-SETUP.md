# Ollama 本地路径 —— 实测记录

> 生成时间：2026-10-10。所有数字来自本机实测，非估算。

## 硬件前提

| 项 | 值 | 说明 |
| --- | --- | --- |
| GPU | RTX 3060 Laptop，**6144 MiB** | WMI 的 `AdapterRAM` 报 4GB 是溢出错误，以 `nvidia-smi` 为准 |
| 内存 | 15.2 GB | 模型驻留时剩余约 2.2 GB |
| 磁盘 | 模型 4.7 GB | 装在 `~/.ollama/models` |

## 模型

`qwen2.5-coder:7b` Q4_K_M，**4,683,073,536 字节**（字节数与官方发布完全一致）。

因`registry.ollama.ai` 在本机 TLS 握手超时，改从 `hf-mirror.com` 直接下载 GGUF
再用 Modelfile 导入。见 `docs/OLLAMA-SETUP.md`。

## 实测结果

| 指标 | 值 | 判读 |
| --- | --- | --- |
| 吞吐 | **29.5 tokens/s**（418 tokens / 14.2s） | 对7B Q4 属健康，模型完整驻留显存 |
| 显存占用 | **4191 / 6144 MiB** | 未溢出到系统内存 |
| GPU 温度 | 55°C（负载中） | 远低于降频阈值（通常 87°C） |
| 工具调用格式 | `{"tool":"fs.write","arguments":{"path":"hello.txt","content":"hi"}}` | 精确可用 |

## 关键发现：工具调用走提示词而非原生通道

用标准 OpenAI `tools` 参数探测，模型**理解**工具语义但输出 XML/JSON 文本：

```xml
{{"name": "fs.write", "arguments": {"path": "hello.txt", "content": "hi"}}}
```

`finish_reason=stop`，无 `tool_calls` 字段。原因：**Ollama 0.40 内置的 qwen2.5
模板 instruct 模型输出 `<tool_call>` XML 标签**，而不是结构化 function call。

绕过办法（已验证有效）：不传 `tools` 参数，改用系统提示词约束格式，模型即
精确输出 Camelia 期望的结构。

## 上下文限制在 8192的原因

模型原生支持 32k，但 6GB 显存装下 4.7GB 权重后只剩约 1.9GB 给 KV cache。
上下文一旦拉长，Ollama 把部分层转移到系统内存（走 PCIe），延迟高一个数量级。

**宁可上下文小而快。** 覆盖方式：`CAMELIA_OLLAMA_CONTEXT=16384`。

## 由此修正的一个架构缺陷

`packages/agent/src/config/load.ts` 里Ollama 原本标着 `supportsTools: false`。
而 `ModelGateway` 在能力为 false 时会**静默剥离**工具列表：

```ts
const toolsSuppressed = Boolean(input.tools && !caps.supportsTools);
const tools = toolsSuppressed ? undefined : input.tools;
```

模型收到任务却没有任何工具可用，只能输出文本，任务永远完不成**且不报错** ——
用户看到的是模型在思考，任务却不动。**「静默降级成不可能完成」是最坏的失败形态。**

已改为 `supportsTools: true`，并在 `packages/agent/test/config.test.ts` 加了回归
护栏：所有内置 provider 必须声明 `supportsTools: true`。

## 安全结论

跑本地模型**不会损坏电脑**。显卡有独立的硬件级过温保护（不依赖驱动或软件配合），
笔记本显卡功耗墙通常锁在 80–115W。真实约束是「变慢」和「挤占内存」，不是「损坏」。

实测温度 55°C，显存 4191/6144 MiB，系统内存尚余 2.2 GB——均在安全范围。

## 复现命令

```bash
# 服务（带HF 镜像变量）
node scripts/ollama-serve.mjs

# 工具调用能力探测
node scripts/probe-tools.mjs qwen2.5-coder:7b

# doctor 确认 Camelia 识别
OLLAMA_HOST=127.0.0.1:11434 node packages/cli/dist/bin.js doctor
```