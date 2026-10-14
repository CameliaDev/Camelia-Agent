# Extension registry mirror

Camelia searches a catalog CameliaDev maintains.

Preferred document, on `main` of [camelia-extensions](https://github.com/CameliaDev/camelia-extensions):

```
https://raw.githubusercontent.com/CameliaDev/camelia-extensions/main/catalog.json
```

This folder is the copy Camelia reads when that repository cannot be fetched:

```
https://raw.githubusercontent.com/CameliaDev/Camelia-Agent/main/extensions-registry/catalog.json
```

`CAMELIA_CATALOG_URL` replaces both. Entries in this copy point at Camelia-Agent so a shallow clone can install `plugins/quiet-activity-bar` and the skills below. The dedicated registry uses the same ids and points at its own tree.

Install clones the entry's GitHub repository (`git clone --depth 1`) and copies `path`. Plugins must contain `camelia.plugin.json` and land in `~/.camelia/plugins/<id>`. Skills must contain `SKILL.md` and land in `~/.camelia/skills`. Restart Camelia after installing a plugin; the engine loads plugins when the process starts.
