# Sandbox allow roots (`extraAllowPaths`)

Camelia tools (`fs.*`, `shell.exec` cwd) may only touch:

1. The **primary workspace** (the folder you opened / `set_workspace`), and
2. Optional **extra absolute roots** listed in `extraAllowPaths`.

## FULL ≠ expand sandbox

Permission mode **FULL** only skips approval prompts. It does **not** enlarge the
writable tree. If a path is denied, add an absolute directory to allow roots —
do not expect FULL to open `camelia-bench` or any other sibling folder.

## Configure

In `~/.camelia/config.json` (create the file if missing):

```json
{
  "extraAllowPaths": [
    "C:/Users/you/Desktop/camelia-bench"
  ]
}
```

Or pass `harnessConfig.extraAllowPaths` when constructing `CameliaRuntime`.

Paths must be absolute. Relative entries are resolved from the process cwd and
are easy to get wrong — prefer drive-rooted absolute paths on Windows.

## Behaviour notes

- Relative tool paths still resolve against the **primary workspace**.
- Absolute tool paths are accepted when they fall under the workspace **or** any
  `extraAllowPaths` entry.
- `shell.exec` validates `cwd` the same way; command argument strings are not
  fully parsed for every absolute path (use `fs.write` / an allowed `cwd` for
  downloads into allow roots).
