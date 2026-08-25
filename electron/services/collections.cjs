'use strict';
/**
 * Song collections — the folders operators actually organise a library by:
 * "Christmas", "Communion", "Fast Songs", "Youth Service".
 *
 * A song can sit in several collections at once, so membership is stored on the
 * collection rather than the song. Deleting a collection never deletes songs.
 */

const DOC = 'collections';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.collections/1', collections: [] });

const newId = () => `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

class CollectionService {
  /** @param {import('./store.cjs').Store} store */
  constructor(store) { this.store = store; }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.collections ?? [];
  }

  async saveAll(collections) {
    await this.store.write(DOC, { ...empty(), collections, updatedAt: new Date().toISOString() });
    return collections;
  }

  async create(name) {
    const collections = await this.all();
    const clean = String(name ?? '').trim() || 'New Collection';
    if (collections.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`A collection called "${clean}" already exists.`);
    }
    const record = { id: newId(), name: clean, songIds: [], createdAt: new Date().toISOString() };
    collections.push(record);
    await this.saveAll(collections);
    return record;
  }

  async rename(id, name) {
    const collections = await this.all();
    const target = collections.find((c) => c.id === id);
    if (!target) throw new Error('Collection not found');
    target.name = String(name ?? '').trim() || target.name;
    await this.saveAll(collections);
    return target;
  }

  async remove(id) {
    const collections = await this.all();
    await this.saveAll(collections.filter((c) => c.id !== id));
    return { ok: true };
  }

  /** Add songs, ignoring any already present. */
  async addSongs(id, songIds) {
    const collections = await this.all();
    const target = collections.find((c) => c.id === id);
    if (!target) throw new Error('Collection not found');
    const existing = new Set(target.songIds);
    for (const songId of songIds) existing.add(songId);
    target.songIds = [...existing];
    await this.saveAll(collections);
    return target;
  }

  async removeSong(id, songId) {
    const collections = await this.all();
    const target = collections.find((c) => c.id === id);
    if (!target) throw new Error('Collection not found');
    target.songIds = target.songIds.filter((s) => s !== songId);
    await this.saveAll(collections);
    return target;
  }

  /** Drop a deleted song from every collection that referenced it. */
  /**
   * Drop many songs from every collection in one save.
   *
   * The single-song purge rewrites the whole collections file each call, so a
   * bulk delete would rewrite it once per song. This does it once.
   */
  async purgeSongs(songIds) {
    const doomed = new Set(songIds ?? []);
    if (!doomed.size) return { ok: true, changed: false };
    const collections = await this.all();
    let changed = false;
    for (const c of collections) {
      const next = c.songIds.filter((s) => !doomed.has(s));
      if (next.length !== c.songIds.length) { c.songIds = next; changed = true; }
    }
    if (changed) await this.saveAll(collections);
    return { ok: true, changed };
  }

  async purgeSong(songId) {
    const collections = await this.all();
    let changed = false;
    for (const c of collections) {
      const next = c.songIds.filter((s) => s !== songId);
      if (next.length !== c.songIds.length) { c.songIds = next; changed = true; }
    }
    if (changed) await this.saveAll(collections);
    return { ok: true, changed };
  }
}

module.exports = { CollectionService };
