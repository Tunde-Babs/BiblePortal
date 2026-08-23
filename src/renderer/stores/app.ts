/**
 * Console state.
 *
 * Deliberately thin: the *live* state lives in the main process (so the output
 * windows can never disagree with the console), and this store holds only what
 * belongs to the operator's own workspace — which panel is open, the library
 * caches, and the current selection.
 */

import { create } from 'zustand';
import { api } from '../../shared/api';
import type {
  Deck, LiveStateShape, MediaItem, Plan, Settings, Slide, Song, TranslationInfo, Verse,
} from '../../shared/types';

export type PanelId =
  | 'bible' | 'songs' | 'plan' | 'theme' | 'media' | 'presentations' | 'notes'
  | 'detect' | 'displays' | 'study' | 'settings';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

interface AppState {
  ready: boolean;
  bootError: string | null;

  panel: PanelId;
  setPanel: (panel: PanelId) => void;

  live: LiveStateShape | null;
  settings: Settings | null;
  translations: TranslationInfo[];
  songs: Song[];
  plans: Plan[];
  media: MediaItem[];
  activePlanId: string | null;

  toasts: Toast[];
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;

  boot: () => Promise<void>;
  refreshSongs: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  refreshMedia: () => Promise<void>;
  refreshTranslations: () => Promise<void>;
  patchSettings: (patch: Record<string, unknown>) => Promise<void>;
  setActivePlan: (id: string | null) => void;

  /** Stage a deck into preview. */
  preview: (deck: Partial<Deck>) => Promise<void>;
  /** Stage and immediately take to air. */
  previewAndTake: (deck: Partial<Deck>) => Promise<void>;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,

  panel: 'bible',
  setPanel: (panel) => set({ panel }),

  live: null,
  settings: null,
  translations: [],
  songs: [],
  plans: [],
  media: [],
  activePlanId: null,

  toasts: [],
  toast: (message, tone = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    // Errors stay long enough to read; everything else is transient.
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 3400);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  boot: async () => {
    try {
      const [live, settings, manifest, songs, plans, media] = await Promise.all([
        api.live.get(),
        api.settings.get(),
        api.bible.manifest(),
        api.songs.all(),
        api.plans.all(),
        api.media.all(),
      ]);

      set({
        live, settings, songs, plans, media,
        translations: manifest.translations ?? [],
        activePlanId: plans[0]?.id ?? null,
        ready: true,
      });

      // Live state is pushed from main; this is the only subscription needed.
      api.on(api.events().LIVE_CHANGED, (next: never) => set({ live: next as LiveStateShape }));

      api.on(api.events().LIBRARY_CHANGED, (payload: never) => {
        const kind = (payload as { kind?: string })?.kind;
        if (kind === 'songs' || kind === 'all') void get().refreshSongs();
        if (kind === 'media' || kind === 'all') void get().refreshMedia();
        if (kind === 'translations' || kind === 'all') void get().refreshTranslations();
        if (kind === 'all') void get().refreshPlans();
      });
    } catch (err) {
      set({ bootError: err instanceof Error ? err.message : String(err), ready: true });
    }
  },

  refreshSongs: async () => set({ songs: await api.songs.all() }),
  refreshPlans: async () => set({ plans: await api.plans.all() }),
  refreshMedia: async () => set({ media: await api.media.all() }),
  refreshTranslations: async () => {
    const manifest = await api.bible.manifest();
    set({ translations: manifest.translations ?? [] });
  },

  patchSettings: async (patch) => {
    const settings = await api.settings.patch(patch);
    set({ settings });
  },

  setActivePlan: (id) => set({ activePlanId: id }),

  preview: async (deck) => {
    const live = await api.live.preview(deck);
    set({ live });
  },

  previewAndTake: async (deck) => {
    await api.live.preview(deck);
    const live = await api.live.take();
    set({ live });
  },
}));

// ------------------------------------------------------------------ helpers

/**
 * The background assigned to a content type, falling back to `default`.
 * Returns the meta fields a deck needs to render it.
 */
export function backgroundMeta(kind: 'scripture' | 'song' | 'slide'): Record<string, unknown> {
  const { settings, media } = useApp.getState();
  const chosen = settings?.backgrounds?.[kind] ?? settings?.backgrounds?.default ?? null;
  if (!chosen) return {};
  const item = media.find((m) => m.id === chosen);
  if (!item) return {};
  return { mediaId: item.id, mediaFile: item.file, mediaKind: item.kind };
}

/** Build a scripture deck from a lookup result. */
export function scriptureDeck(
  label: string,
  verses: Verse[],
  translationAbbr: string,
  versesPerSlide: number,
): Partial<Deck> {
  const slides: Slide[] = [];
  for (let i = 0; i < verses.length; i += versesPerSlide) {
    const group = verses.slice(i, i + versesPerSlide);
    slides.push({
      id: `v_${group[0].bookId}_${group[0].chapter}_${group[0].verse}`,
      lines: group.map((v) => v.text),
      verseNumbers: group.map((v) => v.verse),
      caption: group.length > 1
        ? `${group[0].label}-${group[group.length - 1].verse}`
        : group[0].label,
    });
  }
  return {
    kind: 'scripture',
    title: `${label} · ${translationAbbr}`,
    slides,
    index: 0,
    meta: { translationAbbr, ...backgroundMeta('scripture') },
  };
}

/** Build a song deck from pre-split slides. */
export function songDeck(song: Song, slides: Slide[], key?: string): Partial<Deck> {
  return {
    kind: 'song',
    title: song.title,
    slides: slides.map((s) => ({ ...s, caption: s.sectionLabel })),
    index: 0,
    meta: { songId: song.id, key: key ?? song.key, style: song.style ?? null, ...backgroundMeta('song') },
  };
}

/** Build a deck holding one free-text slide. */
export function textDeck(title: string, body: string): Partial<Deck> {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    kind: 'slide',
    title,
    slides: [{ id: `t_${Date.now()}`, lines: lines.length ? lines : [title] }],
    index: 0,
    meta: { ...backgroundMeta('slide') },
  };
}

/** Build a deck that shows a media background with no text. */
export function mediaDeck(item: MediaItem): Partial<Deck> {
  return {
    kind: 'media',
    title: item.name,
    slides: [{ id: item.id, lines: [] }],
    index: 0,
    meta: { mediaId: item.id, mediaFile: item.file, mediaKind: item.kind },
  };
}
