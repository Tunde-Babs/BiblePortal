/**
 * Typed wrapper over the preload bridge.
 *
 * Every call goes through `call()`, which turns a `{ok:false,error}` reply into
 * a thrown Error so callers can use ordinary try/catch instead of checking a
 * flag at every site.
 */

import type {
  Book, Deck, Detection, LiveStateShape, MediaItem, Plan, PlanItem, Settings,
  Slide, Song, SongSection, StrongsEntry, Theme, TranslationInfo, CatalogueGroup,
  Verse, Reference,
} from './types';

const bridge = () => {
  if (typeof window === 'undefined' || !window.bp) {
    throw new Error('BiblePortal bridge unavailable — this window was not created by the app.');
  }
  return window.bp;
};

/** Unwrap a bridge reply, throwing on failure. */
async function call<T = Record<string, unknown>>(fn: () => Promise<unknown>): Promise<T> {
  const res = (await fn()) as { ok?: boolean; error?: string } & T;
  if (res && res.ok === false) throw new Error(res.error ?? 'Request failed');
  return res as T;
}

export interface LookupResult {
  ok: boolean;
  reference: Reference;
  label: string;
  translation: string;
  translationName: string;
  translationAbbr: string;
  verses: Verse[];
}

export interface SearchResult {
  ok: boolean;
  query: string;
  translation?: string;
  translationAbbr?: string;
  total: number;
  results: Verse[];
}

/**
 * Each variant carries a single literal `kind` so TypeScript can narrow the
 * union properly — a shared `'reference' | 'corrected'` discriminant blocks it.
 */
export type SmartResult =
  | ({ kind: 'reference'; query: string } & LookupResult)
  | ({ kind: 'corrected'; query: string; suggestion: string } & LookupResult)
  | ({ kind: 'text' } & SearchResult)
  | { kind: 'empty'; query: string };

export const api = {
  // ------------------------------------------------------------------ bible
  bible: {
    manifest: () => call<{ translations: TranslationInfo[]; defaultId: string; lexicon: string | null }>(() => bridge().bible.manifest()),
    books: () => call<{ books: Book[] }>(() => bridge().bible.books()).then((r) => r.books),
    lookup: (ref: string, translation?: string) => call<LookupResult>(() => bridge().bible.lookup(ref as never, translation as never)),
    chapter: (bookId: string, chapter: number, translation?: string) =>
      call<{ book: string; bookId: string; chapter: number; chapterCount: number; verses: { verse: number; text: string }[]; translationName: string }>(
        () => bridge().bible.chapter(bookId as never, chapter as never, translation as never)),
    search: (q: string, opts?: Record<string, unknown>) => call<SearchResult>(() => bridge().bible.search(q as never, opts as never)),
    smart: (q: string, opts?: Record<string, unknown>) => call<SmartResult>(() => bridge().bible.smart(q as never, opts as never)),
    suggest: (q: string, opts?: Record<string, unknown>) =>
      call<{ suggestions: Suggestion[] }>(() => bridge().bible.suggest(q as never, opts as never)).then((r) => r.suggestions),
    parallel: (ref: string, ids: string[]) =>
      call<{ label: string; columns: { id: string; name: string; abbr: string; verses: Verse[] }[] }>(
        () => bridge().bible.parallel(ref as never, ids as never)),
    strongs: (code: string) => bridge().bible.strongs(code as never) as Promise<StrongsEntry>,
    lexiconSearch: (q: string, limit?: number) =>
      call<{ results: (StrongsEntry & { code: string })[] }>(() => bridge().bible.lexiconSearch(q as never, limit as never)).then((r) => r.results),
    stats: () => call(() => bridge().bible.stats()),
  },

  // ----------------------------------------------------------- translations
  translations: {
    catalogue: () => call<{ groups: CatalogueGroup[]; installedCount: number; licensed: { abbr: string; name: string; holder: string }[] }>(
      () => bridge().translations.catalogue()),
    install: (id: string) => call<{ id: string; name: string; verseCount: number }>(() => bridge().translations.install(id as never)),
    pickModule: () => call<{ path: string | null }>(() => bridge().translations.pickModule()),
    inspect: (path: string) => call<{ format: string; name: string; abbr: string; suggestedId: string; verseCount: number; bookCount: number; scope: string; sample: string | null }>(
      () => bridge().translations.inspect(path as never)),
    import: (path: string, meta?: Record<string, unknown>) =>
      call<{ id: string; name: string; abbr: string; format: string; verseCount: number }>(() => bridge().translations.import(path as never, meta as never)),
    remove: (id: string) => call(() => bridge().translations.remove(id as never)),
  },

  // ------------------------------------------------------------------ songs
  songs: {
    all: () => call<{ songs: Song[] }>(() => bridge().songs.all()).then((r) => r.songs),
    get: (id: string) => call<{ song: Song | null }>(() => bridge().songs.get(id as never)).then((r) => r.song),
    search: (q: string, limit?: number) =>
      call<{ results: { song: Song; score: number; reason: string }[] }>(() => bridge().songs.search(q as never, limit as never)).then((r) => r.results),
    upsert: (song: Partial<Song>) => call<{ song: Song }>(() => bridge().songs.upsert(song as never)).then((r) => r.song),
    remove: (id: string) => call(() => bridge().songs.remove(id as never)),
    markUsed: (id: string) => call(() => bridge().songs.markUsed(id as never)),
    stats: () => call<{ count: number; withChords: number; withCcli: number; tags: string[] }>(() => bridge().songs.stats()),
    slides: (id: string, opts?: Record<string, unknown>) =>
      call<{ slides: Slide[] }>(() => bridge().songs.slides(id as never, opts as never)).then((r) => r.slides),
    pickFiles: () => call<{ paths: string[] }>(() => bridge().songs.pickFiles()),
    splitStanzas: (text: string, opts?: { startVerse?: number }) =>
      call<{ sections: SongSection[] }>(() => bridge().songs.splitStanzas(text as never, opts as never))
        .then((r) => r.sections),
    import: (paths: string[], collectionName?: string) =>
      call<{ imported: number; failed: number; results: unknown[] }>(
        () => bridge().songs.import(paths as never, collectionName as never)),
    importText: (text: string, name?: string) => call<{ song: Song }>(() => bridge().songs.importText(text as never, name as never)).then((r) => r.song),
    export: (id: string) => call(() => bridge().songs.export(id as never)),
  },

  // ------------------------------------------------------------------ plans
  plans: {
    all: () => call<{ plans: Plan[] }>(() => bridge().plans.all()).then((r) => r.plans),
    get: (id: string) => call<{ plan: Plan | null }>(() => bridge().plans.get(id as never)).then((r) => r.plan),
    create: (input?: Partial<Plan>) => call<{ plan: Plan }>(() => bridge().plans.create(input as never)).then((r) => r.plan),
    update: (id: string, patch: Partial<Plan>) => call<{ plan: Plan }>(() => bridge().plans.update(id as never, patch as never)).then((r) => r.plan),
    remove: (id: string) => call(() => bridge().plans.remove(id as never)),
    duplicate: (id: string) => call<{ plan: Plan }>(() => bridge().plans.duplicate(id as never)).then((r) => r.plan),
    addItem: (planId: string, item: Partial<PlanItem>) => call<{ item: PlanItem }>(() => bridge().plans.addItem(planId as never, item as never)).then((r) => r.item),
    updateItem: (planId: string, itemId: string, patch: Partial<PlanItem>) =>
      call<{ item: PlanItem }>(() => bridge().plans.updateItem(planId as never, itemId as never, patch as never)).then((r) => r.item),
    removeItem: (planId: string, itemId: string) => call(() => bridge().plans.removeItem(planId as never, itemId as never)),
    reorder: (planId: string, from: number, to: number) =>
      call<{ items: PlanItem[] }>(() => bridge().plans.reorder(planId as never, from as never, to as never)).then((r) => r.items),
  },

  // -------------------------------------------------------- schedule files
  schedule: {
    recent: () => call<{ files: RecentSchedule[] }>(() => bridge().schedule.recent()).then((r) => r.files),
    clearRecent: () => call(() => bridge().schedule.clearRecent()),
    templates: () => call<{ templates: ScheduleTemplate[] }>(() => bridge().schedule.templates()).then((r) => r.templates),
    save: (planId: string, filePath?: string | null) =>
      call<{ path: string; items: number; cancelled?: boolean }>(() => bridge().schedule.save(planId as never, filePath as never)),
    saveAs: (planId: string) => call<{ path: string; cancelled?: boolean }>(() => bridge().schedule.saveAs(planId as never)),
    saveTemplate: (planId: string) => call<{ path: string; cancelled?: boolean }>(() => bridge().schedule.saveTemplate(planId as never)),
    open: () => call<{ plan: Plan; path: string; restoredSongs: number; cancelled?: boolean }>(() => bridge().schedule.open()),
    openPath: (filePath: string) =>
      call<{ plan: Plan; path: string; restoredSongs: number }>(() => bridge().schedule.openPath(filePath as never)),
    newFromTemplate: (templatePath: string) =>
      call<{ plan: Plan; restoredSongs: number }>(() => bridge().schedule.newFromTemplate(templatePath as never)),
    revealFolder: () => call(() => bridge().schedule.revealFolder()),
  },

  // ------------------------------------------------------------ collections
  collections: {
    all: () => call<{ collections: Collection[] }>(() => bridge().collections.all()).then((r) => r.collections),
    create: (name: string) => call<{ collection: Collection }>(() => bridge().collections.create(name as never)).then((r) => r.collection),
    rename: (id: string, name: string) =>
      call<{ collection: Collection }>(() => bridge().collections.rename(id as never, name as never)).then((r) => r.collection),
    remove: (id: string) => call(() => bridge().collections.remove(id as never)),
    addSongs: (id: string, songIds: string[]) =>
      call<{ collection: Collection }>(() => bridge().collections.addSongs(id as never, songIds as never)).then((r) => r.collection),
    removeSong: (id: string, songId: string) =>
      call<{ collection: Collection }>(() => bridge().collections.removeSong(id as never, songId as never)).then((r) => r.collection),
  },

  // ------------------------------------------------------ settings & themes
  settings: {
    get: () => call<{ settings: Settings }>(() => bridge().settings.get()).then((r) => r.settings),
    patch: (patch: Record<string, unknown>) => call<{ settings: Settings }>(() => bridge().settings.patch(patch as never)).then((r) => r.settings),
    reset: () => call<{ settings: Settings }>(() => bridge().settings.reset()).then((r) => r.settings),
  },
  themes: {
    all: () => call<{ themes: Theme[] }>(() => bridge().themes.all()).then((r) => r.themes),
    active: () => call<{ theme: Theme }>(() => bridge().themes.active()).then((r) => r.theme),
    save: (theme: Partial<Theme>) => call<{ theme: Theme }>(() => bridge().themes.save(theme as never)).then((r) => r.theme),
    delete: (id: string) => call(() => bridge().themes.delete(id as never)),
  },

  // ------------------------------------------------------------------- live
  live: {
    get: () => call<{ state: LiveStateShape }>(() => bridge().live.get()).then((r) => r.state),
    preview: (deck: Partial<Deck>) => call<{ state: LiveStateShape }>(() => bridge().live.preview(deck as never)).then((r) => r.state),
    take: () => call<{ state: LiveStateShape }>(() => bridge().live.take()).then((r) => r.state),
    step: (delta: number) => call<{ moved: boolean; state: LiveStateShape }>(() => bridge().live.step(delta as never)),
    stepPreview: (delta: number) => call<{ moved: boolean; state: LiveStateShape }>(() => bridge().live.stepPreview(delta as never)),
    goTo: (i: number) => call<{ moved: boolean; state: LiveStateShape }>(() => bridge().live.goTo(i as never)),
    goToPreview: (i: number) =>
      call<{ moved: boolean; state: LiveStateShape }>(() => bridge().live.goToPreview(i as never)),
    blackout: () => call<{ state: LiveStateShape }>(() => bridge().live.blackout()).then((r) => r.state),
    clear: () => call<{ state: LiveStateShape }>(() => bridge().live.clear()).then((r) => r.state),
    restore: () => call<{ state: LiveStateShape }>(() => bridge().live.restore()).then((r) => r.state),
    logo: () => call<{ state: LiveStateShape }>(() => bridge().live.logo()).then((r) => r.state),
    alert: (text: string | null, style?: string) => call<{ state: LiveStateShape }>(() => bridge().live.alert(text as never, style as never)).then((r) => r.state),
    set: (patch: Partial<LiveStateShape>) => call<{ state: LiveStateShape }>(() => bridge().live.set(patch as never)).then((r) => r.state),
  },

  // --------------------------------------------------------------- displays
  displays: {
    list: () => call<{ displays: DisplayInfo[] }>(() => bridge().displays.list()).then((r) => r.displays),
    open: (kind: 'output' | 'stage', screenId: string | null) => call(() => bridge().displays.open(kind as never, screenId as never)),
    close: (kind: 'output' | 'stage') => call(() => bridge().displays.close(kind as never)),
    status: () => call<{ output: boolean; stage: boolean; displays: DisplayInfo[] }>(() => bridge().displays.status()),
  },

  // --------------------------------------------------------------------- ai
  ai: {
    detect: (chunk: string, opts?: Record<string, unknown>) =>
      call<{ window: string; detections: Detection[] }>(() => bridge().ai.detect(chunk as never, opts as never)),
    resetDetection: () => call(() => bridge().ai.resetDetection()),
    topics: () => call<{ topics: string[] }>(() => bridge().ai.topics()).then((r) => r.topics),
    topical: (theme: string, opts?: Record<string, unknown>) =>
      call<{ theme: string; seeds: string[]; verses: (Verse & { breadth: number; seeds: string[] })[] }>(
        () => bridge().ai.topical(theme as never, opts as never)),
    outline: (ref: string, opts?: Record<string, unknown>) => call<Outline>(() => bridge().ai.outline(ref as never, opts as never)),
    forSong: (song: Song, opts?: Record<string, unknown>) =>
      call<{ terms: string[]; verses: Verse[] }>(() => bridge().ai.forSong(song as never, opts as never)),
  },

  // ------------------------------------------------------------------ media
  media: {
    all: () => call<{ media: MediaItem[] }>(() => bridge().media.all()).then((r) => r.media),
    import: () => call<{ imported: number; failed: number }>(() => bridge().media.import()),
    remove: (id: string) => call(() => bridge().media.remove(id as never)),
    update: (id: string, patch: Partial<MediaItem>) =>
      call<{ item: MediaItem }>(() => bridge().media.update(id as never, patch as never)).then((r) => r.item),
  },

  // ------------------------------------------------------------ presentations
  presentations: {
    all: () => call<{ decks: PresentationDeck[] }>(() => bridge().presentations.all()).then((r) => r.decks),
    get: (id: string) =>
      call<{ deck: PresentationDeck | null }>(() => bridge().presentations.get(id as never)).then((r) => r.deck),
    pick: () => call<{ paths: string[] }>(() => bridge().presentations.pick()),
    inspect: (filePath: string) => call<PptxInspection>(() => bridge().presentations.inspect(filePath as never)),
    import: (paths: string[]) => call<{ imported: number; failed: number }>(() => bridge().presentations.import(paths as never)),
    remove: (id: string) => call(() => bridge().presentations.remove(id as never)),
    rename: (id: string, name: string) => call(() => bridge().presentations.rename(id as never, name as never)),
  },

  // ------------------------------------------------------------ sermon notes
  sermons: {
    all: () => call<{ sermons: Sermon[] }>(() => bridge().sermons.all()).then((r) => r.sermons),
    get: (id: string) => call<{ sermon: Sermon | null }>(() => bridge().sermons.get(id as never)).then((r) => r.sermon),
    create: (input?: Partial<Sermon>) => call<{ sermon: Sermon }>(() => bridge().sermons.create(input as never)).then((r) => r.sermon),
    update: (id: string, patch: Partial<Sermon>) =>
      call<{ sermon: Sermon }>(() => bridge().sermons.update(id as never, patch as never)).then((r) => r.sermon),
    remove: (id: string) => call(() => bridge().sermons.remove(id as never)),
    duplicate: (id: string) => call<{ sermon: Sermon }>(() => bridge().sermons.duplicate(id as never)).then((r) => r.sermon),
    addPoint: (id: string, text?: string, at?: number | null) =>
      call<{ point: SermonPoint }>(() => bridge().sermons.addPoint(id as never, text as never, at as never)).then((r) => r.point),
    updatePoint: (id: string, pointId: string, patch: Partial<SermonPoint>) =>
      call<{ point: SermonPoint }>(() => bridge().sermons.updatePoint(id as never, pointId as never, patch as never)).then((r) => r.point),
    removePoint: (id: string, pointId: string) => call(() => bridge().sermons.removePoint(id as never, pointId as never)),
    movePoint: (id: string, from: number, to: number) =>
      call<{ points: SermonPoint[] }>(() => bridge().sermons.movePoint(id as never, from as never, to as never)).then((r) => r.points),
    slides: (id: string, opts?: { mode?: 'outline' | 'point'; includeSubPoints?: boolean }) =>
      call<{ slides: Slide[] }>(() => bridge().sermons.slides(id as never, opts as never)).then((r) => r.slides),
  },

  // ------------------------------------------ licensed (online) translations
  online: {
    config: () => call<OnlineConfig>(() => bridge().online.config()),
    setKey: (key: string, endpoint?: string) =>
      call(() => bridge().online.setKey(key as never, endpoint as never)),
    toggle: (enabled: boolean) => call<{ enabled: boolean }>(() => bridge().online.toggle(enabled as never)),
    test: () => call<{ count: number; sample: string[] }>(() => bridge().online.test()),
    bibles: (refresh?: boolean) =>
      call<{ bibles: OnlineBible[] }>(() => bridge().online.bibles(refresh as never)).then((r) => r.bibles),
    selectBibles: (ids: string[]) => call(() => bridge().online.selectBibles(ids as never)),
    lookup: (bibleId: string, ref: string) =>
      call<OnlineLookup>(() => bridge().online.lookup(bibleId as never, ref as never)),
    cacheSize: () => call<{ passages: number; bytes: number }>(() => bridge().online.cacheSize()),
    diagnose: (bibleId: string, ref?: string) =>
      call<OnlineDiagnosis>(() => bridge().online.diagnose(bibleId as never, ref as never)),
    clearCache: () => call<{ removed: number }>(() => bridge().online.clearCache()),
  },

  // ---------------------------------------------------- EasyWorship import
  ew: {
    pickFile: () => call<{ paths: string[] }>(() => bridge().ew.pickFile()),
    pickFolder: () => call<{ path: string | null }>(() => bridge().ew.pickFolder()),
    inspect: (filePath: string) => call<EwInspection>(() => bridge().ew.inspect(filePath as never)),
    importSchedule: (filePath: string, what?: Record<string, boolean>) =>
      call<EwImportResult>(() => bridge().ew.importSchedule(filePath as never, what as never)),
    importFolder: (dir: string, what?: Record<string, boolean>) =>
      call<EwImportResult & { files: number }>(() => bridge().ew.importFolder(dir as never, what as never)),
  },

  // -------------------------------------------------------------------- app
  app: {
    info: () => call<AppInfo>(() => bridge().app.info()),
    backup: () => call<{ path: string; songs: number; plans: number }>(() => bridge().app.backup()),
    restore: () => call<{ songs: number; plans: number }>(() => bridge().app.restore()),
    revealDataFolder: () => call(() => bridge().app.revealDataFolder()),
    diag: (label: string, payload: Record<string, unknown>) =>
      call(() => bridge().app.diag(label as never, payload as never)),
    setDirty: (dirty: boolean, label?: string) => call(() => bridge().app.setDirty(dirty as never, label as never)),
    quit: () => call(() => bridge().app.quit()),
  },

  on: (event: string, handler: (payload: never) => void) => bridge().on(event, handler),
  events: () => bridge().EVENTS,
  platform: () => (typeof window !== 'undefined' && window.bp ? window.bp.platform : 'unknown'),
};

export interface PresentationDeck {
  id: string;
  name: string;
  source: string;
  importedAt: string;
  slideCount: number;
  slides: { index: number; title: string; lines: string[]; notes: string; image: string | null }[];
}

export interface PptxInspection {
  file: string;
  slideCount: number;
  imageCount: number;
  withNotes: number;
  sample: { index: number; title: string; lines: number }[];
}

export interface SermonPoint {
  id: string;
  text: string;
  subPoints: string[];
  ref: string;
  note: string;
}

export interface Sermon {
  id: string;
  title: string;
  speaker: string;
  date: string;
  passage: string;
  bigIdea: string;
  points: SermonPoint[];
  createdAt: string;
  updatedAt: string;
}

export interface OnlineConfig {
  enabled: boolean;
  /** Whether a key is stored. The key itself never reaches the renderer. */
  hasKey: boolean;
  endpoint: string;
  cache: boolean;
  bibles: string[];
}

export interface OnlineBible {
  id: string;
  abbr: string;
  name: string;
  language: string;
  description: string;
  copyright: string;
  licensed: true;
  online: true;
}

export interface OnlineDiagnosis {
  bibleId: string;
  reference: string;
  abbr: string;
  cached: boolean;
  /** Structure only — never the text of a licensed translation. */
  shape: {
    fields: string[];
    contentChars: number;
    markerStyle: string;
    versesParsed: number;
    verseNumbers: number[];
    hasCopyright: boolean;
  } | null;
  verseLengths: number[];
}

export interface OnlineLookup {
  online: true;
  label: string;
  translation: string;
  translationName: string;
  translationAbbr: string;
  copyright: string;
  cached?: boolean;
  verses: Verse[];
}

export interface EwInspection {
  file: string;
  format: string;
  songs: number;
  media: number;
  tables: string[];
  notes: string[];
  sample: { title: string; author: string; sections: number }[];
}

export interface EwImportResult {
  songs: number;
  media: number;
  skipped: number;
  errors: string[];
  plan?: Plan | null;
}

export interface Suggestion {
  bookId: string;
  book: string;
  /** Text to place in the field when chosen. */
  completion: string;
  /** How the resolved reference reads. */
  label: string;
  hint: string;
  exact: boolean;
}

export interface RecentSchedule {
  path: string;
  name: string;
  openedAt: string;
  size?: number;
  modifiedAt?: string;
}

export interface ScheduleTemplate {
  path: string;
  name: string;
  items: number;
  savedAt: string | null;
}

export interface Collection {
  id: string;
  name: string;
  songIds: string[];
  createdAt: string;
}

export interface DisplayInfo {
  id: string;
  index: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: string;
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
  inUse: { output: boolean; stage: boolean };
}

export interface AppInfo {
  version: string;
  name: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataPath: string;
  packaged: boolean;
}

export interface Outline {
  ok: boolean;
  label: string;
  translationAbbr: string;
  verseCount: number;
  keyTerms: { term: string; count: number; weight: number }[];
  movements: { range: string; verses: Verse[]; emphasis: string[] }[];
  crossRefs: Verse[];
  readingTimeSeconds: number;
}
