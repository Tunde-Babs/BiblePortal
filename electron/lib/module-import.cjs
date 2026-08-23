'use strict';
/**
 * Importer for Bible modules the user already owns.
 *
 * This is how a church installs a translation BiblePortal cannot legally
 * distribute (NIV, NLT, NKJV, AMP, MSG, ESV, NASB…): they supply a module file
 * they have licensed, and it is converted in place, on their machine, with no
 * network involved. Nothing is uploaded and nothing is redistributed.
 *
 * Supported inputs:
 *   • Zefania XML      <XMLBIBLE><BIBLEBOOK bnumber><CHAPTER cnumber><VERS vnumber>
 *   • OSIS XML         <osisText><div type="book"><chapter><verse osisID="John.3.16">
 *   • USFX XML         <book id="JHN"><c id="3"/><v id="16"/>
 *   • ThML             <scripture> / <verse> with osisRef-style ids
 *   • JSON             several common shapes, auto-detected
 *   • CSV/TSV          book,chapter,verse,text
 */

const canon = require('./canon.cjs');

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** Strip markup and normalise whitespace out of a verse body. */
function clean(s) {
  return decode(String(s)
    .replace(/<note\b[\s\S]*?<\/note>/gi, '')       // footnotes never belong on screen
    .replace(/<title\b[\s\S]*?<\/title>/gi, '')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** An accumulator that builds the compact `books` map and reports coverage. */
class Builder {
  constructor() { this.books = {}; this.count = 0; }

  set(bookId, chapter, verse, text) {
    const body = clean(text);
    if (!body || !bookId || !chapter || !verse) return;
    if (!canon.getBook(bookId)) return;
    const chapters = (this.books[bookId] ??= []);
    const verses = (chapters[chapter - 1] ??= []);
    if (verses[verse - 1] == null) this.count += 1;
    verses[verse - 1] = body;
  }

  /** Fill holes so no index is ever undefined at runtime. */
  finish() {
    for (const chapters of Object.values(this.books)) {
      for (let c = 0; c < chapters.length; c++) {
        const verses = (chapters[c] ??= []);
        for (let v = 0; v < verses.length; v++) if (verses[v] == null) verses[v] = '';
      }
    }
    return { books: this.books, verseCount: this.count, bookCount: Object.keys(this.books).length };
  }
}

/** Resolve a book identifier from any of the schemes these formats use. */
function resolveBookRef(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return canon.getBookByOrder(Number(s))?.id ?? null;   // Zefania bnumber
  const direct = canon.getBook(s.toUpperCase());
  if (direct) return direct.id;                                              // USFX / OSIS 3-letter
  return canon.resolveBook(s)?.id ?? null;                                   // full or abbreviated name
}

// ------------------------------------------------------------------ Zefania

function parseZefania(xml) {
  const b = new Builder();
  for (const bm of xml.matchAll(/<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi)) {
    const bookId = resolveBookRef(/\bbnumber="([^"]*)"/i.exec(bm[1])?.[1])
      ?? resolveBookRef(/\bbname="([^"]*)"/i.exec(bm[1])?.[1]);
    if (!bookId) continue;
    for (const cm of bm[2].matchAll(/<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi)) {
      const chapter = Number(/\bcnumber="([^"]*)"/i.exec(cm[1])?.[1]);
      if (!chapter) continue;
      for (const vm of cm[2].matchAll(/<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi)) {
        const verse = Number(/\bvnumber="([^"]*)"/i.exec(vm[1])?.[1]);
        b.set(bookId, chapter, verse, vm[2]);
      }
    }
  }
  return b.finish();
}

// --------------------------------------------------------------------- OSIS

function parseOsis(xml) {
  const b = new Builder();
  // Milestone form: <verse osisID="John.3.16" sID=.../>text<verse eID=.../>
  const milestones = [...xml.matchAll(/<verse\b[^>]*\bosisID="([^"]+)"[^>]*sID="[^"]*"[^>]*\/>/gi)];
  if (milestones.length > 100) {
    for (let i = 0; i < milestones.length; i++) {
      const start = milestones[i].index + milestones[i][0].length;
      const end = i + 1 < milestones.length ? milestones[i + 1].index : xml.length;
      const [bookRef, ch, vs] = milestones[i][1].split('.');
      b.set(resolveBookRef(bookRef), Number(ch), Number(vs), xml.slice(start, end).split(/<\/?div\b/)[0]);
    }
    return b.finish();
  }
  // Container form: <verse osisID="John.3.16">text</verse>
  for (const m of xml.matchAll(/<verse\b[^>]*\bosisID="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/gi)) {
    const [bookRef, ch, vs] = m[1].split('.');
    b.set(resolveBookRef(bookRef), Number(ch), Number(vs), m[2]);
  }
  return b.finish();
}

// --------------------------------------------------------------------- USFX

function parseUsfx(xml) {
  const b = new Builder();
  for (const bm of xml.matchAll(/<book\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/book>/gi)) {
    const bookId = resolveBookRef(bm[1]);
    if (!bookId) continue;
    const body = bm[2];
    let chapter = 0;
    // <c id="3"/> and <v id="16"/> are milestones; text runs until the next one.
    const marks = [...body.matchAll(/<(c|v)\b[^>]*\bid="([^"]+)"[^>]*\/?>/gi)];
    for (let i = 0; i < marks.length; i++) {
      const [, tag, id] = marks[i];
      if (tag.toLowerCase() === 'c') { chapter = Number(id); continue; }
      const start = marks[i].index + marks[i][0].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
      b.set(bookId, chapter, Number(id), body.slice(start, end).replace(/<ve\b[^>]*\/?>/gi, ''));
    }
  }
  return b.finish();
}

// --------------------------------------------------------------------- JSON

/** Accept the handful of JSON shapes these exports come in. */
function parseJson(text) {
  const data = JSON.parse(text);
  const b = new Builder();

  // Shape A: already our format — { books: { GEN: [[...]] } }
  if (data.books && !Array.isArray(data.books)) {
    for (const [key, chapters] of Object.entries(data.books)) {
      const bookId = resolveBookRef(key);
      if (!bookId || !Array.isArray(chapters)) continue;
      chapters.forEach((verses, ci) => (verses ?? []).forEach((t, vi) => b.set(bookId, ci + 1, vi + 1, t)));
    }
    return b.finish();
  }

  // Shape B: getbible-style — { books: [ { nr, chapters: [ { chapter, verses:[{verse,text}] } ] } ] }
  if (Array.isArray(data.books)) {
    for (const book of data.books) {
      const bookId = resolveBookRef(book.nr ?? book.name ?? book.abbrev);
      if (!bookId) continue;
      for (const ch of book.chapters ?? []) {
        const chapter = Number(ch.chapter ?? ch.num);
        for (const v of ch.verses ?? []) b.set(bookId, chapter, Number(v.verse ?? v.num), v.text ?? v.t);
      }
    }
    return b.finish();
  }

  // Shape C: flat rows — [ { book, chapter, verse, text }, … ]
  const rows = Array.isArray(data) ? data : (data.verses ?? data.rows ?? null);
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const bookId = resolveBookRef(r.book ?? r.book_name ?? r.b ?? r.bookId);
      b.set(bookId, Number(r.chapter ?? r.c), Number(r.verse ?? r.v), r.text ?? r.t ?? r.content);
    }
    return b.finish();
  }

  throw new Error('Unrecognised JSON layout');
}

// ---------------------------------------------------------------------- CSV

/** Split one delimited line, honouring quoted fields containing the delimiter. */
function splitRow(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const b = new Builder();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty file');
  const delim = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ',';

  // Skip a header row if the first cell clearly isn't a book.
  const first = splitRow(lines[0], delim);
  const start = resolveBookRef(first[0]) ? 0 : 1;

  for (let i = start; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim);
    if (cells.length < 4) continue;
    b.set(resolveBookRef(cells[0]), Number(cells[1]), Number(cells[2]), cells.slice(3).join(delim));
  }
  return b.finish();
}

// ----------------------------------------------------------------- dispatch

/** Guess the format from content, falling back to the file extension. */
function detectFormat(text, filename = '') {
  const head = text.slice(0, 4000);
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (/<XMLBIBLE|<BIBLEBOOK/i.test(head)) return 'zefania';
  if (/<osis\b|osisID=/i.test(head)) return 'osis';
  if (/<usfx\b/i.test(head) || (/<book\b[^>]*\bid="/i.test(head) && /<c\b[^>]*\bid="/i.test(text.slice(0, 20000)))) return 'usfx';
  if (/^\s*[[{]/.test(head) || ext === 'json') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (/<\?xml|<[A-Za-z]/.test(head)) return 'osis';
  return 'csv';
}

/**
 * Convert a module file into a BiblePortal translation document.
 *
 * @param {string} content  raw file contents
 * @param {string} filename
 * @param {{id?:string, name?:string, abbr?:string, license?:string, language?:string}} meta
 */
function importModule(content, filename = '', meta = {}) {
  const text = String(content);
  const format = detectFormat(text, filename);

  const parsers = { zefania: parseZefania, osis: parseOsis, usfx: parseUsfx, json: parseJson, csv: parseCsv };
  const parse = parsers[format];
  if (!parse) throw new Error(`Unsupported module format: ${format}`);

  const { books, verseCount, bookCount } = parse(text);
  if (!verseCount) throw new Error(`No verses found — the file parsed as ${format} but contained no readable verses.`);

  // Pull a name out of the file when the caller didn't supply one.
  const embeddedName = /<title[^>]*>([^<]{2,80})<\/title>/i.exec(text)?.[1]
    ?? /\bbiblename="([^"]{2,80})"/i.exec(text)?.[1]
    ?? /"(?:translation|name)"\s*:\s*"([^"]{2,80})"/i.exec(text)?.[1];

  const base = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  const name = (meta.name || embeddedName || base || 'Imported Translation').trim();
  const abbr = (meta.abbr || /\b([A-Z]{2,6})\b/.exec(base)?.[1] || name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'IMP').trim();
  const id = (meta.id || abbr.toLowerCase().replace(/[^a-z0-9]/g, '') || 'imported').slice(0, 16);

  const scope = bookCount >= 60 ? 'full' : Object.keys(books).every((k) => canon.getBook(k)?.testament === 'NT') ? 'nt' : 'partial';

  return {
    format: 'bibleportal.translation/1',
    id,
    name,
    abbr,
    language: meta.language ?? 'en',
    year: meta.year ?? null,
    // An imported module is the user's own licensed copy — never redistributed.
    license: meta.license ?? 'User-supplied module (licence held by the user)',
    source: `imported:${filename}`,
    imported: true,
    sourceFormat: format,
    scope,
    builtAt: new Date().toISOString().slice(0, 10),
    verseCount,
    bookCount,
    books,
  };
}

module.exports = {
  importModule, detectFormat, resolveBookRef,
  parseZefania, parseOsis, parseUsfx, parseJson, parseCsv,
};
