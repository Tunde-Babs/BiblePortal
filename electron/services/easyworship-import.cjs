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
