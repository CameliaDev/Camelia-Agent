import fs from 'node:fs';

function patchTypes() {
  const path = 'packages/ui/src/transport/types.ts';
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes('onCommandRejected')) {
    console.log('types ok');
    return;
  }
  const needle = 'onError?: (message: string) => void;';
  const i = s.indexOf(needle);
  if (i < 0) throw new Error('types needle missing');
  const insert =
    needle +
    `
  /**
   * A command was rejected by the engine (\`CommandAck.ok === false\`).
   * Distinct from \`onError\`: rejected intents (rollback stub, etc.) must not
   * look like a dead transport. Pending \`query()\` callers are rejected too.
   */
  onCommandRejected?: (commandId: string, type: string, error: string) => void;`;
  s = s.slice(0, i) + insert + s.slice(i + needle.length);
  fs.writeFileSync(path, s);
  console.log('types patched');
}

function patchSse() {
  const path = 'packages/ui/src/transport/sse.ts';
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes('onCommandRejected')) {
    console.log('sse ok');
    return;
  }
  const old = 'this.handlers?.onError?.(ack.error ?? `command ${command.type} was rejected`);';
  const neu =
    'const error = ack.error ?? `command ${command.type} was rejected`;\n          this.handlers?.onCommandRejected?.(command.commandId, command.type, error);';
  if (!s.includes(old)) throw new Error('sse needle missing');
  s = s.replace(old, neu);
  fs.writeFileSync(path, s);
  console.log('sse patched');
}

function patchStore() {
  const path = 'packages/ui/src/state/store.ts';
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes('lastCommandError')) {
    console.log('store ok');
    return;
  }

  // Insert field after transportError
  const fieldNeedle = 'transportError?: string;';
  const fi = s.indexOf(fieldNeedle);
  if (fi < 0) throw new Error('store field needle missing');
  // store.ts has blank lines between every line — detect style
  const blankStyle = s.includes('transportError?: string;\n\n');
  const sep = blankStyle ? '\n\n' : '\n';
  const fieldInsert =
    fieldNeedle +
    sep +
    '  /** Last rejected command (engine said no). Not a dead transport. */' +
    sep +
    '  lastCommandError?: { type: string; error: string; at: number };' +
    sep +
    '  clearCommandError: () => void;';
  s = s.slice(0, fi) + fieldInsert + s.slice(fi + fieldNeedle.length);

  // Insert clearCommandError + wire in create body after restoreDefaultLayout block ends is hard;
  // instead patch the setLocalPrefs / after settingsOpen init
  const initNeedle = blankStyle
    ? "settingsOpen: false,\n\n    ...(bootTheme"
    : "settingsOpen: false,\n    ...(bootTheme";
  if (!s.includes(initNeedle.split('\n')[0])) {
    // try without blank
  }
  // Find "settingsOpen: false," and add lastCommandError undefined + clearCommandError after setSettingsOpen
  const setSettings = blankStyle
    ? 'setSettingsOpen: (open) => set({ settingsOpen: open }),'
    : 'setSettingsOpen: (open) => set({ settingsOpen: open }),';
  const si = s.indexOf(setSettings);
  if (si < 0) throw new Error('setSettingsOpen needle missing');
  const clearInsert =
    setSettings +
    sep +
    '    clearCommandError: () => set({ lastCommandError: undefined }),';
  s = s.slice(0, si) + clearInsert + s.slice(si + setSettings.length);

  // Patch onError handler block to also wire onCommandRejected
  const onErrorNeedle = blankStyle
    ? "onError: (message) => store.setState({ transportError: message }),"
    : "onError: (message) => store.setState({ transportError: message }),";
  const oi = s.indexOf(onErrorNeedle);
  if (oi < 0) throw new Error('onError needle missing');
  const rejectedHandler =
    onErrorNeedle +
    sep +
    '      onCommandRejected: (commandId, type, error) => {' +
    sep +
    '        const entry = pending.get(commandId);' +
    sep +
    '        if (entry) {' +
    sep +
    '          pending.delete(commandId);' +
    sep +
    '          entry.reject(new Error(error));' +
    sep +
    '        }' +
    sep +
    '        store.setState({ lastCommandError: { type, error, at: Date.now() } });' +
    sep +
    '      },';
  s = s.slice(0, oi) + rejectedHandler + s.slice(oi + onErrorNeedle.length);

  fs.writeFileSync(path, s);
  console.log('store patched');
}

patchTypes();
patchSse();
patchStore();
