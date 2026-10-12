import fs from 'node:fs';
const path = 'packages/ui/src/transport/fixture.ts';
let s = fs.readFileSync(path, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');

const oldStart = s.indexOf("case 'submit_task':");
if (oldStart < 0) throw new Error('no submit_task');
// find the closing of this case: next "      }\n    }\n  }\n}" after push plan.ready pattern
const marker = "this.push('plan.ready', { plan: planFor(taskId, this.clock) });";
const mi = s.indexOf(marker, oldStart);
if (mi < 0) throw new Error('no planFor in submit');
// Replace from case to return; of this case
const caseEnd = s.indexOf('return;', mi) + 'return;'.length;
const oldBlock = s.slice(oldStart, caseEnd);
const newBlock = `case 'submit_task': {
        // Offline fixture: a typed intent must not replay the canned CLI demo plan.
        this.clock += 5;
        const taskId = \`tsk_\${(this.sent.length * 7919 + 104729).toString(16)}\`;
        const now = this.clock;
        const task = {
          id: taskId,
          sessionId: command.payload.sessionId,
          intentRaw: command.payload.intent,
          status: 'failed',
          phase: 'idle',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.push('task.created', { task: task as never });
        this.push('task.failed', {
          reason: 'engine unreachable — offline fixture cannot run a live model',
          attempts: 0,
          recoverable: false,
          suggestion: 'start camelia serve or open the desktop with a live engine',
        } as never);
        this.status('offline');
        this.answer(command.commandId, { ok: false, error: 'engine unreachable' });
        return;`;

// Need proper typing - look at what Domain events exist. Simpler approach matching earlier WIP:
const simpler = `case 'submit_task': {
        // Behavior evolution: a user-typed intent on the offline fixture used to
        // receive planFor() — the canned CLI --json demo — and every step
        // stayed pending. That plan is unrelated to the intent. Scripted scenes
        // still replay it; a real submit must say the engine is absent.
        this.clock += 5;
        const taskId = \`tsk_\${(this.sent.length * 7919 + 104729).toString(16)}\`;
        const now = this.clock;
        this.push('task.created', {
          task: {
            id: taskId,
            sessionId: command.payload.sessionId,
            intentRaw: command.payload.intent,
            status: 'received',
            phase: 'idle',
            progress: 0,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
        this.push('reliability.notice', {
          kind: 'engine',
          title: '未连接引擎',
          detail: '离线演示无法执行真实任务。请启动 camelia serve 或打开桌面实时引擎。',
          action: 'start-engine',
          at: now,
        } as never);
        this.status('offline');
        this.answer(command.commandId, { ok: false, error: 'engine unreachable' });
        return;`;

// Check what the test looks for: /未连接引擎/
s = s.slice(0, oldStart) + simpler + s.slice(caseEnd);
// Remove unused planFor import if no longer used
if (!s.includes('planFor(')) {
  s = s.replace(/,?\\s*planFor,?/g, (m) => (m.includes('planFor') ? '' : m));
  s = s.replace(/planFor,\\s*/g, '');
  s = s.replace(/,\\s*planFor/g, '');
}
fs.writeFileSync(path, crlf ? s.replace(/\\n/g, '\r\\n') : s);
console.log('fixture submit_task patched', s.includes('未连接引擎'));
