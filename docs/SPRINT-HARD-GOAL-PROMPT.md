# Camelia-Agent — Hard Sprint Goal Prompt (single shot)

> **Do not execute this prompt as current product or packaging.** It predates `main` `1b36ad2` (PR #4). Modes are Work / Math / Term on the session column, not the layout this file freezes. Do **not** overwrite `%USERPROFILE%\Desktop\Camelia-Agent-new.exe`. Local overwrite targets and the single `Camelia.lnk` are in [`apps/desktop/README.md`](../apps/desktop/README.md). Shell behavior is in [`SHELL-UX.md`](SHELL-UX.md). The text below is a historical agent brief.



You are working in the local repo `C:\Users\37963\Desktop\Camelia-Agent` (pnpm + Turborepo + Tauri 2 desktop). Machine is Windows; PowerShell uses `;` not `&&`. Do the entire sprint below in one continuous run. Prefer deep, correct changes over shallow stubs. Commit in logical chunks; rebuild and overwrite the desktop exe when UI changes land. Do not ask clarifying questions — decide using wireframe v2 already agreed with the user.

## Non-negotiable product rules (already decided)
1. Layout: left session rail stays; center conversation + top task bar stay; **right data rail boots collapsed every launch** (session-only expand via 「数据」). Settings is a **full multi-section page** opened from bottom-left account entry — not a tiny top-right panel.
2. Connection presets are CC Switch–style cards (name / Base URL / Key status / enable), persisted to `~/.camelia/config.json` `providers[]` + `keys.json`. Saving must not force full-app relaunch by default.
3. Conversation messages use circular avatars (user + agent). Branding (final name + mascot icon) is still TBD — leave a clear placeholder, do not invent a random name without documenting options.
4. Never fake success for rollback / model-downgrade / intervene controls if the engine still stubs them — disable + show engine error, or implement them for real.

## Work package A — Verify shell fix is live (blocking)
- Confirm `packages/ui/src/state/local-prefs.ts` `LOCAL_PREFS_VERSION = 4` and `loadLocalPrefs` **always** returns `rightCollapsed: true` / `userSetRightRail: false` on boot (expand session-only).
- Run `packages/ui` collapse-related tests (`local-prefs.test.ts`, app layout collapse test).
- `pnpm --filter @camelia/ui build` then `pnpm --filter @camelia/desktop desktop:build`.
- Kill any `camelia-desktop` processes; overwrite both *(historical instruction — do not follow the Desktop path)*:
  - `%LOCALAPPDATA%\Camelia\camelia-desktop.exe` (still a valid overwrite target)
  - ~~`%USERPROFILE%\Desktop\Camelia-Agent-new.exe`~~ **Do not.** Use the single `Camelia.lnk` described in `apps/desktop/README.md`.
- Report commit hash, paths, mtimes (Asia/Shanghai), SHA256.

## Work package B — Connection presets end-to-end (hard)
- Settings → 连接预设: full CRUD (add from templates: 阿里云兼容 / OpenRouter / Zen / Ollama / 自定义; edit; delete; enable one).
- Wire through Tauri whitelist / config writer so custom Base URL + provider id actually reach the engine (no silent drop).
- After save: hot-apply when possible; optional restart only when truly required; surface clear Chinese copy.
- Add/adjust UI + agent/config tests; smoke that `~/.camelia/config.json` gains `providers[]` entries.

## Work package C — Honest intervention + observability (hard)
- Audit FailureCard / SessionRail / intervene buttons vs engine stubs (rollback, downgrade, etc.).
- Either implement engine paths that make them real, **or** disable unavailable actions and show the real engine error — no fake success toasts.
- Add a shared checkpoint timeline if data already exists in run-record / events; keep it behind the collapsed right rail / 数据 drawer.
- EventSection: filterable audit strip (copy event, open `record.json` when path known).

## Work package D — Settings multi-section completeness (medium–hard)
Flesh Settings beyond API/connections into real sections with persistence:
- 语言与外观 (language already in localPrefs; theme; motion; font mono)
- 引擎与日志 (engine URL, open log folder, relaunch — reuse desktop shell work)
- 关于 (version, commit if available)
Do not leave placeholder nav items that open empty panes.

## Work package E — Polish + git hygiene
- Remove remaining hardcoded workspace paths in Composer / EmptyState if still present; EmptyState checklist (workspace, doctor, Ollama/key).
- i18n: no leftover English chrome in zh mode for touched surfaces.
- Keep unrelated Iteration WIP out of commits unless required; clear commit messages; no force-push.
- Final: rebuild desktop, overwrite the two exe paths again, paste SHA256, and list how to verify (cold start → right rail narrow strip → open 数据 → open 设置 → add a connection card).

## Definition of done
- Cold start always shows collapsed right rail even if WebView localStorage previously had expanded prefs.
- Connection presets survive restart in config.json and can be enabled from Settings.
- Intervene UI is honest.
- Settings has multiple working sections.
- New exe hashes match the release build. *(Historical done-line named `Camelia-Agent-new.exe`. That file is not a current launch target.)*
