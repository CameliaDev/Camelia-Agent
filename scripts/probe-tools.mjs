/**
 * 探测本地模型是否真的支持工具调用（tool calling）。
 *
 * 为什么不直接信配置里的 `supportsTools`：Camelia 的 `ModelGateway` 在能力为
 * false 时会**静默剥离**工具列表（`toolsSuppressed`），模型收到任务却没有任何
 * 工具可用，只能输出文本 —— 任务永远不会完成，而且不报错。
 *
 * 「静默降级成不可能完成」是最坏的失败形态：用户看到的是模型在思考，任务却
 * 永远不动。所以这里用一次真实调用去验证能力声明，而不是信任它。
 *
 * 用法：node scripts/probe-tools.mjs [model]
 *   例：node scripts/probe-tools.mjs qwen2.5-coder:7b
 */

const MODEL = process.argv[2] ?? 'qwen2.5-coder:7b';
const BASE = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fs.write',
      description: 'Write text to a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'relative path' },
          content: { type: 'string', description: 'file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

const body = {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content: 'Create a file named hello.txt containing the text "hi". Use the fs.write tool.',
    },
  ],
  tools: TOOLS,
  stream: false,
  options: { temperature: 0, num_ctx: 8192 },
};

console.log(`探测 ${MODEL} @ ${BASE}/v1/chat/completions`);
console.log(`上下文限制 8192（适配 6GB 显存，避免溢出到系统内存）\n`);

const started = Date.now();
let response;
try {
  response = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
} catch (error) {
  console.error(`✗ 无法连接 Ollama: ${error.message}`);
  console.error('  服务是否在运行？检查 http://127.0.0.1:11434');
  process.exit(1);
}

const elapsed = Date.now() - started;
console.log(`HTTP ${response.status}   ${elapsed}ms\n`);

if (!response.ok) {
  const text = await response.text();
  console.error(`✗ 调用失败:\n${text.slice(0, 800)}`);
  process.exit(1);
}

const data = await response.json();
const message = data.choices?.[0]?.message ?? {};

const hasToolCall = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
const content = typeof message.content === 'string' ? message.content : '';

console.log('── 结果 ──');
if (hasToolCall) {
  const call = message.tool_calls[0];
  console.log(`✓ 支持工具调用`);
  console.log(`  工具: ${call.function?.name}`);
  console.log(`  参数: ${call.function?.arguments}`);
  console.log(`\n结论: Camelia 中应设 supportsTools: true`);
} else {
  console.log(`✗ 未返回工具调用`);
  console.log(`  finish_reason: ${data.choices?.[0]?.finish_reason}`);
  console.log(`  文本输出: ${content.slice(0, 300) || '(空)'}`);
  console.log(`\n结论: 该模型不支持工具调用。Camelia 中必须 supportsTools: false，`);
  console.log(`      否则 ModelGateway 会静默剥离工具，任务无法完成且不报错。`);
}

const usage = data.usage ?? {};
console.log(`\ntokens: prompt=${usage.prompt_tokens ?? '?'} completion=${usage.completion_tokens ?? '?'}`);
process.exit(hasToolCall ? 0 : 2);