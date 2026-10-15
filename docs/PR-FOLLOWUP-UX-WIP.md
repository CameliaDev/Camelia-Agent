# Follow-up: Windows-local UX WIP (stranded offline)

The desktop machine `Eualik_Camelia` went offline mid-batch. Uncommitted work that
was already on `C:\\Users\\37963\\Desktop\\Camelia-Agent` (`fix/stop-drag-tidy-replies`)
and is **not** in this PR commit set:

- Stop button cancel end-to-end (ChatLoop AbortController + provider stream abort + optimistic clear)
- Composer folder/file drag-drop + path insert
- Reply structure (Goal/Constraints/Plan cards) + Events timeline folding
- Workspace 「浏览…」 via rfd `pick_folder`
- 「完全放行」 → `unrestrictedFs` whole-PC policy
- GBK/UTF-8 decodeBytes fallback on win32
- Max/send toolbar layout tweaks

When that machine reconnects: cherry-pick / copy those local changes onto this
branch and push a follow-up commit (or open a stacked PR). Do not rebuild/merge exe
until the user asks.
