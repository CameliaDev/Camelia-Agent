import fs from 'node:fs';
function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}
edit('packages/ui/test/app.test.tsx', (s) => {
  s = s.replace(
    `  it('shows the failure reason and recovery strategy', () => {
    renderScene('failure');
    expect(screen.getByText(/Acceptance command exited 1/)).toBeInTheDocument();
    expect(screen.getByText('Failure — recoverable')).toBeInTheDocument();
    expect(screen.getByText('attempts')).toBeInTheDocument();
    expect(screen.getByText('strategy')).toBeInTheDocument();
  });

  it('offers retry, degrade and rollback', () => {
    renderScene('failure');
    expect(screen.getByText('Retry the step')).toBeInTheDocument();
    expect(screen.getByText('Fall back to a smaller model')).toBeInTheDocument();
    expect(screen.getByText('Roll back')).toBeInTheDocument();
  });`,
    `  it('shows the failure reason and recovery strategy', () => {
    renderScene('failure');
    expect(screen.getByText(/Acceptance command exited 1/)).toBeInTheDocument();
    expect(screen.getByText('失败 — 可恢复')).toBeInTheDocument();
    expect(screen.getByText('尝试次数')).toBeInTheDocument();
    expect(screen.getByText('策略')).toBeInTheDocument();
  });

  it('offers retry, degrade and rollback', () => {
    const { container } = renderScene('failure');
    expect(screen.getByText('重试该步骤')).toBeInTheDocument();
    expect(screen.getByText('降级到更小模型')).toBeInTheDocument();
    expect(screen.getByText('回滚')).toBeInTheDocument();
    // Fixture transport supports these — buttons stay enabled.
    expect(container.querySelector('[data-intervene-unavailable]')).toBeNull();
  });`,
  );
  return s;
});
console.log('app test patched');
