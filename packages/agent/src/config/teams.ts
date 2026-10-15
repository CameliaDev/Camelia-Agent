/**
 * User-defined teams persisted under `~/.camelia/teams.json`.
 * @module
 */

import fs from 'node:fs';

import { newId, type Id } from '@camelia/core';

import { paths } from './paths.js';

export interface TeamMemberDef {
  role: string;
  model: string;
}

export interface TeamDef {
  id: Id;
  name: string;
  members: TeamMemberDef[];
  updatedAt: number;
}

interface TeamsDocument {
  version: 1;
  teams: TeamDef[];
}

const EMPTY: TeamsDocument = { version: 1, teams: [] };

function teamsPath(): string {
  return paths.teams();
}

function readDoc(): TeamsDocument {
  const file = teamsPath();
  if (!fs.existsSync(file)) return { ...EMPTY, teams: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TeamsDocument;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.teams)) return { ...EMPTY, teams: [] };
    return parsed;
  } catch {
    return { ...EMPTY, teams: [] };
  }
}

function writeDoc(doc: TeamsDocument): void {
  fs.mkdirSync(paths.home(), { recursive: true });
  fs.writeFileSync(teamsPath(), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

export function listTeams(): TeamDef[] {
  return readDoc().teams.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTeam(id: Id): TeamDef | undefined {
  return listTeams().find((team) => team.id === id);
}

export function saveTeam(input: { id?: Id; name: string; members: TeamMemberDef[] }): TeamDef {
  const name = input.name.trim();
  if (!name) throw new Error('team name is required');
  const members = input.members
    .map((member) => ({ role: member.role.trim(), model: member.model.trim() }))
    .filter((member) => member.role && member.model);
  if (members.length < 2) throw new Error('a team needs at least two members');
  const doc = readDoc();
  const now = Date.now();
  const existing = input.id ? doc.teams.find((team) => team.id === input.id) : undefined;
  const team: TeamDef = existing
    ? { ...existing, name, members, updatedAt: now }
    : { id: newId(), name, members, updatedAt: now };
  const next = existing ? doc.teams.map((row) => (row.id === team.id ? team : row)) : [team, ...doc.teams];
  writeDoc({ version: 1, teams: next });
  return team;
}

export function deleteTeam(id: Id): boolean {
  const doc = readDoc();
  const next = doc.teams.filter((team) => team.id !== id);
  if (next.length === doc.teams.length) return false;
  writeDoc({ version: 1, teams: next });
  return true;
}

/** Map coordinator worker role → configured model id. */
export function teamModelForRole(team: TeamDef, role: string): string | undefined {
  const key = role.trim().toLowerCase();
  const hit = team.members.find((member) => member.role.trim().toLowerCase() === key);
  return hit?.model;
}
