/**
 * Minimal built-in i18n. No runtime npm dep (locked).
 *
 * Language is a window-local preference (localStorage, not the event snapshot),
 * same class as theme. Strings keyed by id; unknown ids fall back to the english
 * value so a partial dictionary never renders `undefined`.
 * @module
 */

import type { LanguagePref } from '../state/local-prefs.js';

type StringKey =
  | 'app.tagline'
  | 'sessions.title'
  | 'sessions.empty'
  | 'sessions.expand'
  | 'sessions.collapse'
  | 'sessions.pin'
  | 'sessions.unpin'
  | 'sessions.favorite'
  | 'sessions.unfavorite'
  | 'sessions.delete'
  | 'sessions.confirmDelete'
  | 'sessions.cancelDelete'
  | 'sessions.search'
  | 'sessions.recent'
  | 'workspace.title'
  | 'provider.title'
  | 'provider.primary'
  | 'provider.none'
  | 'provider.connecting'
  | 'provider.connected'
  | 'provider.chosenBecause'
  | 'provider.depth'
  | 'provider.chain'
  | 'provider.configureKeys'
  | 'checkpoints.title'
  | 'checkpoints.empty'
  | 'checkpoints.restore'
  | 'metrics.title'
  | 'metrics.empty'
  | 'footer.keys'
  | 'right.noSession'
  | 'right.noProvider'
  | 'run.title'
  | 'run.steps'
  | 'run.tools'
  | 'run.context'
  | 'run.tokens'
  | 'run.cost'
  | 'run.notStarted'
  | 'run.stepsList'
  | 'context.title'
  | 'context.nothingCompressed'
  | 'subagents.title'
  | 'subagents.empty'
  | 'events.title'
  | 'events.quiet'
  | 'events.hint'
  | 'status.noSession'
  | 'status.idle'
  | 'status.executing'
  | 'status.paused'
  | 'cancel'
  | 'pause'
  | 'resume'
  | 'steer'
  | 'plan.tab'
  | 'conversation.tab'
  | 'composer.placeholder'
  | 'composer.run'
  | 'composer.steerPlaceholder'
  | 'composer.noActiveRun'
  | 'composer.enterToSend'
  | 'composer.shiftEnter'
  | 'welcome.title'
  | 'welcome.body'
  | 'step.pending'
  | 'step.running'
  | 'step.done'
  | 'step.failed'
  | 'step.weight'
  | 'acceptance.title'
  | 'cancelled.note'
  | 'settings.title'
  | 'settings.close'
  | 'settings.appearance'
  | 'settings.language'
  | 'settings.theme'
  | 'settings.font'
  | 'settings.topBar'
  | 'settings.topBar.auto'
  | 'settings.topBar.pinned'
  | 'settings.topBar.hidden'
  | 'settings.motion'
  | 'settings.motion.system'
  | 'settings.motion.reduce'
  | 'settings.plans'
  | 'settings.planApproval'
  | 'settings.planApproval.always'
  | 'settings.planApproval.auto'
  | 'settings.layout'
  | 'settings.leftWidth'
  | 'settings.rightWidth'
  | 'settings.collapseSessions'
  | 'settings.collapseRunRail'
  | 'settings.restoreLayout'
  | 'settings.layoutDefaults'
  | 'settings.model'
  | 'settings.provider'
  | 'settings.modelName'
  | 'settings.gruntModel'
  | 'settings.modelHint.live'
  | 'settings.modelHint.offline'
  | 'settings.apiKey'
  | 'settings.apiKey.configured'
  | 'settings.apiKey.missing'
  | 'settings.apiKey.local'
  | 'settings.apiKey.placeholder'
  | 'settings.modelSave'
  | 'settings.modelSaved'
  | 'settings.connection.live'
  | 'settings.connection.offline'
  | 'settings.diagnostics'
  | 'settings.openEngineLog'
  | 'settings.restartDesktop'
  | 'connection.panel'
  | 'connection.engineUrl'
  | 'connection.session'
  | 'connection.scene'
  | 'connection.fixture'
  | 'connection.openLog'
  | 'connection.restart'
  | 'connection.copy'
  | 'connection.copied'
  | 'connection.offlineBanner'
  | 'connection.offlineBanner.hint'
  | 'connection.waiting'
  | 'settings.about'
  | 'settings.about.preface'
  | 'settings.about.license'
  | 'settings.tokenRejected'
  | 'approval.waiting'
  | 'approval.yourCall'
  | 'approval.review'
  | 'approval.once'
  | 'approval.session'
  | 'approval.reject'
  | 'step.add'
  | 'step.edit'
  | 'step.delete'
  | 'run.weightedProgress'
  | 'run.atStep'
  | 'run.ctx'
  | 'memory.title'
  | 'memory.due'
  | 'memory.forgetLog'
  | 'memory.noForget'
  | 'intent.yourRequest'
  | 'intent.restatedGoal'
  | 'intent.assumptions'
  | 'intent.constraints'
  | 'intent.steered'
  | 'delivery.delivered'
  | 'delivery.artifacts'
  | 'step.verify'
  | 'step.rollback'
  | 'step.drafting'
  | 'step.stepLabel'
  | 'step.status.pending'
  | 'step.status.running'
  | 'step.status.verifying'
  | 'step.status.done'
  | 'step.status.failed'
  | 'step.status.skipped'
  | 'step.acceptance'
  | 'step.pass'
  | 'step.fail'
  | 'step.unknown'
  | 'lang.en'
  | 'lang.zh';

const en: Record<StringKey, string> = {
  'app.tagline': 'Warm intelligence, sharp code.',
  'sessions.title': 'Sessions',
  'sessions.empty': 'No sessions in this workspace yet.',
  'sessions.expand': 'Expand sessions',
  'sessions.collapse': 'Collapse sessions',
  'sessions.pin': 'Pin',
  'sessions.unpin': 'Unpin',
  'sessions.favorite': 'Favorite',
  'sessions.unfavorite': 'Unfavorite',
  'sessions.delete': 'Delete',
  'sessions.confirmDelete': 'Confirm delete',
  'sessions.cancelDelete': 'Cancel',
  'sessions.search': 'Search sessions',
  'sessions.recent': 'Recent',
  'workspace.title': 'Workspace',
  'provider.title': 'Provider path',
  'provider.primary': 'primary',
  'provider.none': 'No provider connected.',
  'provider.connecting': 'Connecting to the engine…',
  'provider.connected': 'provider connected',
  'provider.chosenBecause': 'chosen because:',
  'provider.depth': 'depth',
  'provider.chain': 'chain:',
  'provider.configureKeys': 'API keys',
  'checkpoints.title': 'Checkpoints',
  'checkpoints.empty': 'Restore points appear after each completed step.',
  'checkpoints.restore': 'restore',
  'metrics.title': 'Metrics',
  'metrics.empty': 'No metrics emitted.',
  'footer.keys': 'keys in ~/.camelia · zero telemetry · Apache-2.0',
  'right.noSession': 'No session',
  'right.noProvider': 'No provider',
  'run.title': 'Run',
  'run.steps': 'STEPS',
  'run.tools': 'TOOLS',
  'run.context': 'CONTEXT',
  'run.tokens': 'TOKENS',
  'run.cost': 'COST',
  'run.notStarted': 'not started',
  'run.stepsList': 'STEPS',
  'context.title': 'CONTEXT',
  'context.nothingCompressed': 'Nothing has been compressed yet. When the window fills, protected slots (goal, constraints, todos, artifacts) survive.',
  'subagents.title': 'SUB-AGENTS',
  'subagents.empty': 'No sub-agent has been spawned. Isolated subtasks run here so the main context stays clean.',
  'events.title': 'EVENTS',
  'events.quiet': 'The bus is quiet.',
  'events.hint': 'Run, steps, context and sub-agents appear here once a task starts.',
  'status.noSession': 'No session',
  'status.idle': 'Idle',
  'status.executing': 'Executing',
  'status.paused': 'Paused',
  'cancel': 'Cancel',
  'pause': 'Pause',
  'resume': 'Resume',
  'steer': 'Steer',
  'plan.tab': 'Plan',
  'conversation.tab': 'Conversation',
  'composer.placeholder': 'Describe a task. Camelia plans, executes, verifies and shows its work…',
  'composer.run': 'Run',
  'composer.steerPlaceholder': 'Steer the run — the goal is re-anchored, prior work kept…',
  'composer.noActiveRun': 'no active run',
  'composer.enterToSend': 'Enter to send',
  'composer.shiftEnter': 'Shift + Enter for a new line',
  'welcome.title': 'No task yet',
  'welcome.body': 'Describe what you want built, fixed or investigated. Camelia plans it, executes it step by step, verifies every acceptance point and shows you the whole run.',
  'step.pending': 'Pending',
  'step.running': 'Running',
  'step.done': 'Done',
  'step.failed': 'Failed',
  'step.weight': 'weight',
  'acceptance.title': 'ACCEPTANCE',
  'cancelled.note': 'Cancelled. Nothing further will run.',
  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.appearance': 'Appearance',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.font': 'Font',
  'settings.topBar': 'Top bar',
  'settings.topBar.auto': 'Show on hover',
  'settings.topBar.pinned': 'Always visible',
  'settings.topBar.hidden': 'Hidden until shortcut',
  'settings.motion': 'Motion',
  'settings.motion.system': 'Follow system',
  'settings.motion.reduce': 'Reduce motion',
  'settings.plans': 'Plans',
  'settings.planApproval': 'Plan approval',
  'settings.planApproval.always': 'Ask before every plan',
  'settings.planApproval.auto': 'Approve plans automatically',
  'settings.layout': 'Layout',
  'settings.leftWidth': 'Left width',
  'settings.rightWidth': 'Right width',
  'settings.collapseSessions': 'Start with sessions collapsed',
  'settings.collapseRunRail': 'Start with the run rail collapsed',
  'settings.restoreLayout': 'Restore default layout',
  'settings.layoutDefaults': 'Defaults are 260px and 360px, both expanded.',
  'settings.model': 'Model',
  'settings.provider': 'Provider',
  'settings.modelName': 'Decision model',
  'settings.gruntModel': 'Cheap model',
  'settings.modelHint.live': 'Saved to ~/.camelia/config.json. Reopen the desktop for the running engine to pick it up.',
  'settings.modelHint.offline': 'This window is offline, so a typed task cannot be planned. Save a model, then reopen so the desktop can start the local engine.',
  'settings.apiKey': 'API key',
  'settings.apiKey.configured': 'Key saved',
  'settings.apiKey.missing': 'No key yet',
  'settings.apiKey.local': 'Local model. No key required.',
  'settings.apiKey.placeholder': 'Paste a key to replace the saved one',
  'settings.modelSave': 'Save and reopen',
  'settings.modelSaved': 'Saved. Reopening…',
  'settings.connection.live': 'Engine connected',
  'settings.connection.offline': 'Offline — no engine',
  'settings.diagnostics': 'Diagnostics',
  'settings.openEngineLog': 'Open engine log',
  'settings.restartDesktop': 'Restart desktop',
  'connection.panel': 'Connection',
  'connection.engineUrl': 'Engine URL',
  'connection.session': 'Session',
  'connection.scene': 'Scene',
  'connection.fixture': 'Fixture (no live engine)',
  'connection.openLog': 'Open engine log',
  'connection.restart': 'Restart desktop',
  'connection.copy': 'Copy',
  'connection.copied': 'Copied',
  'connection.offlineBanner': 'Engine disconnected',
  'connection.offlineBanner.hint': 'The desktop is waiting for the local engine. Open the log if it does not come back, or restart the app.',
  'connection.waiting': 'Waiting for engine…',
  'settings.about': 'About',
  'settings.about.preface': 'API keys stay in ~/.camelia. This app sends no telemetry.',
  'settings.about.license': 'Apache-2.0',
  'settings.tokenRejected': 'token rejected',
  'approval.waiting': 'Waiting for you',
  'approval.yourCall': 'your call',
  'approval.review': 'Review the plan',
  'approval.once': 'Approve once',
  'approval.session': 'Approve for session',
  'approval.reject': 'Reject',
  'step.add': 'Add step',
  'step.edit': 'Edit',
  'step.delete': 'Delete',
  'run.weightedProgress': 'weighted progress',
  'run.atStep': 'at step',
  'run.ctx': 'ctx',
  'memory.title': 'MEMORY',
  'memory.due': 'DUE FOR REACTIVATION',
  'memory.forgetLog': 'FORGET LOG',
  'memory.noForget': 'Nothing has been forgotten.',
  'intent.yourRequest': 'Your request',
  'intent.restatedGoal': 'Restated goal',
  'intent.assumptions': 'assumptions',
  'intent.constraints': 'constraints',
  'intent.steered': 'steered →',
  'delivery.delivered': 'Delivered',
  'delivery.artifacts': 'artifacts',
  'step.verify': 'verify',
  'step.rollback': 'roll back',
  'step.drafting': 'Drafting the plan',
  'step.stepLabel': 'STEP',
  'step.status.pending': 'Pending',
  'step.status.running': 'Running',
  'step.status.verifying': 'Verifying',
  'step.status.done': 'Done',
  'step.status.failed': 'Failed',
  'step.status.skipped': 'Skipped',
  'step.acceptance': 'ACCEPTANCE',
  'step.pass': 'PASS',
  'step.fail': 'FAIL',
  'step.unknown': 'UNKNOWN',
  'lang.en': 'English',
  'lang.zh': '中文',
};

const zh: Record<StringKey, string> = {
  'app.tagline': '温暖的智能，锋利的代码。',
  'sessions.title': '会话',
  'sessions.empty': '此工作区还没有会话。',
  'sessions.expand': '展开会话',
  'sessions.collapse': '收起会话',
  'sessions.pin': '置顶',
  'sessions.unpin': '取消置顶',
  'sessions.favorite': '收藏',
  'sessions.unfavorite': '取消收藏',
  'sessions.delete': '删除',
  'sessions.confirmDelete': '确认删除',
  'sessions.cancelDelete': '取消',
  'sessions.search': '搜索会话',
  'sessions.recent': '最近',
  'workspace.title': '工作区',
  'provider.title': '模型链路',
  'provider.primary': '主',
  'provider.none': '未连接任何模型。',
  'provider.connecting': '正在连接引擎……',
  'provider.connected': '模型已连接',
  'provider.chosenBecause': '选择原因：',
  'provider.depth': '层级',
  'provider.chain': '链路：',
  'provider.configureKeys': '配置密钥',
  'checkpoints.title': '检查点',
  'checkpoints.empty': '每完成一步后会出现恢复点。',
  'checkpoints.restore': '恢复',
  'metrics.title': '指标',
  'metrics.empty': '暂无指标。',
  'footer.keys': '密钥存于 ~/.camelia · 零遥测 · Apache-2.0',
  'right.noSession': '无会话',
  'right.noProvider': '无模型',
  'run.title': '运行',
  'run.steps': '步骤',
  'run.tools': '工具',
  'run.context': '上下文',
  'run.tokens': '令牌',
  'run.cost': '花费',
  'run.notStarted': '未开始',
  'run.stepsList': '步骤',
  'context.title': '上下文',
  'context.nothingCompressed': '尚未发生压缩。窗口填满时，受保护槽位（目标、约束、待办、产物）会保留。',
  'subagents.title': '子代理',
  'subagents.empty': '尚未派生子代理。隔离子任务在此运行，保持主上下文干净。',
  'events.title': '事件',
  'events.quiet': '总线安静。',
  'events.hint': '任务开始后，运行、步骤、上下文与子代理会显示在这里。',
  'status.noSession': '无会话',
  'status.idle': '空闲',
  'status.executing': '执行中',
  'status.paused': '已暂停',
  'cancel': '取消',
  'pause': '暂停',
  'resume': '继续',
  'steer': '引导',
  'plan.tab': '计划',
  'conversation.tab': '对话',
  'composer.placeholder': '描述一个任务。Camelia 会规划、执行、校验并展示全过程……',
  'composer.run': '运行',
  'composer.steerPlaceholder': '引导本次运行——目标重新锚定，已有工作保留……',
  'composer.noActiveRun': '无运行中任务',
  'composer.enterToSend': '回车发送',
  'composer.shiftEnter': 'Shift+回车换行',
  'welcome.title': '暂无任务',
  'welcome.body': '描述你想构建、修复或调查的内容。Camelia 会规划、逐步执行、校验每个验收点，并向你展示完整运行过程。',
  'step.pending': '待处理',
  'step.running': '运行中',
  'step.done': '完成',
  'step.failed': '失败',
  'step.weight': '权重',
  'acceptance.title': '验收',
  'cancelled.note': '已取消。后续不再执行。',
  'settings.title': '设置',
  'settings.close': '关闭',
  'settings.appearance': '外观',
  'settings.language': '语言',
  'settings.theme': '主题',
  'settings.font': '字体',
  'settings.topBar': '顶栏',
  'settings.topBar.auto': '悬停显示',
  'settings.topBar.pinned': '始终显示',
  'settings.topBar.hidden': '快捷键呼出',
  'settings.motion': '动效',
  'settings.motion.system': '跟随系统',
  'settings.motion.reduce': '减弱动效',
  'settings.plans': '计划',
  'settings.planApproval': '计划审批',
  'settings.planApproval.always': '每个计划都先询问',
  'settings.planApproval.auto': '自动批准计划',
  'settings.layout': '布局',
  'settings.leftWidth': '左侧栏宽度',
  'settings.rightWidth': '右侧栏宽度',
  'settings.collapseSessions': '启动时收起会话栏',
  'settings.collapseRunRail': '启动时收起运行栏',
  'settings.restoreLayout': '恢复默认布局',
  'settings.layoutDefaults': '默认 260px 与 360px，均为展开。',
  'settings.model': '模型',
  'settings.provider': '服务商',
  'settings.modelName': '决策模型',
  'settings.gruntModel': '便宜模型',
  'settings.modelHint.live': '已写入 ~/.camelia/config.json。重新打开桌面后，正在运行的引擎才会用上新模型。',
  'settings.modelHint.offline': '当前窗口离线，输入任务不会生成计划。先保存模型，再重新打开，桌面才会启动本机引擎。',
  'settings.apiKey': 'API 密钥',
  'settings.apiKey.configured': '已保存密钥',
  'settings.apiKey.missing': '尚未配置密钥',
  'settings.apiKey.local': '本地模型，不需要密钥。',
  'settings.apiKey.placeholder': '粘贴新密钥以替换已保存的密钥',
  'settings.modelSave': '保存并重新打开',
  'settings.modelSaved': '已保存，正在重新打开……',
  'settings.connection.live': '已连接引擎',
  'settings.connection.offline': '离线，未连接引擎',
  'settings.diagnostics': '诊断',
  'settings.openEngineLog': '打开引擎日志',
  'settings.restartDesktop': '重新打开桌面',
  'connection.panel': '连接',
  'connection.engineUrl': '引擎地址',
  'connection.session': '会话',
  'connection.scene': '场景',
  'connection.fixture': '演示模式（无实时引擎）',
  'connection.openLog': '打开引擎日志',
  'connection.restart': '重新打开桌面',
  'connection.copy': '复制',
  'connection.copied': '已复制',
  'connection.offlineBanner': '引擎已断开',
  'connection.offlineBanner.hint': '桌面正在等待本机引擎。若迟迟未恢复，可打开日志排查，或重新打开应用。',
  'connection.waiting': '正在等待引擎…',
  'settings.about': '关于',
  'settings.about.preface': 'API 密钥存于 ~/.camelia。本应用零遥测。',
  'settings.about.license': 'Apache-2.0',
  'settings.tokenRejected': '个令牌被拒绝',
  'approval.waiting': '等待你的审批',
  'approval.yourCall': '待审批',
  'approval.review': '审阅计划',
  'approval.once': '批准一次',
  'approval.session': '本次会话自动批准',
  'approval.reject': '拒绝',
  'step.add': '添加步骤',
  'step.edit': '编辑',
  'step.delete': '删除',
  'run.weightedProgress': '加权进度',
  'run.atStep': '当前步骤',
  'run.ctx': '上下文',
  'memory.title': '记忆',
  'memory.due': '待再激活',
  'memory.forgetLog': '遗忘日志',
  'memory.noForget': '暂无遗忘记录。',
  'intent.yourRequest': '用户提问',
  'intent.restatedGoal': '重述目标',
  'intent.assumptions': '假设',
  'intent.constraints': '约束',
  'intent.steered': '引导 →',
  'delivery.delivered': '已完成',
  'delivery.artifacts': '产物',
  'step.verify': '校验',
  'step.rollback': '回滚',
  'step.drafting': '正在制定计划',
  'step.stepLabel': '步骤',
  'step.status.pending': '待处理',
  'step.status.running': '运行中',
  'step.status.verifying': '校验中',
  'step.status.done': '完成',
  'step.status.failed': '失败',
  'step.status.skipped': '已跳过',
  'step.acceptance': '验收',
  'step.pass': '通过',
  'step.fail': '失败',
  'step.unknown': '未知',
  'lang.en': 'English',
  'lang.zh': '中文',
};

const DICTS: Record<LanguagePref, Record<StringKey, string>> = { en, zh };

export function t(lang: LanguagePref, key: StringKey): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}
