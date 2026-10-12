import fs from 'node:fs';
const path = 'packages/ui/src/transport/fixture.ts';
let s = fs.readFileSync(path, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');

const bad = `case 'submit_task': {
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
        return;
      }`;

const good = `case 'submit_task': {
        // Offline fixture: do not replay the canned CLI demo for a typed intent.
        this.clock += 5;
        const taskId = \`tsk_\${(this.sent.length * 7919 + 104729).toString(16)}\`;
        const now = this.clock;
        const task: Task = {
          id: taskId,
          sessionId: command.payload.sessionId,
          intentRaw: command.payload.intent,
          status: 'received',
          phase: 'idle',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.push('task.received', { task });
        this.push('task.failed', {
          reason: '未连接引擎 — offline fixture cannot run a live model',
          recoverable: false,
        });
        this.status('offline');
        this.answer(command.commandId, { ok: false, error: 'engine unreachable' });
        return;
      }`;

if (!s.includes("this.push('reliability.notice'")) throw new Error('expected bad block');
s = s.replace(bad, good);
// keep Task import; drop planFor if unused
if (!s.includes('planFor(')) {
  s = s.replace(/\n\s*planFor,\n/, '\n');
  s = s.replace(/planFor,\s*/g, '');
}
fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('fixed', s.includes('task.received'), !s.includes('planFor('));
