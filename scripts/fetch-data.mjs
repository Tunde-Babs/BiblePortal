#!/usr/bin/env node
/**
 * Builds BiblePortal's offline data pack.
 *
 * Downloads public-domain scripture and the public-domain Strong's lexicon,
 * converts them to the compact on-disk format the app reads, and verifies each
 * one against the canon before writing. Run once at install; after that the app
 * never touches the network.
 *
 *   node scripts/fetch-data.mjs                 # core English set (KJV, WEB, ASV)
 *   node scripts/fetch-data.mjs --all           # the whole catalogue, 32 translations
 *   node scripts/fetch-data.mjs --if-missing    # only what isn't there yet
 *   node scripts/fetch-data.mjs --only kjv,rvr  # a specific subset
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const canon = require('../electron/lib/canon.cjs');
const { CATALOG, CORE_IDS } = require('../electron/lib/catalog.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'resources', 'data');
const LEX_DIR = path.join(ROOT, 'resources', 'lexicon');

/**
 * Only public-domain texts are fetched. Copyrighted translations (NIV, ESV,
 * NKJV, NLT, NASB, AMP, MSG…) are excluded by design — see electron/lib/catalog.cjs.
 * Users install those from a module they own via Bible ▸ Translations ▸ Import.
 */
const TRANSLATIONS = CATALOG;

const API = 'https://api.getbible.net/v2';

const args = process.argv.slice(2);
const IF_MISSING = args.includes('--if-missing');
const ALL = args.includes('--all');
const ONLY = (() => {
  const i = args.indexOf('--only');
  if (i >= 0 && args[i + 1]) return new Set(args[i + 1].split(',').map((s) => s.trim()));
  // Default install is the core English set; `--all` fetches the whole catalogue.
  return ALL ? null : new Set(CORE_IDS);
})();

const log = (...a) => console.log('[data]', ...a);

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'BiblePortal/1.0 data-builder' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`fetch failed ${url}: ${lastErr?.message}`);
}

/** Strip the Strong's/morphology markup some sources embed in verse text. */
function cleanVerse(text) {
  return String(text)
    .replace(/\{[^}]*\}/g, '')      // {G2532} strong's tags
    .replace(/<[^>]*>/g, '')        // stray markup
    .replace(/\[([^\]]*)\]/g, '$1') // supplied words -> plain
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert the upstream shape into our compact form:
 *   books: { GEN: [ [v1, v2, …], … ] }   // array of chapters, each an array of verses
 */
function convert(meta, payload) {
  const books = {};
  let verseTotal = 0;
  const problems = [];

  for (const book of payload.books) {
    const canonBook = canon.getBookByOrder(book.nr);
    if (!canonBook) { problems.push(`unknown book nr ${book.nr} (${book.name})`); continue; }

    const chapters = [];
    for (const ch of book.chapters) {
      const verses = [];
      for (const v of ch.verses) verses[v.verse - 1] = cleanVerse(v.text);
      // Fill any gap the source left, so indexes never go undefined at runtime.
      for (let i = 0; i < verses.length; i++) if (verses[i] == null) verses[i] = '';
      chapters[ch.chapter - 1] = verses;
      verseTotal += verses.length;
    }
    for (let i = 0; i < chapters.length; i++) if (chapters[i] == null) chapters[i] = [];

    if (chapters.length !== canonBook.chapters.length) {
      problems.push(`${canonBook.name}: ${chapters.length} chapters, canon expects ${canonBook.chapters.length}`);
    }
    books[canonBook.id] = chapters;
  }

  return { books, verseTotal, problems };
}

async function buildTranslation(t) {
  const outFile = path.join(DATA_DIR, `${t.id}.json`);
  if (IF_MISSING && await exists(outFile)) { log(`${t.id}: present, skipping`); return { id: t.id, skipped: true }; }

  log(`${t.id}: downloading…`);
  const payload = await fetchJson(`${API}/${t.slug}.json`);
  const { books, verseTotal, problems } = convert(t, payload);

  const bookCount = Object.keys(books).length;
  // NT-only and OT-only texts are legitimate; only a full Bible must have 66.
  const expected = t.scope === 'nt' ? 27 : t.scope === 'ot' ? 39 : 66;
  if (t.scope === 'full' && bookCount !== expected) problems.push(`${bookCount} books, expected ${expected}`);
  for (const p of problems) log(`  ! ${t.id}: ${p}`);

  const doc = {
    format: 'bibleportal.translation/1',
    id: t.id,
    name: t.name,
    abbr: t.abbr,
    lang: t.lang,
    language: t.language,
    year: t.year,
    license: t.license,
    scope: t.scope,
    note: t.note ?? null,
    source: `${API}/${t.slug}.json`,
    builtAt: new Date().toISOString().slice(0, 10),
    verseCount: verseTotal,
    bookCount,
    books,
  };

  await writeFile(outFile, JSON.stringify(doc), 'utf8');
  const mb = (JSON.stringify(doc).length / 1048576).toFixed(1);
  log(`${t.id}: ${bookCount} books · ${verseTotal.toLocaleString()} verses · ${mb} MB`);
  return { id: t.id, verseTotal, bookCount, problems };
}

/**
 * Strong's Hebrew & Greek dictionaries (Strong, 1890 — public domain), via the
 * OpenScriptures machine-readable edition.
 */
async function buildLexicon() {
  const outFile = path.join(LEX_DIR, 'strongs.json');
  if (IF_MISSING && await exists(outFile)) { log('lexicon: present, skipping'); return; }

  const sources = {
    hebrew: 'https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/HebrewStrong.xml',
    greek: 'https://raw.githubusercontent.com/morphgnt/strongs-dictionary-xml/master/strongsgreek.xml',
  };

  const entries = {};
  for (const [lang, url] of Object.entries(sources)) {
    log(`lexicon: downloading ${lang}…`);
    let xml;
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'BiblePortal/1.0 data-builder' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      log(`  ! lexicon ${lang} unavailable (${err.message}) — word study will run without it`);
      continue;
    }
    Object.assign(entries, lang === 'hebrew' ? parseHebrew(xml) : parseGreek(xml));
  }

  const count = Object.keys(entries).length;
  if (!count) { log('lexicon: nothing built'); return; }
  await writeFile(outFile, JSON.stringify({ format: 'bibleportal.lexicon/1', license: "Strong's Concordance (1890) — Public Domain", count, entries }), 'utf8');
  log(`lexicon: ${count.toLocaleString()} entries`);
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const stripTags = (s) => unescapeXml(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseHebrew(xml) {
  const out = {};
  const re = /<entry\b[^>]*\bid="(H\d+)"[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [, id, body] = m;
    const lemma = /<w\b[^>]*>([^<]*)<\/w>/.exec(body);
    const xlit = /\bxlit="([^"]*)"/.exec(body);
    const pron = /<w\b[^>]*\bpron="([^"]*)"/.exec(body);
    const def = /<meaning>([\s\S]*?)<\/meaning>/.exec(body);
    const usage = /<usage>([\s\S]*?)<\/usage>/.exec(body);
    out[id] = {
      lang: 'hebrew',
      lemma: lemma ? stripTags(lemma[1]) : '',
      translit: xlit ? unescapeXml(xlit[1]) : '',
      pronounce: pron ? unescapeXml(pron[1]) : '',
      definition: def ? stripTags(def[1]) : '',
      usage: usage ? stripTags(usage[1]) : '',
    };
  }
  return out;
}

function parseGreek(xml) {
  const out = {};
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const num = /<strongs>\s*(\d+)\s*<\/strongs>/.exec(body);
    if (!num) continue;
    const id = `G${Number(num[1])}`;
    const lemma = /<greek\b[^>]*\bunicode="([^"]*)"/.exec(body);
    const translit = /<greek\b[^>]*\btranslit="([^"]*)"/.exec(body);
    const pron = /<pronunciation\b[^>]*\bstrongs="([^"]*)"/.exec(body);
    const def = /<strongs_def>([\s\S]*?)<\/strongs_def>/.exec(body);
    const kjv = /<kjv_def>([\s\S]*?)<\/kjv_def>/.exec(body);
    out[id] = {
      lang: 'greek',
      lemma: lemma ? unescapeXml(lemma[1]) : '',
      translit: translit ? unescapeXml(translit[1]) : '',
      pronounce: pron ? unescapeXml(pron[1]) : '',
      definition: def ? stripTags(def[1]) : '',
      usage: kjv ? stripTags(kjv[1]).replace(/^:-\s*/, '') : '',
    };
  }
  return out;
}

/** A manifest so the app knows what's installed without opening every file. */
async function writeManifest() {
  const installed = [];
  // Anything sitting in the data directory counts as installed — that includes
  // modules the user imported themselves, which are not in the catalogue.
  const onDisk = (await fsp.readdir(DATA_DIR).catch(() => []))
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .map((f) => f.slice(0, -5));
  const known = new Set(TRANSLATIONS.map((t) => t.id));
  const ids = [...TRANSLATIONS.map((t) => t.id), ...onDisk.filter((id) => !known.has(id))];

  for (const id of ids) {
    const t = TRANSLATIONS.find((x) => x.id === id) ?? { id };
    const f = path.join(DATA_DIR, `${t.id}.json`);
    if (!(await exists(f))) continue;
    const doc = JSON.parse(await readFile(f, 'utf8'));
    installed.push({
      id: doc.id, name: doc.name, abbr: doc.abbr, year: doc.year,
      lang: doc.lang ?? 'en', language: doc.language ?? 'English',
      license: doc.license, scope: doc.scope ?? 'full', note: doc.note ?? null,
      verseCount: doc.verseCount, bookCount: doc.bookCount ?? null,
      imported: doc.imported ?? false, file: `${t.id}.json`,
    });
  }
  const manifest = {
    format: 'bibleportal.manifest/1',
    builtAt: new Date().toISOString(),
    defaultTranslation: installed.some((t) => t.id === 'kjv') ? 'kjv' : installed[0]?.id ?? null,
    translations: installed,
    lexicon: (await exists(path.join(LEX_DIR, 'strongs.json'))) ? 'lexicon/strongs.json' : null,
  };
  await writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log(`manifest: ${installed.length} translation(s) installed`);
  return manifest;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(LEX_DIR, { recursive: true });

  const wanted = TRANSLATIONS.filter((t) => !ONLY || ONLY.has(t.id));
  let failed = 0;
  for (const t of wanted) {
    try { await buildTranslation(t); }
    catch (err) { failed++; log(`  ! ${t.id} failed: ${err.message}`); }
  }
  try { await buildLexicon(); } catch (err) { log(`  ! lexicon failed: ${err.message}`); }

  const manifest = await writeManifest();
  if (!manifest.translations.length) {
    log('No translations installed. Run `npm run data` with a network connection.');
    process.exitCode = IF_MISSING ? 0 : 1;
  } else if (failed) {
    log(`Done with ${failed} failure(s).`);
  } else {
    log('Offline data pack ready.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
