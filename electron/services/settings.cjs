'use strict';
/**
 * Application settings and presentation themes, with defaults that produce a
 * good-looking output on the very first launch.
 */

const DOC = 'settings';

const DEFAULT_THEME = {
  id: 'theme_default',
  name: 'Sanctuary',
  background: { type: 'gradient', from: '#0b1020', to: '#131a33', angle: 160, image: null, opacity: 1 },
  /** Per-content backgrounds; null falls through to `background` above. */
  backdrops: { default: null, scripture: null, song: null },
  text: {
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    size: 62, weight: 600, color: '#ffffff', align: 'center', lineHeight: 1.28,
    shadow: true, uppercase: false, maxWidth: 88,
  },
  reference: { show: true, size: 26, color: '#9db4ff', weight: 500, position: 'bottom', uppercase: true },
  padding: 7,
  transition: { type: 'fade', duration: 320 },
  lowerThird: { enabled: false, height: 26, background: 'rgba(6,10,24,0.86)', accent: '#5b7cfa' },
};

const DEFAULTS = {
  format: 'bibleportal.settings/1',
  general: {
    defaultTranslation: 'kjv',
    parallelTranslations: ['kjv', 'web'],
    confirmOnQuit: true,
    autoSaveSeconds: 20,
  },
  presentation: {
    maxLinesPerSlide: 4,
    versesPerSlide: 2,
    showVerseNumbers: true,
    showTranslationAbbr: true,
    /**
     * Section labels ("Verse 3", "Chorus") on the audience screen. Off by
     * default: they orient the operator, but the congregation is reading the
     * words, not the structure. Scripture references are governed separately —
     * those must keep showing, and for a licensed translation the abbreviation
     * is a condition of the publisher's permission.
     */
    showSectionLabels: false,
    blankOnStart: true,
    clearBetweenItems: false,
  },
  /**
   * Serving the audience output to OBS (or any browser) on this machine.
   * Off until asked for — nothing should open a port on a church network
   * without the operator choosing it.
   */
  outputServer: {
    enabled: false,
    port: 7373,
    /** Loopback only unless the operator opts in to other machines. */
    allowLan: false,
  },
  stage: {
    showClock: true,
    showNextSlide: true,
    showChords: true,
    showNotes: true,
    countdownMinutes: 5,
    fontSize: 40,
  },
  ai: {
    smartSearch: true,
    liveDetection: false,
    detectionSensitivity: 0.62,
    autoAdvance: false,
    localModelOnly: true,
  },
  displays: { outputScreenId: null, stageScreenId: null },
  /**
   * Licensed translations reached through API.Bible under the user's own key.
   * The key lives here, in the user's settings file — never in the repository.
   */
  online: {
    enabled: false,
    apiKey: '',
    endpoint: '',
    cache: true,
    /** Translation ids the operator has chosen to show in the picker. */
    bibles: [],
  },
  /**
   * Background media per content type. Churches almost always want a different
   * look behind scripture than behind lyrics, so these are set independently
   * and fall back to `default` when unset.
   */
  backgrounds: {
    default: null,
    scripture: null,
    song: null,
    slide: null,
  },
  themes: [DEFAULT_THEME],
  activeThemeId: DEFAULT_THEME.id,
  hotkeys: {
    take: 'Space', blackout: 'Escape', clear: 'Backspace',
    next: 'ArrowDown', previous: 'ArrowUp', search: 'CmdOrCtrl+K',
  },
};

/** Merge stored settings over the defaults, one level deep per section. */
function merge(defaults, stored) {
  if (!stored || typeof stored !== 'object') return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(stored)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = { ...out[key], ...value };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

class SettingsService {
  /** @param {import('./store.cjs').Store} store */
  constructor(store) { this.store = store; }

  async get() {
    const stored = await this.store.read(DOC, null);
    return merge(DEFAULTS, stored);
  }

  /** Patch one or more sections. Unknown keys are preserved. */
  async patch(patch) {
    const current = await this.get();
    const next = merge(current, patch);
    await this.store.write(DOC, next);
    return next;
  }

  async reset() {
    const fresh = structuredClone(DEFAULTS);
    await this.store.write(DOC, fresh);
    return fresh;
  }

  async themes() { return (await this.get()).themes; }

  async activeTheme() {
    const s = await this.get();
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0] ?? DEFAULT_THEME;
  }

  async saveTheme(theme) {
    const s = await this.get();
    const themes = [...s.themes];
    const id = theme.id ?? `theme_${Date.now().toString(36)}`;
    const record = merge(DEFAULT_THEME, { ...theme, id });
    const i = themes.findIndex((t) => t.id === id);
    if (i >= 0) themes[i] = record; else themes.push(record);
    await this.patch({ themes });
    return record;
  }

  async deleteTheme(id) {
    const s = await this.get();
    if (s.themes.length <= 1) throw new Error('At least one theme must remain');
    const themes = s.themes.filter((t) => t.id !== id);
    const activeThemeId = s.activeThemeId === id ? themes[0].id : s.activeThemeId;
    await this.patch({ themes, activeThemeId });
    return { ok: true };
  }
}

module.exports = { SettingsService, DEFAULTS, DEFAULT_THEME };
