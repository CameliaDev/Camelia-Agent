/**
 * Decode process / file bytes for display.
 *
 * On Chinese Windows, cmd/PowerShell often emit GBK (CP936). Decoding those
 * bytes as UTF-8 produces mojibake in the chat transcript. Prefer strict
 * UTF-8, then fall back to GBK / GB18030 on win32.
 * @module
 */

/** True when a decoded string looks like broken CJK / replacement soup. */
export function looksMojibake(text: string): boolean {
  if (!text) return false;
  if (text.includes('\uFFFD')) return true;
  // Classic UTF-8-as-Latin1 debris (common when GBK/UTF-8 is mislabeled).
  if (/[\u00C3\u00C2\u00C5]{2,}/.test(text)) return true;
  return false;
}

function tryDecode(label: string, buf: Uint8Array, fatal: boolean): string | undefined {
  try {
    return new TextDecoder(label, { fatal }).decode(buf);
  } catch {
    return undefined;
  }
}

/**
 * Decode a Buffer/Uint8Array to a JS string.
 * `platform` defaults to `process.platform` when available.
 */
export function decodeBytes(
  input: Uint8Array | ArrayBuffer,
  platform: string = typeof process !== 'undefined' ? process.platform : 'linux',
): string {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.byteLength === 0) return '';

  const utf8Strict = tryDecode('utf-8', buf, true);
  if (utf8Strict !== undefined) return utf8Strict;

  if (platform === 'win32') {
    for (const label of ['gb18030', 'gbk', 'gb2312'] as const) {
      const hit = tryDecode(label, buf, false);
      if (hit !== undefined && !looksMojibake(hit)) return hit;
    }
  }

  return new TextDecoder('utf-8').decode(buf);
}

/**
 * Attempt to repair a string that was already mis-decoded (latin1 view of
 * GBK/UTF-8 bytes). No-op when the text looks clean.
 */
export function repairMojibake(
  text: string,
  platform: string = typeof process !== 'undefined' ? process.platform : 'linux',
): string {
  if (!text || !looksMojibake(text)) return text;
  const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
  const fixed = decodeBytes(bytes, platform);
  return looksMojibake(fixed) ? text : fixed;
}
