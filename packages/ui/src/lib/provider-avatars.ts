/**
 * Default circular avatars for connection presets / assistant bubbles.
 *
 * Aliyun (first preset) uses the product mark. Others are distinct SVG discs so
 * the Connections list and chat bubbles stay recognisable without remote assets.
 * @module
 */

import mascotUrl from '../assets/mascot.png';
import appIconUrl from '../assets/app-icon.png';

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function letterDisc(letter: string, bg: string, fg = '#ffffff'): string {
  const safe = letter.slice(0, 2);
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${bg}"/><text x="32" y="38" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="26" font-weight="600" fill="${fg}">${safe}</text></svg>`,
  );
}

/** Built-in provider id → avatar URL. Aliyun deliberately shares the app icon. */
export const PROVIDER_AVATAR_URL: Record<string, string> = {
  aliyun: appIconUrl || mascotUrl,
  ollama: letterDisc('Ol', '#1a9e6a'),
  openrouter: letterDisc('OR', '#6b4eff'),
  'opencode-zen': letterDisc('Z', '#0f766e'),
  zen: letterDisc('Z', '#0f766e'),
  custom: letterDisc('·', '#6b7280'),
};

const FALLBACK = letterDisc('AI', '#4b5563');

/**
 * Resolve an avatar for a provider id. Unknown ids get a stable coloured initial
 * disc derived from the id so custom presets still look distinct.
 */
export function providerAvatarSrc(providerId: string | undefined | null): string {
  const id = (providerId || '').trim().toLowerCase();
  if (!id) return mascotUrl;
  if (PROVIDER_AVATAR_URL[id]) return PROVIDER_AVATAR_URL[id]!;
  // Heuristic: treat *aliyun* / dashscope as the product mark.
  if (id.includes('aliyun') || id.includes('dashscope') || id.includes('qwen')) {
    return PROVIDER_AVATAR_URL.aliyun!;
  }
  if (id.includes('ollama')) return PROVIDER_AVATAR_URL.ollama!;
  if (id.includes('openrouter')) return PROVIDER_AVATAR_URL.openrouter!;
  if (id.includes('zen')) return PROVIDER_AVATAR_URL['opencode-zen']!;
  const letter = id.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'AI';
  const hue = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return letterDisc(letter, `hsl(${hue} 45% 42%)`);
}

/** First preset template (阿里云) avatar — documented product default. */
export function primaryPresetAvatarSrc(): string {
  return PROVIDER_AVATAR_URL.aliyun!;
}

export { mascotUrl, appIconUrl, FALLBACK as providerAvatarFallback };
