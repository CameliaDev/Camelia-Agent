/**
 * Extension catalog — the CameliaDev-maintained plugin and skill registry.
 *
 * The desktop search boxes read this document, then install an entry by shallow-cloning
 * its GitHub repo and copying `path` into the user directory the loader already scans.
 *
 * Default document (override with `CAMELIA_CATALOG_URL`):
 * https://raw.githubusercontent.com/CameliaDev/camelia-extensions/main/catalog.json
 *
 * When that repository cannot be fetched, Camelia reads the copy in this repo:
 * https://raw.githubusercontent.com/CameliaDev/Camelia-Agent/main/extensions-registry/catalog.json
 * @module
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isUnsafeRelativePath, parsePluginManifest, parseShellPlugin, type ShellPlugin } from '@camelia/core';

import { paths } from '../config/paths.js';
import { PLUGIN_MANIFEST_FILE, PluginLoader } from '../plugins/PluginLoader.js';
import { installSkillFolder, skillsUserRoot, type SkillInfo } from '../skills/skills.js';

/**
 * Raw catalog on `main` of the CameliaDev registry.
 * Override with the `CAMELIA_CATALOG_URL` environment variable (no fallback).
 */
export const DEFAULT_EXTENSION_CATALOG_URL =
  'https://raw.githubusercontent.com/CameliaDev/camelia-extensions/main/catalog.json';

/**
 * Same document published from Camelia-Agent.
 * Used only when the registry repository cannot be fetched and no override is set.
 */
export const FALLBACK_EXTENSION_CATALOG_URL =
  'https://raw.githubusercontent.com/CameliaDev/Camelia-Agent/main/extensions-registry/catalog.json';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/;
const GITHUB_HTTPS = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const GITHUB_SSH = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  /** Git remote. `repo` or `url` must name a github.com repository. */
  repo?: string;
  url?: string;
  /** Directory inside the repo. Omitted means the repository root. */
  path?: string;
  /** Git branch or tag. Defaults to `main`. */
  ref?: string;
  tags: string[];
}

export interface ExtensionCatalog {
  version: 1;
  plugins: CatalogEntry[];
  skills: CatalogEntry[];
}

export interface InstalledPluginInfo {
  /** Directory name under `~/.camelia/plugins`. Matches a catalog `id` after install. */
  id: string;
  name: string;
  description: string;
  kind: string;
  version?: string;
  dir: string;
  /** Parsed shell contribution when `kind === 'shell'`. */
  shell?: ShellPlugin;
}

export interface CatalogMaterialized {
  /** Checkout root. Entry `path` is resolved inside this directory. */
  root: string;
  cleanup: () => void;
}

export interface CatalogClientOptions {
  pluginsRoot?: string;
  skillsRoot?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  env?: NodeJS.ProcessEnv;
  /** Replaces the git clone. Tests point this at a local tree. */
  materialize?: (entry: CatalogEntry) => Promise<CatalogMaterialized>;
  /** Replaces `git` itself. The real clone still builds the argument list. */
  runGit?: (args: readonly string[]) => Promise<void>;
}

export type CatalogResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function extensionCatalogUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CAMELIA_CATALOG_URL?.trim();
  return override || DEFAULT_EXTENSION_CATALOG_URL;
}

export function parseExtensionCatalog(raw: unknown): CatalogResult<ExtensionCatalog> {
  if (!isRecord(raw)) return { ok: false, error: '目录必须是 JSON 对象' };
  if (raw.version !== 1) return { ok: false, error: '目录 version 必须是 1' };
  const plugins = parseEntries(raw.plugins, 'plugins');
  if (!plugins.ok) return plugins;
  const skills = parseEntries(raw.skills, 'skills');
  if (!skills.ok) return skills;
  return { ok: true, value: { version: 1, plugins: plugins.value, skills: skills.value } };
}

export function filterCatalogEntries<T extends { id: string; name: string; description?: string; tags?: readonly string[] }>(
  entries: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => {
    const haystack = [entry.id, entry.name, entry.description ?? '', ...(entry.tags ?? [])].join('\n').toLowerCase();
    return haystack.includes(needle);
  });
}

export async function fetchExtensionCatalog(
  options: CatalogClientOptions = {},
): Promise<CatalogResult<ExtensionCatalog> & { sourceUrl?: string }> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const urls = catalogUrls(options.env);
  let lastError = '无法读取扩展目录';
  let lastUrl = urls[0] ?? DEFAULT_EXTENSION_CATALOG_URL;
  for (const sourceUrl of urls) {
    lastUrl = sourceUrl;
    const urlError = validateCatalogUrl(sourceUrl);
    if (urlError) {
      lastError = urlError;
      continue;
    }
    let response: Response;
    try {
      response = await fetchImpl(sourceUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = `无法读取扩展目录: ${errorText(error)}`;
      continue;
    }
    if (!response.ok) {
      lastError = `目录请求失败 (${response.status})`;
      continue;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: '目录不是 JSON', sourceUrl };
    }
    const parsed = parseExtensionCatalog(body);
    if (!parsed.ok) return { ...parsed, sourceUrl };
    return { ok: true, value: parsed.value, sourceUrl };
  }
  return { ok: false, error: lastError, sourceUrl: lastUrl };
}

function catalogUrls(env: NodeJS.ProcessEnv | undefined): string[] {
  const primary = extensionCatalogUrl(env);
  const override = (env ?? process.env).CAMELIA_CATALOG_URL?.trim();
  if (override) return [primary];
  if (primary !== DEFAULT_EXTENSION_CATALOG_URL) return [primary];
  return [DEFAULT_EXTENSION_CATALOG_URL, FALLBACK_EXTENSION_CATALOG_URL];
}

/** Manifest-valid plugin folders currently on disk. Does not execute plugin code. */
export function listInstalledPlugins(root = paths.plugins()): InstalledPluginInfo[] {
  const { found } = new PluginLoader().discover(root);
  return found
    .map((plugin) => {
      const row: InstalledPluginInfo = {
        id: path.basename(plugin.dir),
        name: plugin.manifest.name,
        description: plugin.manifest.description ?? '',
        kind: plugin.manifest.kind,
        ...(plugin.manifest.version ? { version: plugin.manifest.version } : {}),
        dir: plugin.dir,
      };
      if (plugin.manifest.kind === 'shell') {
        const shell = readShellEntry(plugin.dir, plugin.manifest.entry);
        if (shell) row.shell = shell;
      }
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function readShellEntry(dir: string, entry: string): ShellPlugin | undefined {
  if (isUnsafeRelativePath(entry)) return undefined;
  const entryPath = path.resolve(dir, entry);
  if (!entryPath.startsWith(path.resolve(dir))) return undefined;
  if (!fs.existsSync(entryPath)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
  } catch {
    return undefined;
  }
  const parsed = parseShellPlugin(raw);
  return parsed.ok ? parsed.value : undefined;
}

export async function installCatalogPlugin(
  id: string,
  options: CatalogClientOptions = {},
): Promise<{ ok: true; id: string; dir: string; restartRequired: true } | { ok: false; error: string }> {
  const entry = await findEntry(id, 'plugins', options);
  if (!entry.ok) return entry;
  const safeId = entry.value.id;
  const materialized = await checkout(entry.value, options);
  if (!materialized.ok) return materialized;
  try {
    const source = resolveEntryDir(materialized.value.root, entry.value.path);
    if (!source.ok) return source;
    const manifestError = validatePluginDir(source.dir);
    if (manifestError) return { ok: false, error: manifestError };
    const pluginsRoot = options.pluginsRoot ?? paths.plugins();
    const dest = path.join(pluginsRoot, safeId);
    if (!isInsideOrEqual(pluginsRoot, dest)) return { ok: false, error: '插件安装路径不合法' };
    fs.mkdirSync(pluginsRoot, { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    try {
      fs.cpSync(source.dir, dest, {
        recursive: true,
        filter: (src) => path.basename(src) !== '.git',
      });
    } catch (error) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: `无法写入插件目录: ${errorText(error)}` };
    }
    return { ok: true, id: safeId, dir: dest, restartRequired: true };
  } finally {
    materialized.value.cleanup();
  }
}

export async function installCatalogSkill(
  id: string,
  options: CatalogClientOptions = {},
): Promise<{ ok: true; skills: SkillInfo[] } | { ok: false; error: string }> {
  const entry = await findEntry(id, 'skills', options);
  if (!entry.ok) return entry;
  const materialized = await checkout(entry.value, options);
  if (!materialized.ok) return materialized;
  try {
    const source = resolveEntryDir(materialized.value.root, entry.value.path);
    if (!source.ok) return source;
    return installSkillFolder(source.dir, options.skillsRoot ?? skillsUserRoot());
  } finally {
    materialized.value.cleanup();
  }
}

/**
 * Shallow-clone the entry's GitHub repository.
 *
 * `git clone --depth 1` is the install transport: the copy that lands in
 * `~/.camelia/plugins` or `~/.camelia/skills` is a normal folder, which is what
 * `PluginLoader` and `installSkillFolder` already know how to read.
 */
export async function materializeCatalogEntry(
  entry: CatalogEntry,
  options: CatalogClientOptions = {},
): Promise<CatalogResult<CatalogMaterialized>> {
  const remote = githubCloneUrl(entry.repo ?? entry.url ?? '');
  if (!remote) return { ok: false, error: '仓库地址必须是 github.com 上的仓库' };
  const refError = validateRef(entry.ref ?? 'main');
  if (refError) return { ok: false, error: refError };
  const ref = entry.ref?.trim() || 'main';
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-catalog-'));
  const dest = path.join(parent, 'repo');
  const runGit = options.runGit ?? defaultRunGit;
  try {
    await runGit(['clone', '--depth', '1', '--branch', ref, remote.url, dest]);
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    return { ok: false, error: `无法克隆 ${remote.url}: ${errorText(error)}` };
  }
  return {
    ok: true,
    value: {
      root: dest,
      cleanup: () => {
        fs.rmSync(parent, { recursive: true, force: true });
      },
    },
  };
}

function parseEntries(raw: unknown, label: 'plugins' | 'skills'): CatalogResult<CatalogEntry[]> {
  if (!Array.isArray(raw)) return { ok: false, error: `目录的 ${label} 必须是数组` };
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const parsed = parseEntry(raw[index], `${label}[${index}]`);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.id)) return { ok: false, error: `目录 id 重复: ${parsed.value.id}` };
    seen.add(parsed.value.id);
    entries.push(parsed.value);
  }
  return { ok: true, value: entries };
}

function parseEntry(raw: unknown, at: string): CatalogResult<CatalogEntry> {
  if (!isRecord(raw)) return { ok: false, error: `${at} 必须是对象` };
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!ID_PATTERN.test(id)) return { ok: false, error: `${at}.id 必须是安全的目录名` };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 200) return { ok: false, error: `${at}.name 必须是非空字符串` };
  let description = '';
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') return { ok: false, error: `${at}.description 必须是字符串` };
    description = raw.description.trim().slice(0, 2000);
  }
  const repo = optionalString(raw.repo);
  const url = optionalString(raw.url);
  if (repo === null || url === null) return { ok: false, error: `${at} 的 repo / url 必须是字符串` };
  if (!repo && !url) return { ok: false, error: `${at} 需要 repo 或 url` };
  let entryPath: string | undefined;
  if (raw.path !== undefined) {
    if (typeof raw.path !== 'string' || !raw.path.trim()) return { ok: false, error: `${at}.path 必须是字符串` };
    entryPath = raw.path.trim();
    if (isUnsafeRelativePath(entryPath)) return { ok: false, error: `${at}.path 不能跳出仓库` };
  }
  let ref: string | undefined;
  if (raw.ref !== undefined) {
    if (typeof raw.ref !== 'string') return { ok: false, error: `${at}.ref 必须是字符串` };
    const refError = validateRef(raw.ref);
    if (refError) return { ok: false, error: `${at}.ref ${refError}` };
    ref = raw.ref.trim();
  }
  const tags = parseTags(raw.tags, at);
  if (!tags.ok) return tags;
  return {
    ok: true,
    value: {
      id,
      name,
      description,
      ...(repo ? { repo } : {}),
      ...(url ? { url } : {}),
      ...(entryPath ? { path: entryPath } : {}),
      ...(ref ? { ref } : {}),
      tags: tags.value,
    },
  };
}

function parseTags(raw: unknown, at: string): CatalogResult<string[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${at}.tags 必须是字符串数组` };
  const tags: string[] = [];
  for (const tag of raw) {
    if (typeof tag !== 'string') return { ok: false, error: `${at}.tags 必须是字符串数组` };
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > 40) return { ok: false, error: `${at}.tags 含有空项或过长项` };
    tags.push(trimmed);
    if (tags.length > 16) return { ok: false, error: `${at}.tags 过多` };
  }
  return { ok: true, value: tags };
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function findEntry(
  id: string,
  kind: 'plugins' | 'skills',
  options: CatalogClientOptions,
): Promise<CatalogResult<CatalogEntry>> {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) return { ok: false, error: 'id 不合法' };
  const catalog = await fetchExtensionCatalog(options);
  if (!catalog.ok) return { ok: false, error: catalog.error };
  const entry = catalog.value[kind].find((item) => item.id === trimmed);
  if (!entry) return { ok: false, error: kind === 'plugins' ? '目录里没有这个插件' : '目录里没有这个技能' };
  return { ok: true, value: entry };
}

async function checkout(
  entry: CatalogEntry,
  options: CatalogClientOptions,
): Promise<CatalogResult<CatalogMaterialized>> {
  try {
    if (options.materialize) return { ok: true, value: await options.materialize(entry) };
    return await materializeCatalogEntry(entry, options);
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function validatePluginDir(dir: string): string | undefined {
  const linkError = rejectSymlinks(dir);
  if (linkError) return linkError;
  const manifestPath = path.join(dir, PLUGIN_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return `插件目录缺少 ${PLUGIN_MANIFEST_FILE}`;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  } catch {
    return `${PLUGIN_MANIFEST_FILE} 不是合法 JSON`;
  }
  const parsed = parsePluginManifest(raw);
  if (!parsed.ok) {
    return `插件清单无效: ${parsed.issues.map((issue) => issue.message).join('; ')}`;
  }
  const entryPath = path.resolve(dir, parsed.value.entry);
  if (isUnsafeRelativePath(parsed.value.entry) || !isInsideOrEqual(dir, entryPath)) {
    return '插件 entry 越出了插件目录';
  }
  if (!fs.existsSync(entryPath)) return `找不到插件入口 ${parsed.value.entry}`;
  return undefined;
}

function rejectSymlinks(dir: string): string | undefined {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return '无法读取要安装的目录';
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return '安装目录不能包含符号链接';
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return undefined;
}

function resolveEntryDir(root: string, entryPath?: string): { ok: true; dir: string } | { ok: false; error: string } {
  if (!entryPath || entryPath === '.') {
    return fs.existsSync(root) ? { ok: true, dir: root } : { ok: false, error: '仓库里没有这个路径' };
  }
  if (isUnsafeRelativePath(entryPath)) return { ok: false, error: '路径越出了仓库目录' };
  const resolved = path.resolve(root, entryPath);
  if (!isInsideOrEqual(root, resolved)) return { ok: false, error: '路径越出了仓库目录' };
  if (!fs.existsSync(resolved)) return { ok: false, error: '仓库里没有这个路径' };
  return { ok: true, dir: resolved };
}

function githubCloneUrl(repoOrUrl: string): { url: string } | undefined {
  const trimmed = repoOrUrl.trim();
  const match = GITHUB_HTTPS.exec(trimmed) ?? GITHUB_SSH.exec(trimmed);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!owner || !repo) return undefined;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return undefined;
  if (owner.includes('..') || repo.includes('..')) return undefined;
  return { url: `https://github.com/${owner}/${repo}.git` };
}

function validateRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!REF_PATTERN.test(trimmed) || trimmed.split('/').includes('..')) return '分支名不合法';
  return undefined;
}

function validateCatalogUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '目录地址不是 URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '目录地址必须是 http 或 https';
  return undefined;
}

function defaultRunGit(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        timeout: 120_000,
        maxBuffer: 2_000_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = `${stderr || ''}`.trim() || error.message;
        reject(new Error(detail.slice(0, 500)));
      },
    );
  });
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
