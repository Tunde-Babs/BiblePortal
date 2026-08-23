'use strict';
/**
 * Spoken-language scripture detection.
 *
 * A speech transcript doesn't contain "John 3:16" — it contains "turn with me
 * to the gospel of john chapter three verse sixteen". This module converts
 * spoken number words into digits and recognises the phrasings preachers
 * actually use, so the console can cue the verse before the sentence ends.
 *
 * Everything here is pure text processing: no model, no network.
 */

const canon = require('./canon.cjs');
const reference = require('./reference.cjs');
const { editDistance } = require('./search.cjs');

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Ordinals a speaker uses for book numbers and verses alike.
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/**
 * Replace spoken number words with digits.
 * "one hundred and nineteen" -> "119", "twenty third" -> "23".
 */
function digitise(text) {
  const words = String(text).toLowerCase().replace(/[,]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let acc = null;      // running value of the current number phrase
  let pending = false; // whether `acc` holds anything yet

  const flush = () => {
    if (pending) { out.push(String(acc)); acc = null; pending = false; }
  };

  for (let i = 0; i < words.length; i++) {
    // Keep ':' and '-' between digits. Stripping all punctuation turned a
    // well-formed "3:16" into "316", so every correctly transcribed reference
    // failed while sloppier ones succeeded.
    const w = words[i].replace(/[^a-z0-9:\-]/g, '').replace(/^[:\-]+|[:\-]+$/g, '');
    if (!w) continue;

    // "3:16", "3:16-18" or a plain number: emit verbatim.
    if (/^\d{1,3}(?::\d{1,3})?(?:-\d{1,3})?$/.test(w)) { flush(); out.push(w); continue; }

    if (w === 'hundred' && pending) { acc = (acc || 1) * 100; continue; }
    // "and" only continues a number when it sits inside one ("a hundred and five")
    if (w === 'and' && pending && /^(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thir|four|fif|six|seven|eigh|nine|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)/.test(words[i + 1] ?? '')) continue;

    if (w in TENS) {
      if (pending && acc % 100 === 0) acc += TENS[w]; else { flush(); acc = TENS[w]; pending = true; }
      continue;
    }
    if (w in ONES) {
      if (pending && acc % 100 === 0 && acc >= 100) acc += ONES[w];
      else if (pending && acc % 10 === 0 && acc < 100 && acc > 0) acc += ONES[w];
      else { flush(); acc = ONES[w]; pending = true; }
      continue;
    }
    if (w in ORDINALS) {
      if (pending && acc % 10 === 0 && acc > 0 && acc < 100) acc += ORDINALS[w];
      else { flush(); acc = ORDINALS[w]; pending = true; }
      continue;
    }
    flush();
    out.push(w);
  }
  flush();

  // Spoken digit strings: "one oh five" -> 105, "one o five" -> 105.
  // digitise() emits these as separate tokens; join them back up.
  let joined = out.join(' ');
  let prev;
  do {
    prev = joined;
    joined = joined.replace(/\b(\d{1,2})\s+0\s+(\d)\b/g, (_, a, b) => `${a}0${b}`);
  } while (joined !== prev);
  return joined;
}

/** Book names as spoken, including "the gospel of" / "the book of" prefixes. */
function normaliseSpokenBooks(text) {
  return String(text)
    .replace(/\bthe (?:gospel|book|letter|epistle) (?:according to|of|to the)?\s*/gi, ' ')
    .replace(/\bsaint\s+/gi, ' ')
    .replace(/\bpsalm\s+number\b/gi, 'psalm')
    .replace(/\bsong of songs\b/gi, 'song of solomon')
    .replace(/\brevelations\b/gi, 'revelation')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn "chapter N verse M (through|to) K" into "N:M-K" so the standard
 * reference parser can read it.
 */
function collapseChapterVerse(text) {
  return String(text)
    .replace(/\b(\d+)\s+chapter\b/gi, 'chapter $1')            // "three chapter" slip
    .replace(/\bchapter\s+(\d+)\s*(?:,|and)?\s*verses?\s+(\d+)\s*(?:through|thru|to|until|till|dash|-)\s*(\d+)/gi, '$1:$2-$3')
    .replace(/\bchapter\s+(\d+)\s*(?:,|and)?\s*verses?\s+(\d+)/gi, '$1:$2')
    .replace(/\bchapter\s+(\d+)/gi, '$1')
    .replace(/\bverses?\s+(\d+)\s*(?:through|thru|to|until|till|dash|-)\s*(\d+)/gi, ':$1-$2')
    .replace(/\bverses?\s+(\d+)/gi, ':$1')
    .replace(/(\d+)\s*:\s*(\d+)\s*(?:through|thru|to|until|till)\s*(\d+)/gi, '$1:$2-$3')
    .replace(/\s+:\s*/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUM_WORD = '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine)';

/**
 * Runs before digitise(): fixes spoken quirks that only make sense while the
 * numbers are still words. "verse one oh five" -> "verse one zero five".
 */
function preNormalise(text) {
  return String(text)
    .toLowerCase()
    .replace(new RegExp(`(\\b${NUM_WORD}\\s+)(?:oh|o)(\\s+${NUM_WORD}\\b)`, 'gi'), '$1zero$2');
}

/** Full normalisation pipeline: raw transcript -> reference-parseable text. */
function normalise(text) {
  return collapseChapterVerse(normaliseSpokenBooks(digitise(preNormalise(text))));
}

/**
 * A rough phonetic key for a word.
 *
 * Speech recognition confuses book names by sound, not by spelling: "Ruth"
 * comes back as "Roots", "Philippians" as "Filipians". Plain edit distance is
 * a poor judge of that ("roots"/"ruth" are 3 apart), so compare consonant
 * skeletons instead, after folding the digraphs that sound alike.
 */
function phoneticKey(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  // Fold sound-alike digraphs BEFORE taking the leading sound. Reading the
  // first letter off the original word gave "Philippians" a leading 'p' and
  // "Filipians" a leading 'f', so the two never matched despite sounding
  // identical — which is the whole point of the comparison.
  w = w
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/ch/g, 'k')
    .replace(/sh/g, 's').replace(/ck/g, 'k').replace(/gh/g, '')
    .replace(/wr/g, 'r').replace(/kn/g, 'n').replace(/qu/g, 'k');
  if (!w) return '';

  // Keep the leading sound, drop later vowels, then collapse runs.
  const key = w[0] + w.slice(1).replace(/[aeiouyh]/g, '');
  return key.replace(/(.)\1+/g, '$1');
}

/** Phonetic keys for every book, built once. */
const PHONETIC_BOOKS = (() => {
  const map = new Map();
  for (const b of canon.books()) {
    for (const name of [b.name, b.abbr]) {
      const key = phoneticKey(name.replace(/^[1-3]\s*/, ''));
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      if (!map.get(key).includes(b.id)) map.get(key).push(b.id);
    }
  }
  return map;
})();

/**
 * Everyday words that must never be guessed at as book names.
 *
 * Consonant skeletons are lossy: "read" reduces to "rd" and lands next to
 * "Ruth", "from" to "frm" and lands next to "Jeremiah". Those words appear in
 * every other sentence a preacher says, so a wrong cue would reach the screen
 * constantly. A genuine mishearing of a book name produces an unusual word,
 * not a common one.
 */
const NEVER_A_BOOK = new Set([
  'lets', 'let', 'read', 'reading', 'reads', 'from', 'this', 'that', 'these',
  'those', 'there', 'their', 'them', 'then', 'than', 'with', 'without', 'into',
  'find', 'found', 'first', 'second', 'third', 'next', 'last', 'turn', 'turns',
  'look', 'looks', 'open', 'opens', 'said', 'says', 'say', 'see', 'seen',
  'come', 'comes', 'came', 'want', 'went', 'know', 'knows', 'think', 'thought',
  'word', 'words', 'lord', 'god', 'jesus', 'christ', 'church', 'people',
  'today', 'tonight', 'morning', 'here', 'hear', 'heard', 'right', 'write',
  'time', 'times', 'thing', 'things', 'were', 'where', 'what', 'when', 'which',
  'will', 'would', 'could', 'should', 'about', 'after', 'again', 'also',
  'through', 'verse', 'verses', 'chapter', 'chapters', 'book', 'books',
  'start', 'starts', 'gonna', 'going', 'just', 'like', 'made', 'make',
  'more', 'most', 'much', 'need', 'over', 'very', 'well', 'work', 'year',
]);

/**
 * Resolve a possibly-misheard book name.
 *
 * Deliberately strict: a phonetic guess only stands if the word is unusual,
 * long enough to carry information, starts with the same sound, and is
 * followed by a number. Every one of those guards exists because dropping it
 * produced false cues on ordinary speech.
 *
 * @param {string} token       the word to resolve
 * @param {string|null} ordinal  a spoken "1"/"2"/"3" preceding it
 * @param {boolean} numberFollows  whether a chapter number comes next
 * @returns {{book:object, exact:boolean}|null}
 */
function resolveSpokenBook(token, ordinal, numberFollows = false) {
  const withOrdinal = ordinal ? `${ordinal} ${token}` : token;
  const exact = canon.resolveBook(withOrdinal);
  if (exact) return { book: exact, exact: true };

  const word = String(token).toLowerCase();
  if (NEVER_A_BOOK.has(word)) return null;
  // A bare book name with no chapter is not worth guessing at.
  if (!numberFollows) return null;

  const key = phoneticKey(token);
  // Two-letter skeletons ("in", "ts") carry too little to identify anything.
  if (key.length < 3) return null;

  let best = null;
  for (const [candidateKey, ids] of PHONETIC_BOOKS) {
    if (!candidateKey) continue;
    // The opening sound must agree; almost every real mishearing preserves it.
    if (candidateKey[0] !== key[0]) continue;
    // Allow one edit in the consonant skeleton — enough for "rts"/"rt".
    const d = candidateKey === key ? 0 : editDistance(key, candidateKey, 1);
    if (d > 1) continue;
    for (const id of ids) {
      const book = canon.getBook(id);
      // A numbered book must have had its number spoken, or we would happily
      // turn "Corinthians" into "1 Corinthians" and pick the wrong letter.
      if (/^[1-3]/.test(book.name) && !ordinal) continue;
      if (ordinal && !book.name.startsWith(String(ordinal))) continue;
      if (!best || d < best.d) best = { book, d };
    }
  }
  return best ? { book: best.book, exact: false } : null;
}

/** Phrases that signal a reference is coming — used to boost confidence. */
const CUE_RE = /\b(turn (?:with me )?to|turn over to|look at|open (?:your bibles?|to)|found in|reading from|go to|let'?s read|our text|the text is|according to|in the book of|verse|chapter)\b/i;

/**
 * Find scripture references spoken in a transcript window.
 *
 * Scans token by token rather than with one big regex: at each position it
 * tries the longest book name that fits (3 words down to 1, so "song of
 * solomon" and "1 corinthians" both win over a shorter accidental match), then
 * reads the numbers that follow.
 *
 * @param {string} transcript
 * @returns {{reference:object, label:string, confidence:number, matched:string}[]}
 */
function detectReferences(transcript) {
  const normalised = normalise(transcript);
  if (!normalised) return [];

  const hasCue = CUE_RE.test(transcript);
  // collapseChapterVerse can fuse a book onto its numbers ("philemon:6").
  // Split that boundary so the book scanner can still see the name.
  const tokens = normalised.replace(/([a-z])(:\d)/gi, '$1 $2').split(/\s+/).filter(Boolean);
  const found = [];
  const seen = new Set();

  for (let i = 0; i < tokens.length; i++) {
    // Longest-first book match starting at i.
    let book = null;
    let width = 0;
    let exact = true;
    for (let take = Math.min(3, tokens.length - i); take >= 1; take--) {
      const candidate = tokens.slice(i, i + take).join(' ');
      // A candidate ending in a digit is a number phrase, not a book name.
      if (/\d$/.test(candidate)) continue;
      const direct = canon.resolveBook(candidate);
      if (direct) { book = direct; width = take; exact = true; break; }
    }

    // Nothing matched outright — try to recover a misheard name.
    if (!book) {
      const ordinalMatch = /^([1-3])$/.exec(tokens[i] ?? '');
      const ordinal = ordinalMatch ? ordinalMatch[1] : null;
      const nameIndex = ordinal ? i + 1 : i;
      const nameToken = tokens[nameIndex];
      if (!nameToken || /\d/.test(nameToken)) continue;
      const numberFollows = /^\d/.test(tokens[nameIndex + 1] ?? '');
      const fuzzy = resolveSpokenBook(nameToken, ordinal, numberFollows);
      if (!fuzzy) continue;
      book = fuzzy.book;
      exact = fuzzy.exact;
      width = ordinal ? 2 : 1;
    }
    if (!book) continue;

    // Read what follows: "3:16", "3:16-18", "3 16", or just "3".
    const rest = tokens.slice(i + width);
    let chapter = null;
    let verse = null;
    let endVerse = null;
    let consumed = 0;

    const packed = /^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/.exec(rest[0] ?? '');
    const chapterOnly = /^(\d{1,3})$/.exec(rest[0] ?? '');
    const verseOnly = /^:(\d{1,3})(?:-(\d{1,3}))?$/.exec(rest[0] ?? '');

    if (verseOnly) {
      // "philemon verse six" — a verse with no chapter. Only meaningful for a
      // single-chapter book; otherwise the speaker hasn't said enough yet.
      if (canon.chapterCount(book.id) !== 1) continue;
      chapter = 1;
      verse = Number(verseOnly[1]);
      endVerse = verseOnly[2] ? Number(verseOnly[2]) : null;
      consumed = 1;
    } else if (packed) {
      chapter = Number(packed[1]);
      verse = Number(packed[2]);
      endVerse = packed[3] ? Number(packed[3]) : null;
      consumed = 1;
    } else if (chapterOnly) {
      chapter = Number(chapterOnly[1]);
      consumed = 1;
      // ":16" arrives as its own token when the speaker said "verse sixteen".
      const nextVerse = /^:(\d{1,3})(?:-(\d{1,3}))?$/.exec(rest[1] ?? '');
      const bareVerse = /^(\d{1,3})$/.exec(rest[1] ?? '');
      if (nextVerse) {
        verse = Number(nextVerse[1]);
        endVerse = nextVerse[2] ? Number(nextVerse[2]) : null;
        consumed = 2;
      } else if (bareVerse) {
        // "second timothy three sixteen" — two bare numbers means chapter:verse.
        verse = Number(bareVerse[1]);
        consumed = 2;
      }
    } else {
      // Book with no number at all — only useful for single-chapter books.
      if (canon.chapterCount(book.id) !== 1) continue;
      chapter = 1;
    }

    if (chapter == null) continue;

    // A single-chapter book named with no number ("the book of jude") is the
    // whole book — appending "1" would wrongly mean verse 1.
    const refText = consumed === 0 && canon.chapterCount(book.id) === 1
      ? book.name
      : `${book.name} ${chapter}${verse != null ? `:${verse}${endVerse ? `-${endVerse}` : ''}` : ''}`;
    const ref = reference.parseOne(refText);
    if (!ref) continue;

    const label = reference.format(ref);
    if (seen.has(label)) { i += width + consumed - 1; continue; }
    seen.add(label);

    // Confidence: a verse-level hit beats a chapter, a cue phrase helps, and a
    // multi-word book name beats a one-word abbreviation that may be a coincidence.
    let confidence = 0.5;
    if (ref.verse != null) confidence += 0.22;
    if (hasCue) confidence += 0.18;
    if (width >= 2) confidence += 0.08;
    if (book.name.length >= 5 && width === 1 && tokens[i].length >= 5) confidence += 0.05;
    // A lone short word that happens to alias a book ("is", "am", "so") is weak.
    if (width === 1 && tokens[i].length <= 3) confidence -= 0.3;
    // A name recovered phonetically is a guess; say so in the score.
    if (!exact) confidence -= 0.15;

    found.push({
      reference: ref,
      label,
      confidence: Math.max(0.05, Math.min(confidence, 0.99)),
      matched: tokens.slice(i, i + width + consumed).join(' '),
    });

    i += width + consumed - 1;
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}

module.exports = { digitise, normalise, preNormalise, phoneticKey, resolveSpokenBook, normaliseSpokenBooks, collapseChapterVerse, detectReferences, CUE_RE };
