import fs from 'node:fs';

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('packages/ui/src/i18n/strings.ts', (s) => {
  if (s.includes("'welcome.check.workspace'")) return s;

  // Add keys before lang.en in the union
  const keyAnchor = "  | 'settings.engine.browserHint'\n  | 'lang.en'\n  | 'lang.zh';";
  const keyInsert = `  | 'settings.engine.browserHint'
  | 'settings.refreshEngineLog'
  | 'settings.engineLog'
  | 'settings.engineLog.empty'
  | 'settings.about.commit'
  | 'welcome.check.workspace'
  | 'welcome.check.doctor'
  | 'welcome.check.model'
  | 'commandError.dismiss'
  | 'intervene.rollbackUnavailable'
  | 'intervene.degradeUnavailable'
  | 'failure.recoverable'
  | 'failure.exhausted'
  | 'failure.attempts'
  | 'failure.strategy'
  | 'failure.suggested'
  | 'failure.checkpoint'
  | 'failure.retry'
  | 'failure.degrade'
  | 'failure.rollback'
  | 'events.filter'
  | 'events.copy'
  | 'events.copyEvent'
  | 'events.copyRecordPath'
  | 'events.copied'
  | 'events.expand'
  | 'events.collapse'
  | 'lang.en'
  | 'lang.zh';`;
  if (!s.includes(keyAnchor)) throw new Error('key union anchor');
  s = s.replace(keyAnchor, keyInsert);

  const enAnchor = `  'settings.engine.browserHint': 'Engine log and restart are available in the desktop app.',
  'lang.en': 'English',
  'lang.zh': '中文',
};`;
  const enInsert = `  'settings.engine.browserHint': 'Engine log and restart are available in the desktop app.',
  'settings.refreshEngineLog': 'Refresh log',
  'settings.engineLog': 'Engine log (tail)',
  'settings.engineLog.empty': 'No log lines yet.',
  'settings.about.commit': 'Build',
  'welcome.check.workspace': 'Pick or confirm the workspace path for this session.',
  'welcome.check.doctor': 'Run camelia doctor if the engine will not connect.',
  'welcome.check.model': 'Add a connection preset (Ollama / API key) in Settings.',
  'commandError.dismiss': 'Dismiss',
  'intervene.rollbackUnavailable': 'Rollback is not available from the live engine yet.',
  'intervene.degradeUnavailable': 'Mid-session provider switch is not available from the live engine yet.',
  'failure.recoverable': 'Failure — recoverable',
  'failure.exhausted': 'Failure — exhausted',
  'failure.attempts': 'attempts',
  'failure.strategy': 'strategy',
  'failure.suggested': 'suggested',
  'failure.checkpoint': 'checkpoint',
  'failure.retry': 'Retry the step',
  'failure.degrade': 'Fall back to a smaller model',
  'failure.rollback': 'Roll back',
  'events.filter': 'Filter events…',
  'events.copy': 'copy',
  'events.copyEvent': 'Copy event JSON',
  'events.copyRecordPath': 'Copy record.json path',
  'events.copied': 'copied',
  'events.expand': 'Expand events',
  'events.collapse': 'Collapse events',
  'lang.en': 'English',
  'lang.zh': '中文',
};`;
  if (!s.includes(enAnchor)) throw new Error('en anchor');
  s = s.replace(enAnchor, enInsert);

  const zhAnchor = `  'settings.engine.browserHint': '引擎日志与重启仅在桌面端可用。',
  'lang.en': 'English',
  'lang.zh': '中文',
};`;
  const zhInsert = `  'settings.engine.browserHint': '引擎日志与重启仅在桌面端可用。',
  'settings.refreshEngineLog': '刷新日志',
  'settings.engineLog': '引擎日志（尾部）',
  'settings.engineLog.empty': '暂无日志。',
  'settings.about.commit': '构建',
  'welcome.check.workspace': '确认本会话的工作区路径。',
  'welcome.check.doctor': '若引擎连不上，运行 camelia doctor。',
  'welcome.check.model': '在设置里添加连接预设（Ollama / API 密钥）。',
  'commandError.dismiss': '关闭',
  'intervene.rollbackUnavailable': '实时引擎尚未提供回滚。',
  'intervene.degradeUnavailable': '实时引擎尚未支持运行中切换服务商。',
  'failure.recoverable': '失败 — 可恢复',
  'failure.exhausted': '失败 — 已耗尽',
  'failure.attempts': '尝试次数',
  'failure.strategy': '策略',
  'failure.suggested': '建议',
  'failure.checkpoint': '检查点',
  'failure.retry': '重试该步骤',
  'failure.degrade': '降级到更小模型',
  'failure.rollback': '回滚',
  'events.filter': '筛选事件…',
  'events.copy': '复制',
  'events.copyEvent': '复制事件 JSON',
  'events.copyRecordPath': '复制 record.json 路径',
  'events.copied': '已复制',
  'events.expand': '展开事件',
  'events.collapse': '收起事件',
  'lang.en': 'English',
  'lang.zh': '中文',
};`;
  if (!s.includes(zhAnchor)) throw new Error('zh anchor');
  s = s.replace(zhAnchor, zhInsert);
  return s;
});
console.log('i18n ok');
