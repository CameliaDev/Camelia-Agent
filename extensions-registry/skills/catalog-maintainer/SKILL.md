---
name: catalog-maintainer
description: Add or update a plugin or skill in the Camelia extension catalog.
---

# Catalog maintainer

The official registry is https://github.com/CameliaDev/camelia-extensions.

Camelia reads that repository's catalog.json on main. If it is unreachable, Camelia reads extensions-registry/catalog.json in Camelia-Agent.

## Add an entry

1. Add the plugin or skill folder under `plugins/` or `skills/`.
2. A plugin directory contains `camelia.plugin.json`. A skill directory contains `SKILL.md` with `name` and `description` frontmatter.
3. Append an object to `catalog.json` with `id`, `name`, `description`, `repo`, `path`, and optional `tags`.
4. Commit to `main`.

`id` is the directory name Camelia uses under `~/.camelia/plugins`. Skill installs copy into `~/.camelia/skills` using the `name` in this file.
