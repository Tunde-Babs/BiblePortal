'use strict';
/**
 * Media library: background stills and motion loops.
 *
 * Files are copied into the app's own media folder on import so a service never
 * breaks because someone moved or renamed the original on their desktop.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DOC = 'media';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.media/1', items: [] });

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);

class MediaService {
  /** @param {{store:import('./store.cjs').Store, mediaDir:string}} deps */
  constructor({ store, mediaDir }) {
    this.store = store;
    this.mediaDir = mediaDir;
  }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.items ?? [];
  }

  async importFiles(paths) {
    await fsp.mkdir(this.mediaDir, { recursive: true });
    const items = await this.all();
    const added = [];
    const failed = [];

    for (const src of paths) {
      try {
        const ext = path.extname(src).toLowerCase();
        const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
        if (!kind) { failed.push({ file: path.basename(src), error: `Unsupported file type (${ext})` }); continue; }

        const stat = await fsp.stat(src);
        const id = `m_${crypto.randomBytes(6).toString('hex')}`;
        const dest = path.join(this.mediaDir, `${id}${ext}`);
        await fsp.copyFile(src, dest);

        const item = {
          id,
          kind,
          name: path.basename(src, ext),
          file: dest,
          ext,
          bytes: stat.size,
          addedAt: new Date().toISOString(),
          loop: kind === 'video',
          muted: true,
          /**
           * 'background' items are offered for scripture/song backdrops;
           * 'clip' items are played as their own item in a service.
           * Video defaults to a motion background, which is the common case.
           */
          role: kind === 'video' ? 'background' : 'background',
          tags: [],
        };
        items.push(item);
        added.push(item);
      } catch (err) {
        failed.push({ file: path.basename(src), error: err.message });
      }
    }

    await this.store.write(DOC, { ...empty(), items });
    return { imported: added.length, failed: failed.length, added, errors: failed };
  }

  async remove(id) {
    const items = await this.all();
    const item = items.find((m) => m.id === id);
    if (item) await fsp.unlink(item.file).catch(() => {});
    await this.store.write(DOC, { ...empty(), items: items.filter((m) => m.id !== id) });
    return { ok: true, id };
  }

  async update(id, patch) {
    const items = await this.all();
    const i = items.findIndex((m) => m.id === id);
    if (i < 0) throw new Error('Media not found');
    items[i] = { ...items[i], ...patch, id };
    await this.store.write(DOC, { ...empty(), items });
    return items[i];
  }
}

module.exports = { MediaService };
