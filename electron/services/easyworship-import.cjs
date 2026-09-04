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

/**
 * Folders holding a discarded copy of a library rather than a usable one.
 *
 * Only the timestamped Paradox rebuild archives qualify. Notably `v6.1` and
 * `v6.11` do *not*: those look like version archives but are where EasyWorship
 * 7 keeps its live SQLite library, so skipping them hides the very thing a
 * migrating church is trying to import.
 */
const ARCHIVE_DIR = /^(oldData|Rebuild Backup|Backup\b)/i;

/**
 * Identity of a song for import purposes: its title *and* its words.
 *
 * Title alone is too coarse for a real church library. Several distinct songs
 * are called "Hallelujah", a chorus often gets filed under the line it opens
 * with, and one title can cover both an English and a Yoruba setting. Keying on
 * the title alone silently dropped 310 of one profile's 3,000 songs as
 * duplicates when they were different songs entirely.
 *
 * The hash is taken over the parsed sections rather than the raw RTF, so the
 * same song read twice yields the same key regardless of how it was formatted.
 * That is what keeps a repeated import from duplicating a library.
 */
function songIdentity(title, sections) {
  const lyrics = (sections ?? [])
    .map((section) => String(section.body ?? ''))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const digest = crypto.createHash('sha1').update(lyrics).digest('hex');
  return `${String(title ?? '').trim().toLowerCase()} ${digest}`;
}

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
      const seen = new Set(existing.map((s) => songIdentity(s.title, s.sections)));
      // Plan items are matched back to songs by title, so a song already in the
      // library has to stay findable. Without this, re-importing a schedule put
      // its songs in the running order pointing at nothing.
      const knownIdByTitle = new Map(existing.map((s) => [s.title.trim().toLowerCase(), s.id]));

      for (const song of result.songs) {
        const title = song.title.trim().toLowerCase();
        // Same rule as a profile import: identical title *and* words is a
        // duplicate; a shared title alone is not.
        const key = songIdentity(song.title, song.sections);
        if (seen.has(key)) {
          imported.skipped++;
          const known = knownIdByTitle.get(title);
          if (known) songIdByTitle.set(title, known);
          continue;
        }
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
          songIdByTitle.set(title, saved.id);
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
   * Find every song library inside a profile folder, and rank them.
   *
   * A profile is not one library. EasyWorship keeps the Paradox tables it grew
   * up on beside the SQLite ones it migrated to, and adds a `v6.x` snapshot for
   * each version it has passed through — so a single export routinely holds
   * three, of two different formats, only one of which is current.
   *
   * Matching on the filename `Songs.db` alone therefore picks a superseded
   * library as readily as the live one, and picks it from the wrong format
   * about as often. Every candidate is opened and identified here instead, and
   * the one holding the most songs wins: a church migrating wants its whole
   * library, and the archives are by definition subsets of it.
   *
   * @returns {Promise<{found:object[], rejected:{dir:string,reason:string}[]}>}
   */
  async _scanSongLibraries(dir) {
    const found = [];
    const rejected = [];
    const seen = new Set();

    /** Identify one folder holding a `Songs.db`/`Songs.DB`, whatever its generation. */
    const classify = async (dataDir, file) => {
      if (seen.has(dataDir)) return;
      seen.add(dataDir);

      // EW7: metadata and lyrics in sibling SQLite files.
      const words = path.join(dataDir, 'SongWords.db');
      if (await fsp.access(words).then(() => true, () => false)) {
        try {
          const songs = await ew.countProfileSqlite(dataDir);
          const lyrics = await fsp.stat(words).then((st) => st.size, () => 0);
          found.push({ kind: 'ew7', dir: dataDir, file, songs, version: await ew.readVersion(dataDir), memoBytes: lyrics });
          return;
        } catch (err) { rejected.push({ dir: dataDir, reason: err.message }); return; }
      }

      // EW2009 and earlier: a Paradox table with lyrics in a sibling .MB file.
      try {
        const info = await paradox.inspect(file);
        found.push({ kind: 'paradox', dir: dataDir, file, songs: info.records, version: await ew.readVersion(dataDir), memoBytes: info.memoBytes });
      } catch (err) { rejected.push({ dir: dataDir, reason: err.message }); }
    };

    // Breadth-first, so a shallow library is seen before a nested archive even
    // when both are readable and the tie has to be broken on song count.
    let frontier = [dir];
    let visited = 0;
    let depth = 0;
    while (frontier.length && visited < 2000 && depth < 8) {
      const next = [];
      for (const current of frontier) {
        if (visited++ >= 2000) break;
        let entries;
        try { entries = await fsp.readdir(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isFile() && /^songs\.db$/i.test(entry.name)) await classify(current, full);
          else if (entry.isDirectory() && !ARCHIVE_DIR.test(entry.name)) next.push(full);
        }
      }
      frontier = next;
      depth++;
    }

    // Most songs first. A version snapshot never holds more than the library it
    // was taken from, so this picks the live one without trusting folder names.
    found.sort((a, b) => b.songs - a.songs);
    return { found, rejected };
  }

  /**
   * The song library to import from, or an error explaining what was found.
   *
   * Both callers need the same answer and the same failure message, so the
   * choice is made once here rather than duplicated.
   */
  async resolveSongLibrary(dir) {
    const { found, rejected } = await this._scanSongLibraries(dir);
    const best = found.find((c) => c.songs > 0) ?? found[0];
    if (best) return { ...best, alternatives: found.filter((c) => c !== best) };

    if (rejected.length) {
      throw new Error(
        `Found ${rejected.length} song database(s) here, but none could be read: `
        + `${rejected[0].reason} Choose the EasyWorship profile folder — the one containing "Databases".`,
      );
    }
    throw new Error('No song library found. Choose the EasyWorship profile folder — the one containing "Databases".');
  }

  /**
   * Path of the song table to import from.
   * @deprecated superseded by resolveSongLibrary; kept for callers wanting a path.
   */
  async findSongTable(dir) {
    const { found } = await this._scanSongLibraries(dir);
    return found.find((c) => c.songs > 0)?.file ?? found[0]?.file ?? null;
  }

  /** Read a profile's song library without importing, so the UI can confirm. */
  async inspectProfile(dir) {
    const lib = await this.resolveSongLibrary(dir);

    const fields = lib.kind === 'ew7'
      ? ['title', 'author', 'copyright', 'reference_number', 'words']
      : (await paradox.inspect(lib.file)).fields
        .filter((f) => /title|author|copyright|words|number/i.test(f.name))
        .map((f) => f.name);

    return {
      ok: true,
      table: lib.file,
      folder: path.basename(dir),
      songs: lib.songs,
      memoMB: Math.round(lib.memoBytes / 1048576),
      fields,
      // Which of the profile's libraries this is, so the operator can tell an
      // 1,800-song archive from the 3,000-song library they actually use.
      format: lib.kind === 'ew7' ? 'EasyWorship 7 (SQLite)' : 'EasyWorship 2009 (Paradox)',
      version: lib.version,
      // The ones passed over, named so a wrong pick is visible before importing.
      // Capped: a long-lived profile accumulates a snapshot per upgrade, and a
      // confirm step listing a dozen of them stops being readable.
      alternatives: lib.alternatives.slice(0, 4).map((c) => ({
        songs: c.songs,
        format: c.kind === 'ew7' ? 'EasyWorship 7 (SQLite)' : 'EasyWorship 2009 (Paradox)',
        folder: path.relative(dir, c.dir) || '.',
      })),
    };
  }

  /**
   * Import a whole EasyWorship song library.
   *
   * Both generations of profile are read into the same row shape — Paradox
   * tables for EasyWorship 2009, paired SQLite files for 7 — so only the read
   * differs and everything after it is shared.
   *
   * Lyrics are stored as RTF, so each is decoded and then split into stanzas on
   * blank lines — the same rule the editor uses, so an imported song is
   * indistinguishable from one written here.
   */
  async importProfile(dir, opts = {}, onProgress = null) {
    const lib = await this.resolveSongLibrary(dir);
    const limit = opts.limit ?? Infinity;

    let rows;
    if (lib.kind === 'ew7') {
      onProgress?.({ stage: 'read', done: 0, total: lib.songs });
      ({ rows } = await ew.readProfileSqlite(lib.dir));
      if (rows.length > limit) rows = rows.slice(0, limit);
      onProgress?.({ stage: 'read', done: rows.length, total: rows.length });
    } else {
      ({ rows } = await paradox.readTable(lib.file, {
        limit,
        onProgress: (done, total) => onProgress?.({ stage: 'read', done, total }),
      }));
    }

    const existing = await this.songs.all();
    const seen = new Set(existing.map((s) => songIdentity(s.title, s.sections)));
    const result = { total: rows.length, imported: 0, skipped: 0, empty: 0, errors: [] };

    /**
     * Built up in memory and saved once at the end.
     *
     * Calling upsert() per song rewrites and fsyncs the entire library each
     * time, so a 3,000-song profile costs three thousand full saves of a
     * document that is growing as it goes — quadratic, and minutes of it.
     */
    const additions = [];

    for (const [i, row] of rows.entries()) {
      const title = String(row.Title ?? '').trim();
      if (!title) { result.empty++; continue; }

      const words = rtfToText(String(row.Words ?? ''));
      if (!words.trim()) { result.empty++; continue; }

      try {
        const sections = songFormat.splitStanzas(words);
        if (!sections.length) { result.empty++; continue; }

        // Re-running an import must not duplicate a library, but two different
        // songs sharing a title must both survive — so identity is title+words.
        const key = songIdentity(title, sections);
        if (seen.has(key)) { result.skipped++; continue; }

        additions.push({
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

    if (additions.length) await this.songs.addMany(additions);
    return { ok: true, ...result, format: lib.kind, songsRead: rows.length };
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
