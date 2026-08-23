'use strict';
/**
 * Durable JSON document store for user data (songs, service plans, settings,
 * themes). Writes are atomic — temp file + rename — so a crash or power loss
 * mid-save can never leave a half-written library on disk.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class Store {
  /**
   * @param {string} dir  directory that holds the documents
   */
  constructor(dir) {
    this.dir = dir;
    /** @type {Map<string, any>} in-memory cache; the disk copy is the source of truth */
    this.cache = new Map();
    /** @type {Map<string, Promise<void>>} serialises writes per document */
    this.queue = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) { return path.join(this.dir, `${name}.json`); }

  /**
   * Read a document, falling back to `fallback` when absent or corrupt.
   *
   * The fallback is cloned before it is cached or returned. Callers routinely
   * pass a module-level constant like `{ songs: [] }` and then push into the
   * result — without the clone that mutates the constant, and every later
   * reader in the process inherits the leftovers.
   */
  async read(name, fallback = null) {
    if (this.cache.has(name)) return this.cache.get(name);
    try {
      const raw = await fsp.readFile(this.file(name), 'utf8');
      const value = JSON.parse(raw);
      this.cache.set(name, value);
      return value;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Corrupt file: keep a copy so nothing is silently destroyed.
        try { await fsp.rename(this.file(name), `${this.file(name)}.corrupt-${Date.now()}`); } catch { /* best effort */ }
        console.warn(`[store] ${name} unreadable (${err.message}); starting fresh, old file kept`);
      }
      const fresh = fallback == null ? fallback : structuredClone(fallback);
      this.cache.set(name, fresh);
      return fresh;
    }
  }

  /** Write a document atomically. Concurrent writes to one name are serialised. */
  async write(name, value) {
    this.cache.set(name, value);
    const prior = this.queue.get(name) ?? Promise.resolve();
    const next = prior.then(() => this._commit(name, value)).catch((err) => {
      console.error(`[store] write ${name} failed:`, err.message);
      throw err;
    });
    this.queue.set(name, next.catch(() => {}));
    return next;
  }

  async _commit(name, value) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.tmp`;
    const data = JSON.stringify(value, null, 2);
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();          // durable before the rename
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, target);  // atomic on POSIX and NTFS
  }

  /** Read-modify-write in one serialised step. */
  async update(name, fallback, mutate) {
    const current = await this.read(name, fallback);
    const next = await mutate(current);
    await this.write(name, next);
    return next;
  }

  async list() {
    const files = await fsp.readdir(this.dir).catch(() => []);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  }

  /** Flush every pending write — call before quit. */
  async flush() { await Promise.allSettled([...this.queue.values()]); }
}

module.exports = { Store };
