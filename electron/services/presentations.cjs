'use strict';
/**
 * Imported presentation decks.
 *
 * A .pptx is converted once at import: its text and images are stored in the
 * library so a service never depends on the original file still existing, and
 * so slides render through BiblePortal's own theme rather than PowerPoint's.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const pptx = require('../lib/pptx.cjs');

const DOC = 'presentations';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.presentations/1', decks: [] });

class PresentationService {
  /** @param {{ store:import('./store.cjs').Store, mediaDir:string }} deps */
  constructor({ store, mediaDir }) {
    this.store = store;
    this.mediaDir = mediaDir;
  }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.decks ?? [];
  }

  async get(id) { return (await this.all()).find((d) => d.id === id) ?? null; }

  async saveAll(decks) {
    await this.store.write(DOC, { ...empty(), decks, updatedAt: new Date().toISOString() });
    return decks;
  }

  /** Read a deck without importing, so the UI can show what it found first. */
  async inspect(filePath) {
    const buffer = await fsp.readFile(filePath);
    const parsed = await pptx.readPptx(buffer);
    return {
      ok: true,
      file: path.basename(filePath),
      slideCount: parsed.slideCount,
      imageCount: parsed.images.length,
      withNotes: parsed.slides.filter((s) => s.notes).length,
      sample: parsed.slides.slice(0, 6).map((s) => ({ index: s.index, title: s.title, lines: s.lines.length })),
    };
  }

  /**
   * Import a .pptx. Slide images are copied into the media folder so the deck
   * is self-contained.
   */
  async importFile(filePath) {
    const buffer = await fsp.readFile(filePath);
    const parsed = await pptx.readPptx(buffer);
    await fsp.mkdir(this.mediaDir, { recursive: true });

    const deckId = `deck_${crypto.randomBytes(5).toString('hex')}`;
    /** Zip entry -> written file, so a picture used twice is stored once. */
    const written = new Map();

    for (const image of parsed.images) {
      try {
        const data = await pptx.extractImage(buffer, image.entry);
        const ext = path.extname(image.name).toLowerCase() || '.png';
        const dest = path.join(this.mediaDir, `${deckId}_${crypto.randomBytes(3).toString('hex')}${ext}`);
        await fsp.writeFile(dest, data);
        written.set(image.entry, dest);
      } catch { /* a missing picture must not fail the whole deck */ }
    }

    const deck = {
      id: deckId,
      name: path.basename(filePath).replace(/\.pptx$/i, ''),
      source: path.basename(filePath),
      importedAt: new Date().toISOString(),
      slideCount: parsed.slideCount,
      slides: parsed.slides.map((s) => ({
        index: s.index,
        title: s.title,
        lines: s.lines,
        notes: s.notes,
        image: s.images.map((e) => written.get(e)).find(Boolean) ?? null,
      })),
    };

    const decks = await this.all();
    decks.push(deck);
    await this.saveAll(decks);

    return {
      ok: true,
      deck,
      slides: deck.slideCount,
      images: written.size,
    };
  }

  async importFiles(paths) {
    const results = [];
    for (const file of paths) {
      try { results.push(await this.importFile(file)); }
      catch (err) { results.push({ ok: false, file: path.basename(file), error: err.message }); }
    }
    return {
      imported: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  async remove(id) {
    const decks = await this.all();
    const deck = decks.find((d) => d.id === id);
    // Remove the images this deck brought with it, but nothing else.
    for (const slide of deck?.slides ?? []) {
      if (slide.image) await fsp.unlink(slide.image).catch(() => {});
    }
    await this.saveAll(decks.filter((d) => d.id !== id));
    return { ok: true, id };
  }

  async rename(id, name) {
    const decks = await this.all();
    const deck = decks.find((d) => d.id === id);
    if (!deck) throw new Error('Presentation not found');
    deck.name = String(name ?? '').trim() || deck.name;
    await this.saveAll(decks);
    return deck;
  }
}

module.exports = { PresentationService };
