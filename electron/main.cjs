'use strict';
/**
 * BiblePortal Studio — main process.
 *
 * Owns every service, the live presentation state, and all three windows.
 * The renderer never touches the filesystem or the network directly; it asks
 * through the channels registered here.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, globalShortcut, session } = require('electron');

const { Store } = require('./services/store.cjs');
const { BibleService } = require('./services/bible.cjs');
const { TranslationService } = require('./services/translations.cjs');
const { SongService } = require('./services/songs.cjs');
const { PlanService } = require('./services/plan.cjs');
const { SettingsService } = require('./services/settings.cjs');
const { AIService } = require('./services/ai.cjs');
const { MediaService } = require('./services/media.cjs');
const { ScheduleFileService, SCHEDULE_EXT } = require('./services/schedule-file.cjs');
const { CollectionService } = require('./services/collections.cjs');
const { EasyWorshipImportService } = require('./services/easyworship-import.cjs');
const { PresentationService } = require('./services/presentations.cjs');
const { SermonService } = require('./services/sermon.cjs');
const { OnlineBibleService } = require('./services/online-bible.cjs');
const { LiveState } = require('./live-state.cjs');
const { WindowManager, isDev } = require('./windows.cjs');
const { EVENTS } = require('./ipc-channels.cjs');
const canon = require('./lib/canon.cjs');
const reference = require('./lib/reference.cjs');
const songFormat = require('./lib/song-format.cjs');
const chords = require('./lib/chords.cjs');

// Two instances would fight over the same data files and the same monitors.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

/** Bundled data lives beside the app in a packaged build, in-repo in dev. */
function dataRoot() {
  const packaged = path.join(process.resourcesPath ?? '', 'data-pack');
  return app.isPackaged ? packaged : path.join(__dirname, '..', 'resources');
}

const userRoot = () => app.getPath('userData');

const ctx = {};

async function bootstrap() {
  const userData = userRoot();
  const bundled = dataRoot();

  // User-installed translations live in userData so an app update can't wipe
  // them, and so a read-only install directory is never written to.
  const userDataDir = path.join(userData, 'translations');
  await fsp.mkdir(userDataDir, { recursive: true });

  // Seed the user directory from the bundle on first run.
  const seedDir = path.join(bundled, 'data');
  const seeded = await fsp.readdir(userDataDir).catch(() => []);
  if (!seeded.some((f) => f.endsWith('.json'))) {
    for (const file of await fsp.readdir(seedDir).catch(() => [])) {
      if (file.endsWith('.json')) {
        await fsp.copyFile(path.join(seedDir, file), path.join(userDataDir, file)).catch(() => {});
      }
    }
  }

  ctx.store = new Store(path.join(userData, 'library'));
  ctx.bible = new BibleService({
    dataDir: userDataDir,
    lexiconDir: path.join(bundled, 'lexicon'),
    cacheDir: path.join(userData, 'cache'),
  });
  await ctx.bible.init();

  ctx.translations = new TranslationService({
    dataDir: userDataDir,
    cacheDir: path.join(userData, 'cache'),
    bible: ctx.bible,
  });
  ctx.settings = new SettingsService(ctx.store);
  ctx.songs = new SongService(ctx.store);
  ctx.plans = new PlanService(ctx.store);
  ctx.media = new MediaService({ store: ctx.store, mediaDir: path.join(userData, 'media') });
  ctx.schedules = new ScheduleFileService({ store: ctx.store, documentsDir: app.getPath('documents') });
  ctx.collections = new CollectionService(ctx.store);
  ctx.ew = new EasyWorshipImportService({ songs: ctx.songs, media: ctx.media, plans: ctx.plans });
  ctx.presentations = new PresentationService({ store: ctx.store, mediaDir: path.join(userData, 'media') });
  ctx.sermons = new SermonService(ctx.store);
  ctx.online = new OnlineBibleService({ settings: ctx.settings, cacheDir: path.join(userData, 'cache') });
  await ctx.schedules.ensureDirs().catch(() => {});
  ctx.ai = new AIService({ bible: ctx.bible, settings: ctx.settings });
  ctx.live = new LiveState();
  ctx.windows = new WindowManager();

  // Any live change fans out to every window immediately.
  ctx.live.on('change', (state) => ctx.windows.broadcast(EVENTS.LIVE_CHANGED, state));

  // Warm the default translation's index in the background so the first search
  // is instant without delaying startup.
  setTimeout(() => { ctx.bible.index(ctx.bible.defaultId).catch(() => {}); }, 1200);
}

// ---------------------------------------------------------------- IPC wiring

/** Register a handler that always resolves to `{ok}` or `{ok:false,error}`. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

function registerHandlers() {
  // ------------------------------------------------------------------ bible
  handle('bible:manifest', async () => ({ ok: true, ...ctx.bible.manifest, defaultId: ctx.bible.defaultId }));
  handle('bible:books', async () => ({ ok: true, books: canon.books() }));
  handle('bible:lookup', (ref, translation) => ctx.bible.lookup(ref, translation));
  handle('bible:chapter', async (bookId, chapter, translation) => ({ ok: true, ...(await ctx.bible.chapter(bookId, chapter, translation)) }));
  handle('bible:search', (q, opts) => ctx.bible.search(q, opts));
  handle('bible:smart', (q, opts) => ctx.bible.smart(q, opts));
  handle('bible:suggest', async (q, opts) => ({ ok: true, suggestions: reference.suggest(q, opts) }));
  handle('bible:parallel', (ref, ids) => ctx.bible.parallel(ref, ids));
  handle('bible:strongs', (code) => ctx.bible.strongs(code));
  handle('bible:lexiconSearch', async (q, limit) => ({ ok: true, results: await ctx.bible.lexiconSearch(q, limit) }));
  handle('bible:stats', async () => ({ ok: true, ...ctx.bible.stats() }));

  // ----------------------------------------------------------- translations
  handle('translations:catalogue', async () => ({ ok: true, ...(await ctx.translations.catalogue()) }));
  handle('translations:install', async (id) => {
    const result = await ctx.translations.installFromCatalogue(id, (p) =>
      ctx.windows.broadcast(EVENTS.TRANSLATION_PROGRESS, p));
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'translations' });
    return result;
  });
  handle('translations:pickModule', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Import a Bible module you own',
      message: 'Select a Bible module you own — MyBible, MySword, e-Sword, Zefania, OSIS, USFX, JSON or CSV.',
      properties: ['openFile'],
      filters: [
        { name: 'All Bible modules', extensions: ['sqlite3', 'sqlite', 'bblx', 'bbli', 'mybible', 'bbl', 'xml', 'osis', 'usfx', 'json', 'csv', 'tsv', 'txt'] },
        { name: 'MyBible / MySword / e-Sword', extensions: ['sqlite3', 'sqlite', 'bblx', 'bbli', 'mybible', 'bbl'] },
        { name: 'Zefania / OSIS / USFX', extensions: ['xml', 'osis', 'usfx'] },
        { name: 'JSON / CSV', extensions: ['json', 'csv', 'tsv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return { ok: !res.canceled, path: res.filePaths?.[0] ?? null };
  });
  /** Guard a renderer-supplied path: it must exist and be a regular file. */
  async function assertReadableFile(filePath) {
    const resolved = path.resolve(String(filePath ?? ''));
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error('That file could not be read.');
    return resolved;
  }

  handle('translations:inspect', async (filePath) =>
    ctx.translations.inspectModule(await assertReadableFile(filePath)));
  handle('translations:import', async (filePath, meta) => {
    const result = await ctx.translations.importModule(await assertReadableFile(filePath), meta);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'translations' });
    return result;
  });
  handle('translations:remove', async (id) => {
    const result = await ctx.translations.remove(id);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'translations' });
    return result;
  });

  // ------------------------------------------------------------------ songs
  handle('songs:all', async () => ({ ok: true, songs: await ctx.songs.all() }));
  handle('songs:get', async (id) => ({ ok: true, song: await ctx.songs.get(id) }));
  handle('songs:search', async (q, limit) => ({ ok: true, results: await ctx.songs.search(q, limit) }));
  handle('songs:upsert', async (song) => ({ ok: true, song: await ctx.songs.upsert(song) }));
  handle('songs:remove', async (id) => {
    const result = await ctx.songs.remove(id);
    await ctx.collections.purgeSong(id);
    return { ok: true, ...result };
  });
  handle('songs:markUsed', async (id) => ({ ok: true, song: await ctx.songs.markUsed(id) }));
  handle('songs:stats', async () => ({ ok: true, ...(await ctx.songs.stats()) }));
  handle('songs:splitStanzas', async (text, opts) => ({
    ok: true,
    sections: songFormat.splitStanzas(text, opts),
  }));
  handle('songs:slides', async (id, opts) => ({ ok: true, slides: await ctx.songs.slides(id, opts) }));
  handle('songs:importText', async (text, name) => ({ ok: true, song: await ctx.songs.importText(text, name) }));
  handle('songs:pickFiles', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Import songs',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Song files', extensions: ['cho', 'chopro', 'crd', 'pro', 'onsong', 'xml', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return { ok: !res.canceled, paths: res.filePaths ?? [] };
  });
  handle('songs:import', async (paths, collectionName) => {
    const checked = [];
    for (const p of paths ?? []) checked.push(await assertReadableFile(p));
    const result = await ctx.songs.importFiles(checked);

    // Dropping a hymnal in should keep it grouped, not scattered through the
    // library alongside contemporary songs.
    if (collectionName && result.imported) {
      const existing = await ctx.collections.all();
      const target = existing.find((c) => c.name.toLowerCase() === String(collectionName).toLowerCase())
        ?? await ctx.collections.create(collectionName);
      const ids = result.results.filter((r) => r.ok && r.song).map((r) => r.song.id);
      if (ids.length) await ctx.collections.addSongs(target.id, ids);
    }

    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'songs' });
    return { ok: true, ...result };
  });
  handle('songs:export', async (id) => {
    const { filename, content } = await ctx.songs.exportSong(id);
    const res = await dialog.showSaveDialog(ctx.windows.console, { title: 'Export song', defaultPath: filename });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    await fsp.writeFile(res.filePath, content, 'utf8');
    return { ok: true, path: res.filePath };
  });

  // ------------------------------------------------------------------ plans
  handle('plans:all', async () => ({ ok: true, plans: await ctx.plans.all() }));
  handle('plans:get', async (id) => ({ ok: true, plan: await ctx.plans.get(id) }));
  handle('plans:create', async (input) => ({ ok: true, plan: await ctx.plans.create(input) }));
  handle('plans:update', async (id, patch) => ({ ok: true, plan: await ctx.plans.update(id, patch) }));
  handle('plans:remove', (id) => ctx.plans.remove(id));
  handle('plans:duplicate', async (id) => ({ ok: true, plan: await ctx.plans.duplicate(id) }));
  handle('plans:addItem', async (planId, item) => ({ ok: true, item: await ctx.plans.addItem(planId, item) }));
  handle('plans:updateItem', async (planId, itemId, patch) => ({ ok: true, item: await ctx.plans.updateItem(planId, itemId, patch) }));
  handle('plans:removeItem', (planId, itemId) => ctx.plans.removeItem(planId, itemId));
  handle('plans:reorder', async (planId, from, to) => ({ ok: true, items: await ctx.plans.reorder(planId, from, to) }));

  // -------------------------------------------------------- schedule files
  handle('schedule:recent', async () => ({ ok: true, files: await ctx.schedules.recent() }));
  handle('schedule:clearRecent', async () => ({ ok: true, files: await ctx.schedules.clearRecent() }));
  handle('schedule:templates', async () => ({ ok: true, templates: await ctx.schedules.templates() }));
  handle('schedule:revealFolder', async () => {
    const roots = await ctx.schedules.ensureDirs();
    shell.openPath(roots.schedules);
    return { ok: true, path: roots.schedules };
  });

  /** Save to a known path, or prompt when there isn't one yet. */
  handle('schedule:save', async (planId, filePath) => {
    const plan = await ctx.plans.get(planId);
    if (!plan) throw new Error('Plan not found');
    const songs = await ctx.songs.all();
    // No path yet means this plan has never been written to disk — prompt.
    if (filePath) return ctx.schedules.save(filePath, plan, { songs });
    return saveAsDialog(plan, songs, false);
  });

  handle('schedule:saveAs', async (planId) => {
    const plan = await ctx.plans.get(planId);
    if (!plan) throw new Error('Plan not found');
    return saveAsDialog(plan, await ctx.songs.all(), false);
  });

  handle('schedule:saveTemplate', async (planId) => {
    const plan = await ctx.plans.get(planId);
    if (!plan) throw new Error('Plan not found');
    return saveAsDialog(plan, await ctx.songs.all(), true);
  });

  async function saveAsDialog(plan, songs, asTemplate) {
    const roots = await ctx.schedules.ensureDirs();
    const res = await dialog.showSaveDialog(ctx.windows.console, {
      title: asTemplate ? 'Save as template' : 'Save schedule',
      defaultPath: path.join(
        asTemplate ? roots.templates : roots.schedules,
        ctx.schedules.suggestName(plan),
      ),
      filters: [{ name: 'BiblePortal schedule', extensions: [SCHEDULE_EXT.slice(1)] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    const saved = await ctx.schedules.save(res.filePath, plan, { songs, asTemplate });
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'schedules' });
    return saved;
  }

  /** Open a schedule file, importing any songs it carried that we don't have. */
  async function loadSchedule(filePath) {
    const doc = await ctx.schedules.open(filePath);

    const existing = await ctx.songs.all();
    const known = new Set(existing.map((s) => s.id));
    let restored = 0;
    for (const song of doc.embeddedSongs) {
      if (known.has(song.id)) continue;
      await ctx.songs.upsert(song);
      restored++;
    }

    const plan = await ctx.plans.create({
      name: doc.name,
      date: doc.date,
      notes: doc.notes,
      items: doc.items.map((item) => ({ ...item, id: item.id ?? `item_${Math.random().toString(36).slice(2, 10)}` })),
    });

    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'all' });
    return { ok: true, plan, path: filePath, restoredSongs: restored, kind: doc.kind };
  }

  handle('schedule:openPath', async (filePath) => loadSchedule(await assertReadableFile(filePath)));

  handle('schedule:open', async () => {
    const roots = await ctx.schedules.ensureDirs();
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Open schedule',
      defaultPath: roots.schedules,
      properties: ['openFile'],
      filters: [{ name: 'BiblePortal schedule', extensions: [SCHEDULE_EXT.slice(1)] }],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, cancelled: true };
    return loadSchedule(res.filePaths[0]);
  });

  handle('schedule:newFromTemplate', async (templatePath) => {
    const result = await loadSchedule(templatePath);
    // A plan started from a template is dated today and has no file of its own.
    await ctx.plans.update(result.plan.id, { date: new Date().toISOString().slice(0, 10) });
    return { ...result, fromTemplate: true };
  });

  // ---------------------------------------------------------- collections
  handle('collections:all', async () => ({ ok: true, collections: await ctx.collections.all() }));
  handle('collections:create', async (name) => ({ ok: true, collection: await ctx.collections.create(name) }));
  handle('collections:rename', async (id, name) => ({ ok: true, collection: await ctx.collections.rename(id, name) }));
  handle('collections:remove', (id) => ctx.collections.remove(id));
  handle('collections:addSongs', async (id, songIds) => ({ ok: true, collection: await ctx.collections.addSongs(id, songIds) }));
  handle('collections:removeSong', async (id, songId) => ({ ok: true, collection: await ctx.collections.removeSong(id, songId) }));

  // ------------------------------------------------------- settings & themes
  handle('settings:get', async () => ({ ok: true, settings: await ctx.settings.get() }));
  handle('settings:patch', async (patch) => {
    const settings = await ctx.settings.patch(patch);
    // Theme and label changes must reach the audience screen without a take.
    ctx.live.set({
      theme: await ctx.settings.activeTheme(),
      sectionLabels: settings.presentation.showSectionLabels,
    });
    return { ok: true, settings };
  });
  handle('settings:reset', async () => ({ ok: true, settings: await ctx.settings.reset() }));
  handle('themes:all', async () => ({ ok: true, themes: await ctx.settings.themes() }));
  handle('themes:active', async () => ({ ok: true, theme: await ctx.settings.activeTheme() }));
  handle('themes:save', async (theme) => {
    const saved = await ctx.settings.saveTheme(theme);
    const startupSettings = await ctx.settings.get();
  ctx.live.set({
    theme: await ctx.settings.activeTheme(),
    sectionLabels: startupSettings.presentation.showSectionLabels,
  });
    return { ok: true, theme: saved };
  });
  handle('themes:delete', (id) => ctx.settings.deleteTheme(id));

  // ------------------------------------------------------------------- live
  handle('live:get', async () => ({ ok: true, state: ctx.live.get() }));
  handle('live:preview', async (deck) => ({ ok: true, state: ctx.live.loadPreview(deck) }));
  handle('live:take', async () => ({ ok: true, state: ctx.live.take() }));
  handle('live:step', async (delta) => ({ ok: true, moved: ctx.live.step(delta), state: ctx.live.get() }));
  handle('live:stepPreview', async (delta) => ({ ok: true, moved: ctx.live.stepPreview(delta), state: ctx.live.get() }));
  handle('live:goTo', async (i) => ({ ok: true, moved: ctx.live.goTo(i), state: ctx.live.get() }));
  handle('live:goToPreview', async (i) => ({ ok: true, moved: ctx.live.goToPreview(i), state: ctx.live.get() }));
  handle('live:blackout', async () => ({ ok: true, state: ctx.live.toggleBlackout() }));
  handle('live:clear', async () => ({ ok: true, state: ctx.live.clear() }));
  handle('live:restore', async () => ({ ok: true, state: ctx.live.restore() }));
  handle('live:logo', async () => ({ ok: true, state: ctx.live.toggleLogo() }));
  handle('live:alert', async (text, style) => ({ ok: true, state: ctx.live.showAlert(text, style) }));
  handle('live:set', async (patch) => ({ ok: true, state: ctx.live.set(patch) }));

  // --------------------------------------------------------------- displays
  handle('displays:list', async () => ({ ok: true, displays: ctx.windows.displays() }));
  handle('displays:open', async (kind, screenId) => {
    const result = ctx.windows.openOutput(kind, screenId);
    await ctx.settings.patch({ displays: { [kind === 'output' ? 'outputScreenId' : 'stageScreenId']: screenId } });
    // A newly opened window needs the current state pushed to it.
    setTimeout(() => ctx.windows.broadcast(EVENTS.LIVE_CHANGED, ctx.live.get()), 500);
    return result;
  });
  handle('displays:close', async (kind) => ctx.windows.closeOutput(kind));
  handle('displays:status', async () => ({
    ok: true,
    output: ctx.windows.isOpen('output'),
    stage: ctx.windows.isOpen('stage'),
    displays: ctx.windows.displays(),
  }));

  // --------------------------------------------------------------------- ai
  handle('ai:detect', async (chunk, opts) => ({ ok: true, ...(await ctx.ai.detect(chunk, opts)) }));
  handle('ai:resetDetection', async () => { ctx.ai.resetDetection(); return { ok: true }; });
  handle('ai:topical', async (theme, opts) => ({ ok: true, ...(await ctx.ai.topical(theme, opts)) }));
  handle('ai:topics', async () => ({ ok: true, topics: ctx.ai.topics() }));
  handle('ai:outline', (ref, opts) => ctx.ai.outline(ref, opts));
  handle('ai:forSong', async (song, opts) => ({ ok: true, ...(await ctx.ai.forSong(song, opts)) }));

  // ------------------------------------------------------------------ media
  handle('media:all', async () => ({ ok: true, media: await ctx.media.all() }));
  handle('media:remove', (id) => ctx.media.remove(id));
  handle('media:update', async (id, patch) => ({ ok: true, item: await ctx.media.update(id, patch) }));

  // --------------------------------------------------------- presentations
  handle('presentations:all', async () => ({ ok: true, decks: await ctx.presentations.all() }));
  handle('presentations:get', async (id) => ({ ok: true, deck: await ctx.presentations.get(id) }));
  handle('presentations:remove', (id) => ctx.presentations.remove(id));
  handle('presentations:rename', async (id, name) => ({ ok: true, deck: await ctx.presentations.rename(id, name) }));
  handle('presentations:inspect', async (filePath) => ctx.presentations.inspect(await assertReadableFile(filePath)));
  handle('presentations:pick', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Import a presentation',
      message: 'Select a PowerPoint file (.pptx).',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }, { name: 'All files', extensions: ['*'] }],
    });
    return { ok: !res.canceled, paths: res.filePaths ?? [] };
  });
  handle('presentations:import', async (paths) => {
    const checked = [];
    for (const p of paths ?? []) checked.push(await assertReadableFile(p));
    const result = await ctx.presentations.importFiles(checked);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'presentations' });
    return { ok: true, ...result };
  });

  // ----------------------------------------------------------- sermon notes
  handle('sermons:all', async () => ({ ok: true, sermons: await ctx.sermons.all() }));
  handle('sermons:get', async (id) => ({ ok: true, sermon: await ctx.sermons.get(id) }));
  handle('sermons:create', async (input) => ({ ok: true, sermon: await ctx.sermons.create(input) }));
  handle('sermons:update', async (id, patch) => ({ ok: true, sermon: await ctx.sermons.update(id, patch) }));
  handle('sermons:remove', (id) => ctx.sermons.remove(id));
  handle('sermons:duplicate', async (id) => ({ ok: true, sermon: await ctx.sermons.duplicate(id) }));
  handle('sermons:addPoint', async (id, text, at) => ({ ok: true, point: await ctx.sermons.addPoint(id, text, at) }));
  handle('sermons:updatePoint', async (id, pointId, patch) => ({ ok: true, point: await ctx.sermons.updatePoint(id, pointId, patch) }));
  handle('sermons:removePoint', (id, pointId) => ctx.sermons.removePoint(id, pointId));
  handle('sermons:movePoint', async (id, from, to) => ({ ok: true, points: await ctx.sermons.movePoint(id, from, to) }));
  handle('sermons:slides', async (id, opts) => ({ ok: true, slides: await ctx.sermons.slides(id, opts) }));

  // ------------------------------------------- licensed (online) translations
  /**
   * Config for the UI, with the key itself withheld — the renderer never needs
   * to see it, only whether one is set.
   */
  handle('online:config', async () => {
    const c = await ctx.online.config();
    return {
      ok: true,
      enabled: c.enabled,
      hasKey: !!c.key,
      endpoint: c.endpoint,
      cache: c.cache,
      bibles: c.bibles,
    };
  });

  handle('online:setKey', async (key, endpoint) => {
    await ctx.settings.patch({
      online: {
        apiKey: String(key ?? '').trim(),
        endpoint: String(endpoint ?? '').trim(),
        enabled: !!String(key ?? '').trim(),
      },
    });
    ctx.online.catalogue = null; // a new key may reach a different set
    return { ok: true };
  });

  handle('online:toggle', async (enabled) => {
    await ctx.settings.patch({ online: { enabled: !!enabled } });
    return { ok: true, enabled: !!enabled };
  });

  handle('online:test', async () => ctx.online.test());
  handle('online:bibles', async (refresh) => ({ ok: true, bibles: await ctx.online.bibles({ refresh }) }));
  handle('online:selectBibles', async (ids) => {
    await ctx.settings.patch({ online: { bibles: Array.isArray(ids) ? ids : [] } });
    return { ok: true, bibles: ids };
  });
  handle('online:lookup', (bibleId, ref) => ctx.online.lookup(bibleId, ref));
  handle('online:cacheSize', async () => ({ ok: true, ...(await ctx.online.cacheSize()) }));
  handle('online:diagnose', (bibleId, ref) => ctx.online.diagnose(bibleId, ref));
  handle('online:clearCache', () => ctx.online.clearCache());

  // ------------------------------------------------------ EasyWorship import
  handle('ew:pickFile', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Import from EasyWorship',
      message: 'Select an EasyWorship schedule (.ewsx).',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'EasyWorship schedule', extensions: ['ewsx'] }, { name: 'All files', extensions: ['*'] }],
    });
    return { ok: !res.canceled, paths: res.filePaths ?? [] };
  });

  handle('ew:pickFolder', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Import an EasyWorship schedules folder',
      message: 'Select the folder holding your .ewsx schedules.',
      properties: ['openDirectory'],
    });
    return { ok: !res.canceled, path: res.filePaths?.[0] ?? null };
  });

  handle('ew:inspect', async (filePath) => ctx.ew.inspect(await assertReadableFile(filePath)));

  handle('ew:importSchedule', async (filePath, what) => {
    const result = await ctx.ew.importSchedule(await assertReadableFile(filePath), what);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'all' });
    return result;
  });

  handle('ew:importFolder', async (dir, what) => {
    const result = await ctx.ew.importFolder(String(dir ?? ''), what);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'all' });
    return result;
  });
  handle('media:import', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Add media',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v'] }],
    });
    if (res.canceled) return { ok: false, cancelled: true };
    const result = await ctx.media.importFiles(res.filePaths);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'media' });
    return { ok: true, ...result };
  });

  // -------------------------------------------------------------------- app
  handle('app:info', async () => ({
    ok: true,
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    dataPath: userRoot(),
    packaged: app.isPackaged,
  }));
  handle('app:revealDataFolder', async () => { shell.openPath(userRoot()); return { ok: true }; });

  /** The renderer tells us when a plan has edits that are not on disk. */
  /**
   * Record a renderer-side measurement to disk.
   *
   * A blank preview looks identical whether the surface failed to measure, laid
   * out off-screen, or painted correctly into an invisible layer. Writing the
   * real numbers from the user's own machine is the only way to tell those apart.
   */
  handle('app:diag', async (label, payload) => {
    const file = path.join(userRoot(), 'diagnostics.json');
    let log = [];
    try { log = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* first write */ }
    log.push({ at: new Date().toISOString(), label, ...payload });
    await fsp.writeFile(file, JSON.stringify(log.slice(-40), null, 2), 'utf8');
    return { ok: true, file };
  });

  handle('app:quit', async () => { ctx.unsaved = null; app.quit(); return { ok: true }; });

  handle('app:setDirty', async (dirty, label) => {
    ctx.unsaved = dirty ? { label: label ?? 'Service plan' } : null;
    return { ok: true };
  });
  /**
   * Open a file or folder in the OS. Restricted to directories BiblePortal
   * itself manages — the renderer must never be able to ask the shell to open
   * an arbitrary path on the machine.
   */
  handle('app:openPath', async (target) => {
    const resolved = path.resolve(String(target ?? ''));
    const roots = [
      userRoot(),
      ctx.schedules.roots.schedules,
      ctx.schedules.roots.templates,
    ].map((r) => path.resolve(r));

    const permitted = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
    if (!permitted) throw new Error('That location is outside the BiblePortal folders.');

    await shell.openPath(resolved);
    return { ok: true, path: resolved };
  });
  handle('app:backup', async () => {
    const res = await dialog.showSaveDialog(ctx.windows.console, {
      title: 'Back up library',
      defaultPath: `bibleportal-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    const payload = {
      format: 'bibleportal.backup/1',
      createdAt: new Date().toISOString(),
      version: app.getVersion(),
      songs: await ctx.songs.all(),
      plans: await ctx.plans.all(),
      settings: await ctx.settings.get(),
      media: await ctx.media.all(),
    };
    await fsp.writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: res.filePath, songs: payload.songs.length, plans: payload.plans.length };
  });
  handle('app:restore', async () => {
    const res = await dialog.showOpenDialog(ctx.windows.console, {
      title: 'Restore library from backup',
      properties: ['openFile'],
      filters: [{ name: 'BiblePortal backup', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, cancelled: true };
    const payload = JSON.parse(await fsp.readFile(res.filePaths[0], 'utf8'));
    if (payload.format !== 'bibleportal.backup/1') throw new Error('That file is not a BiblePortal backup.');

    const confirm = await dialog.showMessageBox(ctx.windows.console, {
      type: 'warning',
      buttons: ['Cancel', 'Replace library'],
      defaultId: 0,
      cancelId: 0,
      message: 'Replace your current library?',
      detail: `This backup holds ${payload.songs?.length ?? 0} song(s) and ${payload.plans?.length ?? 0} plan(s). Your current songs, plans and settings will be overwritten.`,
    });
    if (confirm.response !== 1) return { ok: false, cancelled: true };

    if (payload.songs) await ctx.songs.save(payload.songs);
    if (payload.plans) await ctx.plans.saveAll(payload.plans);
    if (payload.settings) await ctx.settings.patch(payload.settings);
    ctx.windows.broadcast(EVENTS.LIBRARY_CHANGED, { kind: 'all' });
    return { ok: true, songs: payload.songs?.length ?? 0, plans: payload.plans?.length ?? 0 };
  });
}

// ------------------------------------------------------------------ shortcuts

/**
 * Global shortcuts for the live-critical actions, so an operator can black out
 * the screen even when the console isn't focused.
 */
function registerShortcuts() {
  const bind = (accel, fn) => { try { globalShortcut.register(accel, fn); } catch { /* already taken */ } };
  bind('CommandOrControl+Alt+B', () => ctx.live.toggleBlackout());
  bind('CommandOrControl+Alt+Right', () => ctx.live.step(1));
  bind('CommandOrControl+Alt+Left', () => ctx.live.step(-1));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => () => ctx.windows.broadcast(EVENTS.HOTKEY, action);

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Service Plan', accelerator: 'CmdOrCtrl+N', click: send('plan:new') },
        { type: 'separator' },
        { label: 'Import Songs…', accelerator: 'CmdOrCtrl+I', click: send('songs:import') },
        { label: 'Import Bible Module…', click: send('translations:import') },
        { type: 'separator' },
        { label: 'Back Up Library…', click: () => ipcMain.emit('app:backup') },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Live',
      submenu: [
        { label: 'Take to Screen', accelerator: 'CmdOrCtrl+Return', click: () => ctx.live.take() },
        { label: 'Next Slide', accelerator: 'CmdOrCtrl+Down', click: () => ctx.live.step(1) },
        { label: 'Previous Slide', accelerator: 'CmdOrCtrl+Up', click: () => ctx.live.step(-1) },
        { type: 'separator' },
        { label: 'Blackout', accelerator: 'CmdOrCtrl+B', click: () => ctx.live.toggleBlackout() },
        { label: 'Clear Screen', accelerator: 'CmdOrCtrl+K', click: () => ctx.live.clear() },
        { label: 'Show Logo', accelerator: 'CmdOrCtrl+L', click: () => ctx.live.toggleLogo() },
      ],
    },
    {
      label: 'Panels',
      submenu: [
        { label: 'Bible', accelerator: 'CmdOrCtrl+1', click: send('panel:bible') },
        { label: 'Songs', accelerator: 'CmdOrCtrl+2', click: send('panel:songs') },
        { label: 'Service Plan', accelerator: 'CmdOrCtrl+3', click: send('panel:plan') },
        { label: 'Theme', accelerator: 'CmdOrCtrl+4', click: send('panel:theme') },
        { label: 'Media', accelerator: 'CmdOrCtrl+5', click: send('panel:media') },
        { label: 'Live Detect', accelerator: 'CmdOrCtrl+6', click: send('panel:detect') },
        { label: 'Displays', accelerator: 'CmdOrCtrl+7', click: send('panel:displays') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('panel:settings') },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle

/**
 * Live detection needs the microphone. Grant it to our own windows only, and
 * deny everything else outright — an Electron app that blanket-approves
 * permission requests is a liability.
 */
function configurePermissions() {
  const ALLOWED = new Set(['media', 'audioCapture']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(ALLOWED.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => ALLOWED.has(permission));
  // Pick the system default input; the operator changes it in OS sound settings.
  session.defaultSession.setDevicePermissionHandler(() => true);
}

/**
 * In development the Dock shows Electron's own icon, because that comes from
 * the binary's bundle rather than ours. Setting it at runtime makes a dev run
 * look like the shipped app, so the icon can be checked without packaging.
 * Packaged builds already carry it in Info.plist, so this is a no-op there.
 */
function applyDockIcon() {
  if (process.platform !== 'darwin' || app.isPackaged) return;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  try {
    if (!require('node:fs').existsSync(iconPath)) return;
    const image = require('electron').nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) app.dock?.setIcon(image);
  } catch {
    // Cosmetic only — never let an icon problem stop the app starting.
  }
}

app.whenReady().then(async () => {
  applyDockIcon();
  configurePermissions();
  await bootstrap();
  registerHandlers();
  buildMenu();
  registerShortcuts();

  // Seed live state with the active theme so the first take looks right.
  const startupSettings = await ctx.settings.get();
  ctx.live.set({
    theme: await ctx.settings.activeTheme(),
    sectionLabels: startupSettings.presentation.showSectionLabels,
  });

  ctx.windows.createConsole();

  screen.on('display-added', () => ctx.windows.broadcast(EVENTS.DISPLAYS_CHANGED, ctx.windows.displays()));
  screen.on('display-removed', () => ctx.windows.broadcast(EVENTS.DISPLAYS_CHANGED, ctx.windows.displays()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) ctx.windows.createConsole();
  });
});

app.on('second-instance', () => {
  if (ctx.windows?.console) {
    if (ctx.windows.console.isMinimized()) ctx.windows.console.restore();
    ctx.windows.console.focus();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/**
 * Guard the exit.
 *
 * Two things make quitting costly here: unsaved plan edits, and the fact that
 * quitting mid-service cuts the audience screen to nothing. Both are worth one
 * confirmation. `quitting` prevents the handler re-entering when we call
 * app.quit() ourselves.
 */
let quitting = false;

app.on('before-quit', async (event) => {
  if (quitting) return;

  const settings = await ctx.settings?.get().catch(() => null);
  if (settings?.general?.confirmOnQuit === false) return;

  const live = ctx.live?.get();
  const onAir = !!live?.program?.slides?.length && !live.blackout && !live.cleared;
  const unsaved = ctx.unsaved;
  if (!onAir && !unsaved) return;

  event.preventDefault();

  const detail = [
    onAir ? `"${live.program.title}" is on the audience screen right now.` : null,
    unsaved ? `${unsaved.label} has changes that are not saved to a file.` : null,
  ].filter(Boolean).join('\n\n');

  const choice = await dialog.showMessageBox(ctx.windows?.console, {
    type: 'warning',
    buttons: unsaved ? ['Cancel', 'Save and quit', 'Quit without saving'] : ['Cancel', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    message: onAir ? 'Quit while output is live?' : 'Quit with unsaved changes?',
    detail,
  });

  if (choice.response === 0) return;                    // cancel
  if (unsaved && choice.response === 1) {
    // Let the console run its own save, then come back and quit.
    ctx.windows.broadcast(EVENTS.HOTKEY, 'schedule:save-and-quit');
    return;
  }

  quitting = true;
  app.quit();
});

app.on('will-quit', async (event) => {
  globalShortcut.unregisterAll();
  // Never lose a pending library write on the way out.
  if (ctx.store && !ctx.store._flushed) {
    event.preventDefault();
    ctx.store._flushed = true;
    await ctx.store.flush().catch(() => {});
    quitting = true;
    app.quit();
  }
});

// A crash in one handler must not take the console down mid-service.
process.on('uncaughtException', (err) => console.error('[main] uncaught:', err));
process.on('unhandledRejection', (err) => console.error('[main] unhandled rejection:', err));

if (isDev()) console.log('[main] development mode — renderer from Vite');
