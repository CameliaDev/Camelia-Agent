import fs from 'node:fs';
const path = 'packages/ui/test/app.test.tsx';
let s = fs.readFileSync(path, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');

const replacements = [
  ["expect(screen.getByText('Failure — recoverable')).toBeInTheDocument();", "expect(screen.getByText('失败 — 可恢复')).toBeInTheDocument();"],
  ["expect(screen.getByText('attempts')).toBeInTheDocument();", "expect(screen.getByText('尝试次数')).toBeInTheDocument();"],
  ["expect(screen.getByText('strategy')).toBeInTheDocument();", "expect(screen.getByText('策略')).toBeInTheDocument();"],
  ["expect(screen.getByText('Retry the step')).toBeInTheDocument();", "expect(screen.getByText('重试该步骤')).toBeInTheDocument();"],
  ["expect(screen.getByText('Fall back to a smaller model')).toBeInTheDocument();", "expect(screen.getByText('降级到更小模型')).toBeInTheDocument();"],
  ["expect(screen.getByText('Roll back')).toBeInTheDocument();", "expect(screen.getByText('回滚')).toBeInTheDocument();\n    expect(document.querySelector('[data-intervene-unavailable]')).toBeNull();"],
];

for (const [a, b] of replacements) {
  if (!s.includes(a)) {
    // try finding similar
    const key = a.slice(20, 40);
    const idx = s.indexOf(key);
    console.log('MISSING', a, 'near', idx, JSON.stringify(s.slice(Math.max(0,idx-30), idx+60)));
    // Try unicode normalize em dash variants
    const variants = [a, a.replace('—', '\u2014'), a.replace('—', '\u2013'), a.replace('—', '-')];
    let done = false;
    for (const v of variants) {
      if (s.includes(v)) { s = s.replace(v, b); done = true; console.log('used variant'); break; }
    }
    if (!done) throw new Error('missing ' + a);
  } else s = s.replace(a, b);
}
fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('patched asserts');
