'use strict';
/**
 * Importing an existing EasyWorship library into BiblePortal.
 *
 * Everything happens on this machine: a church's songs, schedules and
 * backgrounds are their own licensed content, so they are copied across rather
 * than uploaded anywhere.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ew = require('../lib/easyworship.cjs');
const paradox = require('../lib/paradox.cjs');
const { rtfToText } = require('../lib/rtf.cjs');
const songFormat = require('../lib/song-format.cjs');

class EasyWorshipImportService {
  /**
   * @param {{ songs:import('./songs.cjs').SongService,
   *           media:import('./media.cjs').MediaService,
   *           plans:import('./plan.cjs').PlanService }} deps
   */
  constructor({ songs, media, plans }) {
    this.songs = songs;
    this.media = media;
    this.plans = plans;
  }

  /** Read a schedule without changing anything, so the UI can confirm first. */
  async inspect(filePath) {
    const { size, large } = await ew.checkSize(filePath);
    const result = await ew.readEwsxFile(filePath);
    return {
      ok: true,
      file: path.basename(filePath),
      format: result.format,
      bytes: size,
      large,
      songs: result.songs.length,
      media: result.media.length,
      tables: result.tables,
      notes: result.notes,
      // A short preview so the operator can see it read the right thing.
      sample: result.songs.slice(0, 5).map((s) => ({
        title: s.title,
        author: s.author,
        sections: s.sections.length,
      })),
    };
  }

  /**
   * Import songs, media and optionally a service plan from a `.ewsx` file.
   * @param {string} filePath
   * @param {{ songs?:boolean, media?:boolean, plan?:boolean }} what
   */
  async importSchedule(filePath, what = {}, onProgress = null) {
    await ew.checkSize(filePath);
    const wantSongs = what.songs !== false;
    const wantMedia = what.media !== false;
    const wantPlan = what.plan === true;

    const result = await ew.readEwsxFile(filePath);

    const imported = { songs: 0, media: 0, skipped: 0, errors: [] };
    const songIdByTitle = new Map();

    if (wantSongs) {
      const existing = await this.songs.all();
      const seen = new Set(existing.map((s) => s.title.trim().toLowerCase()));

      for (const song of result.songs) {
        const key = song.title.trim().toLowerCase();
        // Re-importing a schedule should not duplicate a library.
        if (seen.has(key)) { imported.skipped++; continue; }
        try {
          const saved = await this.songs.upsert({
            title: song.title,
            author: song.author,
            copyright: song.copyright,
            ccli: song.ccli,
            key: song.key,
            originalKey: song.key,
            sections: song.sections,
            arrangement: song.arrangement,
            notes: 'Imported from EasyWorship',
          });
          songIdByTitle.set(key, saved.id);
          seen.add(key);
          imported.songs++;
        } catch (err) {
          imported.errors.push(`${song.title}: ${err.message}`);
        }
      }
    }

    if (wantMedia && result.media.length) {
      await fsp.mkdir(this.media.mediaDir, { recursive: true });
      const items = await this.media.all();

      // Open the archive once and stream each entry out. Buffering a 2 GB video
      // would exceed what a Buffer can hold; streaming costs one chunk at a time.
      for (const entry of result.media) {
        try {
          const ext = path.extname(entry.name).toLowerCase();
          const id = `m_${crypto.randomBytes(6).toString('hex')}`;
          const dest = path.join(this.media.mediaDir, `${id}${ext}`);
          const bytes = await ew.streamEntryToFile(filePath, entry.entry, dest);

          const isVideo = /\.(mp4|mov|m4v|webm|mkv)$/i.test(ext);
          items.push({
            id,
            kind: isVideo ? 'video' : 'image',
            name: path.basename(entry.name, ext),
            file: dest,
            ext,
            bytes,
            addedAt: new Date().toISOString(),
            loop: isVideo,
            muted: true,
            role: 'background',
            tags: ['easyworship'],
          });
          imported.media++;
          onProgress?.({ stage: 'media', name: entry.name, done: imported.media, total: result.media.length });
        } catch (err) {
          imported.errors.push(`${entry.name}: ${err.message}`);
        }
      }
      await this.media.store.write('media', { format: 'bibleportal.media/1', items });
    }

    let plan = null;
    if (wantPlan && result.songs.length) {
      plan = await this.plans.create({
        name: path.basename(filePath).replace(/\.ewsx$/i, ''),
        notes: 'Imported from EasyWorship',
      });
      for (const song of result.songs) {
        const id = songIdByTitle.get(song.title.trim().toLowerCase());
        await this.plans.addItem(plan.id, {
          kind: 'song',
          title: song.title,
          songId: id ?? null,
          key: song.key || null,
        });
      }
    }

    return { ok: true, ...imported, plan };
  }

  /**
   * Locate the song table inside an EasyWorship profile folder.
   *
   * A profile can be handed over in several shapes — the profile root, its
   * "… Data" folder, or the Databases folder itself — so accept any of them
   * rather than making the operator find the exact directory.
   */
  async findSongTable(dir) {
    const candidates = [
      path.join(dir, 'Databases', 'Data', 'Songs.DB'),
      path.join(dir, 'Data', 'Songs.DB'),
      path.join(dir, 'Songs.DB'),
    ];
    for (const candidate of candidates) {
      try { await fsp.access(candidate); return candidate; } catch { /* keep looking */ }
    }

    // Fall back to a bounded search, so a slightly different layout still works.
    const stack = [dir];
    let visited = 0;
    while (stack.length && visited < 400) {
      const current = stack.pop();
      visited++;
      let entries;
      try { entries = await fsp.readdir(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isFile() && /^songs\.db$/i.test(entry.name)) return full;
        // Skip the timestamped archives of superseded data.
        if (entry.isDirectory() && !/^oldData/i.test(entry.name)) stack.push(full);
      }
    }
    return null;
  }

  /** Read a profile's song library without importing, so the UI can confirm. */
  async inspectProfile(dir) {
    const table = await this.findSongTable(dir);
    if (!table) {
      throw new Error('No song library found. Choose the EasyWorship profile folder — the one containing "Databases".');
    }
    const info = await paradox.inspect(table);
    return {
      ok: true,
      table,
      folder: path.basename(dir),
      songs: info.records,
      memoMB: Math.round(info.memoBytes / 1048576),
      fields: info.fields.filter((f) => /title|author|copyright|words|number/i.test(f.name)).map((f) => f.name),
    };
  }

  /**
   * Import a whole EasyWorship song library from its Paradox tables.
   *
   * Lyrics are stored as RTF, so each is decoded and then split into stanzas on
   * blank lines — the same rule the editor uses, so an imported song is
   * indistinguishable from one written here.
   */
  async importProfile(dir, opts = {}, onProgress = null) {
    const table = await this.findSongTable(dir);
    if (!table) {
      throw new Error('No song library found. Choose the EasyWorship profile folder — the one containing "Databases".');
    }

    const { rows } = await paradox.readTable(table, {
      limit: opts.limit ?? Infinity,
      onProgress: (done, total) => onProgress?.({ stage: 'read', done, total }),
    });

    const existing = await this.songs.all();
    const seen = new Set(existing.map((s) => s.title.trim().toLowerCase()));
    const result = { total: rows.length, imported: 0, skipped: 0, empty: 0, errors: [] };

    for (const [i, row] of rows.entries()) {
      const title = String(row.Title ?? '').trim();
      if (!title) { result.empty++; continue; }

      const key = title.toLowerCase();
      // Re-running an import must not duplicate a library.
      if (seen.has(key)) { result.skipped++; continue; }

      const words = rtfToText(String(row.Words ?? ''));
      if (!words.trim()) { result.empty++; continue; }

      try {
        const sections = songFormat.splitStanzas(words);
        if (!sections.length) { result.empty++; continue; }

        await this.songs.upsert({
          title,
          author: String(row.Author ?? '').trim(),
          copyright: String(row.Copyright ?? '').trim(),
          ccli: String(row['Song Number'] ?? '').trim(),
          sections,
          arrangement: sections.map((x) => x.id),
          notes: 'Imported from EasyWorship',
        });
        seen.add(key);
        result.imported++;
      } catch (err) {
        result.errors.push(`${title}: ${err.message}`);
      }

      if (i % 25 === 0) onProgress?.({ stage: 'import', done: i, total: rows.length });
    }

    return { ok: true, ...result };
  }

  /**
   * Remove every song this importer brought in.
   *
   * Imported songs carry a note identifying their origin, so a bad import can
   * be undone in one step rather than deleted song by song. Songs written or
   * imported by other means are untouched.
   */
  async removeImported(marker = 'Imported from EasyWorship') {
    const all = await this.songs.all();
    const doomed = all.filter((s) => (s.notes ?? '').includes(marker));
    if (!doomed.length) return { ok: true, removed: 0, remaining: all.length, ids: [] };

    const keep = all.filter((s) => !(s.notes ?? '').includes(marker));
    await this.songs.save(keep);
    // The ids go back so the caller can clear them out of any collection the
    // user filed them into after importing.
    return { ok: true, removed: doomed.length, remaining: keep.length, ids: doomed.map((s) => s.id) };
  }

  /** Count what a removal would take, so the UI can confirm before acting. */
  async countImported(marker = 'Imported from EasyWorship') {
    const all = await this.songs.all();
    return { ok: true, count: all.filter((s) => (s.notes ?? '').includes(marker)).length, total: all.length };
  }

  /**
   * Copy an EasyWorship profile's media into the library.
   *
   * Images and video sit as ordinary files under Resources, so they are copied
   * rather than extracted — far more reliable than pulling blobs out of the
   * Paradox tables, and it preserves the originals untouched.
   */
  async importProfileMedia(dir, onProgress = null) {
    const roots = ['Resources/Images', 'Resources/Videos', 'Resources/SharedMedia', 'Resources']
      .map((r) => path.join(dir, r));

    const MEDIA = /\.(jpe?g|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv|wmv|avi)$/i;
    const VIDEO = /\.(mp4|mov|m4v|webm|mkv|wmv|avi)$/i;

    // Collect first so progress can be reported against a real total.
    const found = new Map();
    for (const root of roots) {
      let entries;
      try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile() || !MEDIA.test(entry.name)) continue;
        const full = path.join(root, entry.name);
        // The same file can appear under more than one root; keep one copy.
        if (!found.has(entry.name.toLowerCase())) found.set(entry.name.toLowerCase(), full);
      }
    }

    const files = [...found.values()];
    if (!files.length) return { ok: true, imported: 0, skipped: 0, bytes: 0, errors: [] };

    await fsp.mkdir(this.media.mediaDir, { recursive: true });
    const items = await this.media.all();
    const known = new Set(items.map((m) => m.name.toLowerCase()));

    const result = { total: files.length, imported: 0, skipped: 0, bytes: 0, errors: [] };

    for (const [i, source] of files.entries()) {
      const ext = path.extname(source).toLowerCase();
      const name = path.basename(source, ext);

      if (known.has(name.toLowerCase())) { result.skipped++; continue; }

      try {
        const stat = await fsp.stat(source);
        const id = `m_${crypto.randomBytes(6).toString('hex')}`;
        const dest = path.join(this.media.mediaDir, `${id}${ext}`);
        // copyFile streams internally, so a large video never lands in memory.
        await fsp.copyFile(source, dest);

        const isVideo = VIDEO.test(ext);
        items.push({
          id,
          kind: isVideo ? 'video' : 'image',
          name,
          file: dest,
          ext,
          bytes: stat.size,
          addedAt: new Date().toISOString(),
          loop: isVideo,
          muted: true,
          role: 'background',
          tags: ['easyworship'],
        });
        known.add(name.toLowerCase());
        result.imported++;
        result.bytes += stat.size;
      } catch (err) {
        result.errors.push(`${path.basename(source)}: ${err.message}`);
      }

      if (i % 10 === 0) onProgress?.({ stage: 'media', done: i, total: files.length });
    }

    await this.media.store.write('media', { format: 'bibleportal.media/1', items });
    return { ok: true, ...result };
  }

  /**
   * Import every schedule in a folder — the usual shape of a migration, since
   * an EasyWorship profile keeps its schedules together.
   */
  async importFolder(dir, what = {}, onProgress = null) {
    const entries = await fsp.readdir(dir).catch(() => []);
    const files = entries.filter((f) => /\.ewsx$/i.test(f)).map((f) => path.join(dir, f));

    const total = { files: files.length, songs: 0, media: 0, skipped: 0, errors: [], bytes: 0 };
    for (const [i, file] of files.entries()) {
      try {
        onProgress?.({ stage: 'file', name: path.basename(file), done: i, total: files.length });
        total.bytes += (await fsp.stat(file).catch(() => ({ size: 0 }))).size;
        const res = await this.importSchedule(file, { ...what, plan: false }, onProgress);
        total.songs += res.songs;
        total.media += res.media;
        total.skipped += res.skipped;
        total.errors.push(...res.errors);
      } catch (err) {
        total.errors.push(`${path.basename(file)}: ${err.message}`);
      }
    }
    return { ok: true, ...total };
  }
}

module.exports = { EasyWorshipImportService };
