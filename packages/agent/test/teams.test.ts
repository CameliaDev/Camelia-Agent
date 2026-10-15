import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteTeam, listTeams, saveTeam, teamModelForRole } from '../src/config/teams.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-team-home-'));
  vi.stubEnv('CAMELIA_HOME', home);
  return home;
}

describe('teams config', () => {
  it('saves, lists, and deletes a team with at least two members', () => {
    tempHome();
    const team = saveTeam({
      name: 'Dual',
      members: [
        { role: 'planner', model: 'alpha' },
        { role: 'worker', model: 'beta' },
      ],
    });
    expect(team.id).toBeTruthy();
    expect(listTeams()).toHaveLength(1);
    expect(teamModelForRole(team, 'worker')).toBe('beta');
    expect(deleteTeam(team.id)).toBe(true);
    expect(listTeams()).toHaveLength(0);
  });
});
