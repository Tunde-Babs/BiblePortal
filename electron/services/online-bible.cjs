'use strict';
/**
 * API.Bible connector for licensed translations.
 *
 * Translations such as NIV, NLT, MSG and AMP cannot be bundled — they are under
 * active copyright. A church that holds access through API.Bible can reach them
 * here instead, under its own key.
 *
 * Three rules this service exists to enforce:
 *
 *   1. The key belongs to the user. It lives in their settings file, never in
 *      the repository, never in a log line, and never in an error message.
 *   2. Attribution is not optional. Publishers permit church display on
 *      condition the translation abbreviation appears with the text, so the
 *      abbreviation and copyright travel with every passage.
 *   3. Bundled and licensed translations stay distinguishable, so nobody
 *      mistakes an online one for something the app ships.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const canon = require('./../lib/canon.cjs');
const reference = require('./../lib/reference.cjs');

const DEFAULT_ENDPOINT = 'https://api.scripture.api.bible/v1';

/** Requests time out rather than hanging a live service. */
const TIMEOUT_MS = 12_000;

/** Never let a key reach a log or an error surface. */
function redact(text, key) {
  if (!key) return String(text);
  return String(text).split(key).join('«key»');
}

class OnlineBibleService {
  /**
   * @param {{ settings:import('./settings.cjs').SettingsService, cacheDir:string }} deps
   */
  constructor({ settings, cacheDir }) {
    this.settings = settings;
    this.cacheDir = path.join(cacheDir, 'online');
    /** Available translations, fetched once per session. */
    this.catalogue = null;
  }

  async config() {
    const s = await this.settings.get();
    const online = s.online ?? {};
    return {
      key: online.apiKey ?? '',
      endpoint: (online.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      enabled: !!online.enabled && !!online.apiKey,
      cache: online.cache !== false,
      bibles: online.bibles ?? [],
    };
  }

  /** A stable, non-reversible cache filename. The key is never part of it. */
  _cacheFile(bibleId, passageId) {
    const name = crypto.createHash('sha1').update(`${bibleId}:${passageId}`).digest('hex');
    return path.join(this.cacheDir, `${name}.json`);
  }

  async _readCache(bibleId, passageId) {
    try { return JSON.parse(await fsp.readFile(this._cacheFile(bibleId, passageId), 'utf8')); }
    catch { return null; }
  }

  async _writeCache(bibleId, passageId, payload) {
    try {
      await fsp.mkdir(this.cacheDir, { recursive: true });
      await fsp.writeFile(this._cacheFile(bibleId, passageId), JSON.stringify(payload), 'utf8');
    } catch { /* a cache miss is not worth failing a service over */ }
  }

  /** One authenticated request, with the key kept out of anything it throws. */
  async _get(pathname, params = {}) {
    const { key, endpoint, enabled } = await this.config();
    if (!enabled) throw new Error('No API.Bible key is configured. Add one in Settings ▸ Translations ▸ Online.');

    const url = new URL(`${endpoint}${pathname}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        headers: { 'api-key': key, accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? 'The request timed out. Check your connection.'
        : redact(err?.message ?? String(err), key);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error('API.Bible rejected the key. Check it in Settings, and that your plan covers this translation.');
    }
    if (res.status === 429) {
      throw new Error('API.Bible rate limit reached for this month. Bundled translations still work offline.');
    }
    if (!res.ok) {
      throw new Error(`API.Bible returned HTTP ${res.status}.`);
    }

    const body = await res.json();
    return body?.data ?? body;
  }

  /** Translations this key can reach. */
  async bibles({ refresh = false } = {}) {
    if (this.catalogue && !refresh) return this.catalogue;
    const data = await this._get('/bibles');
    this.catalogue = (Array.isArray(data) ? data : []).map((b) => ({
      id: b.id,
      abbr: b.abbreviationLocal || b.abbreviation || b.id,
      name: b.nameLocal || b.name,
      language: b.language?.name ?? 'Unknown',
      description: b.description ?? '',
      copyright: b.copyright ?? '',
      // Everything here is licensed to the user, not bundled by us.
      licensed: true,
      online: true,
    }));
    return this.catalogue;
  }

  /** Build an API.Bible passage id from a parsed reference. */
  static passageId(ref) {
    const book = canon.getBook(ref.bookId);
    if (!book) throw new Error(`Unknown book: ${ref.bookId}`);
    const start = `${book.id}.${ref.chapter}${ref.verse != null ? `.${ref.verse}` : ''}`;
    const endChapter = ref.endChapter || ref.chapter;
    const endVerse = ref.endVerse;
    if (endVerse == null && endChapter === ref.chapter) return start;
    const end = `${book.id}.${endChapter}${endVerse != null ? `.${endVerse}` : ''}`;
    return start === end ? start : `${start}-${end}`;
  }

  /**
   * Split API.Bible's verse-numbered text back into individual verses, so an
   * online passage behaves exactly like a bundled one downstream.
   */
  static splitVerses(content, ref) {
    const text = String(content ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return [];

    /**
     * Verse markers vary by translation and by how the API is asked for text.
     * Each pattern below has been seen in the wild, so try them in order of
     * how unambiguous they are rather than assuming one shape.
     */
    const patterns = [
      /\s*\[(\d{1,3})\]\s*/,      // [16]  — bracketed
      /\s*\((\d{1,3})\)\s*/,      // (16)  — parenthesised
      /\s*\{(\d{1,3})\}\s*/,      // {16}  — braced
      /\s+(\d{1,3})\.\s+/,        // 16.   — numbered with a stop
    ];

    for (const pattern of patterns) {
      const parts = text.split(new RegExp(pattern, 'g')).filter((p) => p !== undefined && p !== '');
      // A real split alternates marker, body, marker, body…
      if (parts.length < 3) continue;

      const verses = [];
      // A leading fragment before the first marker belongs to the opening verse.
      let start = 0;
      if (!/^\d{1,3}$/.test(parts[0])) start = 1;

      for (let i = start; i < parts.length - 1; i += 2) {
        const number = Number(parts[i]);
        const body = String(parts[i + 1] ?? '').trim();
        if (!Number.isFinite(number) || !body) continue;
        verses.push({ verse: number, text: body });
      }
      if (verses.length) return verses;
    }

    // No markers found — one block, attributed to the opening verse.
    return [{ verse: ref?.verse ?? 1, text }];
  }

  /**
   * Describe a response's shape without recording any of its text.
   *
   * A licensed translation must not be written into a diagnostics file, so this
   * captures field names, lengths and which marker style was detected — enough
   * to debug a parse, nothing that reproduces the work.
   */
  static describeShape(data, verses) {
    const content = String(data?.content ?? '');
    const marker = /\[\d{1,3}\]/.test(content) ? 'bracket'
      : /\(\d{1,3}\)/.test(content) ? 'paren'
      : /\{\d{1,3}\}/.test(content) ? 'brace'
      : /\s\d{1,3}\.\s/.test(content) ? 'numbered'
      : 'none';
    return {
      fields: Object.keys(data ?? {}).sort(),
      contentChars: content.length,
      markerStyle: marker,
      versesParsed: verses.length,
      verseNumbers: verses.map((v) => v.verse),
      hasCopyright: !!data?.copyright,
    };
  }

  /**
   * Fetch a passage.
   * @param {string} bibleId  API.Bible translation id
   * @param {string} input    free-text reference
   */
  async lookup(bibleId, input) {
    const ref = reference.parseOne(input);
    if (!ref) return { ok: false, error: reference.explain(input) };

    const passageId = OnlineBibleService.passageId(ref);
    const { cache } = await this.config();

    if (cache) {
      const hit = await this._readCache(bibleId, passageId);
      if (hit) return { ...hit, cached: true };
    }

    const data = await this._get(`/bibles/${encodeURIComponent(bibleId)}/passages/${encodeURIComponent(passageId)}`, {
      'content-type': 'text',
      'include-verse-numbers': true,
      'include-notes': false,
      'include-titles': false,
      'include-chapter-numbers': false,
    });

    const book = canon.getBook(ref.bookId);
    const verses = OnlineBibleService.splitVerses(data?.content, ref).map((v) => ({
      bookId: ref.bookId,
      book: book.name,
      chapter: ref.chapter,
      verse: v.verse,
      text: v.text,
      label: reference.format({
        bookId: ref.bookId, book: book.name, chapter: ref.chapter,
        verse: v.verse, endChapter: ref.chapter, endVerse: v.verse,
      }),
    }));

    const meta = (this.catalogue ?? []).find((b) => b.id === bibleId);
    const payload = {
      ok: true,
      online: true,
      reference: ref,
      label: reference.format(ref),
      translation: bibleId,
      translationName: meta?.name ?? data?.bibleId ?? bibleId,
      // Publishers require this beside the text; it is not a display preference.
      translationAbbr: meta?.abbr ?? '',
      copyright: data?.copyright ?? meta?.copyright ?? '',
      verses,
    };

    // Structure only — never the text of a licensed translation.
    this.lastShape = OnlineBibleService.describeShape(data, verses);

    if (cache) await this._writeCache(bibleId, passageId, payload);
    return payload;
  }

  /** Remove every cached passage — for clearing licensed text off the machine. */
  async clearCache() {
    const files = await fsp.readdir(this.cacheDir).catch(() => []);
    for (const f of files) await fsp.unlink(path.join(this.cacheDir, f)).catch(() => {});
    return { ok: true, removed: files.length };
  }

  async cacheSize() {
    const files = await fsp.readdir(this.cacheDir).catch(() => []);
    let bytes = 0;
    for (const f of files) {
      const s = await fsp.stat(path.join(this.cacheDir, f)).catch(() => null);
      if (s) bytes += s.size;
    }
    return { passages: files.length, bytes };
  }

  /** Confirm a key works, without revealing it. */
  async test() {
    const list = await this.bibles({ refresh: true });
    return { ok: true, count: list.length, sample: list.slice(0, 8).map((b) => `${b.abbr} — ${b.name}`) };
  }

  /**
   * Fetch one known passage and report how it parsed — field names, marker
   * style and verse numbers, with no verse text. Used to confirm the parser
   * matches what a given translation actually returns.
   */
  async diagnose(bibleId, ref = 'John 3:16-18') {
    const hit = await this.lookup(bibleId, ref);
    return {
      ok: true,
      bibleId,
      reference: hit.label,
      abbr: hit.translationAbbr,
      cached: !!hit.cached,
      shape: this.lastShape ?? null,
      // Lengths only, so a licensed text is never written down.
      verseLengths: (hit.verses ?? []).map((v) => v.text.length),
    };
  }
}

module.exports = { OnlineBibleService, DEFAULT_ENDPOINT };
