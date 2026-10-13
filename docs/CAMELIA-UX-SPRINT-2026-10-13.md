# Camelia UX Sprint — 2026-10-13

Owner-locked sprint: P0 type bugs, contrast/i18n/progress/density, Term mode, artifacts, Live honesty, provider test+models, effort chips, in-app feedback, desktop overwrite.

## Shipped (full)

### P0
- Fixed `tsc --noEmit` failures from chat→work rename:
  - `Composer.tsx`: steer button when `running && mode !== 'work'`
  - `SessionRail.tsx`: wired `kindFiltered` (work / math / term)
  - `ModeHeader.tsx`: lifecycle tone via `planStageOf` (no invalid `mode: 'plan'`)
  - `strings.ts`: added `avatar.agent` (en/zh)
- `pnpm test` in `@camelia/ui` now runs `tsc --noEmit && vitest run`
- Duplicate panel icon rows removed: `ActivityBar` no longer wraps a second `ModeHeader`; task-card "panels →" link removed

### Visual / i18n / density
- Step statuses use `step.status.*` i18n
- Top mode label: Math (EN) beside Work; Term added
- Title triple: fixed by removing duplicate ModeHeader
- Light theme: `ink-3` → `#6b6b6b` (≥4.5:1), `warn` → `#b45309`, accent warm camellia `#c45c48`, info cool `#2b6cb0`
- RunDock: thin progress bar + `current/total` in left third (no top-bar % rail)
- F1: current running/verifying step auto-expands with solid status color
- Composer border softened (`border-line/50` + light-refined white card)

### Features
- Work composer **effort** chips: max | high | low (persisted in `localPrefs.effort`)
- Provider form: **Test connection** → OpenAI-compatible `/v1/models` (manual IDs if list fails)
- Composer model switcher already present; works with discovered models after save/activate
- **Term** mode MVP: mode id `term`, session kind, kind filtering, `TermWorkspace` stub
- Right rail: panels reordered (run → **artifacts** → memory → …); Artifacts panel lists `task.artifacts`
- Live panel: live/offline hints, reconnect label when offline (relaunch); no fake live
- **Feedback**: Account menu + Settings → Feedback; creates GitHub Issue on `CameliaDev/camelia-feedback` (configurable via code default); prompts GitHub login when needed

### Core / agent
- `SessionKind` / `new_session` / runtime accept `'term'`

## Stubbed / honest gaps
- Term: UI + session kind only — no multi-agent orchestration backend
- Feedback repo `CameliaDev/camelia-feedback` must exist (or change `DEFAULT_FEEDBACK_REPO`); needs PAT with `issues` write
- Effort chips are chrome prefs only — not yet sent as engine command payload
- Model discovery lists into the form; active switch still goes through existing `select_provider` after preset activate/restart

## Verify
1. Completely quit Camelia, then open from Desktop shortcut / `D:\app\Camelia\camelia-desktop.exe`
2. `pnpm --filter @camelia/ui test` → tsc clean + vitest green
3. Top bar: Work | Math | Term; left rail filters by mode
4. Light theme: secondary text readable; RunDock shows thin progress when a task runs
5. Settings → Connections → Test connection; Account menu → Feedback…

## Exe overwrite
- `D:\app\Camelia\camelia-desktop.exe`
- `%LOCALAPPDATA%\Camelia\camelia-desktop.exe`
- Desktop `Camelia.exe` + `Camelia.lnk` → `D:\app\Camelia\camelia-desktop.exe`
- SHA256: 2F02DA3A1399F82383E97958BF968CBE14755C712BC03A9AA8D78F5FCD700A0A