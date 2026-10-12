import fs from 'node:fs';
const path = 'packages/ui/src/state/store.ts';
let s = fs.readFileSync(path, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
if (s.includes('lastCommandError')) {
  console.log('already');
  process.exit(0);
}

const fieldNeedle = '  transportError?: string;';
const fi = s.indexOf(fieldNeedle);
if (fi < 0) throw new Error('field');
s =
  s.slice(0, fi) +
  fieldNeedle +
  '\n  /** Last rejected command (engine said no). Not a dead transport. */\n  lastCommandError?: { type: string; error: string; at: number };\n  clearCommandError: () => void;' +
  s.slice(fi + fieldNeedle.length);

const setSettings = '    setSettingsOpen: (open) => set({ settingsOpen: open }),';
const si = s.indexOf(setSettings);
if (si < 0) throw new Error('setSettings');
s =
  s.slice(0, si) +
  setSettings +
  '\n    clearCommandError: () => set({ lastCommandError: undefined }),' +
  s.slice(si + setSettings.length);

const onError = '      onError: (message) => store.setState({ transportError: message }),';
const oi = s.indexOf(onError);
if (oi < 0) throw new Error('onError');
const rejected = `${onError}
      onCommandRejected: (commandId, type, error) => {
        const entry = pending.get(commandId);
        if (entry) {
          pending.delete(commandId);
          entry.reject(new Error(error));
        }
        store.setState({ lastCommandError: { type, error, at: Date.now() } });
      },`;
s = s.slice(0, oi) + rejected + s.slice(oi + onError.length);
fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('store patched clean', (s.match(/lastCommandError/g) || []).length);
