/**
 * GitHub Release interpretation for the in-app update check.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { compareVersions, interpretRelease, pickInstallerAsset } from '../src/window/updates.js';

describe('compareVersions', () => {
  it('orders dotted numeric versions and ignores a leading v', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0-beta', '0.1.0')).toBe(0);
  });
});

describe('pickInstallerAsset', () => {
  it('prefers the NSIS setup exe and skips blockmaps', () => {
    const setup = {
      name: 'Camelia_0.2.0_x64-setup.exe',
      browserDownloadUrl: 'https://github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe',
      size: 10,
    };
    const picked = pickInstallerAsset([
      { name: 'Camelia_0.2.0_x64-setup.exe.blockmap', browserDownloadUrl: 'https://github.com/x', size: 1 },
      { name: 'Camelia_0.2.0_x64.msi', browserDownloadUrl: 'https://github.com/y', size: 2 },
      setup,
    ]);
    expect(picked).toEqual(setup);
  });
});

describe('interpretRelease', () => {
  it('marks a newer tag as an update and keeps the setup asset', () => {
    const offer = interpretRelease('0.1.0', {
      tag_name: 'v0.2.0',
      body: 'notes',
      html_url: 'https://github.com/CameliaDev/Camelia-Agent/releases/tag/v0.2.0',
      assets: [
        {
          name: 'Camelia_0.2.0_x64-setup.exe',
          browser_download_url:
            'https://github.com/CameliaDev/Camelia-Agent/releases/download/v0.2.0/Camelia_0.2.0_x64-setup.exe',
          size: 4,
        },
      ],
    });
    expect(offer.updateAvailable).toBe(true);
    expect(offer.latest).toBe('0.2.0');
    expect(offer.asset?.name).toMatch(/setup\.exe$/);
    expect(offer.notes).toBe('notes');
  });

  it('does not offer an update when the tag matches the running version', () => {
    const offer = interpretRelease('0.1.0', { tag_name: 'v0.1.0', assets: [] });
    expect(offer.updateAvailable).toBe(false);
    expect(offer.asset).toBeNull();
  });
});
