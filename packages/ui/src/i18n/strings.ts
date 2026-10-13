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
  | 'sessions.empty.hint'
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
  | 'sessions.history'
  | 'rail.label'
  | 'rail.sessions'
  | 'rail.search'
  | 'rail.new'
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
  | 'panel.noSession'
  | 'panel.noProvider'
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
  // The steering panel. It was hard-coded English while the rest of the shell was
  // translated; these four are the only copy it renders.
  | 'steer.title'
  | 'steer.placeholder'
  | 'steer.send'
  | 'steer.cancel'
  // Retained after the conversation's centre tab strip moved to mode tabs; still
  // referenced by plan-copy helpers and available for a future in-panel toggle.
  | 'plan.tab'
  | 'conversation.tab'
  | 'composer.placeholder'
  | 'composer.run'
  | 'composer.steerPlaceholder'
  | 'composer.chatPlaceholder'
  | 'composer.policy'
  | 'composer.policy.readonly'
  | 'composer.policy.ask'
  | 'composer.policy.full'
  | 'chat.empty'
| 'chat.running'
  | 'chat.askTitle'
  | 'composer.noActiveRun'
  | 'composer.enterToSend'
  | 'composer.shiftEnter'
  | 'composer.modelSettings'
  | 'composer.switchModel'
  | 'composer.singleModel'
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
  | 'settings.collapseSessions'
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
  | 'memory.title.session'
  | 'memory.scopeHint'
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
  | 'brand.placeholder'
  | 'account.defaultUser'
  | 'account.profile'
| 'account.menu.signedOut'
| 'account.menu.signedOutHint'
| 'account.menu.openSettings'
| 'account.menu.cancel'
| 'account.github.title'
| 'account.github.hint'
| 'account.github.login'
| 'account.github.logout'
| 'account.github.openTokenPage'
| 'account.github.token'
| 'account.github.tokenHint'
| 'account.github.signedIn'
| 'account.github.signedOut'
| 'account.github.error.empty'
| 'account.github.error.unauthorized'
| 'account.github.error.offline'
| 'account.github.error.malformed'
| 'account.github.error.generic'
  | 'avatar.user'
  | 'avatar.agent'
  | 'account.menu.feedback'
  | 'feedback.title'
  | 'feedback.type'
  | 'feedback.type.bug'
  | 'feedback.type.idea'
  | 'feedback.body'
  | 'feedback.repro'
  | 'feedback.submit'
  | 'feedback.needLogin'
  | 'feedback.success'
  | 'feedback.error'
  | 'feedback.repo'
  | 'composer.effort'
  | 'composer.effort.max'
  | 'composer.effort.high'
  | 'composer.effort.low'
  | 'settings.presets.test'
  | 'settings.presets.testOk'
  | 'settings.presets.testFail'
  | 'settings.presets.modelsFound'
  | 'settings.presets.manualModels'
  | 'connection.reconnect'
  | 'connection.liveHint'
  | 'connection.offlineHonest'
  // The bottom strip. Every key is a tooltip or an accessible name for a *readout* —
  // there are no actions here, so none of these strings is a verb the user can press.
  // The run panels that moved out of the removed right rail into the mode header.
  | 'panels.label'
  | 'panels.close'
  | 'panels.needsTask'
  | 'panels.open'
  | 'statusBar.label'
  | 'statusBar.noWorkspace'
  | 'statusBar.stepsHint'
  | 'statusBar.contextHint'
  | 'statusBar.elapsedHint'
  | 'settings.section.account'
| 'settings.section.connections'
  | 'settings.section.appearance'
  | 'settings.section.engine'
  | 'settings.section.about'
  | 'settings.presets.add'
  | 'settings.presets.edit'
  | 'settings.presets.enable'
  | 'settings.presets.delete'
  | 'settings.presets.active'
  | 'settings.presets.name'
  | 'settings.presets.baseUrl'
  | 'settings.presets.templates'
  | 'settings.presets.todo'
  | 'settings.presets.hint'
  | 'settings.presets.id'
  | 'settings.presets.saveUse'
  | 'settings.presets.saveOnly'
  | 'settings.presets.saved'
  | 'settings.presets.savedActive'
  | 'settings.presets.deleted'
  | 'settings.presets.restartHint'
  | 'settings.presets.restartNow'
  | 'settings.presets.cannotDeleteActive'
  | 'settings.presets.builtinLocked'
  | 'settings.presets.nameRequired'
  | 'settings.presets.modelRequired'
  | 'settings.presets.urlRequired'
  | 'settings.engine.browserHint'
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
  | 'lang.zh'
  // ---- Workbench modes (wireframe v3) --------------------------------------
  | 'mode.work'
| 'mode.chat'
  | 'mode.plan'
  | 'mode.math'
  | 'mode.term'
  | 'mode.eval'
  | 'mode.teach'
  | 'mode.more'
  | 'mode.more.title'
  | 'mode.work.desc'
| 'mode.chat.desc'
  | 'mode.plan.desc'
  | 'mode.math.desc'
  | 'mode.term.desc'
  | 'mode.term.stub'
  | 'mode.math.unavailable'
  | 'mode.switch.busy'
  | 'mode.elsewhere'
  | 'mode.elsewhere.cta'
  | 'mode.elsewhere.dismiss'
  // ---- Progress (single derivation, two renderers) --------------------------
  | 'progress.plan.draft'
  | 'progress.plan.executing'
  | 'progress.plan.done'
  | 'progress.plan.rejected'
  | 'progress.math.modeling'
  | 'progress.math.solving'
  | 'progress.math.verifying'
  | 'progress.math.reporting'
  // ---- Math workspace ------------------------------------------------------
  | 'math.demo.badge'
  | 'math.demo.load'
  | 'math.demo.reload'
  | 'math.demo.clear'
  | 'math.demo.explain'
  | 'math.assumptions'
  | 'math.assumptions.confirmed'
  | 'math.assumptions.pending'
  | 'math.variables'
  | 'math.variables.symbol'
  | 'math.variables.name'
  | 'math.variables.unit'
  | 'math.variables.value'
  | 'math.variables.source'
  | 'math.source.assumption'
  | 'math.source.fitted'
  | 'math.source.user'
  | 'math.source.derived'
  | 'math.equations'
  | 'math.equations.edit'
  | 'math.equations.readonly'
  | 'math.solver'
  | 'math.solver.idle'
  | 'math.solver.running'
  | 'math.solver.converged'
  | 'math.solver.failed'
  | 'math.solver.log'
  | 'math.results'
  | 'math.results.export'
  | 'math.results.copy'
  | 'math.results.copied'
  | 'math.results.empty'
  | 'math.stage.pipeline'
  | 'math.hint.modeling'
  | 'math.hint.solving'
  | 'math.hint.verifying'
  | 'math.hint.reporting'
  | 'math.stage.run'
  | 'math.stage.stop'
  | 'math.unavailable.title'
  | 'math.unavailable.body'
  | 'math.empty.title'
  | 'math.empty.body'
  | 'math.composer.placeholder'
  // ---- Settings: modes -----------------------------------------------------
  | 'settings.modes.title'
  | 'settings.modes.hint'
  | 'settings.modes.default'
  | 'settings.appearance.avatars'
  | 'settings.appearance.avatars.hint'
  | 'settings.appearance.userAvatar'
  | 'settings.appearance.userAvatar.mascot'
  | 'settings.appearance.userAvatar.letter'
  | 'settings.appearance.userAvatar.hint'
  | 'settings.appearance.displayName'
  | 'settings.appearance.displayName.hint'
  | 'settings.topbar.alwaysOnTask'
  | 'settings.topbar.alwaysOnTask.hint'
  // ---- Brand (transitional placeholder) -------------------------------------
  | 'brand.transition'
  | 'brand.placeholder.hint'
  // ---- Right rail tabs (labelled via i18n rather than hard-coded zh) ---------
  | 'panel.memory'
  | 'panel.artifacts'
  | 'panel.events'
  | 'panel.run'
  | 'panel.context'
  | 'panel.sub'
  | 'panel.model'
  | 'panel.artifacts.hint'
  | 'panel.model.hint'
  | 'activity.running';

const en: Record<StringKey, string> = {
  'app.tagline': 'Warm intelligence, sharp code.',
  'sessions.title': 'Sessions',
  'sessions.empty': 'No sessions in this workspace yet.',
  'sessions.empty.hint': 'Type in the composer to start one.',
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
  'sessions.history': 'Chat history',
  'rail.label': 'Left navigation',
  'rail.sessions': 'Chats',
  'rail.search': 'Search chats',
  'rail.new': 'New chat',
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
  'panel.noSession': 'No session',
  'panel.noProvider': 'No provider',
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
  'steer.title': 'Steer the run — the goal is re-anchored, prior work is kept.',
  'steer.placeholder': 'e.g. also update the README, and skip the e2e suite',
  'steer.send': 'Send',
  'steer.cancel': 'Cancel',
  'plan.tab': 'Plan',
  'conversation.tab': 'Conversation',
  'composer.placeholder': 'Describe a task. Camelia plans, executes, verifies and shows its work…',
  'composer.run': 'Run',
  'composer.steerPlaceholder': 'Steer the run — the goal is re-anchored, prior work kept…',
  'composer.chatPlaceholder': 'Ask anything — direct replies, workspace access per the permission you pick…',
  'composer.policy': 'Chat permission mode',
  'composer.policy.readonly': 'Read-only sandbox',
  'composer.policy.ask': 'Ask before writes',
  'composer.policy.full': 'Full access',
  'chat.running': 'Replying…',
  'chat.empty': 'Conversation mode — the model answers directly. No plan, no task machinery.',
  'chat.askTitle': 'Camelia needs your choice',
  'composer.noActiveRun': 'no active run',
  'composer.enterToSend': 'Enter to send',
  'composer.shiftEnter': 'Shift + Enter for a new line',
  'composer.modelSettings': 'Active model — open settings',
  'composer.switchModel': 'Switch model',
  'composer.singleModel': 'This provider advertises one model — open settings to add more',
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
  'settings.collapseSessions': 'Start with sessions collapsed',
  'settings.restoreLayout': 'Restore default layout',
  'settings.layoutDefaults': 'Defaults are 260px left expanded, 360px right collapsed.',
  'settings.model': 'Model',
  'settings.provider': 'Provider',
  'settings.modelName': 'Decision model',
  'settings.gruntModel': 'Cheap model',
  'settings.modelHint.live': 'Saved to ~/.camelia/config.json. Restart the desktop when you want the running engine to pick it up.',
  'settings.modelHint.offline': 'This window is offline, so a typed task cannot be planned. Save a model, then reopen so the desktop can start the local engine.',
  'settings.apiKey': 'API key',
  'settings.apiKey.configured': 'Key saved',
  'settings.apiKey.missing': 'No key yet',
  'settings.apiKey.local': 'Local model. No key required.',
  'settings.apiKey.placeholder': 'Paste a key to replace the saved one',
  'settings.modelSave': 'Save',
  'settings.modelSaved': 'Saved.',
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
  'memory.title.session': 'TASK MEMORY',
  'memory.scopeHint': 'Only what this task learned. Cross-session memories live in Settings.',
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
  'brand.placeholder': 'Name & mascot TBD',
  'account.defaultUser': 'Local user',
  // The rail's account mark. Not "account & settings": that entry was split in two.
  'account.profile': 'Account',
  'account.menu.signedOut': 'Not signed in',
  'account.menu.signedOutHint': 'Sign in with GitHub to use your avatar',
  'account.menu.openSettings': 'Account settings…',
  'account.menu.cancel': 'Cancel',
  'avatar.user': 'You',
  'avatar.agent': 'Camelia',
  'account.menu.feedback': 'Send feedback…',
  'feedback.title': 'Feedback',
  'feedback.type': 'Type',
  'feedback.type.bug': 'Bug',
  'feedback.type.idea': 'Idea',
  'feedback.body': 'What happened / what you want',
  'feedback.repro': 'Steps to reproduce (optional)',
  'feedback.submit': 'Submit to GitHub',
  'feedback.needLogin': 'Sign in with GitHub to send feedback',
  'feedback.success': 'Opened issue',
  'feedback.error': 'Could not create issue',
  'feedback.repo': 'Feedback goes to',
  'composer.effort': 'Effort',
  'composer.effort.max': 'Max',
  'composer.effort.high': 'High',
  'composer.effort.low': 'Low',
  'settings.presets.test': 'Test connection',
  'settings.presets.testOk': 'Connected',
  'settings.presets.testFail': 'Connection failed',
  'settings.presets.modelsFound': 'models found',
  'settings.presets.manualModels': 'Could not list models — enter model IDs manually',
  'connection.reconnect': 'Reconnect',
  'connection.liveHint': 'Engine stream is live',
  'connection.offlineHonest': 'Offline — not pretending to be live',
  'panels.label': 'Run panels',
  'panels.close': 'Close panel',
  'panels.needsTask': 'no task yet',
  'panels.open': 'Open run panel',
  'statusBar.label': 'Status',
  'statusBar.noWorkspace': 'No workspace',
  'statusBar.stepsHint': '{done} of {total} steps done',
  'statusBar.contextHint': 'Context: {used} of {window} tokens used',
  'statusBar.elapsedHint': 'Time since this task started',
  'settings.section.account': 'Account',
  'account.github.title': 'GitHub',
  'account.github.hint': 'Sign in so your messages use your GitHub avatar. The token stays on this device and never reaches the engine.',
  'account.github.login': 'Sign in with GitHub',
  'account.github.logout': 'Sign out',
  'account.github.openTokenPage': 'Open GitHub token page',
  'account.github.token': 'Personal access token',
  'account.github.tokenHint': 'Create a classic token with read:user, paste it here. Offline or revoked tokens show an honest error.',
  'account.github.signedIn': 'Signed in.',
  'account.github.signedOut': 'Signed out.',
  'account.github.error.empty': 'Paste a token first.',
  'account.github.error.unauthorized': 'GitHub rejected the token (401/403).',
  'account.github.error.offline': 'Could not reach api.github.com — check the network.',
  'account.github.error.malformed': 'GitHub returned an unexpected profile payload.',
  'account.github.error.generic': 'GitHub sign-in failed.',
  'settings.section.connections': 'Connection presets',
  'settings.section.appearance': 'Language & appearance',
  'settings.section.engine': 'Engine & logs',
  'settings.section.about': 'About',
  'settings.presets.add': 'Add preset',
  'settings.presets.edit': 'Edit',
  'settings.presets.enable': 'Use',
  'settings.presets.delete': 'Delete',
  'settings.presets.active': 'In use',
  'settings.presets.name': 'Preset name',
  'settings.presets.baseUrl': 'Base URL',
  'settings.presets.templates': 'Templates',
  'settings.presets.todo': 'Connection presets save to ~/.camelia/config.json providers[].',
  'settings.presets.hint': 'Cards map to providers[] in ~/.camelia/config.json. Keys stay in keys.json. Saving does not force a restart.',
  'settings.presets.id': 'Preset id',
  'settings.presets.saveUse': 'Save and use',
  'settings.presets.saveOnly': 'Save',
  'settings.presets.saved': 'Preset saved.',
  'settings.presets.savedActive': 'Preset saved and set as preferred.',
  'settings.presets.deleted': 'Preset deleted.',
  'settings.presets.restartHint': 'Config updated. Restart the desktop for the engine to load the new provider.',
  'settings.presets.restartNow': 'Restart now',
  'settings.presets.cannotDeleteActive': 'Switch to another preset before deleting the one in use.',
  'settings.presets.builtinLocked': 'Built-in presets stay in the list; clear a custom override by editing instead.',
  'settings.presets.nameRequired': 'Preset name is required.',
  'settings.presets.modelRequired': 'Model is required.',
  'settings.presets.urlRequired': 'Base URL is required.',
  'settings.engine.browserHint': 'Engine log and restart are available in the desktop app.',
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
  'mode.work': 'Work',
  'mode.chat': 'Chat',
  'mode.plan': 'Plan',
  'mode.math': 'Math',
  'mode.term': 'Term',
  'mode.eval': 'Eval',
  'mode.teach': 'Teach',
  'mode.more': 'More modes',
  'mode.more.title': 'Coming soon',
  'mode.work.desc': 'Daily work: chat with inline task cards when a run exists.',
  'mode.chat.desc': 'Describe a task — the agent plans, runs and verifies it.',
  'mode.plan.desc': 'Review and edit the plan before any step runs.',
  'mode.math.desc': 'Mathematical modeling: assumptions, variables, equations, solver.',
  'mode.term.desc': 'Team mode — multi-agent collaboration (UI MVP).',
  'mode.term.stub': 'Term (team mode) is a UI stub. Sessions are filtered and created; orchestration lands later.',
  'mode.math.unavailable': 'The engine exposes no math commands yet — this workspace runs on a labelled demo.',
  'mode.switch.busy': 'A task is still running. Switching modes keeps it visible.',
  'mode.elsewhere': 'A task is running in {mode} mode.',
  'mode.elsewhere.cta': 'View',
  'mode.elsewhere.dismiss': 'Dismiss',
  'progress.plan.draft': 'Drafting',
  'progress.plan.executing': 'Executing',
  'progress.plan.done': 'Complete',
  'progress.plan.rejected': 'Rejected',
  'progress.math.modeling': 'Modeling',
  'progress.math.solving': 'Solving',
  'progress.math.verifying': 'Verifying',
  'progress.math.reporting': 'Reporting',
  'math.demo.badge': 'DEMO',
  'math.demo.load': 'Load demo problem',
  'math.demo.reload': 'Replay demo',
  'math.demo.clear': 'Exit demo',
  'math.demo.explain': 'Illustrative data only — no solver is connected. The demo labels every value it shows.',
  'math.assumptions': 'Assumptions',
  'math.assumptions.confirmed': 'Confirmed',
  'math.assumptions.pending': 'Open',
  'math.variables': 'Variables',
  'math.variables.symbol': 'Symbol',
  'math.variables.name': 'Name',
  'math.variables.unit': 'Unit',
  'math.variables.value': 'Value',
  'math.variables.source': 'Source',
  'math.source.assumption': 'assumption',
  'math.source.fitted': 'fitted',
  'math.source.user': 'given',
  'math.source.derived': 'derived',
  'math.equations': 'Equations',
  'math.equations.edit': 'Edit',
  'math.equations.readonly': 'Read-only for now — editing needs a backend model store.',
  'math.solver': 'Solver',
  'math.solver.idle': 'Idle',
  'math.solver.running': 'Running',
  'math.solver.converged': 'Converged',
  'math.solver.failed': 'Failed',
  'math.solver.log': 'Solver output',
  'math.results': 'Results',
  'math.results.export': 'Export report',
  'math.results.copy': 'Copy',
  'math.results.copied': 'Copied',
  'math.results.empty': 'No results yet.',
  'math.stage.pipeline': 'Stage {index}/4',
  'math.hint.modeling': 'Restate the problem, fix assumptions, define symbols, build the model.',
  'math.hint.solving': 'Run the solver (math.exec) — never compute by hand.',
  'math.hint.verifying': 'Check the solution, then test sensitivity.',
  'math.hint.reporting': 'Write up the model, results and caveats.',
  'math.stage.run': 'Run stage',
  'math.stage.stop': 'Stop',
  'math.unavailable.title': 'Math mode is not wired to the engine yet',
  'math.unavailable.body': 'The math.exec tool and the modeling preset exist in the harness, but the engine exposes no math commands. Everything below is demonstration data.',
  'math.empty.title': 'No modeling session',
  'math.empty.body': 'Load the demo problem to see how the four stages behave.',
  'math.composer.placeholder': 'Describe the modeling problem — e.g. build a SIR model…',
  'settings.modes.title': 'Modes',
  'settings.modes.hint': 'Which mode a new window opens in. Switching never stops a running task.',
  'settings.modes.default': 'Default mode',
  'settings.appearance.avatars': 'Message avatars',
  'settings.appearance.avatars.hint': 'Round avatars beside each message, in the WeChat style.',
  'settings.appearance.userAvatar': 'Your avatar',
  'settings.appearance.userAvatar.mascot': 'Camelia mark',
  'settings.appearance.userAvatar.letter': '「你」 letter',
  'settings.appearance.userAvatar.hint': 'Used for your own messages and the rail profile until you pick something else.',
  'settings.appearance.displayName': 'Display name',
  'settings.appearance.displayName.hint': 'Shown when you hover the avatar at the foot of the icon rail. Leave empty to show only the action.',
  'settings.topbar.alwaysOnTask': 'Keep the top bar visible while a task runs',
  'settings.topbar.alwaysOnTask.hint': 'The top bar carries the progress rail, so it stays put while work is in flight even if you set it to auto-hide.',
  'brand.transition': 'Camelia',
  'brand.placeholder.hint': 'Final name and mascot pending product decision.',
  'panel.memory': 'Memory',
  'panel.artifacts': 'Artifacts',
  'panel.events': 'Events',
  'panel.run': 'Run',
  'panel.context': 'Context',
  'panel.sub': 'Sub-agents',
  'panel.model': 'Model',
  'panel.artifacts.hint': 'Deliverables from the current run — files, diffs, stdout.',
  'panel.model.hint': 'Read-only model view. Editing lives in the math workspace.',
  'activity.running': 'Running',
};


const zh: Record<StringKey, string> = {
  'app.tagline': '温暖的智能，锋利的代码。',
  'sessions.title': '会话',
  'sessions.empty': '此工作区还没有会话。',
  'sessions.empty.hint': '在输入框里描述任务即可开始。',
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
  'sessions.history': '聊天记录',
  'rail.label': '左侧导航',
  'rail.sessions': '会话',
  'rail.search': '搜索会话',
  'rail.new': '新建会话',
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
  'panel.noSession': '无会话',
  'panel.noProvider': '无模型',
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
  'steer.title': '引导本次运行 —— 目标会重新锚定，已完成的工作保留。',
  'steer.placeholder': '例如：顺便更新 README，跳过 e2e 测试',
  'steer.send': '发送',
  'steer.cancel': '取消',
  'plan.tab': '计划',
  'conversation.tab': '对话',
  'composer.placeholder': '描述一个任务。Camelia 会规划、执行、校验并展示全过程……',
  'composer.run': '运行',
  'composer.steerPlaceholder': '引导本次运行——目标重新锚定，已有工作保留……',
  'composer.chatPlaceholder': '随便聊——直接回答，按所选权限使用工作区……',
  'composer.policy': '对话权限模式',
  'composer.policy.readonly': '只读沙箱',
  'composer.policy.ask': '写入前询问',
  'composer.policy.full': '完全放行',
  'chat.running': '回复中…',
  'chat.empty': '对话模式——模型直接回答，不建任务、不做计划。',
  'chat.askTitle': 'Camelia 需要你的选择',
  'composer.noActiveRun': '无运行中任务',
  'composer.enterToSend': '回车发送',
  'composer.shiftEnter': 'Shift+回车换行',
  'composer.modelSettings': '当前模型——打开设置',
  'composer.switchModel': '切换模型',
  'composer.singleModel': '该服务商只对外提供一个模型——可在设置里添加更多',
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
  'settings.collapseSessions': '启动时收起会话栏',
  'settings.restoreLayout': '恢复默认布局',
  'settings.layoutDefaults': '默认左侧 260px 展开，右侧 360px 收起。',
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
  'settings.modelSave': '保存',
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
  'memory.title.session': '本任务记忆',
  'memory.scopeHint': '只显示本任务学到的记忆；跨会话的长期记忆在设置里。',
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
  'brand.placeholder': '待定：名字 / 吉祥物',
  'account.defaultUser': '本地用户',
  'account.profile': '账户',
  'account.menu.signedOut': '未登录',
  'account.menu.signedOutHint': '用 GitHub 登录后消息会使用你的头像',
  'account.menu.openSettings': '账户设置…',
  'account.menu.cancel': '取消',
  'avatar.user': '你',
  'avatar.agent': '山茶',
  'account.menu.feedback': '反馈…',
  'feedback.title': '反馈',
  'feedback.type': '类型',
  'feedback.type.bug': '缺陷',
  'feedback.type.idea': '建议',
  'feedback.body': '发生了什么 / 你想改什么',
  'feedback.repro': '复现步骤（可选）',
  'feedback.submit': '提交到 GitHub',
  'feedback.needLogin': '请先用 GitHub 登录再反馈',
  'feedback.success': '已创建 Issue',
  'feedback.error': '无法创建 Issue',
  'feedback.repo': '反馈仓库',
  'composer.effort': '力度',
  'composer.effort.max': 'Max',
  'composer.effort.high': 'High',
  'composer.effort.low': 'Low',
  'settings.presets.test': '测试连通性',
  'settings.presets.testOk': '已连通',
  'settings.presets.testFail': '连通失败',
  'settings.presets.modelsFound': '个模型',
  'settings.presets.manualModels': '无法拉取模型列表 — 请手动填写模型 ID',
  'connection.reconnect': '重新连接',
  'connection.liveHint': '引擎事件流在线',
  'connection.offlineHonest': '离线 — 不会假装在线',
  'panels.label': '运行面板',
  'panels.close': '关闭面板',
  'panels.needsTask': '还没有任务',
  'panels.open': '打开运行面板',
  'statusBar.label': '状态栏',
  'statusBar.noWorkspace': '未设置工作区',
  'statusBar.stepsHint': '{total} 步中已完成 {done} 步',
  'statusBar.contextHint': '上下文：已用 {used} / {window} tokens',
  'statusBar.elapsedHint': '本任务开始至今',
  'settings.section.account': '账户',
  'account.github.title': 'GitHub',
  'account.github.hint': '登录后，你的消息会使用 GitHub 头像。令牌只留在本机，不会发给引擎。',
  'account.github.login': '用 GitHub 登录',
  'account.github.logout': '退出登录',
  'account.github.openTokenPage': '打开 GitHub 令牌页',
  'account.github.token': 'Personal Access Token',
  'account.github.tokenHint': '创建带 read:user 权限的经典令牌并粘贴。网络不通或令牌无效会如实报错。',
  'account.github.signedIn': '已登录。',
  'account.github.signedOut': '已退出。',
  'account.github.error.empty': '请先粘贴令牌。',
  'account.github.error.unauthorized': 'GitHub 拒绝了该令牌（401/403）。',
  'account.github.error.offline': '无法连接 api.github.com，请检查网络。',
  'account.github.error.malformed': 'GitHub 返回了异常的资料数据。',
  'account.github.error.generic': 'GitHub 登录失败。',
  'settings.section.connections': '连接预设',
  'settings.section.appearance': '语言与外观',
  'settings.section.engine': '引擎与日志',
  'settings.section.about': '关于',
  'settings.presets.add': '添加预设',
  'settings.presets.edit': '编辑',
  'settings.presets.enable': '启用',
  'settings.presets.delete': '删除',
  'settings.presets.active': '当前使用',
  'settings.presets.name': '预设名称',
  'settings.presets.baseUrl': 'Base URL',
  'settings.presets.templates': '模板',
  'settings.presets.todo': '连接预设会写入 ~/.camelia/config.json 的 providers[]。',
  'settings.presets.hint': '卡片对应 ~/.camelia/config.json 的 providers[]，密钥在 keys.json。保存后不会强制重启。',
  'settings.presets.id': '预设 ID',
  'settings.presets.saveUse': '保存并启用',
  'settings.presets.saveOnly': '仅保存',
  'settings.presets.saved': '预设已保存。',
  'settings.presets.savedActive': '预设已保存并设为当前使用。',
  'settings.presets.deleted': '预设已删除。',
  'settings.presets.restartHint': '配置已更新。重启桌面后，引擎才会加载新的服务商。',
  'settings.presets.restartNow': '立即重启',
  'settings.presets.cannotDeleteActive': '请先切换到其他预设，再删除当前使用的预设。',
  'settings.presets.builtinLocked': '内置预设会留在列表中；如需覆盖请直接编辑。',
  'settings.presets.nameRequired': '请填写预设名称。',
  'settings.presets.modelRequired': '请填写模型。',
  'settings.presets.urlRequired': '请填写 Base URL。',
  'settings.engine.browserHint': '引擎日志与重启仅在桌面端可用。',
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
  'mode.work': 'Work',
  'mode.chat': '对话',
  'mode.plan': '计划模式',
  'mode.math': 'Math',
  'mode.term': 'Term',
  'mode.eval': '评测',
  'mode.teach': '教学',
  'mode.more': '更多模式',
  'mode.more.title': '即将推出',
  'mode.work.desc': '日常：直答聊天，有任务时内联运行卡。',
  'mode.chat.desc': '描述一个任务，代理会规划、执行并校验。',
  'mode.plan.desc': '在任何步骤执行前审阅并编辑计划。',
  'mode.math.desc': '数学建模：假设、变量、方程与求解。',
  'mode.term.desc': '团队模式 — 多智能体协作（界面 MVP）。',
  'mode.term.stub': 'Term（团队模式）目前是界面占位：可切换、可建会话；编排后端稍后接入。',
  'mode.math.unavailable': '引擎尚未提供数模命令——此工作区运行在明确标注的演示数据上。',
  'mode.switch.busy': '仍有任务在运行。切换模式不会让它消失。',
  'mode.elsewhere': '{mode}模式有一个任务正在运行。',
  'mode.elsewhere.cta': '查看',
  'mode.elsewhere.dismiss': '忽略',
  'progress.plan.draft': '起草中',
  'progress.plan.executing': '执行中',
  'progress.plan.done': '已完成',
  'progress.plan.rejected': '已拒绝',
  'progress.math.modeling': '建模',
  'progress.math.solving': '求解',
  'progress.math.verifying': '校验',
  'progress.math.reporting': '报告',
  'math.demo.badge': '演示',
  'math.demo.load': '加载演示课题',
  'math.demo.reload': '重播演示',
  'math.demo.clear': '退出演示',
  'math.demo.explain': '仅为示意数据——未连接任何求解器。演示会标注它展示的每一个数值。',
  'math.assumptions': '假设',
  'math.assumptions.confirmed': '已确认',
  'math.assumptions.pending': '待定',
  'math.variables': '变量',
  'math.variables.symbol': '符号',
  'math.variables.name': '名称',
  'math.variables.unit': '单位',
  'math.variables.value': '取值',
  'math.variables.source': '来源',
  'math.source.assumption': '假设',
  'math.source.fitted': '拟合',
  'math.source.user': '给定',
  'math.source.derived': '推导',
  'math.equations': '方程',
  'math.equations.edit': '编辑',
  'math.equations.readonly': '暂为只读——编辑需要后端模型存储。',
  'math.solver': '求解状态',
  'math.solver.idle': '空闲',
  'math.solver.running': '求解中',
  'math.solver.converged': '已收敛',
  'math.solver.failed': '失败',
  'math.solver.log': '求解输出',
  'math.results': '结果',
  'math.results.export': '导出报告',
  'math.results.copy': '复制',
  'math.results.copied': '已复制',
  'math.results.empty': '暂无结果。',
  'math.stage.pipeline': '第 {index}/4 阶段',
  'math.hint.modeling': '重述问题、确定假设、定义符号、建立模型。',
  'math.hint.solving': '调用求解器（math.exec）——不要手算。',
  'math.hint.verifying': '校验解的正确性，再做灵敏度分析。',
  'math.hint.reporting': '撰写模型、结果与注意事项。',
  'math.stage.run': '运行本阶段',
  'math.stage.stop': '停止',
  'math.unavailable.title': '数模模式尚未接入引擎',
  'math.unavailable.body': 'harness 里已有 math.exec 工具与建模预设，但引擎尚未暴露任何数模命令。下面所有内容都是演示数据。',
  'math.empty.title': '暂无建模会话',
  'math.empty.body': '加载演示课题即可查看四个阶段的表现。',
  'math.composer.placeholder': '描述建模题目——例如「建立 SIR 模型」…',
  'settings.modes.title': '模式',
  'settings.modes.hint': '新窗口默认打开哪个模式。切换不会中断正在运行的任务。',
  'settings.modes.default': '默认模式',
  'settings.appearance.avatars': '消息头像',
  'settings.appearance.avatars.hint': '每条消息旁的圆形头像，微信风格。',
  'settings.appearance.userAvatar': '用户头像',
  'settings.appearance.userAvatar.mascot': 'Camelia 图标',
  'settings.appearance.userAvatar.letter': '「你」字',
  'settings.appearance.userAvatar.hint': '没设置头像时，你自己的消息和左下角都用它。',
  'settings.appearance.displayName': '用户名',
  'settings.appearance.displayName.hint': '鼠标悬停最左窄栏底部的头像时显示。留空则只显示功能名。',
  'settings.topbar.alwaysOnTask': '任务运行期间保持顶栏常显',
  'settings.topbar.alwaysOnTask.hint': '顶栏承载进度条，因此即使设为自动隐藏，任务运行期间也会保持常显。',
  'brand.transition': 'Camelia',
  'brand.placeholder.hint': '最终名称与吉祥物待产品决策。',
  'panel.memory': '记忆',
  'panel.artifacts': '产物',
  'panel.events': '事件',
  'panel.run': '运行',
  'panel.context': '上下文',
  'panel.sub': '子代理',
  'panel.model': '模型',
  'panel.artifacts.hint': '当前运行的产物 — 文件、diff、stdout。',
  'panel.model.hint': '模型只读视图。编辑在主工作区进行。',
  'activity.running': '运行中',
};

const DICTS: Record<LanguagePref, Record<StringKey, string>> = { en, zh };

/** Values interpolated into a `{token}` slot of an i18n string. */
export type StringParams = Record<string, string | number>;

/**
 * Look up a string, optionally interpolating `{token}` slots.
 *
 * Interpolation lives here rather than at call sites so a translation can reorder its
 * placeholders (a real need for zh) without touching the component that renders it.
 */
export function t(lang: LanguagePref, key: StringKey, params?: StringParams): string {
  const raw = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
