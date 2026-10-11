/**
 * Tolerant JSON extraction — the layer that stops a free model's formatting from
 * becoming a failed task (whitepaper §5.5).
 * @module
 */

import { describe, expect, it } from 'vitest';

import {
  extractFencedBlocks,
  extractJsonObject,
  firstBalancedObject,
  stripFences,
  stripTrailingCommas,
} from '../src/planning/json.js';

describe('stripFences', () => {
  it('unwraps a ```json fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('unwraps a bare ``` fence', () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('returns the input when there is no fence', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('firstBalancedObject', () => {
  it('extracts the first balanced object out of prose', () => {
    expect(firstBalancedObject('Sure! Here it is: {"a":{"b":1}} hope that helps')).toBe('{"a":{"b":1}}');
  });

  it('respects braces inside string literals', () => {
    expect(firstBalancedObject('{"text":"a } b"}')).toBe('{"text":"a } b"}');
  });

  it('respects escaped quotes', () => {
    expect(firstBalancedObject('{"text":"say \\"hi\\""}')).toBe('{"text":"say \\"hi\\""}');
  });

  it('returns undefined when nothing is balanced', () => {
    expect(firstBalancedObject('{"a":1')).toBeUndefined();
    expect(firstBalancedObject('no object here')).toBeUndefined();
  });
});

describe('stripTrailingCommas', () => {
  it('removes commas before a closing brace or bracket', () => {
    expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
    expect(stripTrailingCommas('[1,2,]')).toBe('[1,2]');
  });
});

describe('extractJsonObject', () => {
  it('parses a clean object', () => {
    expect(extractJsonObject('{"steps":[]}')).toEqual({ steps: [] });
  });

  it('parses through a markdown fence and prose', () => {
    const raw = 'Here is the plan:\n```json\n{"steps":[{"title":"a"}]}\n```\nDone.';
    expect(extractJsonObject(raw)).toEqual({ steps: [{ title: 'a' }] });
  });

  it('repairs a trailing comma', () => {
    expect(extractJsonObject('{"a":1,}')).toEqual({ a: 1 });
  });

  it('returns undefined for unparseable output instead of throwing', () => {
    expect(extractJsonObject('I cannot help with that.')).toBeUndefined();
    expect(extractJsonObject('{"a": }')).toBeUndefined();
  });

  it('never returns a non-object (arrays and scalars are rejected)', () => {
    expect(extractJsonObject('[1,2,3]')).toBeUndefined();
  });
});

describe('extractFencedBlocks', () => {
  it('captures label and body for each fenced block', () => {
    const blocks = extractFencedBlocks('```ts\nconst a = 1;\n```\ntext\n```\nplain\n```');
    expect(blocks).toEqual([
      { label: 'ts', body: 'const a = 1;\n' },
      { label: '', body: 'plain\n' },
    ]);
  });

  it('returns an empty list when there are no fences', () => {
    expect(extractFencedBlocks('nothing')).toEqual([]);
  });
});