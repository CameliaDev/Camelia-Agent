# Camelia UX Sprint — 2026-10-13

> **Historical sprint log. Not the current shell.** As of `main` `1b36ad2` (PR #4), modes are **Work / Math / Term on the session column**, not the top bar. Effort is a button that opens Max / High / Low; it does not cycle chips. Term’s plan / execute / verify / done timeline is local to the window; team orchestration is still not in the engine. Desktop overwrite does **not** drop `Camelia.exe` or `Camelia-Agent-new.exe`. See [`SHELL-UX.md`](SHELL-UX.md) and [`apps/desktop/README.md`](../apps/desktop/README.md). The notes under this banner record what that day’s sprint claimed.



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
- Work composer **effort** chips: max | high | low (persisted in `localPrefs.effort`, sent on `chat_message` / `submit_task`). **Later:** the control is a button showing the current level (default High) and a popup; it does not cycle. See `SHELL-UX.md`.
- Provider form: **Test connection** → OpenAI-compatible `/v1/models` (manual IDs if list fails)
- Composer model switcher already present; works with discovered models after save/activate
- **Term** mode MVP: mode id `term`, session kind, kind filtering, `TermWorkspace` stub. **Later:** the composer drives a local plan / execute / verify / done timeline and does not call `submit_task`. Multi-agent orchestration is still absent.
- Right rail: panels reordered (run → **artifacts** → memory → …); Artifacts panel lists `task.artifacts`
- Live panel: live/offline hints, reconnect label when offline (relaunch); no fake live
- **Feedback**: Account menu + Settings → Feedback; creates GitHub Issue on `feedback.repo` default `CameliaDev/camelia-feedback`; prompts GitHub login when needed

### Core / agent
- `SessionKind` / `new_session` / runtime accept `'term'`

## Stubbed / honest gaps
- Term: UI + session kind only — no multi-agent orchestration backend
- `feedback.repo` defaults to `CameliaDev/camelia-feedback` (`DEFAULT_FEEDBACK_REPO` in `packages/ui/src/window/feedback.ts`). There is no `config.json` key. `submitFeedback({ repo: 'owner/name' })` overrides it; any other value falls back to that default. The repo must exist and the PAT needs `issues` write.
- Effort is on the command payload and is copied into the chat system prompt / task constraints. It does not switch the model.
- Model discovery lists into the form; active switch still goes through existing `select_provider` after preset activate/restart

## Verify
1. Completely quit Camelia, then open from Desktop shortcut / `D:\app\Camelia\camelia-desktop.exe`
2. `pnpm --filter @camelia/ui test` → tsc clean + vitest green
3. **Then:** “Top bar: Work | Math | Term”. **Now:** those tabs sit above the session list, and the left rail filters by mode. See `SHELL-UX.md`.
4. Light theme: secondary text readable; RunDock shows thin progress when a task runs
5. Settings → Connections → Test connection; Account menu → Feedback…

## Exe overwrite（当天记录；桌面 exe 这项已作废）

当时的前两条路径今天仍然是覆盖目标。第三条不要再做：不要在桌面放 `Camelia.exe` 或 `Camelia-Agent-new.exe`。当前桌面只有一个原地更新的 `Camelia.lnk`，目标与 `WorkingDirectory` 都是 `D:\app\Camelia`。下面的 SHA256 是当天那次构建，不是 `1b36ad2`。

- `D:\app\Camelia\camelia-desktop.exe`
- `%LOCALAPPDATA%\Camelia\camelia-desktop.exe`
- ~~Desktop `Camelia.exe` + `Camelia.lnk`~~ — 作废。现为单个 `Camelia.lnk` → `D:\app\Camelia\camelia-desktop.exe`
- SHA256（历史）: 2F02DA3A1399F82383E97958BF968CBE14755C712BC03A9AA8D78F5FCD700A0A