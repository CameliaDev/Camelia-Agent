import fs from 'node:fs';
function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}
edit('packages/ui/src/components/RightRail.tsx', (s) => {
  return s.replace('const [open, setOpen] = useState(true);', 'const [open, setOpen] = useState(false);');
});
edit('packages/ui/test/app.test.tsx', (s) => {
  return s
    .replace("fireEvent.click(screen.getByLabelText('Expand events'));", "fireEvent.click(screen.getByLabelText('展开事件'));")
    .replace("fireEvent.click(screen.getByLabelText('Collapse events'));", "fireEvent.click(screen.getByLabelText('收起事件'));");
});
console.log('events default collapsed');
