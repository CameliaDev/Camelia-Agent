/**
 * Argument parsing contract.
 *
 * The parser is hand-rolled, so it carries the whole CLI's surface area. These
 * tests pin the behaviours a typo'd flag depends on: unknown flags must be
 * rejected, not silently ignored (whitepaper §5.5).
 * @module
 */

import { describe, expect, it } from 'vitest';

import { ArgError, option, parseArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('collects positionals in order', () => {
    const args = parseArgs(['run', 'add', 'a', 'file']);
    expect(args.positionals).toEqual(['run', 'add', 'a', 'file']);
    expect(args.options.size).toBe(0);
    expect(args.flags.size).toBe(0);
  });

  it('parses a valued option and consumes its value', () => {
    const args = parseArgs(['run', '--workspace', '/tmp/ws', 'task']);
    expect(args.options.get('workspace')).toBe('/tmp/ws');
    expect(args.positionals).toEqual(['run', 'task']);
  });

  it('expands --key=value form', () => {
    const args = parseArgs(['run', '--workspace=/tmp/ws']);
    expect(args.options.get('workspace')).toBe('/tmp/ws');
    expect(args.positionals).toEqual(['run']);
  });

  it('treats known boolean flags as valueless', () => {
    const args = parseArgs(['run', '--mock', '--yes', '--json']);
    expect([...args.flags].sort()).toEqual(['json', 'mock', 'yes']);
    expect(args.positionals).toEqual(['run']);
  });

  it('maps short aliases to their long form', () => {
    const args = parseArgs(['run', '-w', '/tmp/ws', '-y', '-q']);
    expect(args.options.get('workspace')).toBe('/tmp/ws');
    expect(args.flags.has('yes')).toBe(true);
    expect(args.flags.has('quiet')).toBe(true);
  });

  it('rejects an unknown short flag', () => {
    expect(() => parseArgs(['run', '-z'])).toThrow(ArgError);
  });

  it('rejects a valued flag with no value', () => {
    expect(() => parseArgs(['run', '--workspace'])).toThrow(/requires a value/);
  });

  it('rejects a valued flag followed by another flag', () => {
    expect(() => parseArgs(['run', '--workspace', '--yes'])).toThrow(/requires a value/);
  });

  it('treats everything after -- as positionals', () => {
    const args = parseArgs(['run', '--', '--not-a-flag', '-x']);
    expect(args.positionals).toEqual(['run', '--not-a-flag', '-x']);
    expect(args.options.size).toBe(0);
    expect(args.flags.size).toBe(0);
  });
});

describe('option', () => {
  it('returns the value when present', () => {
    expect(option(parseArgs(['--model', 'x']), 'model')).toBe('x');
  });

  it('falls back when absent', () => {
    expect(option(parseArgs([]), 'model', 'default')).toBe('default');
    expect(option(parseArgs([]), 'model')).toBeUndefined();
  });
});