'use strict';
/**
 * Reader for SQLite-based Bible modules.
 *
 * Most commercially licensed translations are distributed as one of these, so
 * this is the practical route for a church that owns NIV, NLT, NKJV, AMP, MSG
 * or similar to use it here. The file is read locally with a WASM SQLite build
 * — nothing is uploaded, and nothing is redistributed.
 *
 *   • MyBible / MySword  (.SQLite3, .bbl.mybible)  table `Bible`
 *                        columns book_number, chapter, verse, text
 *   • e-Sword            (.bblx, .bbli)            table `Bible`
 *                        columns Book, Chapter, Verse, Scripture
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const canon = require('./canon.cjs');

/**
 * MyBible assigns each book a number in tens, leaving gaps for the
 * deuterocanon. Anything not listed here is outside the Protestant canon and
 * is skipped rather than guessed at.
 */
const MYBIBLE_BOOKS = {
  10: 'GEN', 20: 'EXO', 30: 'LEV', 40: 'NUM', 50: 'DEU', 60: 'JOS', 70: 'JDG',
  80: 'RUT', 90: '1SA', 100: '2SA', 110: '1KI', 120: '2KI', 130: '1CH',
  140: '2CH', 150: 'EZR', 160: 'NEH', 190: 'EST', 220: 'JOB', 230: 'PSA',
  240: 'PRO', 250: 'ECC', 260: 'SNG', 290: 'ISA', 300: 'JER', 310: 'LAM',
  330: 'EZK', 340: 'DAN', 350: 'HOS', 360: 'JOL', 370: 'AMO', 380: 'OBA',
  390: 'JON', 400: 'MIC', 410: 'NAM', 420: 'HAB', 430: 'ZEP', 440: 'HAG',
  450: 'ZEC', 460: 'MAL', 470: 'MAT', 480: 'MRK', 490: 'LUK', 500: 'JHN',
  510: 'ACT', 520: 'ROM', 530: '1CO', 540: '2CO', 550: 'GAL', 560: 'EPH',
  570: 'PHP', 580: 'COL', 590: '1TH', 600: '2TH', 610: '1TI', 620: '2TI',
  630: 'TIT', 640: 'PHM', 650: 'HEB', 660: 'JAS', 670: '1PE', 680: '2PE',
  690: '1JN', 700: '2JN', 710: '3JN', 720: 'JUD', 730: 'REV',
};

/** Strip the inline markup these formats carry so only readable text remains. */
function clean(text) {
  return String(text ?? '')
    .replace(/<(?:S|m|n|f|i)>[\s\S]*?<\/(?:S|m|n|f|i)>/gi, '') // Strong's, morphology, notes
    .replace(/\[[^\]]*\]/g, (m) => m.slice(1, -1))             // supplied words -> plain
    .replace(/<[^>]*>/g, '')                                    // any remaining tags
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let SQL = null;

/** Load the WASM SQLite engine once per process. */
async function engine() {
  if (SQL) return SQL;
  const initSqlJs = require('sql.js');
  const wasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  const wasmBinary = await fsp.readFile(wasmPath);
  SQL = await initSqlJs({ wasmBinary });
  return SQL;
}

/** List the tables a module contains, so the schema can be identified. */
function tableNames(db) {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  return res.length ? res[0].values.map((r) => String(r[0]).toLowerCase()) : [];
}

function columnNames(db, table) {
  try {
    const res = db.exec(`PRAGMA table_info(${table})`);
    return res.length ? res[0].values.map((r) => String(r[1]).toLowerCase()) : [];
  } catch { return []; }
}

/** Read `key`/`value` metadata that MyBible modules carry in `info`. */
function readInfo(db) {
  const out = {};
  try {
    const res = db.exec('SELECT name, value FROM info');
    if (res.length) for (const [k, v] of res[0].values) out[String(k).toLowerCase()] = String(v ?? '');
  } catch { /* e-Sword uses a Details table instead */ }
  try {
    const res = db.exec('SELECT * FROM Details LIMIT 1');
    if (res.length) {
      res[0].columns.forEach((col, i) => { out[String(col).toLowerCase()] = String(res[0].values[0][i] ?? ''); });
    }
  } catch { /* not e-Sword */ }
  return out;
}

/**
 * Read a SQLite Bible module into the compact `books` shape.
 * @param {Buffer} buffer raw file contents
 */
async function readSqliteModule(buffer) {
  const engineRef = await engine();
  const db = new engineRef.Database(new Uint8Array(buffer));

  try {
    const tables = tableNames(db);
    if (!tables.includes('bible')) {
      throw new Error('No `Bible` table — this does not look like a MyBible, MySword or e-Sword module.');
    }

    const cols = columnNames(db, 'Bible');
    const isMyBible = cols.includes('book_number');
    const isESword = cols.includes('book') && (cols.includes('scripture') || cols.includes('verse'));

    if (!isMyBible && !isESword) {
      throw new Error(`Unrecognised \`Bible\` table layout (columns: ${cols.join(', ')}).`);
    }

    const query = isMyBible
      ? 'SELECT book_number, chapter, verse, text FROM Bible ORDER BY book_number, chapter, verse'
      : 'SELECT Book, Chapter, Verse, Scripture FROM Bible ORDER BY Book, Chapter, Verse';

    const books = {};
    let verseCount = 0;
    let skipped = 0;

    const stmt = db.prepare(query);
    while (stmt.step()) {
      const [rawBook, chapter, verse, text] = stmt.get();
      const bookId = isMyBible
        ? MYBIBLE_BOOKS[Number(rawBook)]
        : canon.getBookByOrder(Number(rawBook))?.id;

      if (!bookId) { skipped++; continue; }       // deuterocanon or unknown numbering
      const body = clean(text);
      if (!body) continue;

      const chapters = (books[bookId] ??= []);
      const verses = (chapters[Number(chapter) - 1] ??= []);
      verses[Number(verse) - 1] = body;
      verseCount++;
    }
    stmt.free();

    // Fill gaps so no index is ever undefined at runtime.
    for (const chapters of Object.values(books)) {
      for (let c = 0; c < chapters.length; c++) {
        const verses = (chapters[c] ??= []);
        for (let v = 0; v < verses.length; v++) if (verses[v] == null) verses[v] = '';
      }
    }

    const info = readInfo(db);
    return {
      books,
      verseCount,
      bookCount: Object.keys(books).length,
      skipped,
      sourceFormat: isMyBible ? 'mybible' : 'esword',
      meta: {
        name: info.description || info.title || info.biblename || '',
        abbr: info.abbreviation || info.abbr || '',
        language: info.language || info.lang || '',
      },
    };
  } finally {
    db.close();
  }
}

/** True when a buffer is a SQLite database. */
function isSqlite(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 16 && buffer.subarray(0, 15).toString('utf8') === 'SQLite format 3';
}

module.exports = { readSqliteModule, isSqlite, MYBIBLE_BOOKS, clean };
