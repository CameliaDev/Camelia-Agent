/**
 * Connection-preset avatars.
 *
 * Aliyun keeps the product mark. Every other preset is an ink chibi head in the
 * same family as the Camelia mascot: black hair, warm paper, no letter discs
 * and no coloured circles. Custom ids get the same drawing with a small mole
 * so they stay in the set without falling back to initials.
 * @module
 */

import mascotUrl from '../assets/mascot.png';
import appIconUrl from '../assets/app-icon.png';

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type ChibiVariant = 'tuft' | 'locks' | 'calm' | 'crop';

/**
 * One face, four hair silhouettes, drawn so a 32px circle still reads.
 *
 * Extra tufts painted on top of the bob vanish — they are the same ink. Each
 * variant is its own outer contour: ears, side locks, a bun, or a cowlick,
 * all inside the disc so `rounded-full` does not shear them off.
 */
function chibiHead(variant: ChibiVariant, mole = false): string {
  const ink = '#1b1916';
  const paper = '#f6f3ee';
  const face = '#fffdfb';
  // Shared bob. Variant marks are separate shapes that leave this silhouette,
  // so they stay visible instead of disappearing into the same fill.
  const bob = 'M15 36C15 22 22 18 32 18C42 18 49 22 49 36C49 52 42 58 32 58C22 58 15 52 15 36Z';
  const crest =
    variant === 'tuft'
      ? `<path fill="${ink}" d="M22 22C16 20 14 12 18 9C23 8 28 14 28 21Z"/><path fill="${ink}" d="M42 22C48 20 50 12 46 9C41 8 36 14 36 21Z"/>`
      : variant === 'locks'
        ? ''
        : variant === 'calm'
          ? `<circle cx="32" cy="12" r="5.2" fill="${ink}"/>`
          : `<path fill="${ink}" d="M30 18C28 7 40 6 36 17Z"/>`;
  const sideLocks =
    variant === 'locks'
      ? `<path fill="${ink}" d="M16 33C11 42 12 54 18 58C15 48 15 40 19 33Z"/><path fill="${ink}" d="M48 33C53 42 52 54 46 58C49 48 49 40 45 33Z"/>`
      : '';
  const bangs = 'M17 33C19 20 25 16 32 16C39 16 45 20 47 33C41 26 37 24 32 24C27 24 23 26 17 33Z';
  const eyes =
    variant === 'calm'
      ? `<path d="M21 38.2c2.6 2.8 5.6 2.8 8.2 0" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>` +
        `<path d="M34.8 38.2c2.6 2.8 5.6 2.8 8.2 0" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`
      : `<ellipse cx="25.2" cy="38.2" rx="4.1" ry="4.9" fill="#2f6ed6"/>` +
        `<ellipse cx="39.2" cy="38.2" rx="4.1" ry="4.9" fill="#2f6ed6"/>` +
        `<ellipse cx="25.2" cy="39.6" rx="2.1" ry="2.75" fill="#16356f"/>` +
        `<ellipse cx="39.2" cy="39.6" rx="2.1" ry="2.75" fill="#16356f"/>` +
        `<circle cx="26.7" cy="36.4" r="1.2" fill="#fff"/>` +
        `<circle cx="40.7" cy="36.4" r="1.2" fill="#fff"/>`;
  const beautyMark = mole ? `<circle cx="44.2" cy="44.6" r="1.15" fill="${ink}"/>` : '';
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<circle cx="32" cy="32" r="32" fill="${paper}"/>` +
      `<path fill="${ink}" d="${bob}"/>` +
      crest +
      `<path fill="${face}" d="M18 37c.4 11 6 18 14 18s13.6-7 14-18c0-8-6-14-14-14s-14 6-14 14z"/>` +
      `<path fill="${ink}" d="${bangs}"/>` +
      sideLocks +
      eyes +
      `<path d="M20 44.6c2.4.9 3.8.4 4.6-.7" fill="none" stroke="#e7aea8" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M39.4 43.9c2.4.9 3.8.4 4.6-.7" fill="none" stroke="#e7aea8" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M28.4 48.6c.9 1.4 1.8 1.6 2.5.1.7 1.5 1.7 1.3 2.6-.1" fill="none" stroke="${ink}" stroke-width="1.25" stroke-linecap="round"/>` +
      beautyMark +
      `</svg>`,
  );
}

/** Built-in provider id → avatar URL. Aliyun deliberately shares the app icon. */
export const PROVIDER_AVATAR_URL: Record<string, string> = {
  aliyun: appIconUrl || mascotUrl,
  ollama: chibiHead('tuft'),
  openrouter: chibiHead('locks'),
  'opencode-zen': chibiHead('calm'),
  zen: chibiHead('calm'),
  custom: chibiHead('crop'),
};

const FALLBACK = chibiHead('crop', true);

const CUSTOM_VARIANTS: readonly ChibiVariant[] = ['tuft', 'locks', 'calm', 'crop'];

/**
 * Resolve an avatar for a provider id.
 *
 * Unknown ids stay in the chibi set. A mole keeps them from impersonating a
 * built-in silhouette, and nothing here is a coloured initial.
 */
export function providerAvatarSrc(providerId: string | undefined | null): string {
  const id = (providerId || '').trim().toLowerCase();
  if (!id) return mascotUrl;
  if (PROVIDER_AVATAR_URL[id]) return PROVIDER_AVATAR_URL[id]!;
  if (id.includes('aliyun') || id.includes('dashscope') || id.includes('qwen')) {
    return PROVIDER_AVATAR_URL.aliyun!;
  }
  if (id.includes('ollama')) return PROVIDER_AVATAR_URL.ollama!;
  if (id.includes('openrouter')) return PROVIDER_AVATAR_URL.openrouter!;
  if (id.includes('zen')) return PROVIDER_AVATAR_URL['opencode-zen']!;
  const hash = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return chibiHead(CUSTOM_VARIANTS[hash % CUSTOM_VARIANTS.length]!, true);
}

/** First preset template (阿里云) avatar — documented product default. */
export function primaryPresetAvatarSrc(): string {
  return PROVIDER_AVATAR_URL.aliyun!;
}

export { mascotUrl, appIconUrl, FALLBACK as providerAvatarFallback };
