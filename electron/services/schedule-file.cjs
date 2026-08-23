'use strict';
/**
 * Service plans as portable files, in the style operators already know from
 * EasyWorship: New / Open / Save, a recent-files list, and reusable templates.
 *
 * A plan living in the app database is convenient but invisible — you cannot
 * hand it to next week's operator, drop it in a shared folder, or keep a
 * "Regular Service" skeleton to start every Sunday from. A file can do all of
 * those, so plans are files first and library rows second.
 *
 * Format is `.bpsx` — plain JSON, deliberately readable and diffable.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const FORMAT = 'bibleportal.schedule/1';
const EXT = '.bpsx';
const MAX_RECENT = 12;

/** Where schedules and templates live by default. */
function defaultRoots(documentsDir) {
  return {
    schedules: path.join(documentsDir, 'BiblePortal', 'Schedules'),
    templates: path.join(documentsDir, 'BiblePortal', 'Templates'),
  };
}

class ScheduleFileService {
  /**
   * @param {{ store:import('./store.cjs').Store, documentsDir:string }} deps
   */
  constructor({ store, documentsDir }) {
    this.store = store;
    this.roots = defaultRoots(documentsDir ?? os.homedir());
  }

  async ensureDirs() {
    await fsp.mkdir(this.roots.schedules, { recursive: true });
    await fsp.mkdir(this.roots.templates, { recursive: true });
    return this.roots;
  }

  /** The recent-files list shown under Open. Missing files are pruned. */
  async recent() {
    const doc = await this.store.read('recent-schedules', { files: [] });
    const alive = [];
    for (const entry of doc.files ?? []) {
      try {
        const stat = await fsp.stat(entry.path);
        alive.push({ ...entry, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      } catch {
        // The file was moved or deleted; drop it rather than show a dead row.
      }
    }
    if (alive.length !== (doc.files ?? []).length) {
      await this.store.write('recent-schedules', { files: alive });
    }
    return alive;
  }

  async remember(filePath, name) {
    const doc = await this.store.read('recent-schedules', { files: [] });
    const files = [
      { path: filePath, name, openedAt: new Date().toISOString() },
      ...(doc.files ?? []).filter((f) => f.path !== filePath),
    ].slice(0, MAX_RECENT);
    await this.store.write('recent-schedules', { files });
    return files;
  }

  async clearRecent() {
    await this.store.write('recent-schedules', { files: [] });
    return [];
  }

  /**
   * Write a plan to disk.
   *
   * Songs referenced by the plan are embedded, so a schedule opened on another
   * machine still shows its set even if that machine's library differs. The
   * library remains the source of truth when the ids do resolve.
   */
  async save(filePath, plan, { songs = [], asTemplate = false } = {}) {
    const target = filePath.endsWith(EXT) ? filePath : `${filePath}${EXT}`;
    await fsp.mkdir(path.dirname(target), { recursive: true });

    const usedIds = new Set(plan.items.filter((i) => i.songId).map((i) => i.songId));
    const embedded = songs.filter((s) => usedIds.has(s.id));

    const doc = {
      format: FORMAT,
      kind: asTemplate ? 'template' : 'schedule',
      name: plan.name,
      date: plan.date ?? null,
      notes: plan.notes ?? '',
      savedAt: new Date().toISOString(),
      // A template keeps the running order but drops the specific date.
      items: asTemplate
        ? plan.items.map((i) => ({ ...i, id: undefined }))
        : plan.items,
      embeddedSongs: embedded,
    };

    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
    await fsp.rename(tmp, target);

    if (!asTemplate) await this.remember(target, plan.name);
    return { ok: true, path: target, items: plan.items.length, embeddedSongs: embedded.length };
  }

  /** Read a plan file, returning the plan plus any songs it carried. */
  async open(filePath) {
    const raw = await fsp.readFile(filePath, 'utf8');
    let doc;
    try { doc = JSON.parse(raw); }
    catch { throw new Error('That file is not a readable BiblePortal schedule.'); }
    if (doc.format !== FORMAT) throw new Error('That file is not a BiblePortal schedule.');

    await this.remember(filePath, doc.name ?? path.basename(filePath, EXT));

    return {
      ok: true,
      kind: doc.kind ?? 'schedule',
      name: doc.name ?? path.basename(filePath, EXT),
      date: doc.date ?? new Date().toISOString().slice(0, 10),
      notes: doc.notes ?? '',
      items: doc.items ?? [],
      embeddedSongs: doc.embeddedSongs ?? [],
      path: filePath,
    };
  }

  /** Every template on disk, for the "New from template" picker. */
  async templates() {
    await this.ensureDirs();
    const files = await fsp.readdir(this.roots.templates).catch(() => []);
    const out = [];
    for (const file of files.filter((f) => f.endsWith(EXT))) {
      const full = path.join(this.roots.templates, file);
      try {
        const doc = JSON.parse(await fsp.readFile(full, 'utf8'));
        if (doc.format !== FORMAT) continue;
        out.push({
          path: full,
          name: doc.name ?? path.basename(file, EXT),
          items: (doc.items ?? []).length,
          savedAt: doc.savedAt ?? null,
        });
      } catch { /* skip an unreadable template rather than fail the list */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Suggested filename for a new schedule: "sunday service 24.08.2026.bpsx". */
  suggestName(plan) {
    const date = plan?.date ? new Date(plan.date) : new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const safe = (plan?.name ?? 'service').replace(/[^\w\s-]/g, '').trim() || 'service';
    return `${safe} ${dd}.${mm}.${date.getFullYear()}${EXT}`;
  }
}

module.exports = { ScheduleFileService, SCHEDULE_EXT: EXT, SCHEDULE_FORMAT: FORMAT };
