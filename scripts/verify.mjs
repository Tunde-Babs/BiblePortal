#!/usr/bin/env node
/**
 * BiblePortal verification suite.
 *
 * Exercises every pure module in the main process against real bundled data.
 * No test framework: this runs anywhere Node runs, including inside a packaged
 * app, so a church tech can confirm their install is sound.
 *
 *   node scripts/verify.mjs
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const canon = require('../electron/lib/canon.cjs');
const reference = require('../electron/lib/reference.cjs');
const search = require('../electron/lib/search.cjs');
const chords = require('../electron/lib/chords.cjs');
const songFormat = require('../electron/lib/song-format.cjs');
const spoken = require('../electron/lib/spoken.cjs');
const moduleImport = require('../electron/lib/module-import.cjs');
const catalogue = require('../electron/lib/catalog.cjs');
const { Store } = require('../electron/services/store.cjs');
const { BibleService } = require('../electron/services/bible.cjs');
const { SongService } = require('../electron/services/songs.cjs');
const { PlanService } = require('../electron/services/plan.cjs');
const { SettingsService } = require('../electron/services/settings.cjs');
const { MediaService } = require('../electron/services/media.cjs');
const { ScheduleFileService } = require('../electron/services/schedule-file.cjs');
const { CollectionService } = require('../electron/services/collections.cjs');
const sqliteModule = require('../electron/lib/sqlite-module.cjs');
const { rtfToText } = require('../electron/lib/rtf.cjs');
const easyworship = require('../electron/lib/easyworship.cjs');
const pptx = require('../electron/lib/pptx.cjs');
const zipStream = require('../electron/lib/zip-stream.cjs');
const { SermonService } = require('../electron/services/sermon.cjs');
const { OnlineBibleService } = require('../electron/services/online-bible.cjs');
const { MAX_RESIDENT_TRANSLATIONS, MAX_RESIDENT_INDEXES } = require('../electron/services/bible.cjs');
const { AIService } = require('../electron/services/ai.cjs');
const { LiveState } = require('../electron/live-state.cjs');

// ---------------------------------------------------------------- harness

let passed = 0;
let failed = 0;
const failures = [];
let group = '';

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m', reset: '\x1b[0m', cyan: '\x1b[36m' };

function describe(name) { group = name; console.log(`\n${C.bold}${name}${C.reset}`); }

function check(label, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error('returned false');
    passed++;
    console.log(`  ${C.green}✓${C.reset} ${C.dim}${label}${C.reset}`);
  } catch (err) {
    failed++;
    failures.push({ group, label, message: err.message });
    console.log(`  ${C.red}✗ ${label}${C.reset}\n      ${C.red}${err.message}${C.reset}`);
  }
}

async function checkAsync(label, fn) {
  try {
    const result = await fn();
    if (result === false) throw new Error('returned false');
    passed++;
    console.log(`  ${C.green}✓${C.reset} ${C.dim}${label}${C.reset}`);
  } catch (err) {
    failed++;
    failures.push({ group, label, message: err.message });
    console.log(`  ${C.red}✗ ${label}${C.reset}\n      ${C.red}${err.message}${C.reset}`);
  }
}

function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what ? `${what}: ` : ''}expected ${e}, got ${a}`);
}

function ok(value, message = 'expected truthy') {
  if (!value) throw new Error(message);
}

// ------------------------------------------------------------------- canon

describe('Canon');
check('66 books in Protestant order', () => eq(canon.BOOKS.length, 66));
check('31,102 verses (KJV versification)', () => eq(canon.TOTAL_VERSES, 31102));
check('39 Old Testament books', () => eq(canon.BOOKS.filter((b) => b.testament === 'OT').length, 39));
check('27 New Testament books', () => eq(canon.BOOKS.filter((b) => b.testament === 'NT').length, 27));
check('Psalm 119 has 176 verses', () => eq(canon.verseCount('PSA', 119), 176));
check('Psalm 117 has 2 verses', () => eq(canon.verseCount('PSA', 117), 2));
check('Revelation has 22 chapters', () => eq(canon.chapterCount('REV'), 22));
check('every book has a positive chapter count', () => ok(canon.BOOKS.every((b) => b.chapters.length > 0)));
check('every chapter has a positive verse count', () =>
  ok(canon.BOOKS.every((b) => b.chapters.every((c) => c > 0))));
check('book ids are unique', () => eq(new Set(canon.BOOKS.map((b) => b.id)).size, 66));
check('resolves "1 jn"', () => eq(canon.resolveBook('1 jn')?.id, '1JN'));
check('resolves "II Kings"', () => eq(canon.resolveBook('II Kings')?.id, '2KI'));
check('resolves "Song of Songs"', () => eq(canon.resolveBook('Song of Songs')?.id, 'SNG'));
check('resolves "First Corinthians"', () => eq(canon.resolveBook('First Corinthians')?.id, '1CO'));
check('rejects a non-book', () => eq(canon.resolveBook('Hesitations'), null));

// --------------------------------------------------------------- reference

describe('Reference parsing');
const refCases = [
  ['jn 3:16', 'John 3:16'],
  ['John 3:16-18', 'John 3:16-18'],
  ['1 cor 13', '1 Corinthians 13'],
  ['Ps 23', 'Psalm 23'],
  ['gen1:1', 'Genesis 1:1'],
  ['2 tim 3:16-17', '2 Timothy 3:16-17'],
  ['Matt 5:1-7:29', 'Matthew 5:1-7:29'],
  ['Jude 5', 'Jude 5'],
  ['Philemon', 'Philemon'],
  ['II Kings 4:1', '2 Kings 4:1'],
  ['rom 8.28', 'Romans 8:28'],
  ['1st john 4:8', '1 John 4:8'],
  ['revelation 21:4', 'Revelation 21:4'],
  ['3 john 4', '3 John 4'],
  ['Psalm 22-24', 'Psalms 22-24'],
];
for (const [input, expected] of refCases) {
  check(`"${input}" → ${expected}`, () => eq(reference.format(reference.parseOne(input)), expected));
}
check('clamps an over-long verse range', () =>
  eq(reference.format(reference.parseOne('john 3:16-999')), 'John 3:16-36'));
check('rejects gibberish', () => eq(reference.parseOne('zzzz qqqq'), null));
check('rejects an out-of-range chapter', () => eq(reference.parseOne('John 99:1'), null));
check('parses a semicolon list', () =>
  eq(reference.parseList('Jn 3:16; Rom 8:28').map((r) => reference.format(r)), ['John 3:16', 'Romans 8:28']));
check('carries the book across a bare reference', () =>
  eq(reference.parseList('Rom 8:28; 12:2').map((r) => reference.format(r)), ['Romans 8:28', 'Romans 12:2']));
check('expands a verse range', () => eq(reference.expand(reference.parseOne('Jn 3:16-18')).length, 3));
check('expands a whole chapter', () => eq(reference.expand(reference.parseOne('Ps 23')).length, 6));
check('expands across a chapter boundary', () =>
  ok(reference.expand(reference.parseOne('Matt 5:1-6:5')).length === 48 + 5));
check('verseKey orders correctly', () =>
  ok(reference.verseKey('GEN', 1, 1) < reference.verseKey('REV', 22, 21)));
check('stepChapter rolls into the next book', () =>
  eq(reference.stepChapter('MAL', 4, 1), { bookId: 'MAT', chapter: 1 }));
check('stepChapter rolls back into the previous book', () =>
  eq(reference.stepChapter('MAT', 1, -1), { bookId: 'MAL', chapter: 4 }));

// ------------------------------------------------------------------ search

describe('Search engine');
const idx = new search.SearchIndex();
[
  'In the beginning God created the heaven and the earth.',
  'For God so loved the world, that he gave his only begotten Son.',
  'The LORD is my shepherd; I shall not want.',
  'And God said, Let there be light: and there was light.',
].forEach((t, i) => idx.add(i, t));

check('indexes documents', () => eq(idx.docCount, 4));
check('finds a distinctive word', () => eq(idx.search('shepherd')[0].id, 2));
check('ranks multi-term queries', () => eq(idx.search('God created')[0].id, 0));
check('returns nothing for an absent term', () => eq(idx.search('quantum').length, 0));
check('ignores stopword-only queries', () => eq(idx.search('the and of').length, 0));
check('serialises and restores identically', () => {
  const round = search.SearchIndex.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  eq(round.search('God created'), idx.search('God created'));
});
check('phraseScore is 1 for an exact substring', () =>
  eq(search.phraseScore('in the beginning', 'In the beginning God created'), 1));
check('phraseScore is 0 for an absent phrase', () =>
  eq(search.phraseScore('purple monkey', 'In the beginning God created'), 0));
check('editDistance catches a single typo', () => eq(search.editDistance('shephard', 'shepherd'), 1));
check('editDistance bails past the cap', () => ok(search.editDistance('cat', 'elephant', 3) > 3));
check('stemmer folds plurals', () => eq(search.stem('shepherds'), 'shepherd'));
check('highlight ranges land on real words', () => {
  const text = 'and there was light';
  const [[start, end]] = search.highlightRanges('light', text);
  eq(text.slice(start, end), 'light');
});

// ------------------------------------------------------------------ chords

describe('Chord transposition');
check('G→A major triads', () => eq(['G', 'C', 'D'].map((c) => chords.transposeChord(c, 2, 'A')), ['A', 'D', 'E']));
check('preserves minor quality', () => eq(chords.transposeChord('Em', 2, 'A'), 'F#m'));
check('transposes both halves of a slash chord', () => eq(chords.transposeChord('G/B', 2, 'A'), 'A/C#'));
check('preserves extensions', () => eq(chords.transposeChord('Cmaj7', 2, 'D'), 'Dmaj7'));
check('preserves altered extensions', () => eq(chords.transposeChord('F#m7b5', 2, 'A'), 'G#m7b5'));
check('spells flats for a flat destination key', () => eq(chords.transposeChord('C', 3, 'Eb'), 'Eb'));
check('leaves a non-chord untouched', () => eq(chords.transposeChord('N.C.', 2, 'A'), 'N.C.'));
check('leaves a lyric fragment untouched', () => eq(chords.transposeChord('Hello', 2, 'A'), 'Hello'));
check('computes an interval', () => eq(chords.interval('G', 'A'), 2));
check('wraps an interval downward', () => eq(chords.interval('D', 'Bb'), 8));
check('transposes a whole body', () =>
  eq(chords.transposeBody('[G]one [C]two [D]three', 2, 'A'), '[A]one [D]two [E]three'));
check('round-trips through 12 semitones', () =>
  eq(chords.transposeChord(chords.transposeChord('G', 5, 'C'), 7, 'G'), 'G'));
check('key wheel is conventionally spelled', () =>
  eq(chords.keyWheel('C').map((k) => k.key), ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']));
check('splits a chord line into segments', () =>
  eq(chords.splitChordLine('[G]abc [C]def'), [{ chord: 'G', lyric: 'abc ' }, { chord: 'C', lyric: 'def' }]));
check('detects a key from a body', () => eq(chords.detectKey('[Em]x [G]y'), 'Em'));

// ------------------------------------------------------------- song format

describe('Song import');
// Fixtures use neutral placeholder text — the app ships no lyrics of its own.
const choFixture = [
  '{title: Sample Song}', '{artist: A. Writer}', '{key: G}', '{ccli: 1234567}', '',
  '[Verse 1]', '[G]Alpha line one', '[C]Alpha line [D]two', '',
  '[Chorus]', '[Em]Beta line one', '[C]Beta line two',
].join('\n');

const cho = songFormat.importSong(choFixture, 'sample.cho');
check('detects ChordPro', () => eq(cho.format, 'chordpro'));
check('reads the title directive', () => eq(cho.title, 'Sample Song'));
check('reads the artist directive', () => eq(cho.author, 'A. Writer'));
check('reads the key directive', () => eq(cho.key, 'G'));
check('reads the CCLI number', () => eq(cho.ccli, '1234567'));
check('splits into sections', () => eq(cho.sections.map((s) => s.label), ['Verse 1', 'Chorus']));
check('flags chord presence', () => eq(cho.hasChords, true));
check('round-trips through export', () =>
  ok(songFormat.exportChordPro(cho).includes('{title: Sample Song}')));

const xmlFixture = '<song><properties><titles><title>XML Sample</title></titles>'
  + '<authors><author>B. Person</author></authors><ccliNo>999</ccliNo>'
  + '<verseOrder>v1 c v1</verseOrder></properties><lyrics>'
  + '<verse name="v1"><lines>Gamma one<br/>Gamma two</lines></verse>'
  + '<verse name="c"><lines>Delta one<br/>Delta two</lines></verse></lyrics></song>';
const xml = songFormat.importSong(xmlFixture, 'sample.xml');
check('detects OpenLyrics', () => eq(xml.format, 'openlyrics'));
check('reads OpenLyrics metadata', () => eq([xml.title, xml.author, xml.ccli], ['XML Sample', 'B. Person', '999']));
check('maps verseOrder onto real section ids', () =>
  ok(xml.arrangement.every((id) => xml.sections.some((s) => s.id === id))));
check('honours a repeated section in the arrangement', () => eq(xml.arrangement.length, 3));
check('arrangement drives slide order', () =>
  eq(songFormat.toSlides(xml, { maxLines: 4 }).map((s) => s.sectionLabel), ['Verse 1', 'Chorus', 'Verse 1']));

const txt = songFormat.importSong('Plain Sample\n\nVerse 1\nEpsilon one\nEpsilon two\n\nChorus\nZeta one\n', 'plain.txt');
check('detects plain text', () => eq(txt.format, 'text'));
check('lifts the first line as the title', () => eq(txt.title, 'Plain Sample'));
check('does not leave the title as a section', () => eq(txt.sections.map((s) => s.label), ['Verse 1', 'Chorus']));
check('keeps the body when there is no header', () =>
  eq(songFormat.importSong('Solo one\nSolo two\n', 'x.txt').sections.length, 1));
check('splits long sections onto multiple slides', () => {
  const long = songFormat.importSong('[Verse 1]\na\nb\nc\nd\ne\nf\n', 'l.cho');
  eq(songFormat.toSlides(long, { maxLines: 3 }).length, 2);
});
check('strips chords from presentation slides', () =>
  ok(!songFormat.toSlides(cho, { maxLines: 4 }).some((s) => s.lines.join('').includes('['))));

// ------------------------------------------------------------------ spoken

describe('Spoken detection');
check('digitises simple numbers', () => eq(spoken.digitise('chapter three verse sixteen'), 'chapter 3 verse 16'));
check('digitises compound numbers', () => eq(spoken.digitise('one hundred and nineteen'), '119'));
check('digitises ordinals', () => eq(spoken.digitise('twenty third'), '23'));
check('digitises book ordinals', () => eq(spoken.digitise('first corinthians'), '1 corinthians'));

const spokenCases = [
  ['turn with me to the gospel of john chapter three verse sixteen', 'John 3:16'],
  ['lets read from first corinthians chapter thirteen', '1 Corinthians 13'],
  ['open your bibles to psalm twenty three', 'Psalm 23'],
  ['our text is romans chapter eight verses twenty eight through thirty', 'Romans 8:28-30'],
  ['in the book of revelation chapter twenty one verse four', 'Revelation 21:4'],
  ['second timothy three sixteen', '2 Timothy 3:16'],
  ['turn to the letter to the ephesians chapter two verses eight and nine', 'Ephesians 2:8'],
  ['look at the book of jude', 'Jude'],
  ['reading from psalm one hundred and nineteen verse one oh five', 'Psalm 119:105'],
  ['we find this in second kings chapter four', '2 Kings 4'],
  ['philemon verse six', 'Philemon 6'],
  ['go to matthew chapter five verse three through twelve', 'Matthew 5:3-12'],
];
for (const [phrase, expected] of spokenCases) {
  check(`"${phrase.slice(0, 44)}…" → ${expected}`, () => {
    const hits = spoken.detectReferences(phrase);
    ok(hits.length, 'nothing detected');
    eq(hits[0].label, expected);
  });
}
check('stays silent on ordinary speech', () =>
  eq(spoken.detectReferences('i went to the store to buy three apples').filter((h) => h.confidence > 0.5).length, 0));
check('stays silent on a greeting', () =>
  eq(spoken.detectReferences('good morning and welcome to church today').filter((h) => h.confidence > 0.5).length, 0));
check('a cue phrase raises confidence', () =>
  ok(spoken.detectReferences('turn to john three sixteen')[0].confidence
     > spoken.detectReferences('john three sixteen')[0].confidence));

// ----------------------------------------------------------- module import

describe('Bible module import');
check('imports Zefania', () => {
  const doc = moduleImport.importModule(
    '<XMLBIBLE><BIBLEBOOK bnumber="43"><CHAPTER cnumber="3"><VERS vnumber="16">Sample text.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>',
    'm.xml');
  eq([doc.sourceFormat, doc.verseCount, doc.books.JHN[2][15]], ['zefania', 1, 'Sample text.']);
});
check('imports OSIS', () => {
  const doc = moduleImport.importModule('<osis><verse osisID="Rom.8.28">Sample text.</verse></osis>', 'm.osis');
  eq([doc.sourceFormat, doc.books.ROM[7][27]], ['osis', 'Sample text.']);
});
check('imports USFX', () => {
  const doc = moduleImport.importModule('<usfx><book id="JHN"><c id="3"/><v id="16"/>Sample text.</book></usfx>', 'm.usfx');
  eq([doc.sourceFormat, doc.books.JHN[2][15]], ['usfx', 'Sample text.']);
});
check('imports CSV with quoted commas', () => {
  const doc = moduleImport.importModule('book,chapter,verse,text\nJohn,3,16,"Sample, text."', 'm.csv');
  eq([doc.sourceFormat, doc.books.JHN[2][15]], ['csv', 'Sample, text.']);
});
check('imports flat JSON', () => {
  const doc = moduleImport.importModule(JSON.stringify([{ book: 'John', chapter: 3, verse: 16, text: 'Sample text.' }]), 'm.json');
  eq([doc.sourceFormat, doc.verseCount], ['json', 1]);
});
check('strips footnotes from verse text', () => {
  const doc = moduleImport.importModule('<osis><verse osisID="Rom.8.28">Body<note>dropped</note> text.</verse></osis>', 'm.osis');
  ok(!doc.books.ROM[7][27].includes('dropped'));
});
check('rejects a file with no verses', () => {
  try { moduleImport.importModule('<osis></osis>', 'empty.osis'); return false; }
  catch { return true; }
});
check('marks imported modules as user-supplied', () => {
  const doc = moduleImport.importModule('<osis><verse osisID="Rom.8.28">x</verse></osis>', 'm.osis');
  ok(doc.imported === true && /licence held by the user/i.test(doc.license));
});

// --------------------------------------------------------------- catalogue

describe('Translation catalogue');
check('every entry has a licence', () => ok(catalogue.CATALOG.every((t) => t.license)));
check('every catalogue entry is public domain', () =>
  ok(catalogue.CATALOG.every((t) => /public domain/i.test(t.license))));
check('no copyrighted translation is in the catalogue', () => {
  const banned = ['NIV', 'NLT', 'NKJV', 'ESV', 'NASB', 'AMP', 'MSG', 'CSB', 'NRSV'];
  const present = catalogue.CATALOG.filter((t) => banned.includes(t.abbr));
  eq(present.map((t) => t.abbr), []);
});
check('catalogue ids are unique', () =>
  eq(new Set(catalogue.CATALOG.map((t) => t.id)).size, catalogue.CATALOG.length));
check('core set is installable English', () => ok(catalogue.CORE_IDS.length >= 3));
check('licensed list explains the omissions', () => ok(catalogue.LICENSED.every((l) => l.holder)));

// ------------------------------------------------------------- live state

describe('Live state');
check('starts blank', () => {
  const live = new LiveState();
  eq([live.get().program.slides.length, live.get().blackout], [0, false]);
});
check('take copies preview to program', () => {
  const live = new LiveState();
  live.loadPreview({ kind: 'scripture', title: 'T', slides: [{ id: 'a', lines: ['x'] }] });
  eq(live.get().program.slides.length, 0, 'program must not change before take');
  live.take();
  eq(live.get().program.slides.length, 1);
});
check('step respects deck bounds', () => {
  const live = new LiveState();
  live.loadPreview({ slides: [{ id: 'a', lines: [] }, { id: 'b', lines: [] }] });
  live.take();
  // index 0 -> 1 ok, past the end refused, back to 0 ok, before the start refused.
  eq([live.step(1), live.step(1), live.step(-1), live.step(-1)],
     [true, false, true, false]);
  eq(live.get().program.index, 0);
});
check('take clears blackout', () => {
  const live = new LiveState();
  live.toggleBlackout();
  live.loadPreview({ slides: [{ id: 'a', lines: ['x'] }] });
  live.take();
  eq(live.get().blackout, false);
});
check('currentSlide is null while blacked out', () => {
  const live = new LiveState();
  live.loadPreview({ slides: [{ id: 'a', lines: ['x'] }] });
  live.take();
  live.toggleBlackout();
  eq(live.currentSlide(), null);
});
check('emits on change', () => {
  const live = new LiveState();
  let fired = 0;
  live.on('change', () => { fired++; });
  live.set({ logo: true });
  eq(fired, 1);
});

// ------------------------------------------------------------- data layer

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bibleportal-verify-'));

describe('Store');
await checkAsync('returns the fallback when absent', async () => {
  const store = new Store(path.join(TMP, 'store1'));
  eq(await store.read('nothing', { a: 1 }), { a: 1 });
});
await checkAsync('round-trips a document', async () => {
  const store = new Store(path.join(TMP, 'store2'));
  await store.write('doc', { hello: 'world' });
  const fresh = new Store(path.join(TMP, 'store2'));
  eq(await fresh.read('doc'), { hello: 'world' });
});
await checkAsync('serialises concurrent writes', async () => {
  const store = new Store(path.join(TMP, 'store3'));
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.write('doc', { n })));
  const fresh = new Store(path.join(TMP, 'store3'));
  eq(await fresh.read('doc'), { n: 5 });
});
await checkAsync('quarantines a corrupt file instead of losing it', async () => {
  const dir = path.join(TMP, 'store4');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ not json');
  const store = new Store(dir);
  eq(await store.read('bad', { safe: true }), { safe: true });
  ok(fs.readdirSync(dir).some((f) => f.includes('corrupt')), 'original not preserved');
});

describe('Songs, plans, settings');
await checkAsync('library starts empty', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'lib1')));
  eq(await svc.all(), []);
});
await checkAsync('one library never leaks into another', async () => {
  const a = new SongService(new Store(path.join(TMP, 'leak-a')));
  await a.upsert({ title: 'Only In A' });
  const b = new SongService(new Store(path.join(TMP, 'leak-b')));
  eq(await b.all(), [], 'a fresh library inherited another one\'s songs');
});
await checkAsync('one plan list never leaks into another', async () => {
  const a = new PlanService(new Store(path.join(TMP, 'pleak-a')));
  await a.create({ name: 'Only In A' });
  const b = new PlanService(new Store(path.join(TMP, 'pleak-b')));
  eq(await b.all(), [], 'a fresh plan list inherited another one\'s plans');
});
await checkAsync('one media library never leaks into another', async () => {
  const a = new MediaService({ store: new Store(path.join(TMP, 'mleak-a')), mediaDir: path.join(TMP, 'mleak-a-files') });
  await a.store.write('media', { format: 'bibleportal.media/1', items: [{ id: 'x' }] });
  const b = new MediaService({ store: new Store(path.join(TMP, 'mleak-b')), mediaDir: path.join(TMP, 'mleak-b-files') });
  eq(await b.all(), [], 'a fresh media library inherited another one\'s items');
});
await checkAsync('a mutated read does not corrupt the next read', async () => {
  const store = new Store(path.join(TMP, 'mutate'));
  const first = await store.read('absent', { items: [] });
  first.items.push('scribble');
  const second = new Store(path.join(TMP, 'mutate2'));
  eq(await second.read('absent', { items: [] }), { items: [] });
});
await checkAsync('upsert then search finds the song', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'lib2')));
  const saved = await svc.upsert({ title: 'Findable Sample', sections: [{ id: 's1', label: 'Verse 1', type: 'verse', number: 1, body: 'Alpha' }] });
  const hits = await svc.search('Findable');
  eq(hits[0]?.song.id, saved.id);
});
await checkAsync('remove deletes the song', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'lib3')));
  const saved = await svc.upsert({ title: 'Temp' });
  await svc.remove(saved.id);
  eq(await svc.all(), []);
});
await checkAsync('a song keeps its style override', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'style1')));
  const saved = await svc.upsert({
    title: 'Styled',
    sections: [{ id: 's1', label: 'Verse 1', type: 'verse', number: 1, body: 'Alpha' }],
    style: { size: 80, align: 'left', italic: true },
  });
  eq((await svc.get(saved.id)).style, { size: 80, align: 'left', italic: true });
});
await checkAsync('a song with no style stores null, not an empty object', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'style2')));
  const saved = await svc.upsert({ title: 'Plain', sections: [] });
  eq(saved.style, null);
});
await checkAsync('clearing a style reverts to the theme', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'style3')));
  const saved = await svc.upsert({ title: 'X', sections: [], style: { size: 90 } });
  const cleared = await svc.upsert({ ...saved, style: null });
  eq(cleared.style, null);
});

await checkAsync('markUsed increments usage', async () => {
  const svc = new SongService(new Store(path.join(TMP, 'lib4')));
  const saved = await svc.upsert({ title: 'Used' });
  await svc.markUsed(saved.id);
  eq((await svc.get(saved.id)).usageCount, 1);
});
await checkAsync('plan reorder moves an item', async () => {
  const svc = new PlanService(new Store(path.join(TMP, 'plans1')));
  const plan = await svc.create({ name: 'Test' });
  for (const t of ['A', 'B', 'C']) await svc.addItem(plan.id, { kind: 'slide', title: t });
  const items = await svc.reorder(plan.id, 0, 2);
  eq(items.map((i) => i.title), ['B', 'C', 'A']);
});
await checkAsync('plan rejects an unknown item kind', async () => {
  const svc = new PlanService(new Store(path.join(TMP, 'plans2')));
  const plan = await svc.create({});
  try { await svc.addItem(plan.id, { kind: 'nonsense' }); return false; }
  catch { return true; }
});
await checkAsync('duplicating a plan gives fresh item ids', async () => {
  const svc = new PlanService(new Store(path.join(TMP, 'plans3')));
  const plan = await svc.create({});
  await svc.addItem(plan.id, { kind: 'slide', title: 'A' });
  const copy = await svc.duplicate(plan.id);
  const original = await svc.get(plan.id);
  ok(copy.items[0].id !== original.items[0].id, 'ids were shared');
});
await checkAsync('settings merge over defaults', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'set1')));
  const next = await svc.patch({ presentation: { versesPerSlide: 4 } });
  eq(next.presentation.versesPerSlide, 4);
  ok(next.presentation.maxLinesPerSlide === 4, 'other defaults were dropped');
});
await checkAsync('background slots default to unset', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'bg1')));
  const s = await svc.get();
  eq(s.backgrounds, { default: null, scripture: null, song: null, slide: null });
});
await checkAsync('assigning one background leaves the others alone', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'bg2')));
  await svc.patch({ backgrounds: { scripture: 'm_abc' } });
  const s = await svc.get();
  eq(s.backgrounds.scripture, 'm_abc');
  eq([s.backgrounds.song, s.backgrounds.default], [null, null]);
});
await checkAsync('a background can be cleared', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'bg3')));
  await svc.patch({ backgrounds: { song: 'm_x' } });
  await svc.patch({ backgrounds: { song: null } });
  eq((await svc.get()).backgrounds.song, null);
});
await checkAsync('at least one theme always remains', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'set2')));
  const { themes } = await svc.get();
  try { await svc.deleteTheme(themes[0].id); return false; }
  catch { return true; }
});

// ------------------------------------------------------------- regressions

describe('Regressions');

// A whole book must never be silently clipped — that is invisible data loss.
check('expand() returns every verse of the longest book', () => {
  const psalms = reference.parseOne('Psalms 1-150');
  eq(reference.countVerses(psalms), 2461);
  eq(reference.expand(psalms).length, 2461);
});
check('expand() returns a whole gospel intact', () => {
  const matthew = reference.parseOne('Matthew 1:1-28:20');
  eq(reference.expand(matthew).length, 1071);
});
check('countVerses agrees with expand across many references', () => {
  for (const input of ['John 3:16', 'Ps 23', 'Matt 5:1-7:29', 'Jude 3-5', 'Romans 8', 'Genesis 1-3']) {
    const ref = reference.parseOne(input);
    const counted = reference.countVerses(ref);
    const expanded = reference.expand(ref).length;
    if (counted !== expanded) throw new Error(`${input}: counted ${counted}, expanded ${expanded}`);
  }
});
check('expand() still refuses to allocate without bound', () => {
  ok(reference.EXPAND_LIMIT > 2461 && reference.EXPAND_LIMIT <= 10000,
    `limit ${reference.EXPAND_LIMIT} must clear the longest book but stay bounded`);
});

// Showing a different verse than the one requested is worse than showing none:
// on a live screen it looks authoritative and nobody catches it.
check('an out-of-range verse is rejected, not substituted', () => {
  eq(reference.parseOne('Jeremiah 11:29'), null);   // Jeremiah 11 ends at verse 23
  eq(reference.parseOne('John 3:99'), null);        // John 3 ends at verse 36
  eq(reference.parseOne('Psalm 23:40'), null);      // Psalm 23 ends at verse 6
});
check('a valid verse at the chapter boundary still parses', () => {
  eq(reference.format(reference.parseOne('Jeremiah 11:23')), 'Jeremiah 11:23');
  eq(reference.format(reference.parseOne('John 3:36')), 'John 3:36');
  eq(reference.format(reference.parseOne('Psalm 23:6')), 'Psalm 23:6');
});
check('a range END is still clamped to the chapter', () => {
  eq(reference.format(reference.parseOne('John 3:16-999')), 'John 3:16-36');
  eq(reference.format(reference.parseOne('Jeremiah 11:20-999')), 'Jeremiah 11:20-23');
});
check('explain() names the real limit', () => {
  ok(/23 verses/.test(reference.explain('Jeremiah 11:29')), reference.explain('Jeremiah 11:29'));
  ok(/50 chapters/.test(reference.explain('Genesis 51:1')), reference.explain('Genesis 51:1'));
  ok(/25 verses/.test(reference.explain('Jude 30')), reference.explain('Jude 30'));
  ok(/doesn't match a book/.test(reference.explain('Habbakuk 2:4')), reference.explain('Habbakuk 2:4'));
});
check('explain() returns null for a good reference', () => eq(reference.explain('John 3:16'), null));
check('explain() cites a psalm in the singular', () =>
  ok(/^Psalm 23 /.test(reference.explain('Psalm 23:40')), reference.explain('Psalm 23:40')));
check('the spoken detector will not cue a verse that does not exist', () => {
  eq(spoken.detectReferences('jeremiah chapter eleven verse twenty nine').length, 0);
  eq(spoken.detectReferences('jeremiah eleven twenty nine').length, 0);
});
check('the spoken detector still cues the valid neighbour', () =>
  eq(spoken.detectReferences('jeremiah eleven twenty three')[0]?.label, 'Jeremiah 11:23'));

// A partial book name is the commonest thing typed into the search field, and
// it is not a full-text query — "Jo" must offer books, not report no matches.
check('a two-letter prefix offers books', () => {
  const names = reference.suggest('Jo').map((x) => x.book);
  for (const expected of ['John', 'Job', 'Joel', 'Jonah', 'Joshua']) {
    if (!names.includes(expected)) throw new Error(`"Jo" missed ${expected}: ${names.join(', ')}`);
  }
});
check('an abbreviation completes', () => {
  eq(reference.suggest('rev')[0]?.book, 'Revelation');
  eq(reference.suggest('ps')[0]?.book, 'Psalms');
});
check('an ordinal narrows to numbered books', () => {
  const names = reference.suggest('1 c').map((x) => x.book);
  eq(names, ['1 Chronicles', '1 Corinthians']);
});
check('numbers carry into the completion', () => {
  eq(reference.suggest('matt 5')[0]?.completion, 'Matthew 5');
  eq(reference.suggest('matt 5')[0]?.label, 'Matthew 5');
});
check('a completion that cannot resolve is not offered', () => {
  // Matthew has 28 chapters; chapter 99 must not be suggested.
  eq(reference.suggest('matt 99').length, 0);
});
check('nonsense suggests nothing', () => eq(reference.suggest('zzzz').length, 0));
check('every suggestion round-trips through the parser', () => {
  for (const q of ['Jo', 'joh 3', 'ps 23', '1 cor 13', 'rev 21:4']) {
    for (const hit of reference.suggest(q)) {
      if (!/\d/.test(hit.completion)) continue;      // book-only needs no parse
      if (!parseOne(hit.completion)) throw new Error(`"${hit.completion}" does not parse`);
    }
  }
  function parseOne(x) { return reference.parseOne(x); }
});

// Whisper formats references properly most of the time, so a parser that only
// handles the sloppy form fails on the majority of real transcripts.
check('a colon-formatted reference survives digitise', () => {
  eq(spoken.digitise('John 3:16'), 'john 3:16');
  eq(spoken.digitise('Romans 8:28-30'), 'romans 8:28-30');
});
check('formatted references are detected', () => {
  for (const [input, expected] of [
    ['John 3:16', 'John 3:16'],
    ['John 11:2', 'John 11:2'],
    ['Romans 8:28-30', 'Romans 8:28-30'],
    ['1 John 4:8', '1 John 4:8'],
    ['Ruth 1:16', 'Ruth 1:16'],
  ]) {
    const hit = spoken.detectReferences(input)[0];
    if (hit?.label !== expected) throw new Error(`${input} -> ${hit?.label ?? 'nothing'}`);
  }
});
check('bare "book chapter verse" still works', () =>
  eq(spoken.detectReferences('john 11 2')[0]?.label, 'John 11:2'));

// Speech recognition confuses book names by sound; recover the common ones.
check('phonetic keys fold sound-alike spellings', () => {
  ok(search.editDistance(spoken.phoneticKey('roots'), spoken.phoneticKey('ruth'), 2) <= 1,
    `roots=${spoken.phoneticKey('roots')} ruth=${spoken.phoneticKey('ruth')}`);
});
check('misheard book names are recovered', () => {
  for (const [input, expected] of [
    ['The Book of Roots chapter 1, verse 4', 'Ruth 1:4'],
    ['Filipians 4:6', 'Philippians 4:6'],
    ['Mathew 5:3', 'Matthew 5:3'],
    ['Ecclesiasties 3:1', 'Ecclesiastes 3:1'],
  ]) {
    const hit = spoken.detectReferences(input)[0];
    if (hit?.label !== expected) throw new Error(`${input} -> ${hit?.label ?? 'nothing'}`);
  }
});
check('a recovered name scores lower than one heard cleanly', () => {
  const fuzzy = spoken.detectReferences('Mathew 5:3')[0].confidence;
  const clean = spoken.detectReferences('Matthew 5:3')[0].confidence;
  ok(fuzzy < clean, `fuzzy ${fuzzy} should be below clean ${clean}`);
});
check('everyday words are never guessed at as book names', () => {
  // Consonant skeletons are lossy: "read"->"rd" sits next to Ruth, "from"->"frm"
  // next to Jeremiah. These appear constantly in preaching.
  for (const word of ['lets', 'read', 'from', 'this', 'in', 'we', 'find', 'turn', 'look', 'word']) {
    const hit = spoken.resolveSpokenBook(word, null, true);
    if (hit) throw new Error(`"${word}" was guessed as ${hit.book.name}`);
  }
});
check('ordinary preaching produces no cue', () => {
  for (const line of [
    'we are going to look at this in a moment',
    'the word of god is living and active',
    'and there were about three thousand people',
    'good morning everyone welcome to church today',
  ]) {
    const hits = spoken.detectReferences(line).filter((h) => h.confidence > 0.5);
    if (hits.length) throw new Error(`"${line}" cued ${hits.map((h) => h.label).join(', ')}`);
  }
});
check('phonetic folding is applied before the leading sound is taken', () => {
  // Reading the first letter off the untransformed word left "Philippians"
  // starting 'p' and "Filipians" starting 'f', so they never matched.
  eq(spoken.phoneticKey('philippians'), spoken.phoneticKey('filipians'));
  eq(spoken.phoneticKey('matthew'), spoken.phoneticKey('mathew'));
});
check('a short book key is still reachable', () => {
  // Ruth reduces to a two-character key; excluding those lost the book entirely.
  ok(spoken.phoneticKey('ruth').length === 2, spoken.phoneticKey('ruth'));
  eq(spoken.detectReferences('roots 1 16')[0]?.label, 'Ruth 1:16');
});

check('a numbered book is not invented without its number', () => {
  // "Corinthians" alone must not silently become 1 Corinthians.
  eq(spoken.detectReferences('corinthians 13:4').length, 0);
});
check('noise annotations never cue', () => {
  for (const noise of ['(static)', '(clicking)', '[BLANK_AUDIO]', '[Music]']) {
    eq(spoken.detectReferences(noise).filter((h) => h.confidence > 0.5).length, 0, noise);
  }
});

// A bare bass marking is a real chart notation and must transpose.
check('a bare bass slash chord transposes', () => eq(chords.transposeChord('/G', 2, 'A'), '/A'));
check('plain words are still left alone', () => {
  eq(chords.transposeChord('Hello', 2, 'A'), 'Hello');
  eq(chords.transposeChord('N.C.', 2, 'A'), 'N.C.');
  eq(chords.transposeChord('', 2, 'A'), '');
});

// Resident memory must stay bounded however many translations are opened.
check('translation and index caches are capped', () => {
  ok(MAX_RESIDENT_TRANSLATIONS >= 2 && MAX_RESIDENT_TRANSLATIONS <= 8, 'translation cap out of range');
  ok(MAX_RESIDENT_INDEXES >= 1 && MAX_RESIDENT_INDEXES <= 4, 'index cap out of range');
});

// -------------------------------------------------------- SQLite modules

describe('SQLite Bible modules');
check('all 66 Protestant books are mapped', () =>
  eq(new Set(Object.values(sqliteModule.MYBIBLE_BOOKS)).size, 66));
check('MyBible numbering is correct at the edges', () =>
  eq([sqliteModule.MYBIBLE_BOOKS[10], sqliteModule.MYBIBLE_BOOKS[470], sqliteModule.MYBIBLE_BOOKS[730]],
     ['GEN', 'MAT', 'REV']));
check('deuterocanonical numbers are unmapped', () =>
  ok(!sqliteModule.MYBIBLE_BOOKS[170] && !sqliteModule.MYBIBLE_BOOKS[320]));
check('every mapped id is a real canon book', () =>
  ok(Object.values(sqliteModule.MYBIBLE_BOOKS).every((id) => canon.getBook(id))));
check('a text file is not mistaken for a database', () =>
  eq(sqliteModule.isSqlite(Buffer.from('<osis>not a db</osis>')), false));
check("markup is stripped from verse text", () =>
  eq(sqliteModule.clean('In the <S>1722</S>beginning  <i>was</i> light.'), 'In the beginning light.'));

await checkAsync('reads a MyBible-schema module', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE info (name TEXT, value TEXT)');
  db.run("INSERT INTO info VALUES ('description','Sample Module'),('abbreviation','SMP')");
  db.run('CREATE TABLE Bible (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT)');
  db.run("INSERT INTO Bible VALUES (500,3,16,'Placeholder body one.')");
  db.run("INSERT INTO Bible VALUES (10,1,1,'Placeholder body two.')");
  db.run("INSERT INTO Bible VALUES (170,1,1,'Outside the Protestant canon.')");
  const buffer = Buffer.from(db.export());
  db.close();

  const res = await sqliteModule.readSqliteModule(buffer);
  eq([res.sourceFormat, res.verseCount, res.skipped], ['mybible', 2, 1]);
  eq(res.books.JHN[2][15], 'Placeholder body one.');
  eq(res.meta.abbr, 'SMP');
});

await checkAsync('reads an e-Sword-schema module', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE Bible (Book INTEGER, Chapter INTEGER, Verse INTEGER, Scripture TEXT)');
  db.run("INSERT INTO Bible VALUES (43,3,16,'Placeholder body three.')");
  const buffer = Buffer.from(db.export());
  db.close();

  const res = await sqliteModule.readSqliteModule(buffer);
  eq([res.sourceFormat, res.verseCount], ['esword', 1]);
  eq(res.books.JHN[2][15], 'Placeholder body three.');
});

await checkAsync('rejects a database with no Bible table', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE Notes (id INTEGER)');
  const buffer = Buffer.from(db.export());
  db.close();
  try { await sqliteModule.readSqliteModule(buffer); return false; }
  catch { return true; }
});

// ------------------------------------------- licensed (online) translations

describe('API.Bible connector');
check('passage ids use USFM book codes', () => {
  const id = (q) => OnlineBibleService.passageId(reference.parseOne(q));
  eq(id('John 3:16'), 'JHN.3.16');
  eq(id('John 3:16-18'), 'JHN.3.16-JHN.3.18');
  eq(id('Psalm 23'), 'PSA.23');
  eq(id('Matthew 5:1-7:29'), 'MAT.5.1-MAT.7.29');
});
check('every canon id is a valid USFM code', () => {
  // The connector builds ids straight from our canon, so a drift here would
  // silently request passages that do not exist.
  for (const book of canon.BOOKS) {
    if (!/^[A-Z0-9]{3}$/.test(book.id)) throw new Error(`${book.name} -> ${book.id}`);
  }
});
check('verse-numbered text splits back into verses', () => {
  const ref = reference.parseOne('John 3:16-17');
  const out = OnlineBibleService.splitVerses('[16] First body here. [17] Second body here.', ref);
  eq(out.map((v) => v.verse), [16, 17]);
  eq(out[0].text, 'First body here.');
});
check('text with no verse markers still yields a verse', () => {
  const ref = reference.parseOne('John 3:16');
  const out = OnlineBibleService.splitVerses('A block with no markers.', ref);
  eq(out, [{ verse: 16, text: 'A block with no markers.' }]);
});
check('verse markers are recognised in every format seen in the wild', () => {
  const ref = reference.parseOne('John 3:16-18');
  const split = (t) => OnlineBibleService.splitVerses(t, ref).map((v) => v.verse);
  eq(split('[16] Body one. [17] Body two. [18] Body three.'), [16, 17, 18]);
  eq(split('(16) Body one. (17) Body two.'), [16, 17]);
  eq(split('{16} Body one. {17} Body two.'), [16, 17]);
  eq(split('Lead in 16. Body one. 17. Body two.'), [16, 17]);
});
check('an unparsed block is attributed to the opening verse, not dropped', () => {
  const ref = reference.parseOne('John 3:16');
  eq(OnlineBibleService.splitVerses('A block with no numbering.', ref), [
    { verse: 16, text: 'A block with no numbering.' },
  ]);
});
check('the shape report carries no verse text', () => {
  const verses = [{ verse: 16, text: 'Some fetched body text' }];
  const shape = OnlineBibleService.describeShape({ content: '[16] Some fetched body text', copyright: 'x' }, verses);
  const dumped = JSON.stringify(shape);
  ok(!dumped.includes('Some fetched body text'), 'licensed text leaked into diagnostics');
  eq(shape.markerStyle, 'bracket');
  eq(shape.verseNumbers, [16]);
});

check('empty content yields nothing rather than a blank verse', () =>
  eq(OnlineBibleService.splitVerses('   ', reference.parseOne('John 3:16')), []));

await checkAsync('a lookup without a key fails with guidance, not a stack trace', async () => {
  const settings = new SettingsService(new Store(path.join(TMP, 'online1')));
  const svc = new OnlineBibleService({ settings, cacheDir: path.join(TMP, 'online1-cache') });
  try { await svc.lookup('any', 'John 3:16'); return false; }
  catch (err) { return /Settings/.test(err.message); }
});
await checkAsync('online is off until a key is set', async () => {
  const settings = new SettingsService(new Store(path.join(TMP, 'online2')));
  const svc = new OnlineBibleService({ settings, cacheDir: path.join(TMP, 'online2-cache') });
  eq((await svc.config()).enabled, false);
});
await checkAsync('the cache filename never contains the key', async () => {
  const settings = new SettingsService(new Store(path.join(TMP, 'online3')));
  await settings.patch({ online: { apiKey: 'FIXTURE-not-a-real-key-0000', enabled: true } });
  const svc = new OnlineBibleService({ settings, cacheDir: path.join(TMP, 'online3-cache') });
  const file = svc._cacheFile('bible-id', 'JHN.3.16');
  ok(!file.includes('FIXTURE-not-a-real-key-0000'), 'the key leaked into a cache path');
});

// ------------------------------------------------------ PowerPoint import

describe('PowerPoint (.pptx)');
const buildPptx = async (files) => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer' });
};
const slideXml = (paragraphs) =>
  '<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree>'
  + paragraphs.map((runs) => `<p:sp><p:txBody><a:p>${runs.map((r) => `<a:t>${r}</a:t>`).join('')}</a:p></p:txBody></p:sp>`).join('')
  + '</p:spTree></p:cSld></p:sld>';

await checkAsync('runs are joined without separators', async () => {
  // PowerPoint splits a word across runs whenever formatting changes; joining
  // with spaces would corrupt every such title.
  const buf = await buildPptx({ 'ppt/slides/slide1.xml': slideXml([['Wel', 'come to '], ['Mount Zion']]) });
  const r = await pptx.readPptx(buf);
  eq(r.slides[0].lines, ['Welcome to', 'Mount Zion']);
});
await checkAsync('slides order numerically, not lexically', async () => {
  const buf = await buildPptx({
    'ppt/slides/slide1.xml': slideXml([['One']]),
    'ppt/slides/slide2.xml': slideXml([['Two']]),
    'ppt/slides/slide10.xml': slideXml([['Ten']]),
  });
  const r = await pptx.readPptx(buf);
  eq(r.slides.map((s) => s.title), ['One', 'Two', 'Ten']);
});
await checkAsync('XML entities decode', async () => {
  const buf = await buildPptx({ 'ppt/slides/slide1.xml': slideXml([['Tea &amp; coffee &lt;after&gt;']]) });
  const r = await pptx.readPptx(buf);
  eq(r.slides[0].title, 'Tea & coffee <after>');
});
await checkAsync('speaker notes are read and page numbers dropped', async () => {
  const buf = await buildPptx({
    'ppt/slides/slide1.xml': slideXml([['Announcements']]),
    'ppt/notesSlides/notesSlide1.xml': slideXml([['Mention the offering'], ['1']]),
  });
  const r = await pptx.readPptx(buf);
  eq(r.slides[0].notes, 'Mention the offering');
});
await checkAsync('slide images resolve through relationships', async () => {
  const buf = await buildPptx({
    'ppt/slides/slide1.xml': slideXml([['With picture']]),
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Target="../media/image1.png"/></Relationships>',
    'ppt/media/image1.png': Buffer.from('fake-png-bytes'),
  });
  const r = await pptx.readPptx(buf);
  eq(r.slides[0].images, ['ppt/media/image1.png']);
  eq((await pptx.extractImage(buf, 'ppt/media/image1.png')).toString(), 'fake-png-bytes');
});
await checkAsync('a non-zip is rejected clearly', async () => {
  try { await pptx.readPptx(Buffer.from('not a zip')); return false; }
  catch (err) { return /not a readable PowerPoint/i.test(err.message); }
});
await checkAsync('a zip with no slides explains the .ppt case', async () => {
  const buf = await buildPptx({ 'notes.txt': 'nothing here' });
  try { await pptx.readPptx(buf); return false; }
  catch (err) { return /older \.ppt/i.test(err.message); }
});

// ----------------------------------------------------------- sermon notes

describe('Section labels on screen');
await checkAsync('section labels are off by default', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'labels1')));
  eq((await svc.get()).presentation.showSectionLabels, false);
});
await checkAsync('turning labels on leaves other presentation settings alone', async () => {
  const svc = new SettingsService(new Store(path.join(TMP, 'labels2')));
  const next = await svc.patch({ presentation: { showSectionLabels: true } });
  eq(next.presentation.showSectionLabels, true);
  // Scripture attribution must not be disturbed — for a licensed translation
  // it is a condition of the publisher's permission, not a preference.
  eq(next.presentation.showTranslationAbbr, true);
  eq(next.presentation.showVerseNumbers, true);
});
check('live state carries the flag to the output windows', () => {
  const live = new LiveState();
  eq(live.get().sectionLabels, false);
  live.set({ sectionLabels: true });
  eq(live.get().sectionLabels, true);
});

describe('Preview slide jumping');
check('goToPreview moves only the preview deck', () => {
  const live = new LiveState();
  live.loadPreview({ slides: [{ id: 'a', lines: ['x'] }, { id: 'b', lines: ['y'] }, { id: 'c', lines: ['z'] }] });
  eq(live.goToPreview(2), true);
  eq(live.get().preview.index, 2);
  // Cueing in preview must never disturb what is on the audience screen.
  eq(live.get().program.slides.length, 0);
});
check('goToPreview refuses an index outside the deck', () => {
  const live = new LiveState();
  live.loadPreview({ slides: [{ id: 'a', lines: ['x'] }] });
  eq([live.goToPreview(-1), live.goToPreview(5)], [false, false]);
  eq(live.get().preview.index, 0);
});
check('cueing then taking puts that exact slide on air', () => {
  const live = new LiveState();
  live.loadPreview({ slides: [{ id: 'a', lines: ['x'] }, { id: 'b', lines: ['y'] }, { id: 'c', lines: ['z'] }] });
  live.goToPreview(1);
  live.take();
  eq(live.get().program.index, 1);
  eq(live.currentSlide().id, 'b');
});

describe('Pasting a song into stanzas');
// Fixtures use neutral placeholder text; the app ships no lyrics of its own.
check('blank lines separate stanzas', () => {
  const out = songFormat.splitStanzas('Alpha one\nAlpha two\n\nBeta one\nBeta two\n\nGamma one');
  eq(out.length, 3);
  eq(out.map((x) => x.label), ['Verse 1', 'Verse 2', 'Verse 3']);
  eq(out[0].body, 'Alpha one\nAlpha two');
});
check('a repeated block still becomes its own stanza', () => {
  // Songs commonly repeat a stanza verbatim; each occurrence is addressable.
  const out = songFormat.splitStanzas('Alpha one\nAlpha two\n\nAlpha one\nAlpha two');
  eq(out.length, 2);
  ok(out[0].id !== out[1].id, 'repeated blocks shared an id');
});
check('labelled blocks keep their label and type', () => {
  const out = songFormat.splitStanzas('Verse 1\nAlpha\n\nChorus\nBeta\n\nGamma');
  eq(out.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2']);
  eq(out.map((x) => x.type), ['verse', 'chorus', 'verse']);
});
check('numbering continues from stanzas already present', () => {
  const out = songFormat.splitStanzas('Delta\n\nEpsilon', { startVerse: 2 });
  eq(out.map((x) => x.label), ['Verse 3', 'Verse 4']);
});
check('windows line endings and ragged blanks are handled', () =>
  eq(songFormat.splitStanzas('One\r\n\r\n\r\nTwo\r\n   \r\nThree').length, 3));
check('a single block yields one stanza', () =>
  eq(songFormat.splitStanzas('Only one block here').length, 1));
check('empty input yields nothing', () => {
  eq(songFormat.splitStanzas('').length, 0);
  eq(songFormat.splitStanzas('   \n\n  \n').length, 0);
});
check('no stanza is created with an empty body', () =>
  ok(songFormat.splitStanzas('Alpha\n\n\n\nBeta').every((x) => x.body.trim())));

describe('Sermon notes');
await checkAsync('a new sermon starts with a usable outline', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon1')));
  const s = await svc.create({ title: 'Test' });
  ok(s.points.length >= 3, `only ${s.points.length} starter points`);
});
await checkAsync('outline mode marks exactly one live point per slide', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon2')));
  const s = await svc.create({ title: 'Test' });
  const slides = await svc.slides(s.id, { mode: 'outline' });
  eq(slides.length, s.points.length);
  slides.forEach((slide, i) => {
    const activeCount = slide.outline.filter((o) => o.active).length;
    if (activeCount !== 1) throw new Error(`slide ${i + 1} has ${activeCount} active points`);
    if (!slide.outline[i].active) throw new Error(`slide ${i + 1} marks the wrong point`);
  });
});
await checkAsync('every outline slide carries the whole message', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon3')));
  const s = await svc.create({ title: 'Test' });
  const slides = await svc.slides(s.id, { mode: 'outline' });
  for (const slide of slides) eq(slide.outline.length, s.points.length);
});
await checkAsync('sub-points appear only on the live point', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon4')));
  const s = await svc.create({ title: 'Test' });
  await svc.updatePoint(s.id, s.points[1].id, { subPoints: ['Alpha', 'Beta'] });
  const slides = await svc.slides(s.id, { mode: 'outline' });
  eq(slides[1].outline[1].subPoints, ['Alpha', 'Beta']);
  // The same point seen from another slide is dimmed and carries no sub-points.
  eq(slides[0].outline[1].subPoints, []);
});
await checkAsync('point mode shows one point with its sub-points', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon5')));
  const s = await svc.create({ title: 'Test' });
  await svc.updatePoint(s.id, s.points[0].id, { text: 'Only point', subPoints: ['Gamma'] });
  const slides = await svc.slides(s.id, { mode: 'point' });
  eq(slides[0].lines, ['Only point', 'Gamma']);
  ok(!slides[0].outline, 'point mode must not carry an outline');
});
await checkAsync('empty points are left out of the projection', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon6')));
  const s = await svc.create({ title: 'Test', points: [] });
  await svc.addPoint(s.id, 'Real point');
  await svc.addPoint(s.id, '   ');
  eq((await svc.slides(s.id, { mode: 'outline' })).length, 1);
});
await checkAsync('reordering points reorders the projection', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon7')));
  const s = await svc.create({ title: 'Test', points: [] });
  for (const t of ['A', 'B', 'C']) await svc.addPoint(s.id, t);
  await svc.movePoint(s.id, 0, 2);
  const slides = await svc.slides(s.id, { mode: 'outline' });
  eq(slides[0].outline.map((o) => o.text), ['B', 'C', 'A']);
});
await checkAsync('duplicating a sermon gives fresh point ids', async () => {
  const svc = new SermonService(new Store(path.join(TMP, 'sermon8')));
  const s = await svc.create({ title: 'Original' });
  const copy = await svc.duplicate(s.id);
  const original = await svc.get(s.id);
  ok(copy.points[0].id !== original.points[0].id, 'point ids were shared with the copy');
});
await checkAsync('one sermon list never leaks into another', async () => {
  const a = new SermonService(new Store(path.join(TMP, 'sleak-a')));
  await a.create({ title: 'Only In A' });
  const b = new SermonService(new Store(path.join(TMP, 'sleak-b')));
  eq(await b.all(), []);
});

// ---------------------------------------------------- EasyWorship migration

describe('RTF decoding');
check('plain text passes through', () => eq(rtfToText('Just plain text'), 'Just plain text'));
check('paragraph breaks become newlines', () =>
  eq(rtfToText(String.raw`{\rtf1\ansi\deff0\fs24 Alpha line\par Beta line\par}`), 'Alpha line\nBeta line'));
check('font tables are not emitted as text', () => {
  const out = rtfToText(String.raw`{\rtf1{\fonttbl{\f0\froman Times New Roman;}{\f1 Arial;}}Gamma text\par}`);
  eq(out, 'Gamma text');
});
check('colour tables are not emitted as text', () =>
  eq(rtfToText(String.raw`{\rtf1{\colortbl;\red0\green0\blue0;}Epsilon\par}`), 'Epsilon'));
check('ignorable destinations are skipped', () =>
  eq(rtfToText(String.raw`{\rtf1{\*\generator Riched20 10.0}Delta line\par}`), 'Delta line'));
check('escaped braces survive', () =>
  eq(rtfToText(String.raw`{\rtf1 A \{literal\} brace\par}`), 'A {literal} brace'));
check('hex escapes decode', () => ok(/caf/.test(rtfToText(String.raw`{\rtf1 caf\'e9 stop\par}`))));

describe('EasyWorship schedules');
await checkAsync('reads songs and media from a .ewsx', async () => {
  const initSqlJs = require('sql.js');
  const JSZip = require('jszip');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });

  // Fixture uses neutral placeholder text — no third-party lyrics are shipped.
  const db = new SQL.Database();
  db.run('CREATE TABLE song (rowid INTEGER, title TEXT, author TEXT, reference_number TEXT, words TEXT)');
  const rtf = (lines) => '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 ' + lines.join('\\par ') + '\\par}';
  const ins = db.prepare('INSERT INTO song VALUES (?,?,?,?,?)');
  ins.run([1, 'Placeholder One', 'A. Writer', '1234567',
    rtf(['Verse 1', 'Alpha one', 'Alpha two', '', 'Chorus', 'Beta one'])]);
  ins.free();
  db.run("CREATE TABLE settings (k TEXT, v TEXT)");
  db.run("INSERT INTO settings VALUES ('unrelated','ignore')");
  const dbBuf = Buffer.from(db.export());
  db.close();

  const zip = new JSZip();
  zip.file('main.db', dbBuf);
  zip.file('media/backdrop one.jpg', Buffer.from('fake-bytes'));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const res = await easyworship.readEwsx(buf);
  eq(res.format, 'ewsx');
  eq(res.songs.length, 1);
  eq(res.songs[0].title, 'Placeholder One');
  eq(res.songs[0].ccli, '1234567');
  eq(res.songs[0].sections.map((x) => x.label), ['Verse 1', 'Chorus']);
  eq(res.media.map((m) => m.name), ['backdrop one.jpg']);
});
await checkAsync('a non-zip file is rejected clearly', async () => {
  try { await easyworship.readEwsx(Buffer.from('not a zip at all')); return false; }
  catch (err) { return /not a readable EasyWorship/i.test(err.message); }
});
await checkAsync('archives are read without buffering the whole file', async () => {
  const JSZip = require('jszip');
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE song (title TEXT, words TEXT)');
  db.run("INSERT INTO song VALUES ('Placeholder','{\\rtf1 Alpha\\par}')");
  const dbBuf = Buffer.from(db.export());
  db.close();

  // 24 MB of incompressible data stands in for video.
  const payload = require('node:crypto').randomBytes(24 * 1024 * 1024);
  const zip = new JSZip();
  zip.file('main.db', dbBuf);
  zip.file('media/clip.mp4', payload, { compression: 'STORE' });
  const file = path.join(TMP, 'stream-test.ewsx');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));

  // Listing and reading must not pull the archive into memory.
  const before = process.memoryUsage().rss;
  const read = await easyworship.readEwsxFile(file);
  eq(read.songs.length, 1);
  eq(read.media.map((m) => m.name), ['clip.mp4']);

  const dest = path.join(TMP, 'streamed.mp4');
  const bytes = await easyworship.streamEntryToFile(file, 'media/clip.mp4', dest);
  const growth = process.memoryUsage().rss - before;

  eq(bytes, payload.length);
  eq(fs.statSync(dest).size, payload.length);
  // Reading a 24 MB entry must not cost anything like 24 MB of resident memory.
  ok(growth < payload.length, `RSS grew ${(growth / 1048576).toFixed(0)}MB for a ${(payload.length / 1048576).toFixed(0)}MB entry`);
  fs.rmSync(dest, { force: true });
  fs.rmSync(file, { force: true });
});
await checkAsync('entries are listed without decompressing them', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('a.txt', 'alpha');
  zip.file('media/b.mp4', Buffer.alloc(1024 * 1024));
  const file = path.join(TMP, 'list-test.zip');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const entries = await zipStream.listEntries(file);
  eq(entries.filter((e) => !e.dir).map((e) => e.name).sort(), ['a.txt', 'media/b.mp4']);
  eq(entries.find((e) => e.name === 'media/b.mp4').size, 1024 * 1024);
  fs.rmSync(file, { force: true });
});
await checkAsync('a missing entry is named in the error', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('present.txt', 'x');
  const file = path.join(TMP, 'missing-test.zip');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  try { await zipStream.extractToFile(file, 'absent.mp4', path.join(TMP, 'no.mp4')); return false; }
  catch (err) { return /absent\.mp4/.test(err.message); }
  finally { fs.rmSync(file, { force: true }); }
});
await checkAsync('readEntry refuses something too large for memory', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('big.bin', Buffer.alloc(2 * 1024 * 1024));
  const file = path.join(TMP, 'big-entry.zip');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  try { await zipStream.readEntry(file, 'big.bin', 1024); return false; }
  catch (err) { return /too large to read into memory/i.test(err.message); }
  finally { fs.rmSync(file, { force: true }); }
});

await checkAsync('media extracts back out byte-for-byte', async () => {
  const JSZip = require('jszip');
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE song (title TEXT, words TEXT)');
  db.run("INSERT INTO song VALUES ('X','{\\rtf1 Line\\par}')");
  const dbBuf = Buffer.from(db.export());
  db.close();

  const payload = Buffer.from('unique-media-payload-1234');
  const zip = new JSZip();
  zip.file('main.db', dbBuf);
  zip.file('media/clip.mp4', payload);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const out = await easyworship.extractMedia(buf, 'media/clip.mp4');
  eq(out.toString(), payload.toString());
});
check('a Firebird database is recognised, not misread', () => {
  const fake = Buffer.alloc(64);
  fake[0] = 0x01; fake[1] = 0x39;
  ok(easyworship.isFirebird(fake));
  ok(!easyworship.isSqlite(fake));
});
check('sections split on blank lines with labels honoured', () => {
  const secs = easyworship.toSections('Verse 1\nAlpha\n\nChorus\nBeta\n\nGamma');
  eq(secs.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2']);
  eq(secs.map((x) => x.type), ['verse', 'chorus', 'verse']);
});

// ------------------------------------------------------- schedules & sets

describe('Schedule files');
await checkAsync('saves and reopens a schedule', async () => {
  const dir = path.join(TMP, 'sched');
  const svc = new ScheduleFileService({ store: new Store(path.join(TMP, 'sched-store')), documentsDir: dir });
  await svc.ensureDirs();
  const plan = { id: 'p1', name: 'Sunday Service', date: '2026-08-23', notes: '', items: [
    { id: 'i1', kind: 'scripture', title: 'John 3:16' },
    { id: 'i2', kind: 'song', title: 'Sample Song', songId: 'song_1' },
  ] };
  const file = path.join(svc.roots.schedules, 'test.bpsx');
  await svc.save(file, plan, { songs: [{ id: 'song_1', title: 'Sample Song', sections: [] }] });
  const opened = await svc.open(file);
  eq([opened.name, opened.items.length, opened.embeddedSongs.length], ['Sunday Service', 2, 1]);
});
await checkAsync('embeds only songs the plan actually uses', async () => {
  const dir = path.join(TMP, 'sched2');
  const svc = new ScheduleFileService({ store: new Store(path.join(TMP, 'sched2-store')), documentsDir: dir });
  await svc.ensureDirs();
  const plan = { id: 'p', name: 'S', items: [{ id: 'i', kind: 'song', songId: 'used' }] };
  const file = path.join(svc.roots.schedules, 'x.bpsx');
  await svc.save(file, plan, { songs: [{ id: 'used', title: 'A' }, { id: 'unused', title: 'B' }] });
  eq((await svc.open(file)).embeddedSongs.map((s) => s.id), ['used']);
});
await checkAsync('a template drops item ids so copies stay independent', async () => {
  const dir = path.join(TMP, 'sched3');
  const svc = new ScheduleFileService({ store: new Store(path.join(TMP, 'sched3-store')), documentsDir: dir });
  await svc.ensureDirs();
  const plan = { id: 'p', name: 'Regular', items: [{ id: 'i1', kind: 'slide', title: 'Welcome' }] };
  const file = path.join(svc.roots.templates, 'regular.bpsx');
  await svc.save(file, plan, { songs: [], asTemplate: true });
  const opened = await svc.open(file);
  eq([opened.kind, opened.items[0].id], ['template', undefined]);
  eq((await svc.templates()).length, 1);
});
await checkAsync('recent list prunes files that no longer exist', async () => {
  const dir = path.join(TMP, 'sched4');
  const svc = new ScheduleFileService({ store: new Store(path.join(TMP, 'sched4-store')), documentsDir: dir });
  await svc.ensureDirs();
  const file = path.join(svc.roots.schedules, 'gone.bpsx');
  await svc.save(file, { id: 'p', name: 'Gone', items: [] }, { songs: [] });
  eq((await svc.recent()).length, 1);
  fs.rmSync(file);
  eq((await svc.recent()).length, 0);
});
await checkAsync('rejects a file that is not a schedule', async () => {
  const dir = path.join(TMP, 'sched5');
  const svc = new ScheduleFileService({ store: new Store(path.join(TMP, 'sched5-store')), documentsDir: dir });
  await svc.ensureDirs();
  const bad = path.join(svc.roots.schedules, 'bad.bpsx');
  fs.writeFileSync(bad, JSON.stringify({ format: 'something.else/1' }));
  try { await svc.open(bad); return false; } catch { return true; }
});
check('suggested filename carries the date', () => {
  const svc = new ScheduleFileService({ store: null, documentsDir: TMP });
  ok(/^sunday service \d{2}\.\d{2}\.\d{4}\.bpsx$/.test(svc.suggestName({ name: 'sunday service', date: '2026-08-23' })));
});

describe('Collections');
await checkAsync('creates and lists a collection', async () => {
  const svc = new CollectionService(new Store(path.join(TMP, 'col1')));
  await svc.create('Christmas');
  eq((await svc.all()).map((c) => c.name), ['Christmas']);
});
await checkAsync('refuses a duplicate name', async () => {
  const svc = new CollectionService(new Store(path.join(TMP, 'col2')));
  await svc.create('Communion');
  try { await svc.create('communion'); return false; } catch { return true; }
});
await checkAsync('adding a song twice does not duplicate it', async () => {
  const svc = new CollectionService(new Store(path.join(TMP, 'col3')));
  const c = await svc.create('Youth');
  await svc.addSongs(c.id, ['s1', 's2']);
  await svc.addSongs(c.id, ['s1']);
  eq((await svc.all())[0].songIds, ['s1', 's2']);
});
await checkAsync('purging a song clears it everywhere', async () => {
  const svc = new CollectionService(new Store(path.join(TMP, 'col4')));
  const a = await svc.create('A');
  const b = await svc.create('B');
  await svc.addSongs(a.id, ['s1']);
  await svc.addSongs(b.id, ['s1']);
  await svc.purgeSong('s1');
  ok((await svc.all()).every((c) => c.songIds.length === 0));
});
await checkAsync('one collection set never leaks into another', async () => {
  const a = new CollectionService(new Store(path.join(TMP, 'cleak-a')));
  await a.create('Only In A');
  const b = new CollectionService(new Store(path.join(TMP, 'cleak-b')));
  eq(await b.all(), []);
});

// ---------------------------------------------------------- bible service

const dataDir = path.join(ROOT, 'resources', 'data');
const hasData = fs.existsSync(path.join(dataDir, 'manifest.json'));

if (!hasData) {
  describe('Bible service');
  console.log(`  ${C.dim}skipped — no data pack. Run \`npm run data\` first.${C.reset}`);
} else {
  describe('Bible service (against real bundled scripture)');
  const bible = new BibleService({
    dataDir,
    lexiconDir: path.join(ROOT, 'resources', 'lexicon'),
    cacheDir: path.join(TMP, 'cache'),
  });
  await bible.init();

  await checkAsync('translations are installed', () => ok(bible.available.length > 0));
  await checkAsync('KJV loads with 66 books', async () => {
    const doc = await bible.load('kjv');
    eq(Object.keys(doc.books).length, 66);
  });
  await checkAsync('KJV holds 31,102 verses', async () => {
    const doc = await bible.load('kjv');
    let n = 0;
    for (const chapters of Object.values(doc.books)) for (const verses of chapters) n += verses.length;
    eq(n, 31102);
  });
  await checkAsync('every KJV chapter count matches the canon', async () => {
    const doc = await bible.load('kjv');
    for (const book of canon.BOOKS) {
      const chapters = doc.books[book.id];
      if (chapters.length !== book.chapters.length) {
        throw new Error(`${book.name}: ${chapters.length} chapters, canon says ${book.chapters.length}`);
      }
    }
  });
  await checkAsync('every KJV verse count matches the canon', async () => {
    const doc = await bible.load('kjv');
    for (const book of canon.BOOKS) {
      book.chapters.forEach((expected, i) => {
        const actual = doc.books[book.id][i].length;
        if (actual !== expected) throw new Error(`${book.name} ${i + 1}: ${actual} verses, canon says ${expected}`);
      });
    }
  });
  await checkAsync('no KJV verse is empty', async () => {
    const doc = await bible.load('kjv');
    for (const [bookId, chapters] of Object.entries(doc.books)) {
      chapters.forEach((verses, c) => verses.forEach((t, v) => {
        if (!t || !t.trim()) throw new Error(`empty verse at ${bookId} ${c + 1}:${v + 1}`);
      }));
    }
  });
  await checkAsync('lookup returns the right verse', async () => {
    const res = await bible.lookup('John 3:16', 'kjv');
    ok(res.ok && res.verses.length === 1);
    ok(/For God so loved the world/i.test(res.verses[0].text));
  });
  await checkAsync('lookup expands a range', async () => {
    const res = await bible.lookup('John 3:16-18', 'kjv');
    eq(res.verses.length, 3);
  });
  await checkAsync('lookup reports an unparseable reference', async () => {
    const res = await bible.lookup('not a reference at all', 'kjv');
    eq(res.ok, false);
  });
  await checkAsync('lookup explains an out-of-range verse precisely', async () => {
    const res = await bible.lookup('Jeremiah 11:29', 'kjv');
    eq(res.ok, false);
    ok(/23 verses/.test(res.error), `unhelpful error: ${res.error}`);
  });
  await checkAsync('chapter returns every verse', async () => {
    const res = await bible.chapter('PSA', 23, 'kjv');
    eq(res.verses.length, 6);
  });
  await checkAsync('search finds a known phrase', async () => {
    const res = await bible.search('good shepherd', { translation: 'kjv', limit: 10 });
    ok(res.results.some((r) => r.label === 'John 10:11'));
  });
  await checkAsync('search scopes to a testament', async () => {
    const res = await bible.search('god', { translation: 'kjv', testament: 'NT', limit: 50 });
    ok(res.results.every((r) => canon.getBook(r.bookId).testament === 'NT'));
  });
  await checkAsync('search scopes to one book', async () => {
    const res = await bible.search('love', { translation: 'kjv', bookId: '1JN', limit: 30 });
    ok(res.results.length > 0 && res.results.every((r) => r.bookId === '1JN'));
  });
  await checkAsync('smart bar recognises a reference', async () => {
    const res = await bible.smart('jn 3:16', { translation: 'kjv' });
    eq(res.kind, 'reference');
  });
  await checkAsync('smart bar corrects a misspelled book', async () => {
    const res = await bible.smart('revalations 21:4', { translation: 'kjv' });
    eq([res.kind, res.suggestion], ['corrected', 'Revelation 21:4']);
  });
  await checkAsync('smart bar falls back to text search', async () => {
    const res = await bible.smart('a city set on a hill', { translation: 'kjv' });
    eq(res.kind, 'text');
  });
  await checkAsync('parallel aligns multiple translations', async () => {
    const installed = bible.available.map((t) => t.id).slice(0, 2);
    const res = await bible.parallel('Ps 23:1', installed);
    eq(res.columns.length, installed.length);
  });
  await checkAsync('index caches to disk and reloads', async () => {
    await bible.index('kjv');
    const second = new BibleService({
      dataDir, lexiconDir: path.join(ROOT, 'resources', 'lexicon'), cacheDir: path.join(TMP, 'cache'),
    });
    await second.init();
    const t0 = Date.now();
    const idx2 = await second.index('kjv');
    ok(idx2.docCount === 31102, `cached index has ${idx2.docCount} docs`);
    ok(Date.now() - t0 < 3000, 'cached index load was slow');
  });
  await checkAsync('resident translations are evicted past the cap', async () => {
    const svc = new BibleService({
      dataDir, lexiconDir: path.join(ROOT, 'resources', 'lexicon'), cacheDir: path.join(TMP, 'lru'),
    });
    await svc.init();
    const ids = svc.available.map((t) => t.id).slice(0, MAX_RESIDENT_TRANSLATIONS + 2);
    if (ids.length <= MAX_RESIDENT_TRANSLATIONS) return true; // not enough installed to test
    for (const id of ids) await svc.load(id);
    ok(svc.translations.size <= MAX_RESIDENT_TRANSLATIONS,
      `${svc.translations.size} resident, cap is ${MAX_RESIDENT_TRANSLATIONS}`);
    ok(svc.translations.has(svc.defaultId), 'the default translation was evicted');
    // An evicted translation must still answer, by reloading from disk.
    const hit = await svc.lookup('John 3:16', ids[0]);
    ok(hit.ok, 'an evicted translation stopped serving lookups');
  });
  await checkAsync('a normal passage is never flagged as truncated', async () => {
    const res = await bible.lookup('Romans 8', 'kjv');
    eq([res.truncated, res.verses.length], [false, 39]);
  });
  await checkAsync('a whole gospel loads without clipping', async () => {
    const res = await bible.lookup('Mark 1:1-16:20', 'kjv');
    eq([res.truncated, res.verses.length], [false, 678]);
  });
  await checkAsync("Strong's lookup resolves a Greek code", async () => {
    const entry = await bible.strongs('G26');
    ok(entry.ok && /love/i.test(entry.definition));
  });
  await checkAsync("Strong's lookup normalises padding", async () => {
    const entry = await bible.strongs('g0026');
    eq(entry.code, 'G26');
  });
  await checkAsync('lexicon search returns matches', async () => {
    const hits = await bible.lexiconSearch('covenant', 10);
    ok(hits.length > 0);
  });

  describe('AI engine (offline)');
  const ai = new AIService({ bible, settings: null });
  await checkAsync('topical search widens a theme', async () => {
    const res = await ai.topical('anxiety', { translation: 'kjv', limit: 20 });
    ok(res.seeds.length > 1, 'theme was not expanded');
    ok(res.verses.some((v) => v.label === 'Philippians 4:6'), 'missed the obvious passage');
  });
  await checkAsync('topical handles an unknown theme gracefully', async () => {
    const res = await ai.topical('zzzznotatheme', { translation: 'kjv', limit: 5 });
    ok(Array.isArray(res.verses));
  });
  await checkAsync('detects a spoken reference', async () => {
    ai.resetDetection();
    const res = await ai.detect('turn to romans chapter eight verse twenty eight', { translation: 'kjv' });
    eq(res.detections[0]?.label, 'Romans 8:28');
  });
  await checkAsync('detects quoted scripture', async () => {
    ai.resetDetection();
    const res = await ai.detect('for God so loved the world that he gave his only begotten son', { translation: 'kjv' });
    eq(res.detections[0]?.label, 'John 3:16');
  });
  await checkAsync('stays silent on ordinary speech', async () => {
    ai.resetDetection();
    const res = await ai.detect('good morning everyone it is wonderful to see you all here', { translation: 'kjv' });
    eq(res.detections.length, 0);
  });
  await checkAsync('does not re-fire the same reference', async () => {
    ai.resetDetection();
    await ai.detect('turn to romans chapter eight verse twenty eight', { translation: 'kjv' });
    const again = await ai.detect('romans chapter eight verse twenty eight', { translation: 'kjv' });
    eq(again.detections.length, 0);
  });
  await checkAsync('outline splits a passage into movements', async () => {
    const res = await ai.outline('Psalm 23', { translation: 'kjv' });
    ok(res.ok && res.movements.length >= 2 && res.keyTerms.length > 0);
  });
  await checkAsync('outline reports a bad reference', async () => {
    const res = await ai.outline('not a passage', { translation: 'kjv' });
    eq(res.ok, false);
  });
}

// ------------------------------------------------------------------ report

fs.rmSync(TMP, { recursive: true, force: true });

const total = passed + failed;
console.log(`\n${C.bold}${'─'.repeat(58)}${C.reset}`);
if (failed === 0) {
  console.log(`${C.green}${C.bold}  All ${total} checks passed.${C.reset}`);
} else {
  console.log(`${C.red}${C.bold}  ${failed} of ${total} checks failed:${C.reset}`);
  for (const f of failures) console.log(`${C.red}    · [${f.group}] ${f.label}\n        ${f.message}${C.reset}`);
}
console.log(`${C.bold}${'─'.repeat(58)}${C.reset}\n`);

process.exit(failed === 0 ? 0 : 1);
