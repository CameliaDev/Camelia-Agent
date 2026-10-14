/**
 * Catalog fetch, filter, and install. Network and git are stubs.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EXTENSION_CATALOG_URL,
  FALLBACK_EXTENSION_CATALOG_URL,
  extensionCatalogUrl,
  fetchExtensionCatalog,
  filterCatalogEntries,
  installCatalogPlugin,
  installCatalogSkill,
  listInstalledPlugins,
  materializeCatalogEntry,
  parseExtensionCatalog,
  type CatalogEntry,
} from '../src/catalog/catalog.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const quietPlugin: CatalogEntry = {
  id: 'quiet-activity-bar',
  name: 'Quiet activity bar',
  description: 'Quieter ink tokens',
  repo: 'https://github.com/CameliaDev/camelia-extensions',
  path: 'plugins/quiet-activity-bar',
  tags: ['theme', 'sample'],
};

const catalogBody = {
  version: 1,
  plugins: [quietPlugin],
  skills: [
    {
      id: 'catalog-maintainer',
      name: 'Catalog maintainer',
      description: 'Add an entry to the Camelia catalog',
      repo: 'https://github.com/CameliaDev/camelia-extensions.git',
      path: 'skills/catalog-maintainer',
      tags: ['meta'],
    },
    {
      id: 'quiet-shell-notes',
      name: 'Quiet shell notes',
      description: 'Notes for the quieter shell',
      url: 'git@github.com:CameliaDev/camelia-extensions.git',
      path: 'skills/quiet-shell-notes',
      tags: ['shell'],
    },
  ],
};

function writePlugin(root: string, entryPath: string): void {
  const dir = path.join(root, entryPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'camelia.plugin.json'),
    JSON.stringify({
      name: '@camelia/plugin-quiet-activity-bar',
      kind: 'theme',
      entry: 'theme.json',
      permissions: [],
      version: '0.1.0',
      description: 'Quieter ink tokens',
    }),
  );
  fs.writeFileSync(path.join(dir, 'theme.json'), '{}\n');
}

function writeSkill(root: string, entryPath: string, name: string): void {
  const dir = path.join(root, entryPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: From the catalog\n---\n\n# ${name}\n`,
  );
}

describe('parseExtensionCatalog', () => {
  it('accepts plugins and skills from the registry shape', () => {
    const parsed = parseExtensionCatalog(catalogBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.plugins.map((entry) => entry.id)).toEqual(['quiet-activity-bar']);
    expect(parsed.value.skills).toHaveLength(2);
    expect(parsed.value.skills[1]?.url).toBe('git@github.com:CameliaDev/camelia-extensions.git');
  });

  it('rejects a bad version, an unsafe path, and a missing remote', () => {
    expect(parseExtensionCatalog({ version: 2, plugins: [], skills: [] }).ok).toBe(false);
    expect(parseExtensionCatalog({ version: 1, plugins: [{ ...quietPlugin, path: '../etc' }], skills: [] }).ok).toBe(false);
    const missingRemote = parseExtensionCatalog({
      version: 1,
      plugins: [{ id: 'x', name: 'X', description: '' }],
      skills: [],
    });
    expect(missingRemote.ok).toBe(false);
    if (!missingRemote.ok) expect(missingRemote.error).toMatch(/repo 或 url/);
  });
});

describe('filterCatalogEntries', () => {
  const parsed = parseExtensionCatalog(catalogBody);
  if (!parsed.ok) throw new Error('fixture catalog');
  const all = [...parsed.value.plugins, ...parsed.value.skills];

  it('matches name, id, description, and tags, and keeps every entry for a blank query', () => {
    expect(filterCatalogEntries(all, '').map((entry) => entry.id)).toEqual([
      'quiet-activity-bar',
      'catalog-maintainer',
      'quiet-shell-notes',
    ]);
    expect(filterCatalogEntries(all, 'QUIET').map((entry) => entry.id)).toEqual([
      'quiet-activity-bar',
      'quiet-shell-notes',
    ]);
    expect(filterCatalogEntries(all, 'theme').map((entry) => entry.id)).toEqual(['quiet-activity-bar']);
    expect(filterCatalogEntries(all, 'catalog-maintainer').map((entry) => entry.id)).toEqual(['catalog-maintainer']);
    expect(filterCatalogEntries(all, 'add an entry').map((entry) => entry.id)).toEqual(['catalog-maintainer']);
    expect(filterCatalogEntries(all, 'no-such-plugin')).toEqual([]);
  });
});

describe('fetchExtensionCatalog', () => {
  it('GETs the default raw catalog URL', async () => {
    const seen: string[] = [];
    const fetched = await fetchExtensionCatalog({
      fetchImpl: async (input) => {
        seen.push(input);
        return jsonResponse(catalogBody);
      },
    });
    expect(seen).toEqual([DEFAULT_EXTENSION_CATALOG_URL]);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value.plugins[0]?.id).toBe('quiet-activity-bar');
  });

  it('uses CAMELIA_CATALOG_URL when set', async () => {
    const override = 'https://example.test/catalog.json';
    const fetched = await fetchExtensionCatalog({
      env: { CAMELIA_CATALOG_URL: override },
      fetchImpl: async (input) => {
        expect(input).toBe(override);
        return jsonResponse(catalogBody);
      },
    });
    expect(fetched.ok).toBe(true);
    expect(extensionCatalogUrl({ CAMELIA_CATALOG_URL: '  https://example.test/other.json  ' })).toBe(
      'https://example.test/other.json',
    );
  });

  it('falls back to the Camelia-Agent copy when the registry repo is missing', async () => {
    const seen: string[] = [];
    const fetched = await fetchExtensionCatalog({
      env: {},
      fetchImpl: async (input) => {
        seen.push(input);
        if (input === DEFAULT_EXTENSION_CATALOG_URL) return jsonResponse({ message: 'missing' }, 404);
        return jsonResponse(catalogBody);
      },
    });
    expect(seen).toEqual([DEFAULT_EXTENSION_CATALOG_URL, FALLBACK_EXTENSION_CATALOG_URL]);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.sourceUrl).toBe(FALLBACK_EXTENSION_CATALOG_URL);
  });

  it('reports an HTTP failure and a non-JSON body without throwing', async () => {
    const missing = await fetchExtensionCatalog({
      fetchImpl: async () => jsonResponse({ message: 'nope' }, 404),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/404/);

    const text = await fetchExtensionCatalog({
      fetchImpl: async () => new Response('not-json', { status: 200 }),
    });
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error).toMatch(/JSON/);
  });
});

describe('install from the catalog', () => {
  function client(kind: 'plugin' | 'skill') {
    const checkout = tempDir('camelia-catalog-src-');
    if (kind === 'plugin') writePlugin(checkout, quietPlugin.path!);
    else {
      writeSkill(checkout, 'skills/catalog-maintainer', 'catalog-maintainer');
      writeSkill(checkout, 'skills/quiet-shell-notes', 'quiet-shell-notes');
    }
    let cleaned = false;
    return {
      fetchImpl: async () => jsonResponse(catalogBody),
      materialize: async () => ({
        root: checkout,
        cleanup: () => {
          cleaned = true;
        },
      }),
      wasCleaned: () => cleaned,
    };
  }

  it('copies a manifest-backed plugin into the plugins root and removes the checkout', async () => {
    const pluginsRoot = tempDir('camelia-plugins-');
    const io = client('plugin');
    const installed = await installCatalogPlugin('quiet-activity-bar', { ...io, pluginsRoot });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.restartRequired).toBe(true);
    expect(installed.dir).toBe(path.join(pluginsRoot, 'quiet-activity-bar'));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installed.dir, 'camelia.plugin.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe('@camelia/plugin-quiet-activity-bar');
    expect(io.wasCleaned()).toBe(true);
    expect(listInstalledPlugins(pluginsRoot).map((plugin) => plugin.id)).toEqual(['quiet-activity-bar']);
  });

  it('does not clone when the catalog path escapes the repo', async () => {
    let cloned = false;
    const installed = await installCatalogPlugin('quiet-activity-bar', {
      fetchImpl: async () =>
        jsonResponse({
          version: 1,
          plugins: [{ ...quietPlugin, path: '../../outside' }],
          skills: [],
        }),
      materialize: async () => {
        cloned = true;
        return { root: tempDir('unused-'), cleanup: () => undefined };
      },
    });
    expect(installed.ok).toBe(false);
    expect(cloned).toBe(false);
  });

  it('refuses a directory that has no camelia.plugin.json', async () => {
    const checkout = tempDir('camelia-empty-plugin-');
    fs.mkdirSync(path.join(checkout, 'plugins/quiet-activity-bar'), { recursive: true });
    const installed = await installCatalogPlugin('quiet-activity-bar', {
      pluginsRoot: tempDir('camelia-plugins-'),
      fetchImpl: async () => jsonResponse(catalogBody),
      materialize: async () => ({ root: checkout, cleanup: () => undefined }),
    });
    expect(installed.ok).toBe(false);
    if (!installed.ok) expect(installed.error).toMatch(/camelia\.plugin\.json/);
  });

  it('installs a catalog skill through the SKILL.md copy', async () => {
    const skillsRoot = tempDir('camelia-skills-');
    const io = client('skill');
    const installed = await installCatalogSkill('catalog-maintainer', { ...io, skillsRoot });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.skills.map((skill) => skill.name)).toEqual(['catalog-maintainer']);
    expect(fs.existsSync(path.join(skillsRoot, 'catalog-maintainer', 'SKILL.md'))).toBe(true);
    expect(io.wasCleaned()).toBe(true);
  });

  it('reports an unknown id', async () => {
    const installed = await installCatalogPlugin('missing', {
      fetchImpl: async () => jsonResponse(catalogBody),
    });
    expect(installed.ok).toBe(false);
    if (!installed.ok) expect(installed.error).toMatch(/没有这个插件/);
  });
});

describe('materializeCatalogEntry', () => {
  it('clones github.com with a shallow branch and refuses other hosts', async () => {
    const calls: string[][] = [];
    const result = await materializeCatalogEntry(
      { ...quietPlugin, ref: 'main' },
      {
        runGit: async (args) => {
          calls.push([...args]);
          const dest = args.at(-1);
          if (dest) fs.mkdirSync(dest, { recursive: true });
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        'main',
        'https://github.com/CameliaDev/camelia-extensions.git',
        expect.any(String),
      ],
    ]);
    if (result.ok) {
      expect(fs.existsSync(result.value.root)).toBe(true);
      result.value.cleanup();
      expect(fs.existsSync(result.value.root)).toBe(false);
    }

    // Host checks must return before git. A real clone on Windows can sit in
    // Git Credential Manager until the test timeout.
    const refuse = async (entry: CatalogEntry): Promise<void> => {
      let spawned = false;
      const refused = await materializeCatalogEntry(entry, {
        runGit: async () => {
          spawned = true;
          throw new Error('git must not run');
        },
      });
      expect(spawned).toBe(false);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/github\.com/);
    };
    await refuse({ ...quietPlugin, repo: 'https://evil.example/plugins.git', url: undefined });
    await refuse({ ...quietPlugin, repo: undefined, url: 'file:///tmp/plugins' });
  });
});
