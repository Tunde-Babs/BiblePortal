'use strict';
/**
 * Translation manager: installing, importing and removing translations.
 *
 * Two install paths, and the distinction matters legally:
 *
 *   installFromCatalogue()  downloads a public-domain text. Needs the network
 *                           once; the app is fully offline afterwards.
 *   importModule()          converts a module file the user already owns.
 *                           Never touches the network. This is how a church
 *                           installs a licensed translation such as NIV, NLT,
 *                           NKJV, AMP or MSG — BiblePortal cannot distribute
 *                           those, but it can read the copy you licensed.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const canon = require('../lib/canon.cjs');
const catalogue = require('../lib/catalog.cjs');
const moduleImport = require('../lib/module-import.cjs');
const sqliteModule = require('../lib/sqlite-module.cjs');

const API = 'https://api.getbible.net/v2';

class TranslationService {
  /**
   * @param {{ dataDir:string, cacheDir:string, bible:import('./bible.cjs').BibleService }} deps
   */
  constructor({ dataDir, cacheDir, bible }) {
    this.dataDir = dataDir;
    this.cacheDir = cacheDir;
    this.bible = bible;
  }

  /** Catalogue + install state, grouped by language, for the manager UI. */
  async catalogue() {
    const installed = new Map((this.bible.available ?? []).map((t) => [t.id, t]));
    const groups = catalogue.grouped().map((g) => ({
      language: g.language,
      translations: g.translations.map((t) => ({
        ...t,
        installed: installed.has(t.id),
        verseCount: installed.get(t.id)?.verseCount ?? null,
      })),
    }));

    // Imported modules aren't in the catalogue; surface them in their own group.
    const imported = [...installed.values()].filter((t) => t.imported || !catalogue.byId(t.id));
    if (imported.length) {
      groups.unshift({
        language: 'Your modules',
        translations: imported.map((t) => ({ ...t, installed: true, imported: true })),
      });
    }

    return {
      groups,
      installedCount: installed.size,
      /** Shown in the UI so the absence of NIV/NLT/etc. is explained, not mysterious. */
      licensed: catalogue.LICENSED,
    };
  }

  /** Download and install a public-domain translation from the catalogue. */
  async installFromCatalogue(id, onProgress = () => {}) {
    const entry = catalogue.byId(id);
    if (!entry) throw new Error(`"${id}" is not in the catalogue.`);

    onProgress({ id, stage: 'downloading', percent: 5 });
    const res = await fetch(`${API}/${entry.slug}.json`, { headers: { 'user-agent': 'BiblePortal/1.0' } });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}). Check your connection.`);
    const payload = await res.json();

    onProgress({ id, stage: 'converting', percent: 55 });
    const books = {};
    let verseCount = 0;
    for (const book of payload.books ?? []) {
      const canonBook = canon.getBookByOrder(book.nr);
      if (!canonBook) continue; // e.g. deuterocanon outside the Protestant canon
      const chapters = [];
      for (const ch of book.chapters ?? []) {
        const verses = [];
        for (const v of ch.verses ?? []) {
          verses[v.verse - 1] = String(v.text).replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        }
        for (let i = 0; i < verses.length; i++) if (verses[i] == null) verses[i] = '';
        chapters[ch.chapter - 1] = verses;
        verseCount += verses.length;
      }
      for (let i = 0; i < chapters.length; i++) if (chapters[i] == null) chapters[i] = [];
      books[canonBook.id] = chapters;
    }
    if (!verseCount) throw new Error('The download contained no verses.');

    const doc = {
      format: 'bibleportal.translation/1',
      id: entry.id, name: entry.name, abbr: entry.abbr,
      lang: entry.lang, language: entry.language, year: entry.year,
      license: entry.license, scope: entry.scope, note: entry.note ?? null,
      source: `${API}/${entry.slug}.json`,
      builtAt: new Date().toISOString().slice(0, 10),
      verseCount, bookCount: Object.keys(books).length, books,
    };

    onProgress({ id, stage: 'saving', percent: 85 });
    await this._write(doc);
    onProgress({ id, stage: 'done', percent: 100 });
    return { ok: true, id: entry.id, name: entry.name, verseCount };
  }

  /**
   * Parse a module file into a translation document.
   *
   * SQLite-backed modules (MyBible, MySword, e-Sword) are how most commercially
   * licensed translations are distributed, so they are detected by file
   * signature before falling back to the text-based formats.
   */
  async _parseModule(filePath, meta = {}) {
    const buffer = await fsp.readFile(filePath);
    const filename = path.basename(filePath);

    if (sqliteModule.isSqlite(buffer)) {
      const parsed = await sqliteModule.readSqliteModule(buffer);
      if (!parsed.verseCount) throw new Error('The module opened, but contained no verses.');

      const base = filename.replace(/\.(sqlite3?|bblx|bbli|mybible|bbl)$/i, '').replace(/[_-]+/g, ' ').trim();
      const name = (meta.name || parsed.meta.name || base || 'Imported Translation').trim();
      const abbr = (meta.abbr || parsed.meta.abbr || name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'IMP').trim();
      const id = (meta.id || abbr.toLowerCase().replace(/[^a-z0-9]/g, '') || 'imported').slice(0, 16);

      const scope = parsed.bookCount >= 60 ? 'full'
        : Object.keys(parsed.books).every((k) => canon.getBook(k)?.testament === 'NT') ? 'nt'
        : 'partial';

      return {
        format: 'bibleportal.translation/1',
        id, name, abbr,
        lang: meta.language ?? parsed.meta.language ?? 'en',
        language: meta.language ?? parsed.meta.language ?? 'en',
        year: meta.year ?? null,
        // The user's own licensed copy — never redistributed by this app.
        license: meta.license ?? 'User-supplied module (licence held by the user)',
        source: `imported:${filename}`,
        imported: true,
        sourceFormat: parsed.sourceFormat,
        scope,
        builtAt: new Date().toISOString().slice(0, 10),
        verseCount: parsed.verseCount,
        bookCount: parsed.bookCount,
        books: parsed.books,
      };
    }

    return moduleImport.importModule(buffer.toString('utf8'), filename, meta);
  }

  /**
   * Import a module file the user owns. Entirely local — no network, no upload.
   * @param {string} filePath
   * @param {object} meta optional overrides (name, abbr, id, language)
   */
  async importModule(filePath, meta = {}) {
    const doc = await this._parseModule(filePath, meta);

    if (catalogue.byId(doc.id) && doc.id !== meta.id) doc.id = `${doc.id}-mod`; // never shadow a catalogue id
    await this._write(doc);

    return {
      ok: true,
      id: doc.id,
      name: doc.name,
      abbr: doc.abbr,
      format: doc.sourceFormat,
      verseCount: doc.verseCount,
      bookCount: doc.bookCount,
      scope: doc.scope,
    };
  }

  /** Preview a module file without installing it, so the UI can confirm first. */
  async inspectModule(filePath) {
    const doc = await this._parseModule(filePath);
    // A recognisable verse proves the parse landed on real text.
    const sample = doc.books.JHN?.[2]?.[15] ?? doc.books.GEN?.[0]?.[0] ?? null;
    return {
      ok: true,
      format: doc.sourceFormat,
      name: doc.name,
      abbr: doc.abbr,
      suggestedId: doc.id,
      verseCount: doc.verseCount,
      bookCount: doc.bookCount,
      scope: doc.scope,
      sample: sample ? String(sample).slice(0, 160) : null,
    };
  }

  async remove(id) {
    const entry = (this.bible.available ?? []).find((t) => t.id === id);
    if (!entry) throw new Error('Translation not installed.');
    if ((this.bible.available ?? []).length <= 1) throw new Error('At least one translation must remain installed.');

    await fsp.unlink(path.join(this.dataDir, entry.file ?? `${id}.json`)).catch(() => {});
    // Drop the cached search index too, or a reinstall would reuse stale postings.
    for (const f of await fsp.readdir(this.cacheDir).catch(() => [])) {
      if (f.startsWith(`index-${id}-`)) await fsp.unlink(path.join(this.cacheDir, f)).catch(() => {});
    }
    this.bible.translations.delete(id);
    this.bible.indexes.delete(id);
    await this._rebuildManifest();
    return { ok: true, id };
  }

  /** Write a translation document and refresh the manifest + in-memory state. */
  async _write(doc) {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.writeFile(path.join(this.dataDir, `${doc.id}.json`), JSON.stringify(doc), 'utf8');
    // Replace any cached copy so the new text is served immediately.
    this.bible.translations.set(doc.id, doc);
    this.bible.indexes.delete(doc.id);
    for (const f of await fsp.readdir(this.cacheDir).catch(() => [])) {
      if (f.startsWith(`index-${doc.id}-`)) await fsp.unlink(path.join(this.cacheDir, f)).catch(() => {});
    }
    await this._rebuildManifest();
  }

  async _rebuildManifest() {
    const files = (await fsp.readdir(this.dataDir).catch(() => []))
      .filter((f) => f.endsWith('.json') && f !== 'manifest.json');

    const translations = [];
    for (const file of files) {
      try {
        const doc = JSON.parse(await fsp.readFile(path.join(this.dataDir, file), 'utf8'));
        if (doc.format !== 'bibleportal.translation/1') continue;
        translations.push({
          id: doc.id, name: doc.name, abbr: doc.abbr, year: doc.year ?? null,
          lang: doc.lang ?? 'en', language: doc.language ?? 'English',
          license: doc.license, scope: doc.scope ?? 'full', note: doc.note ?? null,
          verseCount: doc.verseCount, bookCount: doc.bookCount ?? null,
          imported: doc.imported ?? false, file,
        });
      } catch { /* skip anything unreadable rather than failing the rebuild */ }
    }

    translations.sort((a, b) => (a.lang === 'en' ? -1 : 1) - (b.lang === 'en' ? -1 : 1) || a.name.localeCompare(b.name));

    const previous = this.bible.manifest?.defaultTranslation;
    const manifest = {
      format: 'bibleportal.manifest/1',
      builtAt: new Date().toISOString(),
      defaultTranslation: translations.some((t) => t.id === previous) ? previous
        : (translations.find((t) => t.id === 'kjv')?.id ?? translations[0]?.id ?? null),
      translations,
      lexicon: this.bible.manifest?.lexicon ?? null,
    };

    await fsp.writeFile(path.join(this.dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    this.bible.manifest = manifest;
    return manifest;
  }
}

module.exports = { TranslationService };
