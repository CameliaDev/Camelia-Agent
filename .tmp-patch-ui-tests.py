from pathlib import Path

mp = Path("packages/ui/src/components/MemoryPanel.tsx")
t = mp.read_text(encoding="utf-8")
old = '<section className="border-b border-line">'
new = '<section data-testid="memory-panel" className="border-b border-line">'
# only the MemoryPanel export return — first occurrence in export function is fine if unique enough
idx = t.find("export function MemoryPanel")
assert idx > 0
sub = t[idx:]
assert old in sub
t = t[:idx] + sub.replace(old, new, 1)
mp.write_text(t, encoding="utf-8")
print("MemoryPanel testid OK")

app = Path("packages/ui/test/app.test.tsx")
at = app.read_text(encoding="utf-8")
needle = """    expect(container.querySelector('[data-open-right-rail]')).not.toBeNull();
  });

  it('pins and deletes a session from the left list', () => {"""
insert = """    expect(container.querySelector('[data-open-right-rail]')).not.toBeNull();
  });

  it('hides Memory when collapsed and shows it after expand — even with sticky expanded prefs', () => {
    localStorage.setItem(
      'camelia.localPrefs',
      JSON.stringify({
        version: 3,
        leftWidth: 260,
        rightWidth: 360,
        leftCollapsed: false,
        rightCollapsed: false,
        userSetRightRail: true,
        themeId: 'light',
        language: 'zh',
        topBar: 'pinned',
        motion: 'system',
        fontMono: '',
        planApproval: 'always',
      }),
    );
    const { container } = renderScene('empty');
    expect(container.querySelector('[data-rail-collapsed=\"true\"]')).not.toBeNull();
    expect(container.querySelector('[data-testid=\"memory-panel\"]')).toBeNull();
    expect(screen.queryByText('记忆')).not.toBeInTheDocument();
    expandRightRail(container);
    expect(container.querySelector('[data-rail-collapsed=\"false\"]')).not.toBeNull();
    expect(container.querySelector('[data-testid=\"memory-panel\"]')).not.toBeNull();
    expect(screen.getByText('记忆')).toBeInTheDocument();
  });

  it('pins and deletes a session from the left list', () => {"""
assert needle in at, "insert point missing"
app.write_text(at.replace(needle, insert, 1), encoding="utf-8")
print("app.test.tsx patched")
