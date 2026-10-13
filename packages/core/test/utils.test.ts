import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { Err, Ok, unwrap } from '../src/types/common.js';
import { fingerprint, newId, shortId } from '../src/utils/id.js';
import { assertWithin, isWithin, relativeTo, stem, toPosix } from '../src/utils/paths.js';
import { estimateTokens, estimateTotal, withSafetyMargin } from '../src/utils/tokens.js';

describe('id utils', () => {
  it('newId returns a uuid', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('shortId has the requested length and is url-safe', () => {
    const id = shortId(10);
    expect(id).toHaveLength(10);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it('fingerprint is deterministic and differs for different inputs', () => {
    expect(fingerprint('a')).toBe(fingerprint('a'));
    expect(fingerprint('a')).not.toBe(fingerprint('b'));
    expect(fingerprint('a')).toHaveLength(8);
  });
});

describe('token utils', () => {
  it('estimates tokens for text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(2);
  });

  it('estimates tokens for a list with per-item overhead', () => {
    const total = estimateTotal([{ a: 1 }, { b: 2 }], 4);
    expect(total).toBeGreaterThan(8);
  });

  it('applies a safety margin', () => {
    expect(withSafetyMargin(100)).toBe(110);
    expect(withSafetyMargin(100, 1)).toBe(100);
  });
});

describe('path utils', () => {
  const root = path.resolve('/tmp/workspace');

  it('normalizes windows separators', () => {
    expect(toPosix('a\\b\\c')).toBe('a/b/c');
  });

  it('computes workspace-relative posix paths', () => {
    expect(relativeTo(root, 'src/index.ts')).toBe('src/index.ts');
  });

  it('accepts paths inside the root', () => {
    expect(isWithin(root, 'src/a.ts')).toBe(true);
    expect(isWithin(root, '.')).toBe(true);
  });

  it('rejects traversal outside the root', () => {
    expect(isWithin(root, '../secrets.txt')).toBe(false);
    expect(isWithin(root, 'a/../../b')).toBe(false);
    expect(isWithin(root, path.resolve('/etc/passwd'))).toBe(false);
  });

  it('assertWithin throws for escapes and returns the resolved path otherwise', () => {
    expect(() => assertWithin(root, '../x')).toThrow(/escapes workspace/);
    expect(assertWithin(root, 'src/a.ts')).toBe(path.resolve(root, 'src/a.ts'));
  });

  it('keeps a Windows drive workspace stable on POSIX', () => {
    expect(toPosix(assertWithin('C:/workspace', 'a.txt'))).toBe('C:/workspace/a.txt');
    expect(relativeTo('C:/workspace', 'src/a.ts')).toBe('src/a.ts');
    expect(isWithin('C:/workspace', 'src/a.ts')).toBe(true);
    expect(isWithin('C:/workspace', '../secrets.txt')).toBe(false);
    expect(isWithin('C:/workspace', 'C:/workspace/../Windows/System32')).toBe(false);
    expect(isWithin('C:/workspace', 'D:/secret')).toBe(false);
    expect(() => assertWithin('C:/workspace', '../x')).toThrow(/escapes workspace/);
  });

  it('extracts the stem', () => {
    expect(stem('a/b/c.test.ts')).toBe('c.test');
    expect(stem('README')).toBe('README');
  });
});

describe('Result', () => {
  it('Ok/Err/unwrap behave', () => {
    expect(unwrap(Ok(5))).toBe(5);
    expect(() => unwrap(Err(new Error('nope')))).toThrow('nope');
  });

  it('unwrap wraps non-Error values', () => {
    expect(() => unwrap(Err('plain-string'))).toThrow('plain-string');
  });
});