/**
 * Turns a theme + slide into concrete CSS.
 *
 * The console preview, the audience output and the stage display all render
 * through this one module. That is what guarantees the small preview on the
 * operator's screen is a truthful miniature of what the room is seeing —
 * "preview parity" is the property a live console lives or dies on.
 */

import type { CSSProperties } from 'react';
import type { Deck, Slide, SongStyle, Theme } from './types';

/** The design resolution every surface scales from. */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

export const FALLBACK_THEME: Theme = {
  id: 'fallback',
  name: 'Fallback',
  background: { type: 'gradient', from: '#0b1020', to: '#131a33', angle: 160, image: null, opacity: 1 },
  text: {
    fontFamily: "'Inter', system-ui, sans-serif",
    size: 62, weight: 600, color: '#ffffff', align: 'center',
    lineHeight: 1.28, shadow: true, uppercase: false, maxWidth: 88,
  },
  reference: { show: true, size: 26, color: '#9db4ff', weight: 500, position: 'bottom', uppercase: true },
  padding: 7,
  transition: { type: 'fade', duration: 320 },
  lowerThird: { enabled: false, height: 26, background: 'rgba(6,10,24,0.86)', accent: '#5b7cfa' },
};

export function backgroundStyle(theme: Theme): CSSProperties {
  const bg = theme.background;
  if (bg.type === 'solid') return { background: bg.from };
  if (bg.type === 'image' && bg.image) {
    return { backgroundImage: `url("${bg.image}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: `linear-gradient(${bg.angle}deg, ${bg.from} 0%, ${bg.to} 100%)` };
}

/**
 * Body type size, in stage pixels.
 *
 * Long passages must shrink or they overflow the screen — the single most
 * common failure in church presentation. The curve is deliberately gentle so
 * consecutive slides don't visibly jump in size mid-passage.
 */
export function bodyFontSize(slide: Slide | null, theme: Theme): number {
  const base = theme.text.size;
  if (!slide) return base;

  const chars = slide.lines.join(' ').length;
  const lines = slide.lines.length;

  // Two independent pressures: total characters, and line count.
  const charScale = chars <= 120 ? 1
    : chars <= 200 ? 0.92
    : chars <= 300 ? 0.82
    : chars <= 420 ? 0.72
    : chars <= 600 ? 0.63
    : 0.55;

  const lineScale = lines <= 4 ? 1 : lines <= 6 ? 0.9 : lines <= 8 ? 0.8 : 0.7;

  return Math.round(base * Math.min(charScale, lineScale));
}

/**
 * Body style, scaled to the surface.
 *
 * `scale` is the surface width divided by the 1920px design width. Type and
 * shadows are multiplied by it while spacing stays proportional, so a small
 * preview is a true miniature of the projector without rendering a
 * 1920x1080 layer and shrinking it — which on a HiDPI screen asks the
 * compositor for a 3840x2160 texture per surface and can silently fail to paint.
 */
export function bodyStyle(
  slide: Slide | null,
  theme: Theme,
  scale = 1,
  override?: SongStyle | null,
): CSSProperties {
  // A song's own settings win over the theme; anything it does not set falls
  // through, so a song carries only what it actually changes.
  const t = { ...theme.text, ...stripUndefined(override) };
  const px = (v: number) => `${Math.max(v * scale, 0.01)}px`;
  const base = override?.size ?? bodyFontSize(slide, theme);
  return {
    fontFamily: t.fontFamily,
    fontSize: px(override?.size ? fitOverride(slide, base) : base),
    fontWeight: t.weight,
    color: t.color,
    textAlign: t.align,
    lineHeight: t.lineHeight,
    fontStyle: override?.italic ? 'italic' : 'normal',
    maxWidth: `${theme.text.maxWidth}%`,
    textTransform: t.uppercase ? 'uppercase' : 'none',
    textShadow: t.shadow
      ? `0 ${px(3)} ${px(22)} rgba(0,0,0,0.62), 0 ${px(1)} ${px(3)} rgba(0,0,0,0.5)`
      : 'none',
    textWrap: 'balance',
  };
}

/** Drop undefined keys so a spread does not overwrite theme values with nothing. */
function stripUndefined<T extends object>(o: T | null | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Even an explicit size must not overflow the screen — a long verse at 90px
 * would run off the bottom. Shrink only when it genuinely does not fit.
 */
function fitOverride(slide: Slide | null, size: number): number {
  if (!slide) return size;
  const chars = slide.lines.join(' ').length;
  const lines = slide.lines.length;
  const pressure = Math.max(chars / 320, lines / 6, 1);
  return Math.round(size / pressure);
}

export function captionStyle(theme: Theme, scale = 1): CSSProperties {
  const r = theme.reference;
  const px = (v: number) => `${Math.max(v * scale, 0.01)}px`;
  return {
    fontFamily: theme.text.fontFamily,
    fontSize: px(r.size),
    fontWeight: r.weight,
    color: r.color,
    textTransform: r.uppercase ? 'uppercase' : 'none',
    letterSpacing: r.uppercase ? '0.09em' : '0.01em',
    textShadow: theme.text.shadow ? `0 ${px(2)} ${px(12)} rgba(0,0,0,0.6)` : 'none',
  };
}

export function frameStyle(theme: Theme, scale = 1): CSSProperties {
  return {
    padding: `${theme.padding}%`,
    gap: `${Math.max(44 * scale, 2)}px`,
    flexDirection: theme.reference.position === 'top' ? 'column-reverse' : 'column',
  };
}

/** The slide currently on air for a deck, or null when the deck is empty. */
export function slideOf(deck: Deck | null | undefined): Slide | null {
  if (!deck?.slides?.length) return null;
  return deck.slides[Math.max(0, Math.min(deck.index, deck.slides.length - 1))] ?? null;
}

export function nextSlideOf(deck: Deck | null | undefined): Slide | null {
  if (!deck?.slides?.length) return null;
  return deck.slides[deck.index + 1] ?? null;
}

/** Caption text for a slide: the reference, or the song section. */
export function captionOf(slide: Slide | null, deck: Deck | null | undefined, showTranslation = true): string {
  if (!slide) return '';
  if (slide.caption) {
    const abbr = deck?.meta?.translationAbbr;
    return showTranslation && abbr ? `${slide.caption} · ${abbr}` : slide.caption;
  }
  return slide.sectionLabel ?? '';
}

/**
 * Scale factor to fit the 1920×1080 design surface into a container.
 * Rendering at a fixed size and scaling keeps every surface pixel-identical.
 */
export function fitScale(containerW: number, containerH: number): number {
  if (!containerW || !containerH) return 0;
  return Math.min(containerW / STAGE_W, containerH / STAGE_H);
}
