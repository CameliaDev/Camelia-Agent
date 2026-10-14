/**
 * Skill folders laid out the way Cursor and Claude Code do it.
 *
 * A skill is a directory with `SKILL.md` (optional YAML frontmatter `name` and
 * `description`). User installs land in `~/.camelia/skills`. Discovery also
 * reads the workspace and the home Cursor/Claude skill directories.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cameliaHome } from '../config/paths.js';

export type SkillSource = 'user' | 'workspace' | 'cursor' | 'claude' | 'agents' | 'picked';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  dir: string;
  source: SkillSource;
}

export interface SkillRoot {
  dir: string;
  source: SkillSource;
}

export function skillsUserRoot(): string {
  return path.join(cameliaHome(), 'skills');
}

export function skillScanRoots(workspace?: string, extraRoot?: string): SkillRoot[] {
  const roots: SkillRoot[] = [{ dir: skillsUserRoot(), source: 'user' }];
  if (workspace) {
    roots.push(
      { dir: path.join(workspace, '.camelia', 'skills'), source: 'workspace' },
      { dir: path.join(workspace, '.cursor', 'skills'), source: 'cursor' },
      { dir: path.join(workspace, '.claude', 'skills'), source: 'claude' },
      { dir: path.join(workspace, '.agents', 'skills'), source: 'agents' },
    );
  }
  const home = os.homedir();
  roots.push(
    { dir: path.join(home, '.cursor', 'skills'), source: 'cursor' },
    { dir: path.join(home, '.claude', 'skills'), source: 'claude' },
  );
  if (extraRoot?.trim()) roots.push({ dir: extraRoot.trim(), source: 'picked' });
  return roots;
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readSkillDir(dir: string, source: SkillSource): SkillInfo | undefined {
  const file = path.join(dir, 'SKILL.md');
  let text: string;
  try {
    if (!fs.statSync(file).isFile()) return undefined;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const meta = parseFrontmatter(text);
  const name = meta.name?.trim() || path.basename(dir);
  let description = meta.description?.trim() ?? '';
  if (!description) {
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    description =
      body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))
        ?.slice(0, 200) ?? '';
  }
  return { id: `${source}:${name}`, name, description, dir, source };
}

export function listSkillDirs(roots: readonly SkillRoot[]): SkillInfo[] {
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  for (const root of roots) {
    if (!root.dir) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(root.dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const direct = readSkillDir(root.dir, root.source);
    const dirs = direct
      ? [root.dir]
      : fs
          .readdirSync(root.dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(root.dir, entry.name));
    for (const dir of dirs) {
      const skill = readSkillDir(dir, root.source);
      if (!skill) continue;
      const key = path.resolve(skill.dir);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(skill);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir));
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'skill';
}

export function installSkillFolder(
  sourceDir: string,
  destRoot = skillsUserRoot(),
): { ok: true; skills: SkillInfo[] } | { ok: false; error: string } {
  const trimmed = sourceDir.trim();
  if (!trimmed) return { ok: false, error: '路径不能为空' };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    return { ok: false, error: '这不是文件夹' };
  }
  if (!stat.isDirectory()) return { ok: false, error: '这不是文件夹' };
  const found = listSkillDirs([{ dir: trimmed, source: 'picked' }]);
  if (found.length === 0) return { ok: false, error: '这个文件夹里没有 SKILL.md' };
  fs.mkdirSync(destRoot, { recursive: true });
  const installed: SkillInfo[] = [];
  for (const skill of found) {
    const dest = path.join(destRoot, safeName(skill.name));
    fs.cpSync(skill.dir, dest, { recursive: true });
    const copied = readSkillDir(dest, 'user');
    if (copied) installed.push(copied);
  }
  return { ok: true, skills: installed };
}
