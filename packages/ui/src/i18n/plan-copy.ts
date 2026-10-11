/**
 * Display copy for the built-in demo plan.
 *
 * The scenario keeps one English source so events and tests stay stable.
 * The window language only changes what the user reads. Unknown text — a live
 * model's own title — is shown as written.
 * @module
 */

import type { LanguagePref } from '../state/local-prefs.js';

const ZH_TEXT: Record<string, string> = {
  'Map the CLI entrypoint and the report generator': '定位 CLI 入口和报告生成器',
  'Find where flags are parsed and where the acceptance report is rendered.':
    '找到参数在哪里解析，验收报告在哪里渲染。',
  'Parse a --json flag in the CLI': '在 CLI 中解析 --json 参数',
  'Accept `--json` and thread it into the run options without touching the human-readable path.':
    '接受 `--json`，并把它传入运行选项，同时不改动人类可读的那条路径。',
  'Thread the flag into the report renderer': '把该参数接到报告渲染器',
  'Make the report emit machine-readable JSON when the flag is set.':
    '设置该参数时，报告输出机器可读的 JSON。',
  'Extend the acceptance tests for JSON output': '为 JSON 输出补上验收测试',
  'Cover the new flag end-to-end, including the default path staying unchanged.':
    '端到端覆盖这个新参数，并确认默认路径保持不变。',
  'Run the full workspace suite and confirm green': '跑完整工作区测试并确认全绿',
  'No regressions anywhere in the monorepo.': '整个 monorepo 没有回归。',
  'packages/cli/src/main.ts exists': 'packages/cli/src/main.ts 存在',
  'report renderer located': '已定位报告渲染器',
  'main.ts parses --json': 'main.ts 会解析 --json',
  'renderer branches on format': '渲染器按格式分支',
  'renderer still emits the table by default': '默认仍输出表格',
  'cli e2e suite passes': 'CLI 端到端套件通过',
  'workspace suite exits zero': '工作区测试套件退出码为 0',
};

const ZH_KIND: Record<string, string> = {
  'file-exists': '文件存在',
  'file-contains': '文件包含',
  'command-exit-zero': '命令退出码为 0',
  'test-pass': '测试通过',
  'diff-nonempty': '差异非空',
  manual: '人工确认',
};

/** Title, goal, or acceptance description for the current language. */
export function localizePlanText(language: LanguagePref, text: string): string {
  if (language !== 'zh') return text;
  return ZH_TEXT[text] ?? text;
}

/** Acceptance kind badge. English keeps the machine token. */
export function localizeAcceptanceKind(language: LanguagePref, kind: string): string {
  if (language !== 'zh') return kind;
  return ZH_KIND[kind] ?? kind;
}
