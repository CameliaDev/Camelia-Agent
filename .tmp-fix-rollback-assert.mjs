import fs from 'node:fs';
const path = 'packages/ui/test/app.test.tsx';
let s = fs.readFileSync(path, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
s = s.replace(
  "expect(screen.getByText('回滚')).toBeInTheDocument();\n    expect(document.querySelector('[data-intervene-unavailable]')).toBeNull();",
  "expect(screen.getAllByText('回滚').length).toBeGreaterThan(0);\n    expect(document.querySelector('[data-intervene-unavailable]')).toBeNull();\n    expect(document.querySelector('[data-failure-card]')).not.toBeNull();",
);
fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok');
