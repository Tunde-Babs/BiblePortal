'use strict';
/**
 * Offline scripture engine.
 *
 * Loads the bundled public-domain translations, serves reference lookups, and
 * owns the BM25 index used for text search. The index is built once and cached
 * on disk so subsequent launches are instant.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const canon = require('../lib/canon.cjs');
const reference = require('../lib/reference.cjs');
const { SearchIndex, phraseScore, editDistance, highlightRanges } = require('../lib/search.cjs');

const INDEX_VERSION = 3;

/**
 * How many translations and search indexes stay resident.
 *
 * A loaded translation is ~4 MB and its index ~25 MB, so an operator browsing
 * a dozen languages would otherwise hold several hundred MB for the rest of the
 * service. Both caches evict least-recently-used entries; anything dropped
 * reloads from disk (or from the on-disk index cache) in well under a second.
 */
const MAX_RESIDENT_TRANSLATIONS = 4;
const MAX_RESIDENT_INDEXES = 2;

class BibleService {
  /**
   * @param {{ dataDir:string, lexiconDir:string, cacheDir:string }} paths
   */
  constructor({ dataDir, lexiconDir, cacheDir }) {
    this.dataDir = dataDir;
    this.lexiconDir = lexiconDir;
    this.cacheDir = cacheDir;
    /** @type {Map<string, any>} translation id -> loaded document (LRU) */
    this.translations = new Map();
    /** @type {Map<string, SearchIndex>} translation id -> index (LRU) */
    this.indexes = new Map();
    /** @type {Map<string, Promise<SearchIndex>>} in-flight index builds */
    this.building = new Map();
    this.manifest = { translations: [], defaultTranslation: null, lexicon: null };
    this.lexicon = null;
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Mark a key as most-recently-used and evict the oldest past `max`.
   * A Map preserves insertion order, so re-inserting moves an entry to the end.
   */
  _touch(map, key, max, pinned) {
    if (map.has(key)) {
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
    }
    while (map.size > max) {
      // Never evict the default translation: it is the one most likely needed next.
      const oldest = [...map.keys()].find((k) => k !== pinned);
      if (!oldest) break;
      map.delete(oldest);
    }
  }

  async init() {
    try {
      this.manifest = JSON.parse(await fsp.readFile(path.join(this.dataDir, 'manifest.json'), 'utf8'));
    } catch {
      this.manifest = { translations: [], defaultTranslation: null, lexicon: null };
    }
    // Load the default translation eagerly so the first lookup is instant.
    if (this.manifest.defaultTranslation) {
      await this.load(this.manifest.defaultTranslation).catch(() => {});
    }
    return this.manifest;
  }

  get available() { return this.manifest.translations ?? []; }
  get defaultId() { return this.manifest.defaultTranslation ?? this.available[0]?.id ?? null; }

  resolveId(id) {
    const wanted = String(id || '').toLowerCase();
    if (this.available.some((t) => t.id === wanted)) return wanted;
    return this.defaultId;
  }

  /** Load a translation into memory (idempotent). */
  async load(id) {
    const key = this.resolveId(id);
    if (!key) throw new Error('No translations installed. Run `npm run data`.');
    if (this.translations.has(key)) {
      this._touch(this.translations, key, MAX_RESIDENT_TRANSLATIONS, this.defaultId);
      return this.translations.get(key);
    }
    const entry = this.available.find((t) => t.id === key);
    const file = path.join(this.dataDir, entry?.file ?? `${key}.json`);
    const doc = JSON.parse(await fsp.readFile(file, 'utf8'));
    this.translations.set(key, doc);
    this._touch(this.translations, key, MAX_RESIDENT_TRANSLATIONS, this.defaultId);
    return doc;
  }

  /** Raw verse text, or '' when the verse doesn't exist in this translation. */
  verseText(doc, bookId, chapter, verse) {
    const chapters = doc.books?.[bookId];
    if (!chapters) return '';
    const verses = chapters[chapter - 1];
    if (!verses) return '';
    return verses[verse - 1] ?? '';
  }

  /** Every verse of a chapter as `{ verse, text }`. */
  async chapter(bookId, chapterNo, translationId) {
    const doc = await this.load(translationId);
    const book = canon.getBook(bookId);
    if (!book) throw new Error(`Unknown book: ${bookId}`);
    const chapters = doc.books?.[book.id] ?? [];
    const verses = chapters[chapterNo - 1] ?? [];
    return {
      translation: doc.id,
      translationName: doc.name,
      bookId: book.id,
      book: book.name,
      chapter: chapterNo,
      chapterCount: book.chapters.length,
      verses: verses.map((text, i) => ({ verse: i + 1, text })).filter((v) => v.text),
    };
  }

  /**
   * Look up a free-text reference.
   * @returns {Promise<{ok:boolean, reference?:object, label?:string, verses?:object[], error?:string}>}
   */
  async lookup(input, translationId) {
    const ref = reference.parseOne(input);
    if (!ref) return { ok: false, error: reference.explain(input) };
    const doc = await this.load(translationId);
    const requested = reference.countVerses(ref);
    const verses = reference.expand(ref).map(({ bookId, chapter, verse }) => ({
      bookId, chapter, verse,
      text: this.verseText(doc, bookId, chapter, verse),
      label: reference.format({ bookId, book: canon.getBook(bookId).name, chapter, verse, endChapter: chapter, endVerse: verse }),
    })).filter((v) => v.text);

    if (!verses.length) {
      return { ok: false, error: `${reference.format(ref)} is not present in ${doc.abbr}.` };
    }
    return {
      ok: true,
      reference: ref,
      label: reference.format(ref),
      translation: doc.id,
      translationName: doc.name,
      translationAbbr: doc.abbr,
      verses,
      // Surfaced so the UI can say so rather than silently showing less than asked.
      truncated: requested > verses.length && requested > reference.EXPAND_LIMIT,
      requestedVerses: requested,
    };
  }

  /** The same passage across several translations, aligned verse by verse. */
  async parallel(input, translationIds) {
    const ids = (translationIds?.length ? translationIds : [this.defaultId]).map((i) => this.resolveId(i)).filter(Boolean);
    const columns = [];
    for (const id of [...new Set(ids)]) {
      const res = await this.lookup(input, id);
      if (res.ok) columns.push({ id, name: res.translationName, abbr: res.translationAbbr, verses: res.verses });
    }
    if (!columns.length) return { ok: false, error: `Could not read "${input}" as a scripture reference.` };
    const ref = reference.parseOne(input);
    return { ok: true, label: reference.format(ref), reference: ref, columns };
  }

  // ---------------------------------------------------------------- indexing

  indexFile(id) { return path.join(this.cacheDir, `index-${id}-v${INDEX_VERSION}.json.gz`); }

  /**
   * Get (building and caching if needed) the search index for a translation.
   * Concurrent callers share one build.
   */
  async index(id) {
    const key = this.resolveId(id);
    if (this.indexes.has(key)) {
      this._touch(this.indexes, key, MAX_RESIDENT_INDEXES, this.defaultId);
      return this.indexes.get(key);
    }
    if (this.building.has(key)) return this.building.get(key);

    const job = (async () => {
      const file = this.indexFile(key);
      try {
        const gz = await fsp.readFile(file);
        const idx = SearchIndex.fromJSON(JSON.parse(zlib.gunzipSync(gz).toString('utf8')));
        if (idx.docCount > 0) {
          this.indexes.set(key, idx);
          this._touch(this.indexes, key, MAX_RESIDENT_INDEXES, this.defaultId);
          return idx;
        }
      } catch { /* no usable cache — build below */ }

      const doc = await this.load(key);
      const idx = new SearchIndex();
      for (const [bookId, chapters] of Object.entries(doc.books)) {
        for (let c = 0; c < chapters.length; c++) {
          const verses = chapters[c];
          for (let v = 0; v < verses.length; v++) {
            if (verses[v]) idx.add(reference.verseKey(bookId, c + 1, v + 1), verses[v]);
          }
        }
      }
      this.indexes.set(key, idx);
      this._touch(this.indexes, key, MAX_RESIDENT_INDEXES, this.defaultId);
      // Cache in the background; a failure here only costs startup time later.
      fsp.writeFile(file, zlib.gzipSync(Buffer.from(JSON.stringify(idx.toJSON()), 'utf8')))
        .catch((err) => console.warn(`[bible] index cache failed: ${err.message}`));
      return idx;
    })().finally(() => this.building.delete(key));

    this.building.set(key, job);
    return job;
  }

  /** Decode a packed verse key back into a reference. */
  static decodeKey(key) {
    const order = Math.floor(key / 1_000_000);
    const chapter = Math.floor((key % 1_000_000) / 1000);
    const verse = key % 1000;
    const book = canon.getBookByOrder(order);
    return book ? { bookId: book.id, book: book.name, chapter, verse } : null;
  }

  /**
   * Full-text search across a translation.
   * @param {string} query
   * @param {{translation?:string, limit?:number, testament?:'OT'|'NT'|'ALL', bookId?:string}} opts
   */
  async search(query, opts = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) return { ok: true, query: q, results: [], total: 0 };

    const id = this.resolveId(opts.translation);
    const [doc, idx] = await Promise.all([this.load(id), this.index(id)]);
    const limit = Math.min(opts.limit ?? 60, 300);

    // Optional scope filter, applied while scoring so it never truncates results.
    let filter;
    if (opts.bookId) {
      const b = canon.getBook(opts.bookId);
      if (b) filter = (key) => Math.floor(key / 1_000_000) === b.order;
    } else if (opts.testament === 'OT' || opts.testament === 'NT') {
      const cutoff = 39; // Malachi is book 39
      filter = opts.testament === 'OT'
        ? (key) => Math.floor(key / 1_000_000) <= cutoff
        : (key) => Math.floor(key / 1_000_000) > cutoff;
    }

    // Over-fetch, then re-rank the head with phrase proximity.
    const raw = idx.search(q, { limit: limit * 4, filter });
    const scored = [];
    for (const hit of raw) {
      const loc = BibleService.decodeKey(hit.id);
      if (!loc) continue;
      const text = this.verseText(doc, loc.bookId, loc.chapter, loc.verse);
      if (!text) continue;
      const phrase = phraseScore(q, text);
      scored.push({
        ...loc,
        text,
        label: reference.format({ ...loc, endChapter: loc.chapter, endVerse: loc.verse }),
        score: hit.score * (1 + phrase * 1.4),
        highlights: highlightRanges(q, text),
      });
    }
    scored.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      query: q,
      translation: doc.id,
      translationAbbr: doc.abbr,
      total: scored.length,
      results: scored.slice(0, limit),
    };
  }

  /**
   * The unified "smart bar" behind the console's search field: understands a
   * reference, a phrase, or a misspelled book name, and says which it chose.
   */
  async smart(query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return { kind: 'empty', query: q };

    const ref = reference.parseOne(q);
    if (ref) {
      const hit = await this.lookup(q, opts.translation);
      if (hit.ok) return { kind: 'reference', query: q, ...hit };
    }

    // Did they mean a book name? ("jhn", "revalation", "corintians")
    const firstWord = q.split(/[\s\d:]+/)[0]?.toLowerCase() ?? '';
    if (firstWord.length >= 3 && !canon.resolveBook(firstWord)) {
      let best = null;
      for (const b of canon.books()) {
        const d = Math.min(
          editDistance(firstWord, b.name.toLowerCase(), 3),
          editDistance(firstWord, b.abbr.toLowerCase(), 3),
        );
        if (d <= 2 && (!best || d < best.distance)) best = { book: b, distance: d };
      }
      if (best) {
        const rest = q.slice(firstWord.length).trim();
        const suggestion = `${best.book.name}${rest ? ` ${rest}` : ''}`;
        const hit = await this.lookup(suggestion, opts.translation);
        if (hit.ok) return { kind: 'corrected', query: q, suggestion, ...hit };
      }
    }

    const results = await this.search(q, opts);
    return { kind: 'text', ...results };
  }

  // ----------------------------------------------------------------- lexicon

  async loadLexicon() {
    if (this.lexicon) return this.lexicon;
    try {
      const doc = JSON.parse(await fsp.readFile(path.join(this.lexiconDir, 'strongs.json'), 'utf8'));
      this.lexicon = doc.entries ?? {};
    } catch {
      this.lexicon = {};
    }
    return this.lexicon;
  }

  /** Look up one Strong's number, e.g. "G26" or "H1570". */
  async strongs(code) {
    const lex = await this.loadLexicon();
    const key = String(code || '').toUpperCase().replace(/\s+/g, '');
    const normalised = /^[GH]\d+$/.test(key) ? `${key[0]}${Number(key.slice(1))}` : key;
    const entry = lex[normalised];
    return entry ? { ok: true, code: normalised, ...entry } : { ok: false, code: normalised, error: 'Not in lexicon' };
  }

  /** Free-text search over lexicon definitions — "love", "covenant", "grace". */
  async lexiconSearch(query, limit = 40) {
    const lex = await this.loadLexicon();
    const q = String(query || '').toLowerCase().trim();
    if (q.length < 2) return [];
    const out = [];
    for (const [code, e] of Object.entries(lex)) {
      const hay = `${e.translit} ${e.definition} ${e.usage}`.toLowerCase();
      if (!hay.includes(q)) continue;
      // Prefer a hit in the transliteration or the head of the definition.
      const rank = (e.translit?.toLowerCase().startsWith(q) ? 0 : 1) + (e.definition?.toLowerCase().indexOf(q) < 40 ? 0 : 1);
      out.push({ code, rank, ...e });
      if (out.length > 800) break;
    }
    out.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    return out.slice(0, limit);
  }

  /** Stats for the settings/about screen. */
  stats() {
    return {
      translations: this.available.map((t) => ({ ...t, loaded: this.translations.has(t.id), indexed: this.indexes.has(t.id) })),
      lexiconEntries: this.lexicon ? Object.keys(this.lexicon).length : null,
      canonBooks: canon.BOOKS.length,
      canonVerses: canon.TOTAL_VERSES,
    };
  }
}

module.exports = { BibleService, INDEX_VERSION, MAX_RESIDENT_TRANSLATIONS, MAX_RESIDENT_INDEXES };
