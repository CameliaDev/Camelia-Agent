/**
 * Boot-contract tests.
 *
 * The shell is the authority on what the app projects, so the precedence it establishes —
 * boot config, then URL, then the empty default — is a contract, not an implementation
 * detail. A regression here would silently make the desktop app show a state nobody asked
 * for, which is exactly the failure the empty default exists to prevent.
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createTransport } from '../src/transport/index.js';
import { FixtureTransport } from '../src/transport/fixture.js';
import { readBootConfig } from '../src/transport/boot.js';

function sceneOf(search: string): string {
  const transport = createTransport(search);
  expect(transport).toBeInstanceOf(FixtureTransport);
  return (transport as FixtureTransport).scene;
}

afterEach(() => {
  delete window.__CAMELIA_BOOT__;
});

describe('createTransport scene resolution', () => {
  it('defaults to the empty state when nothing asks otherwise', () => {
    expect(sceneOf('')).toBe('empty');
  });

  it('reads the scene from the URL in a plain browser', () => {
    expect(sceneOf('?scene=diff')).toBe('diff');
  });

  it('lets the native shell override the URL', () => {
    window.__CAMELIA_BOOT__ = { scene: 'approval' };
    expect(sceneOf('?scene=diff')).toBe('approval');
  });

  it('falls back to empty when the shell passes an unknown scene', () => {
    window.__CAMELIA_BOOT__ = { scene: 'not-a-scene' };
    expect(sceneOf('')).toBe('empty');
  });

  it('falls back to empty when the URL carries an unknown scene', () => {
    expect(sceneOf('?scene=nope')).toBe('empty');
  });

  it('replays instantly unless the URL asks for timed', () => {
    expect(createTransport('?scene=diff&replay=timed')).toBeInstanceOf(FixtureTransport);
    expect(createTransport('?scene=diff').kind).toBe('fixture');
  });
});

describe('readBootConfig', () => {
  it('returns an empty config when the shell injected nothing', () => {
    expect(readBootConfig()).toEqual({});
  });

  it('returns the injected config verbatim', () => {
    window.__CAMELIA_BOOT__ = { scene: 'done', engineUrl: 'http://127.0.0.1:7433', sessionId: 'ses_1' };
    expect(readBootConfig()).toEqual({
      scene: 'done',
      engineUrl: 'http://127.0.0.1:7433',
      sessionId: 'ses_1',
    });
  });
});

describe('engineSpawnError boot field', () => {
  it('preserves spawn failure reasons from the shell', () => {
    window.__CAMELIA_BOOT__ = {
      engineSpawnError: 'Node/better-sqlite3 ABI mismatch (probe)',
    };
    expect(readBootConfig().engineSpawnError).toContain('ABI mismatch');
  });

  it('still uses fixture transport when spawn failed (no fake live URL)', () => {
    window.__CAMELIA_BOOT__ = {
      engineSpawnError: 'Node/better-sqlite3 ABI mismatch (probe)',
    };
    const transport = createTransport('');
    expect(transport).toBeInstanceOf(FixtureTransport);
    expect(transport.kind).toBe('fixture');
  });
});
