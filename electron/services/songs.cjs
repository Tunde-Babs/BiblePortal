'use strict';
/**
 * Song library.
 *
 * The library starts empty on purpose — worship lyrics are licensed content the
 * local church holds (usually under CCLI), so BiblePortal imports what the user
 * already owns instead of shipping anyone else's catalogue.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const format = require('../lib/song-format.cjs');
const { SearchIndex } = require('../lib/search.cjs');

const DOC = 'songs';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.library/1', songs: [] });

const newId = () => `song_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

class SongService {
  /** @param {import('./store.cjs').Store} store */
  constructor(store) {
    this.store = store;
    /** @type {SearchIndex|null} rebuilt whenever the library changes */
    this.index = null;
    /** @type {Map<number, string>} index doc id -> song id */
    this.indexMap = new Map();
  }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.songs ?? [];
  }

  async get(id) {
    return (await this.all()).find((s) => s.id === id) ?? null;
  }

  async save(songs) {
    await this.store.write(DOC, { ...empty(), songs, updatedAt: new Date().toISOString() });
    this.index = null; // invalidate; rebuilt lazily on next search
    return songs;
  }

  /** Create or update a song. Returns the stored record. */
  async upsert(input) {
    const songs = await this.all();
    const now = new Date().toISOString();
    const existing = input.id ? songs.findIndex((s) => s.id === input.id) : -1;

    const record = {
      id: input.id ?? newId(),
      title: (input.title ?? 'Untitled').trim(),
      author: input.author ?? '',
      key: input.key ?? '',
      originalKey: input.originalKey ?? input.key ?? '',
      tempo: input.tempo ?? null,
      timeSignature: input.timeSignature ?? '',
      ccli: input.ccli ?? '',
      copyright: input.copyright ?? '',
      capo: input.capo ?? null,
      tags: input.tags ?? [],
      sections: input.sections ?? [],
      arrangement: input.arrangement ?? (input.sections ?? []).map((s) => s.id),
      notes: input.notes ?? '',
      // Per-song overrides on the theme; null means "use the theme as-is".
      style: input.style ?? null,
      createdAt: existing >= 0 ? songs[existing].createdAt : now,
      updatedAt: now,
      usageCount: existing >= 0 ? songs[existing].usageCount ?? 0 : 0,
      lastUsedAt: existing >= 0 ? songs[existing].lastUsedAt ?? null : null,
    };

    if (existing >= 0) songs[existing] = record; else songs.push(record);
    await this.save(songs);
    return record;
  }

  async remove(id) {
    const songs = await this.all();
    const next = songs.filter((s) => s.id !== id);
    await this.save(next);
    return { removed: songs.length - next.length };
  }

  /**
   * Remove many songs in one pass.
   *
   * Calling remove() in a loop would re-read and re-write the whole library
   * once per song — for a large clear-out that is thousands of full saves and
   * leaves the library half-deleted if it is interrupted partway. One read and
   * one atomic save keeps it fast and all-or-nothing.
   */
  async removeMany(ids) {
    const doomed = new Set(ids ?? []);
    if (!doomed.size) return { removed: 0, remaining: (await this.all()).length };
    const songs = await this.all();
    const next = songs.filter((s) => !doomed.has(s.id));
    await this.save(next);
    return { removed: songs.length - next.length, remaining: next.length };
  }

  /** Empty the library outright. Returns the count so the UI can report it. */
  async removeAll() {
    const songs = await this.all();
    await this.save([]);
    return { removed: songs.length, remaining: 0 };
  }

  /** Record that a song was used in a service — drives "recent" and "most used". */
  async markUsed(id) {
    const songs = await this.all();
    const song = songs.find((s) => s.id === id);
    if (!song) return null;
    song.usageCount = (song.usageCount ?? 0) + 1;
    song.lastUsedAt = new Date().toISOString();
    await this.save(songs);
    return song;
  }

  /** Import one file's contents into the library. */
  async importFile(filePath) {
    const content = await fsp.readFile(filePath, 'utf8');
    const parsed = format.importSong(content, path.basename(filePath));
    const saved = await this.upsert({ ...parsed, originalKey: parsed.key });
    return { ok: true, song: saved, format: parsed.format, file: path.basename(filePath) };
  }

  /** Import many files, reporting per-file outcomes rather than failing the batch. */
  async importFiles(filePaths) {
    const results = [];
    for (const file of filePaths) {
      try { results.push(await this.importFile(file)); }
      catch (err) { results.push({ ok: false, file: path.basename(file), error: err.message }); }
    }
    return {
      imported: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /** Import from pasted text (the "paste lyrics" path in the UI). */
  async importText(text, filename = 'Pasted song.txt') {
    const parsed = format.importSong(text, filename);
    return this.upsert({ ...parsed, originalKey: parsed.key });
  }

  async exportSong(id) {
    const song = await this.get(id);
    if (!song) throw new Error('Song not found');
    return { filename: `${song.title.replace(/[^\w\s-]/g, '').trim() || 'song'}.cho`, content: format.exportChordPro(song) };
  }

  // ------------------------------------------------------------------ search

  async ensureIndex() {
    if (this.index) return this.index;
    const songs = await this.all();
    const idx = new SearchIndex();
    this.indexMap = new Map();
    songs.forEach((song, i) => {
      this.indexMap.set(i, song.id);
      const body = (song.sections ?? []).map((s) => s.body.replace(/\[[^\]]*\]/g, '')).join('\n');
      idx.add(i, `${song.title} ${song.author} ${(song.tags ?? []).join(' ')} ${body}`);
    });
    this.index = idx;
    return idx;
  }

  /**
   * Search titles, authors, tags and lyrics. Title matches are boosted so
   * typing a song name finds it instantly.
   */
  async search(query, limit = 40) {
    const songs = await this.all();
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) {
      return [...songs]
        .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.title.localeCompare(b.title))
        .slice(0, limit)
        .map((song) => ({ song, score: 0, reason: song.lastUsedAt ? 'recent' : 'library' }));
    }

    const idx = await this.ensureIndex();
    const byId = new Map(songs.map((s) => [s.id, s]));
    const scores = new Map();

    for (const hit of idx.search(q, { limit: limit * 3 })) {
      const id = this.indexMap.get(hit.id);
      if (id) scores.set(id, hit.score);
    }
    // Direct substring matches on title/author always rank, even for one letter.
    for (const song of songs) {
      const title = song.title.toLowerCase();
      if (title.includes(q)) scores.set(song.id, (scores.get(song.id) ?? 0) + (title.startsWith(q) ? 14 : 8));
      if ((song.author ?? '').toLowerCase().includes(q)) scores.set(song.id, (scores.get(song.id) ?? 0) + 4);
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ song: byId.get(id), score }))
      .filter((r) => r.song)
      .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
      .slice(0, limit)
      .map((r) => ({ ...r, reason: r.song.title.toLowerCase().includes(q) ? 'title' : 'lyrics' }));
  }

  /** Slides for presentation, with the requested key applied. */
  async slides(id, opts = {}) {
    const song = await this.get(id);
    if (!song) throw new Error('Song not found');
    return format.toSlides(song, opts);
  }

  async stats() {
    const songs = await this.all();
    return {
      count: songs.length,
      withChords: songs.filter((s) => (s.sections ?? []).some((x) => /\[[A-G]/.test(x.body))).length,
      withCcli: songs.filter((s) => s.ccli).length,
      tags: [...new Set(songs.flatMap((s) => s.tags ?? []))].sort(),
    };
  }
}

module.exports = { SongService, emptyLibrary: empty };
