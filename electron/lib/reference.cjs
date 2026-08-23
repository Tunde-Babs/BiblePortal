'use strict';
/**
 * Scripture reference parsing and formatting.
 *
 * Handles the shapes operators actually type under pressure:
 *   "jn 3:16"  "John 3:16-18"  "1 cor 13"  "Ps 23"  "rom 8:28,31"
 *   "Matt 5:3-12; Luke 6:20"   "John 3.16"  "gen1:1"  "2 tim 3:16-17"
 * plus open-ended ranges ("Rom 8:28-") and cross-chapter ranges ("Mt 5:1-7:29").
 */

const canon = require('./canon.cjs');

/** @typedef {{ bookId:string, book:string, chapter:number, verse:number|null, endChapter:number, endVerse:number|null, source:string }} Reference */

// "Book" part: optional leading ordinal, then letters/spaces/dots.
const REF_RE = /((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z\s.'’]*?)\s*(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3}))?(?:\s*[-–—]\s*(?:(\d{1,3})\s*[:.]\s*)?(\d{1,3}))?/i;

/**
 * Clamp a RANGE END to the real end of its chapter.
 *
 * Only ever applied to the end of a range, where "John 3:16-999" sensibly means
 * "verse 16 through the end". It must never be applied to the verse someone
 * actually asked for: silently turning "Jeremiah 11:29" into "Jeremiah 11:23"
 * puts different scripture on the screen than was requested, and labels it as
 * though it were correct.
 */
function clampRangeEnd(bookId, chapter, verse) {
  const max = canon.verseCount(bookId, chapter);
  if (!max) return null;
  return Math.min(Math.max(verse, 1), max);
}

/**
 * Parse a single reference from free text.
 * @returns {Reference|null}
 */
function parseOne(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;

  // Book-only ("Jude", "Philemon", "psalms") -> chapter 1.
  const bookOnly = canon.resolveBook(text);
  if (bookOnly) {
    return {
      bookId: bookOnly.id, book: bookOnly.name, chapter: 1, verse: null,
      endChapter: 1, endVerse: null, source: text,
    };
  }

  const m = REF_RE.exec(text);
  if (!m) return null;

  const book = canon.resolveBook(m[1]);
  if (!book) return null;

  let chapter = Number(m[2]);
  let verse = m[3] != null ? Number(m[3]) : null;
  const rangeChapter = m[4] != null ? Number(m[4]) : null;
  const rangeEnd = m[5] != null ? Number(m[5]) : null;

  // Single-chapter books: "Jude 5" means verse 5, not chapter 5.
  if (canon.chapterCount(book.id) === 1 && verse == null) {
    verse = chapter;
    chapter = 1;
  }

  if (chapter < 1 || chapter > canon.chapterCount(book.id)) return null;
  // A requested verse that does not exist is an error, not something to
  // quietly round down to the nearest one that does.
  if (verse != null) {
    const max = canon.verseCount(book.id, chapter);
    if (!max || verse < 1 || verse > max) return null;
  }

  let endChapter = chapter;
  let endVerse = verse;

  if (rangeEnd != null) {
    if (rangeChapter != null) {
      // Cross-chapter range: "Matt 5:1-7:29"
      endChapter = Math.min(rangeChapter, canon.chapterCount(book.id));
      endVerse = clampRangeEnd(book.id, endChapter, rangeEnd);
    } else if (verse != null) {
      // Same-chapter verse range: "John 3:16-18"
      endVerse = clampRangeEnd(book.id, chapter, Math.max(rangeEnd, verse));
    } else {
      // Chapter range: "Psalm 22-24"
      endChapter = Math.min(Math.max(rangeEnd, chapter), canon.chapterCount(book.id));
      endVerse = null;
    }
  }

  return { bookId: book.id, book: book.name, chapter, verse, endChapter, endVerse, source: m[0].trim() };
}

/**
 * Say why a reference could not be read. Returns null when it parses fine.
 *
 * "That isn't a reference" is useless to an operator mid-service; "Jeremiah 11
 * has 23 verses" tells them exactly what to do next.
 */
function explain(input) {
  const text = String(input ?? '').trim();
  if (!text) return 'Enter a scripture reference.';
  if (parseOne(text)) return null;

  const m = REF_RE.exec(text);
  const book = canon.resolveBook(m ? m[1] : text);
  if (!book) return `"${text}" doesn't match a book of the Bible.`;

  if (!m) return `${book.name} needs a chapter — try "${book.name} 1".`;

  const chapter = Number(m[2]);
  const chapters = canon.chapterCount(book.id);
  const single = chapters === 1;

  // In a single-chapter book the first number is the verse.
  if (single) {
    const verses = canon.verseCount(book.id, 1);
    if (chapter > verses) return `${book.name} has ${verses} verses.`;
    return `Could not read "${text}" as a reference in ${book.name}.`;
  }

  if (chapter < 1 || chapter > chapters) {
    return `${book.name} has ${chapters} chapter${chapters === 1 ? '' : 's'}.`;
  }

  const verse = m[3] != null ? Number(m[3]) : null;
  if (verse != null) {
    const verses = canon.verseCount(book.id, chapter);
    if (verse < 1 || verse > verses) {
      // Cite it the way it is cited everywhere else — "Psalm 23", not "Psalms 23".
      const cited = `${displayName(book.id, chapter, chapter, false)} ${chapter}`;
      return `${cited} has ${verses} verse${verses === 1 ? '' : 's'} — there is no verse ${verse}.`;
    }
  }
  return `Could not read "${text}" as a scripture reference.`;
}

/** Parse a list of references separated by ';' or ',' — "Jn 3:16; Rom 8:28". */
function parseList(input) {
  if (!input) return [];
  const out = [];
  let carryBook = null;
  for (const chunk of String(input).split(/\s*;\s*/)) {
    if (!chunk.trim()) continue;
    // A bare "8:28" after a full ref inherits the previous book.
    const bare = /^\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?(?:\s*[-–—]\s*(\d{1,3}))?\s*$/.exec(chunk);
    const ref = parseOne(bare && carryBook ? `${carryBook} ${chunk}` : chunk);
    if (ref) { out.push(ref); carryBook = ref.book; }
  }
  return out;
}

/**
 * The longest single book (Psalms) holds 2,461 verses, so the default ceiling
 * sits above any legitimate single-reference request. It exists only to stop a
 * pathological input allocating without bound — it must never quietly clip a
 * passage an operator actually asked for.
 */
const EXPAND_LIMIT = 3000;

/** Expand a reference into the flat list of {bookId,chapter,verse} it covers. */
function expand(ref, limit = EXPAND_LIMIT) {
  if (!ref) return [];
  const out = [];
  const startCh = ref.chapter;
  const endCh = ref.endChapter || ref.chapter;
  for (let ch = startCh; ch <= endCh && out.length < limit; ch++) {
    const max = canon.verseCount(ref.bookId, ch);
    if (!max) continue;
    const from = ch === startCh && ref.verse != null ? ref.verse : 1;
    const to = ch === endCh && ref.endVerse != null ? ref.endVerse : max;
    for (let v = from; v <= to && out.length < limit; v++) {
      out.push({ bookId: ref.bookId, chapter: ch, verse: v });
    }
  }
  return out;
}

/**
 * The name to print for a book. Two conventions operators expect:
 * "Psalms" is the book but a single psalm is cited "Psalm 23".
 */
function displayName(bookId, chapter, endChapter, abbreviated) {
  const b = canon.getBook(bookId);
  if (!b) return bookId;
  if (abbreviated) return b.abbr;
  if (b.id === 'PSA' && chapter === endChapter) return 'Psalm';
  return b.name;
}

/**
 * Human-readable reference: "John 3:16-18", "Psalm 23", "Matthew 5:1-7:29".
 * Single-chapter books drop the chapter number entirely — "Jude 5", not "Jude 1:5".
 */
function format(ref, opts = {}) {
  if (!ref) return '';
  const name = displayName(ref.bookId, ref.chapter, ref.endChapter, opts.abbreviated);

  if (canon.chapterCount(ref.bookId) === 1) {
    if (ref.verse == null) return name;
    if (ref.endVerse != null && ref.endVerse > ref.verse) return `${name} ${ref.verse}-${ref.endVerse}`;
    return `${name} ${ref.verse}`;
  }

  if (ref.verse == null) {
    return ref.endChapter > ref.chapter ? `${name} ${ref.chapter}-${ref.endChapter}` : `${name} ${ref.chapter}`;
  }
  if (ref.endChapter > ref.chapter) return `${name} ${ref.chapter}:${ref.verse}-${ref.endChapter}:${ref.endVerse}`;
  if (ref.endVerse != null && ref.endVerse > ref.verse) return `${name} ${ref.chapter}:${ref.verse}-${ref.endVerse}`;
  return `${name} ${ref.chapter}:${ref.verse}`;
}

/**
 * Autocomplete for the search field.
 *
 * Typing "Jo" should offer John, Job, Joel, Jonah, Joshua and Jude rather than
 * reporting no matches — a partial book name is the most common thing an
 * operator types, and it is not a full-text query.
 *
 * @param {string} input     what has been typed so far
 * @param {{limit?:number}} opts
 * @returns {{bookId:string, book:string, completion:string, label:string, hint:string, exact:boolean}[]}
 */
function suggest(input, opts = {}) {
  const limit = opts.limit ?? 8;
  const raw = String(input ?? '').trim();
  if (!raw) return [];

  // Split "1 joh 3:16" into the name part and whatever numbers follow it.
  const m = /^((?:[1-3]\s*|i{1,3}\s+|first\s+|second\s+|third\s+)?[a-z][a-z\s.'’]*?)\s*(\d.*)?$/i.exec(raw);
  if (!m) return [];

  const namePart = (m[1] ?? '').trim();
  const numberPart = (m[2] ?? '').trim();
  if (!namePart) return [];

  const needle = canon.normaliseBookToken(namePart);
  if (!needle) return [];

  const scored = [];
  for (const book of canon.books()) {
    const name = canon.normaliseBookToken(book.name);
    const abbr = canon.normaliseBookToken(book.abbr);

    // Rank: exact name, exact abbreviation, prefix of either, then contained.
    let rank = null;
    if (name === needle) rank = 0;
    else if (abbr === needle) rank = 1;
    else if (name.startsWith(needle)) rank = 2;
    else if (abbr.startsWith(needle)) rank = 3;
    else if (needle.length >= 3 && name.includes(needle)) rank = 4;
    if (rank === null) continue;

    const completion = numberPart ? `${book.name} ${numberPart}` : book.name;
    // Only offer a completion that actually resolves.
    const parsed = numberPart ? parseOne(completion) : null;
    if (numberPart && !parsed) continue;

    scored.push({
      bookId: book.id,
      book: book.name,
      completion,
      label: parsed ? format(parsed) : book.name,
      hint: parsed
        ? `${book.testament === 'OT' ? 'Old' : 'New'} Testament`
        : `${book.chapters.length} chapter${book.chapters.length === 1 ? '' : 's'}`,
      exact: rank <= 1,
      rank,
      order: book.order,
    });
  }

  scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return scored.slice(0, limit).map(({ rank, order, ...rest }) => rest);
}

/** Stable sortable key — book order, chapter, verse packed into one integer. */
/**
 * How many verses a reference covers, without building the list. Lets callers
 * warn before expanding something enormous.
 */
function countVerses(ref) {
  if (!ref) return 0;
  let n = 0;
  const endCh = ref.endChapter || ref.chapter;
  for (let ch = ref.chapter; ch <= endCh; ch++) {
    const max = canon.verseCount(ref.bookId, ch);
    if (!max) continue;
    const from = ch === ref.chapter && ref.verse != null ? ref.verse : 1;
    const to = ch === endCh && ref.endVerse != null ? ref.endVerse : max;
    n += Math.max(0, to - from + 1);
  }
  return n;
}

function verseKey(bookId, chapter, verse) {
  const b = canon.getBook(bookId);
  return (b ? b.order : 0) * 1_000_000 + chapter * 1000 + verse;
}

/** The next/previous chapter, rolling across book boundaries. */
function stepChapter(bookId, chapter, delta) {
  const b = canon.getBook(bookId);
  if (!b) return null;
  let ch = chapter + delta;
  if (ch >= 1 && ch <= b.chapters.length) return { bookId, chapter: ch };
  const next = canon.getBookByOrder(b.order + (delta > 0 ? 1 : -1));
  if (!next) return null;
  return { bookId: next.id, chapter: delta > 0 ? 1 : next.chapters.length };
}

module.exports = { parseOne, parseList, expand, countVerses, explain, suggest, format, displayName, verseKey, stepChapter, REF_RE, EXPAND_LIMIT };
