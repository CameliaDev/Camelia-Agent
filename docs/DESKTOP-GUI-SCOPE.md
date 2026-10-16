# Windows desktop GUI control — scope

Shipped in this PR (scaffolding, usable):

- `desktop_list_windows` — top-level visible windows (title, process, hwnd)
- `desktop_focus_window` — focus by title substring
- `desktop_send_keys` — SendKeys to foreground (optional focus first)

Not in this PR (follow-up):

- Click by screen coordinates / control AutomationId
- OCR / screenshot-to-action loop
- Drag-drop and multi-monitor coordinate mapping
- Non-Windows backends

Risk class: `system` (same gate as shell). Tools no-op with a clear error off Windows.
