import fs from 'node:fs';

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('packages/ui/src/components/RightRail.tsx', (s) => {
  // Replace EventSection entirely with filterable version + add CheckpointSection
  if (!s.includes('data-checkpoint-section')) {
    const eventStart = s.indexOf('// event trail');
    const exportStart = s.indexOf('export function RightRail');
    if (eventStart < 0 || exportStart < 0) throw new Error('right rail anchors');
    const before = s.slice(0, eventStart);
    const after = s.slice(exportStart);
    const middle = `// checkpoints
// ---------------------------------------------------------------------------

function CheckpointSection({ task }: { task: TaskView }): ReactNode {
  const tr = useTr();
  const rollbackOk = true; // display-only timeline; restore goes through FailureCard / Conversation
  return (
    <section className="border-b border-line" data-checkpoint-section>
      <SectionHeader
        icon="undo"
        title={tr('checkpoints.title')}
        right={<span className="font-mono text-[10.5px] text-ink-3">{task.checkpoints.length}</span>}
      />
      <div className="space-y-1.5 px-3 pb-3">
        {task.checkpoints.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">{tr('checkpoints.empty')}</p>
        ) : (
          <ol className="space-y-1.5">
            {[...task.checkpoints].reverse().map((ck) => (
              <li key={ck.id} className="rounded-md border border-line bg-base/40 px-2 py-1.5" data-checkpoint={ck.id}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10.5px] text-accent-2">step {ck.stepIdx}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{ck.ctxSummary}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">{clock(ck.at)}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-ink-3">{ck.id}</p>
              </li>
            ))}
          </ol>
        )}
        {!rollbackOk ? null : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// event trail
// ---------------------------------------------------------------------------

function EventSection({ timeline, taskId }: { timeline: TimelineEntry[]; taskId?: string }): ReactNode {
  const tr = useTr();
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const shown = timeline
    .filter((entry) => {
      if (!filter.trim()) return true;
      const q = filter.trim().toLowerCase();
      return entry.type.toLowerCase().includes(q) || (entry.summary ?? '').toLowerCase().includes(q);
    })
    .slice(-80)
    .reverse();
  const recordHint = taskId ? \`~/.camelia/runs/\${taskId}/record.json\` : undefined;

  async function copyText(label: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section data-event-section>
      <SectionHeader
        icon="terminal"
        title={tr('events.title')}
        right={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-ink-3">{timeline.length}</span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-ink-3 hover:text-ink"
              aria-label={open ? tr('events.collapse') : tr('events.expand')}
            >
              <Icon name="chevron" size={11} className={\`transition-transform \${open ? 'rotate-90' : ''}\`} />
            </button>
          </span>
        }
      />
      {open ? (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex flex-wrap gap-1.5">
            <input
              aria-label={tr('events.filter')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={tr('events.filter')}
              className="min-w-0 flex-1 rounded-md border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none placeholder:text-ink-3"
            />
            {recordHint ? (
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-2 hover:border-accent/40 hover:text-accent"
                title={recordHint}
                onClick={() => void copyText('record', recordHint)}
              >
                {copied === 'record' ? tr('events.copied') : tr('events.copyRecordPath')}
              </button>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <p className="text-[11.5px] text-ink-3">{tr('events.quiet')}</p>
          ) : (
            <ul className="space-y-[3px]">
              {shown.map((entry, i) => {
                const payload = JSON.stringify({ type: entry.type, summary: entry.summary, at: entry.at, traceId: entry.traceId });
                return (
                  <li key={\`\${entry.at}-\${i}\`} className="flex items-baseline gap-2 font-mono text-[10.5px]">
                    <span className="shrink-0 text-ink-3/70">{clock(entry.at)}</span>
                    <span className="shrink-0 text-accent-2">{entry.type}</span>
                    {entry.summary ? <span className="min-w-0 flex-1 truncate text-ink-3">{entry.summary}</span> : <span className="flex-1" />}
                    <button
                      type="button"
                      className="shrink-0 text-ink-3 hover:text-accent"
                      title={tr('events.copyEvent')}
                      onClick={() => void copyText(\`\${entry.at}-\${i}\`, payload)}
                    >
                      {copied === \`\${entry.at}-\${i}\` ? tr('events.copied') : tr('events.copy')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

`;
    s = before + middle + after;
  }

  // Wire CheckpointSection + EventSection taskId in RightRail body
  if (!s.includes('<CheckpointSection')) {
    const old = `          <RunSection task={task} />
          <StepsSection task={task} />
          <ContextSection task={task} />
          <SubAgentsSection task={task} />`;
    const neu = `          <RunSection task={task} />
          <StepsSection task={task} />
          <CheckpointSection task={task} />
          <ContextSection task={task} />
          <SubAgentsSection task={task} />`;
    if (!s.includes(old)) throw new Error('sections wire needle');
    s = s.replace(old, neu);
  }
  if (s.includes('<EventSection timeline={timeline} />')) {
    s = s.replace(
      '<EventSection timeline={timeline} />',
      '<EventSection timeline={timeline} taskId={task?.id} />',
    );
  }
  return s;
});
console.log('RightRail ok');
