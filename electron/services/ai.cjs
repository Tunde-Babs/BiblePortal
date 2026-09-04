'use strict';
/**
 * On-device intelligence.
 *
 * Everything in this file runs locally with no model download and no network:
 * it is built on the same inverted index that powers search. That is a
 * deliberate trade — a small, predictable engine that always works in a
 * building with no wi-fi beats a large one that fails on Sunday morning.
 *
 *   • detect()      live scripture detection from a speech transcript
 *   • topical()     verses for a theme ("forgiveness", "anxiety")
 *   • outline()     a service/sermon scaffold for a passage
 *   • forSong()     scripture that matches a song's language
 */

const spoken = require('../lib/spoken.cjs');
const reference = require('../lib/reference.cjs');
const { tokenize, phraseScore } = require('../lib/search.cjs');

/**
 * Seed vocabulary for topical lookup. These widen a one-word theme into the
 * language scripture actually uses, which is what makes offline topical search
 * feel intelligent rather than literal.
 */
const TOPICS = {
  love: ['love', 'beloved', 'charity', 'compassion', 'kindness'],
  faith: ['faith', 'believe', 'trust', 'faithful', 'confidence'],
  hope: ['hope', 'expectation', 'await', 'patience'],
  fear: ['fear', 'afraid', 'dread', 'terror', 'courage', 'strong'],
  anxiety: ['anxious', 'careful', 'worry', 'troubled', 'peace', 'rest'],
  peace: ['peace', 'rest', 'quiet', 'still', 'calm'],
  forgiveness: ['forgive', 'pardon', 'mercy', 'blot', 'transgression'],
  grace: ['grace', 'favour', 'gift', 'unmerited'],
  salvation: ['salvation', 'saved', 'redeem', 'deliver', 'ransom'],
  healing: ['heal', 'health', 'whole', 'restore', 'cure'],
  provision: ['provide', 'supply', 'bread', 'shepherd', 'need'],
  strength: ['strength', 'strong', 'power', 'might', 'renew'],
  guidance: ['guide', 'lead', 'path', 'direct', 'way', 'counsel'],
  joy: ['joy', 'rejoice', 'glad', 'delight', 'blessed'],
  grief: ['mourn', 'weep', 'sorrow', 'comfort', 'tears'],
  patience: ['patience', 'longsuffering', 'endure', 'wait'],
  humility: ['humble', 'meek', 'lowly', 'pride'],
  worship: ['worship', 'praise', 'glory', 'exalt', 'sing'],
  prayer: ['pray', 'supplication', 'petition', 'intercession', 'ask'],
  wisdom: ['wisdom', 'understanding', 'knowledge', 'prudent', 'instruction'],
  generosity: ['give', 'cheerful', 'bountiful', 'alms', 'offering'],
  marriage: ['husband', 'wife', 'marriage', 'wedded', 'cleave'],
  family: ['children', 'father', 'mother', 'household', 'honour'],
  work: ['labour', 'work', 'diligent', 'hand', 'slothful'],
  money: ['riches', 'wealth', 'money', 'treasure', 'mammon'],
  temptation: ['tempt', 'sin', 'flee', 'lust', 'escape'],
  repentance: ['repent', 'turn', 'confess', 'contrite', 'broken'],
  church: ['church', 'body', 'assembly', 'fellowship', 'gather'],
  mission: ['nations', 'preach', 'gospel', 'witness', 'send'],
  suffering: ['affliction', 'tribulation', 'suffer', 'persecute', 'trial'],
  eternity: ['eternal', 'everlasting', 'heaven', 'life', 'forever'],
  identity: ['son', 'child', 'chosen', 'called', 'new creature'],
  thanksgiving: ['thanks', 'thanksgiving', 'grateful', 'bless'],
};

class AIService {
  /**
   * @param {{ bible:import('./bible.cjs').BibleService, settings:import('./settings.cjs').SettingsService }} deps
   */
  constructor({ bible, settings }) {
    this.bible = bible;
    this.settings = settings;
    /** Rolling transcript window used by live detection. */
    this.window = '';
    /** Labels already cued, so the same verse isn't fired twice in a row. */
    this.recent = [];
  }

  // ------------------------------------------------------------- live detect

  /** Reset detection state — call when transcription starts or stops. */
  resetDetection() { this.window = ''; this.recent = []; }

  /**
   * Feed a transcript chunk and get anything worth cueing.
   *
   * Two independent signals:
   *   1. a spoken reference   ("turn to john chapter three verse sixteen")
   *   2. quoted scripture     (the preacher reading the verse aloud)
   *
   * @param {string} chunk newly transcribed text
   * @param {{translation?:string, sensitivity?:number}} opts
   */
  async detect(chunk, opts = {}) {
    const sensitivity = opts.sensitivity ?? 0.62;
    // Keep a bounded window so a reference spanning two chunks still resolves.
    this.window = `${this.window} ${chunk}`.trim().split(/\s+/).slice(-60).join(' ');

    const candidates = [];

    // 1. Spoken references.
    const spokenHits = spoken.detectReferences(this.window);
    for (const hit of spokenHits) {
      candidates.push({ ...hit, via: 'reference' });
    }

    // 2. Quoted scripture — match the tail of the window against the index.
    //
    // What the speaker has already been understood to *cite* must not also be
    // scored as something they *quoted*. "First Peter two one" reduces to the
    // words "first" and "peter", which are a perfect phrase match for
    // John 20:4 — "the other disciple did outrun Peter, and came first to the
    // sepulchre" — and at 0.97 that beat the 1 Peter 2:1 the speaker actually
    // asked for. So the recognised reference is removed before quotation
    // matching, and what remains has to stand on its own as a quotation.
    let residue = spoken.normalise(this.window);
    for (const hit of spokenHits) residue = residue.split(hit.matched).join(' ');

    // Distinct tokens, not total: repeating a short phrase used to clear a
    // count-based guard, which is exactly what happens when the same reference
    // is spoken twice into one window.
    const tail = this.window.split(/\s+/).slice(-18).join(' ');
    const quotable = new Set(tokenize(residue)).size >= 4 && new Set(tokenize(tail)).size >= 4;
    if (quotable) {
      const res = await this.bible.search(tail, { translation: opts.translation, limit: 5 });
      for (const r of res.results ?? []) {
        const phrase = phraseScore(tail, r.text);
        // Only a genuinely close quotation should fire; loose word overlap won't.
        if (phrase < 0.55) continue;
        candidates.push({
          reference: { bookId: r.bookId, book: r.book, chapter: r.chapter, verse: r.verse, endChapter: r.chapter, endVerse: r.verse },
          label: r.label,
          confidence: Math.min(0.5 + phrase * 0.48, 0.97),
          matched: tail,
          via: 'quotation',
        });
      }
    }

    // Best candidate per label, strongest first.
    const best = new Map();
    for (const c of candidates) {
      const prior = best.get(c.label);
      if (!prior || c.confidence > prior.confidence) best.set(c.label, c);
    }

    const fresh = [...best.values()]
      .filter((c) => c.confidence >= sensitivity)
      .filter((c) => !this.recent.includes(c.label))
      .sort((a, b) => b.confidence - a.confidence);

    if (fresh.length) {
      this.recent = [...fresh.map((c) => c.label), ...this.recent].slice(0, 6);
    }

    // Attach the verse text so the operator can cue without a second round trip.
    const out = [];
    for (const c of fresh.slice(0, 3)) {
      const passage = await this.bible.lookup(c.label, opts.translation);
      if (passage.ok) out.push({ ...c, verses: passage.verses, translationAbbr: passage.translationAbbr });
    }
    return { window: this.window, detections: out };
  }

  // ---------------------------------------------------------------- topical

  /**
   * Verses for a theme. Expands the theme with related vocabulary, then ranks
   * by how many of those words a verse carries.
   */
  async topical(theme, opts = {}) {
    const key = String(theme || '').toLowerCase().trim();
    if (!key) return { theme: key, verses: [] };

    // Match a known topic, or any topic whose seed list contains the word.
    let seeds = TOPICS[key];
    if (!seeds) {
      const entry = Object.entries(TOPICS).find(([name, words]) =>
        name.includes(key) || words.some((w) => w === key || w.startsWith(key)));
      seeds = entry ? entry[1] : [key];
    }

    const limit = opts.limit ?? 24;
    const tally = new Map();

    for (const seed of seeds) {
      const res = await this.bible.search(seed, { translation: opts.translation, limit: 40 });
      for (const r of res.results ?? []) {
        const prior = tally.get(r.label);
        if (prior) {
          prior.score += r.score * 0.6;   // corroboration from another seed word
          prior.seeds.add(seed);
        } else {
          tally.set(r.label, { ...r, score: r.score, seeds: new Set([seed]) });
        }
      }
    }

    const verses = [...tally.values()]
      .map((v) => ({ ...v, seeds: [...v.seeds], breadth: v.seeds.size }))
      // A verse touching several facets of the theme is the better illustration.
      .sort((a, b) => (b.breadth - a.breadth) || (b.score - a.score))
      .slice(0, limit);

    return { theme: key, seeds, verses, matchedTopic: key in TOPICS ? key : null };
  }

  /** Every theme the offline engine knows, for the UI's topic picker. */
  topics() { return Object.keys(TOPICS).sort(); }

  // ---------------------------------------------------------------- outline

  /**
   * A service scaffold for a passage: the passage split into readable movements,
   * key terms, and cross-references built from shared vocabulary.
   */
  async outline(input, opts = {}) {
    const passage = await this.bible.lookup(input, opts.translation);
    if (!passage.ok) return { ok: false, error: passage.error };

    const verses = passage.verses;
    const full = verses.map((v) => v.text).join(' ');

    // Distinctive terms: frequent inside the passage, rare across scripture.
    const counts = new Map();
    for (const t of tokenize(full)) counts.set(t, (counts.get(t) || 0) + 1);
    const idx = await this.bible.index(opts.translation);
    const keyTerms = [...counts.entries()]
      .map(([term, n]) => {
        const df = idx.postings.get(term)?.docs.length ?? 1;
        return { term, count: n, weight: n * Math.log(idx.docCount / df) };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);

    // Movements: split the passage into 2–4 balanced blocks of verses.
    const blocks = Math.min(4, Math.max(2, Math.ceil(verses.length / 4)));
    const per = Math.ceil(verses.length / blocks);
    const movements = [];
    for (let i = 0; i < verses.length; i += per) {
      const slice = verses.slice(i, i + per);
      if (!slice.length) continue;
      const head = tokenize(slice.map((v) => v.text).join(' '))
        .filter((t) => keyTerms.some((k) => k.term === t))
        .slice(0, 3);
      movements.push({
        range: slice.length > 1 ? `${slice[0].label}–${slice[slice.length - 1].verse}` : slice[0].label,
        verses: slice,
        emphasis: [...new Set(head)],
      });
    }

    // Cross-references: other passages sharing this one's distinctive language.
    const query = keyTerms.slice(0, 5).map((k) => k.term).join(' ');
    const related = await this.bible.search(query, { translation: opts.translation, limit: 30 });
    const inPassage = new Set(verses.map((v) => v.label));
    const crossRefs = (related.results ?? [])
      .filter((r) => !inPassage.has(r.label) && r.bookId !== passage.reference.bookId)
      .slice(0, 8);

    return {
      ok: true,
      label: passage.label,
      translationAbbr: passage.translationAbbr,
      verseCount: verses.length,
      keyTerms,
      movements,
      crossRefs,
      readingTimeSeconds: Math.round(full.split(/\s+/).length / 2.4), // ~145 wpm read aloud
    };
  }

  // ------------------------------------------------------------------- song

  /** Scripture whose language matches a song's lyrics — for pairing in a set. */
  async forSong(song, opts = {}) {
    const lyrics = (song?.sections ?? []).map((s) => s.body.replace(/\[[^\]]*\]/g, '')).join(' ');
    const terms = [...new Set(tokenize(`${song?.title ?? ''} ${lyrics}`))];
    if (!terms.length) return { verses: [] };

    // Weight by rarity so common worship words don't dominate the query.
    const idx = await this.bible.index(opts.translation);
    const ranked = terms
      .map((t) => ({ t, df: idx.postings.get(t)?.docs.length ?? 0 }))
      .filter((x) => x.df > 0)
      .sort((a, b) => a.df - b.df)
      .slice(0, 8)
      .map((x) => x.t);

    const res = await this.bible.search(ranked.join(' '), { translation: opts.translation, limit: opts.limit ?? 12 });
    return { terms: ranked, verses: res.results ?? [] };
  }
}

module.exports = { AIService, TOPICS };
