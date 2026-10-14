# Quiet activity bar (plugin stub)

Theme sample for the quieter shell direction. The narrow activity bar itself is part of the app, not this folder.

## What ships in the app

The left edge is a 48px icon strip, the same job as the VS Code activity bar:

- Chats, Plugins, account, and settings are icons. Search and new chat live in the session list, not on this strip.
- The words are tooltips and accessible names.
- The session list is the sidebar to the right of that strip. Click the open chats or plugins icon on this strip to tuck that column away. The right drawer opens and closes from the top bar.

Copying this plugin does not change that layout.

## What this plugin is

A `theme` plugin. `theme.json` holds a quieter ink accent and a softer line color, using only tokens the loader already accepts. There is no shell kind. Layout, icon order, and the 48px width are not read from here.

The engine loads the theme into its plugin result on startup. The desktop settings list still shows the four built-in presets; applying a plugin theme in that menu is later work. Until then, dropping this folder in does not recolor the window.

## Drop in and restart

The Extensions panel installs this from the catalog: [CameliaDev/camelia-extensions](https://github.com/CameliaDev/camelia-extensions) `catalog.json` on `main`, path `plugins/quiet-activity-bar`. The copy lands in `~/.camelia/plugins/quiet-activity-bar`.

Copying this directory to that same path works the same way. The folder must contain `camelia.plugin.json`.

Quit Camelia completely and start it again. The engine scans `~/.camelia/plugins` only when the process starts. The panel has no enable switch.

Windows: `%USERPROFILE%\.camelia\plugins\quiet-activity-bar`.

A rejected manifest is logged at startup (`plugin rejected`). This sample is a valid theme, so it should not be rejected.

## Refine later

Edit `theme.json` and restart. Do not add tokens outside the whitelist in `packages/core/src/types/presets.ts` — the loader refuses them. A future shell contribution would be a new extension point; do not pretend this theme file is that point.
