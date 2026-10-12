import fs from 'node:fs';

// Composer workspace fix
{
  let s = fs.readFileSync('packages/ui/src/components/Composer.tsx', 'utf8');
  const old = "workspace: snapshot.session?.workspace ?? 'C:/Users/dev/projects/camelia-code',";
  const neu = "workspace: snapshot.session?.workspace ?? '.',";
  if (!s.includes(old) && s.includes(neu)) console.log('Composer ok');
  else if (!s.includes(old)) throw new Error('Composer needle missing: ' + s.includes('workspace:'));
  else {
    s = s.replace(old, neu);
    fs.writeFileSync('packages/ui/src/components/Composer.tsx', s);
    console.log('Composer patched');
  }
}

// provider-presets Chinese-friendly labels (ids stay English)
{
  let s = fs.readFileSync('packages/ui/src/window/provider-presets.ts', 'utf8');
  const old = `export const PRESET_TEMPLATES: PresetTemplate[] = [
  { id: 'aliyun', label: 'Aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-coder:free'] },
  { id: 'opencode-zen', label: 'Zen', baseUrl: 'https://opencode.ai/zen/v1', models: ['claude-3-5-haiku', 'qwen2.5-coder-32b'] },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b', 'llama3.2:3b'] },
  { id: 'custom', label: 'Custom', baseUrl: '', models: [] },
];`;
  const neu = `export const PRESET_TEMPLATES: PresetTemplate[] = [
  { id: 'aliyun', label: '阿里云兼容', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-coder:free'] },
  { id: 'opencode-zen', label: 'Zen', baseUrl: 'https://opencode.ai/zen/v1', models: ['claude-3-5-haiku', 'qwen2.5-coder-32b'] },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b', 'llama3.2:3b'] },
  { id: 'custom', label: '自定义', baseUrl: '', models: [] },
];`;
  if (s.includes("label: '阿里云兼容'")) console.log('presets ok');
  else if (!s.includes(old)) throw new Error('presets needle missing');
  else {
    s = s.replace(old, neu);
    fs.writeFileSync('packages/ui/src/window/provider-presets.ts', s);
    console.log('presets patched');
  }
}
