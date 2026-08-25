/** Types shared by the console, the audience output and the stage display. */

export type Testament = 'OT' | 'NT';

export interface Book {
  id: string;
  name: string;
  abbr: string;
  testament: Testament;
  order: number;
  chapters: number[];
}

export interface Reference {
  bookId: string;
  book: string;
  chapter: number;
  verse: number | null;
  endChapter: number;
  endVerse: number | null;
  source?: string;
}

export interface Verse {
  bookId: string;
  book?: string;
  chapter: number;
  verse: number;
  text: string;
  label: string;
  score?: number;
  highlights?: [number, number][];
}

export interface TranslationInfo {
  id: string;
  name: string;
  abbr: string;
  year: number | null;
  lang: string;
  language: string;
  license: string;
  scope: 'full' | 'nt' | 'ot' | 'partial';
  note: string | null;
  verseCount: number;
  bookCount: number | null;
  imported: boolean;
  file?: string;
  installed?: boolean;
}

export interface CatalogueGroup {
  language: string;
  translations: TranslationInfo[];
}

export interface SongSection {
  id: string;
  type: string;
  number: number | null;
  label: string;
  body: string;
}

/**
 * Per-song overrides on top of the active theme.
 *
 * A hymn set in a serif face, or a chorus that needs to be a size smaller to
 * fit, should not require editing the theme every other song. Anything left
 * undefined falls through to the theme, so a song only carries what it changes.
 */
export interface SongStyle {
  fontFamily?: string;
  size?: number;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  color?: string;
  uppercase?: boolean;
  italic?: boolean;
  shadow?: boolean;
}

export interface Song {
  id: string;
  title: string;
  author: string;
  key: string;
  originalKey: string;
  tempo: number | null;
  timeSignature: string;
  ccli: string;
  copyright: string;
  capo: number | null;
  tags: string[];
  sections: SongSection[];
  arrangement: string[];
  notes: string;
  style?: SongStyle | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsedAt: string | null;
}

export type PlanItemKind = 'scripture' | 'song' | 'media' | 'slide' | 'announcement' | 'header';

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  title: string;
  ref: Reference | null;
  songId: string | null;
  mediaId: string | null;
  body: string;
  key: string | null;
  arrangement: string[] | null;
  duration: number | null;
  notes: string;
}

export interface Plan {
  id: string;
  name: string;
  date: string;
  notes: string;
  items: PlanItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A still or motion background behind the words.
 *
 * `dim` and `blur` are not decoration: a photograph busy enough to be worth
 * showing is usually busy enough to make white text unreadable, and darkening
 * or softening it is what makes the two coexist.
 */
export interface Backdrop {
  file: string;
  kind: 'image' | 'video';
  fit: 'cover' | 'contain';
  /** 0–1, how strongly the media shows over the theme's base colour. */
  opacity: number;
  /** 0–1 black scrim laid over the media, for text legibility. */
  dim: number;
  /** Gaussian blur in stage pixels. */
  blur: number;
}

export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  role?: 'background' | 'clip';
  tags?: string[];
  name: string;
  file: string;
  ext: string;
  bytes: number;
  addedAt: string;
  loop: boolean;
  muted: boolean;
}

/** One rendered screen of content. */
export interface Slide {
  id: string;
  /** Body lines — verses or lyric lines. */
  lines: string[];
  /** Small caption under the body: a reference or a section label. */
  caption?: string;
  /** Chord-annotated lines, for the stage display only. */
  chordLines?: string[];
  sectionLabel?: string;
  sectionType?: string;
  verseNumbers?: (number | null)[];
  continued?: boolean;
  /** Sermon outline with the current point marked, for live highlighting. */
  outline?: { text: string; active: boolean; subPoints?: string[] }[];
  /** Position of this slide's point within the outline. */
  pointIndex?: number;
  /** Full-bleed image for an imported presentation slide. */
  image?: string | null;
}

export type DeckKind = 'scripture' | 'song' | 'slide' | 'media' | 'sermon' | 'presentation' | 'blank';

export interface Deck {
  kind: DeckKind;
  title: string;
  slides: Slide[];
  index: number;
  meta: Record<string, unknown> & {
    translationAbbr?: string;
    songId?: string;
    mediaId?: string;
    mediaFile?: string;
    mediaKind?: 'image' | 'video';
    key?: string;
    style?: SongStyle | null;
  };
}

export interface Theme {
  id: string;
  name: string;
  background: {
    type: 'gradient' | 'solid' | 'image' | 'video';
    from: string;
    to: string;
    angle: number;
    image: string | null;
    opacity: number;
  };
  /**
   * Backgrounds chosen per kind of content, so scripture and songs can look
   * different without swapping themes mid-service. `null` falls through to
   * `default`, and `default` falls through to the base `background` above.
   */
  backdrops: {
    default: Backdrop | null;
    scripture: Backdrop | null;
    song: Backdrop | null;
  };
  text: {
    fontFamily: string;
    size: number;
    weight: number;
    color: string;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    shadow: boolean;
    uppercase: boolean;
    maxWidth: number;
  };
  reference: {
    show: boolean;
    size: number;
    color: string;
    weight: number;
    position: 'top' | 'bottom';
    uppercase: boolean;
  };
  padding: number;
  transition: { type: 'fade' | 'slide' | 'none'; duration: number };
  lowerThird: { enabled: boolean; height: number; background: string; accent: string };
}

export interface LiveStateShape {
  preview: Deck;
  program: Deck;
  blackout: boolean;
  cleared: boolean;
  theme: Theme | null;
  sectionLabels: boolean;
  logo: boolean;
  alert: { text: string; style: string; at: number } | null;
  countdown: { endsAt: number; label: string } | null;
  stage: { notes: string; nextLabel: string };
  updatedAt: number;
}

export interface Settings {
  general: {
    defaultTranslation: string;
    parallelTranslations: string[];
    confirmOnQuit: boolean;
    autoSaveSeconds: number;
  };
  presentation: {
    maxLinesPerSlide: number;
    versesPerSlide: number;
    showVerseNumbers: boolean;
    showTranslationAbbr: boolean;
    showSectionLabels: boolean;
    blankOnStart: boolean;
    clearBetweenItems: boolean;
  };
  stage: {
    showClock: boolean;
    showNextSlide: boolean;
    showChords: boolean;
    showNotes: boolean;
    countdownMinutes: number;
    fontSize: number;
  };
  ai: {
    smartSearch: boolean;
    liveDetection: boolean;
    detectionSensitivity: number;
    autoAdvance: boolean;
    localModelOnly: boolean;
  };
  displays: { outputScreenId: string | null; stageScreenId: string | null };
  online: {
    enabled: boolean;
    apiKey: string;
    endpoint: string;
    cache: boolean;
    bibles: string[];
  };
  backgrounds: {
    default: string | null;
    scripture: string | null;
    song: string | null;
    slide: string | null;
  };
  themes: Theme[];
  activeThemeId: string;
  hotkeys: Record<string, string>;
}

export interface StrongsEntry {
  ok: boolean;
  code: string;
  lang?: 'hebrew' | 'greek';
  lemma?: string;
  translit?: string;
  pronounce?: string;
  definition?: string;
  usage?: string;
  error?: string;
}

export interface Detection {
  reference: Reference;
  label: string;
  confidence: number;
  matched: string;
  via: 'reference' | 'quotation';
  verses?: Verse[];
  translationAbbr?: string;
}

/** The preload bridge, as seen from the renderer. */
export interface BridgeResult { ok: boolean; error?: string; [key: string]: unknown }

declare global {
  /** Injected at build time by Vite; identifies the renderer bundle. */
  const __BUILD_STAMP__: string;

  interface Window {
    bp: {
      bible: Record<string, (...args: never[]) => Promise<never>>;
      translations: Record<string, (...args: never[]) => Promise<never>>;
      songs: Record<string, (...args: never[]) => Promise<never>>;
      plans: Record<string, (...args: never[]) => Promise<never>>;
      settings: Record<string, (...args: never[]) => Promise<never>>;
      themes: Record<string, (...args: never[]) => Promise<never>>;
      live: Record<string, (...args: never[]) => Promise<never>>;
      schedule: Record<string, (...args: never[]) => Promise<never>>;
      collections: Record<string, (...args: never[]) => Promise<never>>;
      displays: Record<string, (...args: never[]) => Promise<never>>;
      ai: Record<string, (...args: never[]) => Promise<never>>;
      media: Record<string, (...args: never[]) => Promise<never>>;
      ew: Record<string, (...args: never[]) => Promise<never>>;
      presentations: Record<string, (...args: never[]) => Promise<never>>;
      sermons: Record<string, (...args: never[]) => Promise<never>>;
      online: Record<string, (...args: never[]) => Promise<never>>;
      outputServer: Record<string, (...args: never[]) => Promise<never>>;
      app: Record<string, (...args: never[]) => Promise<never>>;
      on: (event: string, handler: (payload: never) => void) => () => void;
      EVENTS: Record<string, string>;
      platform: string;
    };
  }
}
