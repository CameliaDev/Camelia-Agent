/**
 * Windows shell/fs bytes must not become mojibake in the transcript.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { decodeBytes, looksMojibake, repairMojibake } from '../src/utils/decode-bytes.js';

describe('decodeBytes', () => {
  it('keeps valid UTF-8', () => {
    const buf = new TextEncoder().encode('你好 Camelia');
    expect(decodeBytes(buf, 'linux')).toBe('你好 Camelia');
  });

  it('decodes GBK Chinese on win32', () => {
    // "你好" in GBK: C4 E3 BA C3
    const gbk = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
    const text = decodeBytes(gbk, 'win32');
    expect(text).toBe('你好');
    expect(looksMojibake(text)).toBe(false);
  });

  it('does not treat GBK as UTF-8 on win32', () => {
    const gbk = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
    const asUtf8 = new TextDecoder('utf-8').decode(gbk);
    expect(asUtf8.includes('\uFFFD') || looksMojibake(asUtf8) || asUtf8 !== '你好').toBe(true);
    expect(decodeBytes(gbk, 'win32')).toBe('你好');
  });
});

describe('repairMojibake', () => {
  it('leaves clean text alone', () => {
    expect(repairMojibake('plain 中文')).toBe('plain 中文');
  });
});
