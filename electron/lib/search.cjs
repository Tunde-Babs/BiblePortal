'use strict';
/**
 * Fully offline text search: a compact inverted index with BM25 ranking, plus
 * phrase-proximity boosting so "in the beginning" outranks documents that merely
 * contain all three words. No model download, no network — this is the search
 * that always works.
 */

const BM25_K1 = 1.5;
const BM25_B = 0.72;

// Words that carry no discriminating signal in English scripture search.
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','had','has','have',
  'he','her','him','his','i','in','is','it','its','me','my','not','of','on','or',
  'our','shall','she','so','that','the','their','them','then','there','these',
  'they','this','to','unto','upon','was','we','were','what','when','which','who',
  'will','with','you','your','ye','thee','thou','thy','him','hath','did','do',
  // Interjections carry no discriminating power and are everywhere in worship
  // lyrics: without this, "oh" alone is enough to match half a song library.
  'oh','ooh','yeah',
]);

/** Very small English suffix stemmer — enough to unify plural/tense variants. */
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && /[sxz]|ch|sh$/.test(w.slice(0, -2))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('eth')) return w.slice(0, -3);
  return w;
}

/** Split text into normalised, stemmed tokens. Keeps stopwords out of the index. */
function tokenize(text, { keepStopwords = false } = {}) {
  const out = [];
  const words = String(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9']+/);
  for (const w of words) {
    const clean = w.replace(/^'+|'+$/g, '');
    if (clean.length < 2) continue;
    if (!keepStopwords && STOPWORDS.has(clean)) continue;
    out.push(stem(clean));
  }
  return out;
}

/**
 * An inverted index over documents identified by a numeric id.
 * Postings are stored as parallel arrays to keep memory flat for ~31k docs.
 */
class SearchIndex {
  constructor() {
    /** @type {Map<string, {docs:number[], tfs:number[]}>} */
    this.postings = new Map();
    /** @type {Map<number, number>} docId -> token count */
    this.lengths = new Map();
    this.totalLength = 0;
    this.docCount = 0;
  }

  get avgLength() { return this.docCount ? this.totalLength / this.docCount : 1; }

  /** Index one document. `id` must be a unique integer. */
  add(id, text) {
    const tokens = tokenize(text);
    if (!tokens.length) return;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [term, count] of tf) {
      let p = this.postings.get(term);
      if (!p) { p = { docs: [], tfs: [] }; this.postings.set(term, p); }
      p.docs.push(id);
      p.tfs.push(count);
    }
    this.lengths.set(id, tokens.length);
    this.totalLength += tokens.length;
    this.docCount += 1;
  }

  /**
   * Rank documents for a query.
   * @param {string} query
   * @param {{limit?:number, filter?:(id:number)=>boolean}} opts
   * @returns {{id:number, score:number}[]}
   */
  search(query, opts = {}) {
    const limit = opts.limit ?? 50;
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];

    const avg = this.avgLength;
    /** @type {Map<number, number>} */
    const scores = new Map();
    /** @type {Map<number, number>} how many distinct query terms each doc matched */
    const hits = new Map();

    for (const term of terms) {
      const p = this.postings.get(term);
      if (!p) continue;
      const df = p.docs.length;
      // BM25 IDF with the +1 guard that keeps the value non-negative.
      const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.docs.length; i++) {
        const id = p.docs[i];
        if (opts.filter && !opts.filter(id)) continue;
        const freq = p.tfs[i];
        const len = this.lengths.get(id) || avg;
        const norm = freq * (BM25_K1 + 1) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * (len / avg)));
        scores.set(id, (scores.get(id) || 0) + idf * norm);
        hits.set(id, (hits.get(id) || 0) + 1);
      }
    }
    if (!scores.size) return [];

    // Reward documents that matched more of the query — coverage beats raw tf.
    const results = [];
    for (const [id, score] of scores) {
      const coverage = (hits.get(id) || 0) / terms.length;
      results.push({ id, score: score * (0.45 + 0.55 * coverage), coverage });
    }
    results.sort((a, b) => b.score - a.score || a.id - b.id);
    return results.slice(0, limit);
  }

  /** Serialise to a plain object for on-disk caching. */
  toJSON() {
    const terms = [];
    const docs = [];
    const tfs = [];
    for (const [term, p] of this.postings) { terms.push(term); docs.push(p.docs); tfs.push(p.tfs); }
    return { v: 1, terms, docs, tfs, lengths: [...this.lengths], totalLength: this.totalLength, docCount: this.docCount };
  }

  static fromJSON(data) {
    const idx = new SearchIndex();
    if (!data || data.v !== 1) return idx;
    for (let i = 0; i < data.terms.length; i++) {
      idx.postings.set(data.terms[i], { docs: data.docs[i], tfs: data.tfs[i] });
    }
    idx.lengths = new Map(data.lengths);
    idx.totalLength = data.totalLength;
    idx.docCount = data.docCount;
    return idx;
  }
}

/**
 * Phrase-proximity bonus: how tightly the query's words sit together in `text`.
 * Returns 0..1. An exact substring match scores 1.
 */
function phraseScore(query, text) {
  const q = String(query).toLowerCase().trim();
  const t = String(text).toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 1;

  const words = tokenize(q, { keepStopwords: true });
  if (words.length < 2) return 0;
  const docWords = tokenize(t, { keepStopwords: true });
  const positions = words.map((w) => {
    const at = [];
    for (let i = 0; i < docWords.length; i++) if (docWords[i] === w) at.push(i);
    return at;
  });
  if (positions.some((p) => !p.length)) return 0;

  // Smallest window containing one occurrence of every query word.
  let best = Infinity;
  const walk = (i, lo, hi) => {
    if (i === positions.length) { best = Math.min(best, hi - lo); return; }
    for (const p of positions[i]) walk(i + 1, Math.min(lo, p), Math.max(hi, p));
  };
  // Cap the branching so a pathological verse can't blow up the search.
  if (positions.reduce((n, p) => n * Math.max(p.length, 1), 1) > 4096) return 0.25;
  walk(0, Infinity, -Infinity);
  const ideal = words.length - 1;
  return best === Infinity ? 0 : Math.max(0, ideal / Math.max(best, ideal));
}

/** Levenshtein distance, bounded — returns `max+1` once it's clearly too far. */
function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, row[j]);
    }
    if (rowMin > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Highlight query terms inside a snippet, as [start,end] offset pairs. */
function highlightRanges(query, text) {
  const terms = [...new Set(tokenize(query, { keepStopwords: true }))];
  if (!terms.length) return [];
  const ranges = [];
  const re = /[A-Za-z0-9']+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const word = stem(m[0].toLowerCase());
    if (terms.includes(word)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

module.exports = { SearchIndex, tokenize, stem, phraseScore, editDistance, highlightRanges, STOPWORDS };
