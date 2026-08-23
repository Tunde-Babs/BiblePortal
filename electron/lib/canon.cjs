'use strict';
/**
 * Biblical canon: ordering, chapter/verse counts and the alias table that powers
 * reference parsing. Chapter counts are authoritative for the Protestant canon;
 * verse counts follow the KJV versification (the versification used by every
 * translation BiblePortal bundles).
 */

/** @typedef {{ id:string, name:string, abbr:string, testament:'OT'|'NT', order:number, chapters:number[] }} Book */

// Each entry: [id, display name, standard abbreviation, testament, verses-per-chapter]
const RAW = [
  ['GEN', 'Genesis', 'Gen', 'OT', [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26]],
  ['EXO', 'Exodus', 'Exod', 'OT', [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38]],
  ['LEV', 'Leviticus', 'Lev', 'OT', [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34]],
  ['NUM', 'Numbers', 'Num', 'OT', [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13]],
  ['DEU', 'Deuteronomy', 'Deut', 'OT', [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12]],
  ['JOS', 'Joshua', 'Josh', 'OT', [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33]],
  ['JDG', 'Judges', 'Judg', 'OT', [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25]],
  ['RUT', 'Ruth', 'Ruth', 'OT', [22,23,18,22]],
  ['1SA', '1 Samuel', '1Sam', 'OT', [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13]],
  ['2SA', '2 Samuel', '2Sam', 'OT', [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25]],
  ['1KI', '1 Kings', '1Kgs', 'OT', [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53]],
  ['2KI', '2 Kings', '2Kgs', 'OT', [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30]],
  ['1CH', '1 Chronicles', '1Chr', 'OT', [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30]],
  ['2CH', '2 Chronicles', '2Chr', 'OT', [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23]],
  ['EZR', 'Ezra', 'Ezra', 'OT', [11,70,13,24,17,22,28,36,15,44]],
  ['NEH', 'Nehemiah', 'Neh', 'OT', [11,20,32,23,19,19,73,18,38,39,36,47,31]],
  ['EST', 'Esther', 'Esth', 'OT', [22,23,15,17,14,14,10,17,32,3]],
  ['JOB', 'Job', 'Job', 'OT', [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17]],
  ['PSA', 'Psalms', 'Ps', 'OT', [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6]],
  ['PRO', 'Proverbs', 'Prov', 'OT', [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31]],
  ['ECC', 'Ecclesiastes', 'Eccl', 'OT', [18,26,22,16,20,12,29,17,18,20,10,14]],
  ['SNG', 'Song of Solomon', 'Song', 'OT', [17,17,11,16,16,13,13,14]],
  ['ISA', 'Isaiah', 'Isa', 'OT', [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24]],
  ['JER', 'Jeremiah', 'Jer', 'OT', [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34]],
  ['LAM', 'Lamentations', 'Lam', 'OT', [22,22,66,22,22]],
  ['EZK', 'Ezekiel', 'Ezek', 'OT', [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35]],
  ['DAN', 'Daniel', 'Dan', 'OT', [21,49,30,37,31,28,28,27,27,21,45,13]],
  ['HOS', 'Hosea', 'Hos', 'OT', [11,23,5,19,15,11,16,14,17,15,12,14,16,9]],
  ['JOL', 'Joel', 'Joel', 'OT', [20,32,21]],
  ['AMO', 'Amos', 'Amos', 'OT', [15,16,15,13,27,14,17,14,15]],
  ['OBA', 'Obadiah', 'Obad', 'OT', [21]],
  ['JON', 'Jonah', 'Jonah', 'OT', [17,10,10,11]],
  ['MIC', 'Micah', 'Mic', 'OT', [16,13,12,13,15,16,20]],
  ['NAM', 'Nahum', 'Nah', 'OT', [15,13,19]],
  ['HAB', 'Habakkuk', 'Hab', 'OT', [17,20,19]],
  ['ZEP', 'Zephaniah', 'Zeph', 'OT', [18,15,20]],
  ['HAG', 'Haggai', 'Hag', 'OT', [15,23]],
  ['ZEC', 'Zechariah', 'Zech', 'OT', [21,13,10,14,11,15,14,23,17,12,17,14,9,21]],
  ['MAL', 'Malachi', 'Mal', 'OT', [14,17,18,6]],
  ['MAT', 'Matthew', 'Matt', 'NT', [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20]],
  ['MRK', 'Mark', 'Mark', 'NT', [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20]],
  ['LUK', 'Luke', 'Luke', 'NT', [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53]],
  ['JHN', 'John', 'John', 'NT', [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25]],
  ['ACT', 'Acts', 'Acts', 'NT', [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31]],
  ['ROM', 'Romans', 'Rom', 'NT', [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27]],
  ['1CO', '1 Corinthians', '1Cor', 'NT', [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24]],
  ['2CO', '2 Corinthians', '2Cor', 'NT', [24,17,18,18,21,18,16,24,15,18,33,21,14]],
  ['GAL', 'Galatians', 'Gal', 'NT', [24,21,29,31,26,18]],
  ['EPH', 'Ephesians', 'Eph', 'NT', [23,22,21,32,33,24]],
  ['PHP', 'Philippians', 'Phil', 'NT', [30,30,21,23]],
  ['COL', 'Colossians', 'Col', 'NT', [29,23,25,18]],
  ['1TH', '1 Thessalonians', '1Thess', 'NT', [10,20,13,18,28]],
  ['2TH', '2 Thessalonians', '2Thess', 'NT', [12,17,18]],
  ['1TI', '1 Timothy', '1Tim', 'NT', [20,15,16,16,25,21]],
  ['2TI', '2 Timothy', '2Tim', 'NT', [18,26,17,22]],
  ['TIT', 'Titus', 'Titus', 'NT', [16,15,15]],
  ['PHM', 'Philemon', 'Phlm', 'NT', [25]],
  ['HEB', 'Hebrews', 'Heb', 'NT', [14,18,19,16,14,20,28,13,28,39,40,29,25]],
  ['JAS', 'James', 'Jas', 'NT', [27,26,18,17,20]],
  ['1PE', '1 Peter', '1Pet', 'NT', [25,25,22,19,14]],
  ['2PE', '2 Peter', '2Pet', 'NT', [21,22,18]],
  ['1JN', '1 John', '1John', 'NT', [10,29,24,21,21]],
  ['2JN', '2 John', '2John', 'NT', [13]],
  ['3JN', '3 John', '3John', 'NT', [14]],
  ['JUD', 'Jude', 'Jude', 'NT', [25]],
  ['REV', 'Revelation', 'Rev', 'NT', [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21]],
];

/** @type {Book[]} */
const BOOKS = RAW.map(([id, name, abbr, testament, chapters], i) => ({
  id, name, abbr, testament, order: i + 1, chapters,
}));

const BY_ID = new Map(BOOKS.map((b) => [b.id, b]));
const BY_ORDER = new Map(BOOKS.map((b) => [b.order, b]));

/**
 * Extra spellings operators actually type. Keys are normalised (lowercase, no
 * punctuation/space) and map to a book id.
 */
const EXTRA_ALIASES = {
  gen: 'GEN', ge: 'GEN', gn: 'GEN', genesis: 'GEN',
  ex: 'EXO', exo: 'EXO', exod: 'EXO', exodus: 'EXO',
  lev: 'LEV', lv: 'LEV', leviticus: 'LEV',
  num: 'NUM', nm: 'NUM', nb: 'NUM', numbers: 'NUM',
  deut: 'DEU', dt: 'DEU', deu: 'DEU', deuteronomy: 'DEU',
  josh: 'JOS', jos: 'JOS', jsh: 'JOS', joshua: 'JOS',
  judg: 'JDG', jdg: 'JDG', jg: 'JDG', judges: 'JDG',
  rth: 'RUT', ru: 'RUT', ruth: 'RUT',
  '1sam': '1SA', '1sa': '1SA', '1s': '1SA', '1samuel': '1SA', isam: '1SA', firstsamuel: '1SA',
  '2sam': '2SA', '2sa': '2SA', '2s': '2SA', '2samuel': '2SA', iisam: '2SA', secondsamuel: '2SA',
  '1kgs': '1KI', '1ki': '1KI', '1k': '1KI', '1kings': '1KI', ikgs: '1KI',
  '2kgs': '2KI', '2ki': '2KI', '2k': '2KI', '2kings': '2KI', iikgs: '2KI',
  '1chr': '1CH', '1ch': '1CH', '1chron': '1CH', '1chronicles': '1CH',
  '2chr': '2CH', '2ch': '2CH', '2chron': '2CH', '2chronicles': '2CH',
  ezr: 'EZR', ezra: 'EZR',
  neh: 'NEH', ne: 'NEH', nehemiah: 'NEH',
  est: 'EST', esth: 'EST', es: 'EST', esther: 'EST',
  job: 'JOB', jb: 'JOB',
  ps: 'PSA', psa: 'PSA', psalm: 'PSA', psalms: 'PSA', pslm: 'PSA', psm: 'PSA', pss: 'PSA',
  prov: 'PRO', pro: 'PRO', prv: 'PRO', pr: 'PRO', proverbs: 'PRO',
  eccl: 'ECC', ecc: 'ECC', ec: 'ECC', qoh: 'ECC', ecclesiastes: 'ECC',
  song: 'SNG', sos: 'SNG', sng: 'SNG', canticles: 'SNG', songofsongs: 'SNG', songofsolomon: 'SNG',
  isa: 'ISA', is: 'ISA', isaiah: 'ISA',
  jer: 'JER', je: 'JER', jeremiah: 'JER',
  lam: 'LAM', la: 'LAM', lamentations: 'LAM',
  ezek: 'EZK', eze: 'EZK', ezk: 'EZK', ezekiel: 'EZK',
  dan: 'DAN', da: 'DAN', dn: 'DAN', daniel: 'DAN',
  hos: 'HOS', ho: 'HOS', hosea: 'HOS',
  joel: 'JOL', jol: 'JOL', jl: 'JOL',
  amos: 'AMO', amo: 'AMO', am: 'AMO',
  obad: 'OBA', oba: 'OBA', ob: 'OBA', obadiah: 'OBA',
  jonah: 'JON', jon: 'JON', jnh: 'JON',
  mic: 'MIC', mc: 'MIC', micah: 'MIC',
  nah: 'NAM', na: 'NAM', nam: 'NAM', nahum: 'NAM',
  hab: 'HAB', hb: 'HAB', habakkuk: 'HAB',
  zeph: 'ZEP', zep: 'ZEP', zp: 'ZEP', zephaniah: 'ZEP',
  hag: 'HAG', hg: 'HAG', haggai: 'HAG',
  zech: 'ZEC', zec: 'ZEC', zc: 'ZEC', zechariah: 'ZEC',
  mal: 'MAL', ml: 'MAL', malachi: 'MAL',
  matt: 'MAT', mat: 'MAT', mt: 'MAT', matthew: 'MAT',
  mrk: 'MRK', mk: 'MRK', mr: 'MRK', mark: 'MRK',
  luk: 'LUK', lk: 'LUK', luke: 'LUK',
  jhn: 'JHN', jn: 'JHN', joh: 'JHN', john: 'JHN',
  acts: 'ACT', act: 'ACT', ac: 'ACT',
  rom: 'ROM', ro: 'ROM', rm: 'ROM', romans: 'ROM',
  '1cor': '1CO', '1co': '1CO', '1c': '1CO', '1corinthians': '1CO', icor: '1CO',
  '2cor': '2CO', '2co': '2CO', '2c': '2CO', '2corinthians': '2CO', iicor: '2CO',
  gal: 'GAL', ga: 'GAL', galatians: 'GAL',
  eph: 'EPH', ephes: 'EPH', ephesians: 'EPH',
  phil: 'PHP', php: 'PHP', pp: 'PHP', philippians: 'PHP',
  col: 'COL', cl: 'COL', colossians: 'COL',
  '1thess': '1TH', '1th': '1TH', '1thes': '1TH', '1thessalonians': '1TH',
  '2thess': '2TH', '2th': '2TH', '2thes': '2TH', '2thessalonians': '2TH',
  '1tim': '1TI', '1ti': '1TI', '1t': '1TI', '1timothy': '1TI',
  '2tim': '2TI', '2ti': '2TI', '2t': '2TI', '2timothy': '2TI',
  titus: 'TIT', tit: 'TIT', ti: 'TIT',
  phlm: 'PHM', phm: 'PHM', pm: 'PHM', philem: 'PHM', philemon: 'PHM',
  heb: 'HEB', hebrews: 'HEB',
  jas: 'JAS', jam: 'JAS', james: 'JAS', jm: 'JAS',
  '1pet': '1PE', '1pe': '1PE', '1p': '1PE', '1peter': '1PE',
  '2pet': '2PE', '2pe': '2PE', '2p': '2PE', '2peter': '2PE',
  '1john': '1JN', '1jn': '1JN', '1jo': '1JN', '1j': '1JN',
  '2john': '2JN', '2jn': '2JN', '2jo': '2JN', '2j': '2JN',
  '3john': '3JN', '3jn': '3JN', '3jo': '3JN', '3j': '3JN',
  jude: 'JUD', jud: 'JUD', jd: 'JUD',
  rev: 'REV', re: 'REV', rv: 'REV', revelation: 'REV', apocalypse: 'REV',
};

/** Normalise a book token: lowercase, strip punctuation, fold roman/word ordinals. */
function normaliseBookToken(raw) {
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/[.’'`]/g, '');
  // Leading ordinal words and roman numerals -> digits (e.g. "First John", "II Kings").
  s = s.replace(/^(first|1st)\s+/, '1 ').replace(/^(second|2nd)\s+/, '2 ').replace(/^(third|3rd)\s+/, '3 ');
  s = s.replace(/^(iii)\s+/, '3 ').replace(/^(ii)\s+/, '2 ').replace(/^(i)\s+/, '1 ');
  return s.replace(/[\s\-_]+/g, '');
}

/** Full alias table (generated names + abbreviations + hand-written spellings). */
const ALIASES = (() => {
  const map = new Map();
  for (const [k, v] of Object.entries(EXTRA_ALIASES)) map.set(k, v);
  for (const b of BOOKS) {
    map.set(normaliseBookToken(b.name), b.id);
    map.set(normaliseBookToken(b.abbr), b.id);
    map.set(b.id.toLowerCase(), b.id);
  }
  return map;
})();

const TOTAL_VERSES = BOOKS.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c, 0), 0);

function books() { return BOOKS; }
function getBook(id) { return BY_ID.get(String(id).toUpperCase()) || null; }
function getBookByOrder(n) { return BY_ORDER.get(Number(n)) || null; }
function resolveBook(token) {
  const id = ALIASES.get(normaliseBookToken(token));
  return id ? BY_ID.get(id) : null;
}
function chapterCount(bookId) { const b = getBook(bookId); return b ? b.chapters.length : 0; }
function verseCount(bookId, chapter) {
  const b = getBook(bookId);
  if (!b) return 0;
  return b.chapters[chapter - 1] || 0;
}
/** True when book/chapter/verse all exist in the KJV versification. */
function isValid(bookId, chapter, verse) {
  const max = verseCount(bookId, chapter);
  if (!max) return false;
  return verse == null || (verse >= 1 && verse <= max);
}

module.exports = {
  BOOKS, TOTAL_VERSES, ALIASES,
  books, getBook, getBookByOrder, resolveBook,
  chapterCount, verseCount, isValid, normaliseBookToken,
};
