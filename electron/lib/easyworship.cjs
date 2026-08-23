'use strict';
/**
 * EasyWorship import.
 *
 * A `.ewsx` schedule is a ZIP holding a SQLite database plus the media the
 * schedule references. EasyWorship does not publish that schema and it has
 * changed between releases, so this reader *discovers* the layout: it looks at
 * every table for recognisable columns rather than hard-coding names that would
 * break on the next version.
 *
 * Everything runs locally. A church's songs and media are their own licensed
 * content and are simply moved, never uploaded or redistributed.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const { rtfToText } = require('./rtf.cjs');
const zipStream = require('./zip-stream.cjs');

/** Column names EasyWorship has used for each field, lowercased. */
const FIELD_HINTS = {
  title: ['title', 'song_title', 'name', 'songtitle'],
  words: ['words', 'lyrics', 'song_words', 'rtf', 'text', 'content', 'slide_text'],
  author: ['author', 'artist', 'writer', 'authors', 'composer'],
  copyright: ['copyright', 'copyright_text'],
  ccli: ['ccli', 'ccli_no', 'ccli_number', 'song_number', 'reference_number'],
  key: ['song_key', 'key', 'music_key'],
  order: ['presentation_order', 'verse_order', 'song_order', 'order'],
  id: ['song_id', 'rowid', 'id', 'songid'],
};

let SQL = null;
async function engine() {
  if (SQL) return SQL;
  const initSqlJs = require('sql.js');
  const wasm = await fsp.readFile(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm'));
  SQL = await initSqlJs({ wasmBinary: wasm });
  return SQL;
}

const isSqlite = (buf) =>
  Buffer.isBuffer(buf) && buf.length > 16 && buf.subarray(0, 15).toString('utf8') === 'SQLite format 3';

/** Firebird databases (EasyWorship 6/7 profiles) need a server; detect to explain. */
const isFirebird = (buf) =>
  Buffer.isBuffer(buf) && buf.length > 32 && buf[0] === 0x01 && buf.subarray(0, 2).toString('hex') === '0139';

function tablesOf(db) {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view')");
  return res.length ? res[0].values.map((r) => String(r[0])) : [];
}

function columnsOf(db, table) {
  try {
    const res = db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
    return res.length ? res[0].values.map((r) => ({ name: String(r[1]), lower: String(r[1]).toLowerCase() })) : [];
  } catch { return []; }
}

/** Map a table's columns onto our field names, where they can be recognised. */
function mapFields(cols) {
  const found = {};
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    const hit = cols.find((c) => hints.includes(c.lower))
      ?? cols.find((c) => hints.some((h) => c.lower.includes(h)));
    if (hit) found[field] = hit.name;
  }
  return found;
}

/**
 * Split decoded lyrics into sections.
 *
 * EasyWorship separates slides with blank lines and sometimes labels them.
 * Anything unlabelled becomes a numbered verse, which is what an operator
 * expects to see in the arrangement strip.
 */
function toSections(text) {
  const blocks = String(text).split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const sections = [];
  let verse = 0;

  for (const block of blocks) {
    const lines = block.split('\n');
    const header = /^\[?\s*((?:pre-?chorus|chorus|verse|bridge|intro|outro|tag|ending|refrain|interlude|vamp)\s*\d*)\s*\]?\s*:?\s*$/i
      .exec(lines[0] ?? '');

    let label;
    let body;
    if (header && lines.length > 1) {
      label = header[1].trim();
      body = lines.slice(1).join('\n').trim();
      // Keep the counter ahead of any number the source already used, or a
      // later unlabelled block reuses it and two sections end up both called
      // "Verse 1" — which breaks the arrangement and the slide captions.
      const numbered = /verse\s*(\d+)/i.exec(label);
      if (numbered) verse = Math.max(verse, Number(numbered[1]));
    } else {
      verse += 1;
      label = `Verse ${verse}`;
      body = block;
    }
    if (!body) continue;

    const type = /chorus/i.test(label) ? (/pre/i.test(label) ? 'prechorus' : 'chorus')
      : /bridge/i.test(label) ? 'bridge'
      : /tag/i.test(label) ? 'tag'
      : /intro/i.test(label) ? 'intro'
      : /outro|ending/i.test(label) ? 'outro'
      : 'verse';

    sections.push({
      id: `s_${Math.random().toString(36).slice(2, 10)}`,
      type,
      number: type === 'verse' ? verse : null,
      label,
      body,
    });
  }
  return sections;
}

/** Pull songs out of whichever table looks like a song table. */
function extractSongs(db) {
  const songs = [];
  const notes = [];

  for (const table of tablesOf(db)) {
    const cols = columnsOf(db, table);
    if (!cols.length) continue;
    const fields = mapFields(cols);
    // A song table must at least have something to show and something to call it.
    if (!fields.words) continue;

    const select = Object.entries(fields)
      .map(([field, col]) => `"${col.replace(/"/g, '""')}" AS ${field}`)
      .join(', ');

    let stmt;
    try { stmt = db.prepare(`SELECT ${select} FROM "${table.replace(/"/g, '""')}"`); }
    catch { continue; }

    let rows = 0;
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const words = row.words == null ? '' : String(row.words);
        const text = rtfToText(words);
        if (!text.trim()) continue;

        const sections = toSections(text);
        if (!sections.length) continue;

        songs.push({
          title: String(row.title ?? '').trim() || `Untitled ${songs.length + 1}`,
          author: String(row.author ?? '').trim(),
          copyright: String(row.copyright ?? '').trim(),
          ccli: row.ccli == null ? '' : String(row.ccli).trim(),
          key: String(row.key ?? '').trim(),
          sections,
          arrangement: sections.map((s) => s.id),
          sourceTable: table,
        });
        rows++;
      }
    } finally { stmt.free(); }

    if (rows) notes.push(`${table}: ${rows} song(s)`);
  }

  return { songs, notes };
}

/**
 * Size beyond which a schedule is read entry-by-entry rather than whole.
 *
 * Node caps a Buffer at 4 GB and the V8 heap sits just above that, so holding a
 * large archive *and* its decompressed contents is not merely slow, it fails.
 * Media is therefore streamed to disk instead of being buffered.
 */
const LARGE_FILE_BYTES = 512 * 1024 * 1024;

/** Node cannot hold a single file larger than this in one Buffer. */
const MAX_BUFFERABLE_BYTES = require('node:buffer').constants.MAX_LENGTH;

/**
 * Check a schedule is readable before trying, so an oversized file produces an
 * explanation rather than an out-of-memory crash mid-service.
 */
async function checkSize(filePath) {
  const { size } = await fsp.stat(filePath);
  // Archives stream from disk, so their own size is no longer a limit. The
  // check remains so the UI can warn that a large import will take a while.
  return { size, large: size >= LARGE_FILE_BYTES };
}

/**
 * Read a `.ewsx` schedule from disk.
 *
 * The database is small enough to hold in memory; media is only listed here and
 * streamed out later, so archive size never has to fit in the heap.
 *
 * @param {string} filePath
 */
async function readEwsxFile(filePath) {
  const entries = await zipStream.listEntries(filePath).catch(() => null);
  if (!entries) throw new Error('That file is not a readable EasyWorship schedule (expected a zip archive).');

  const names = entries.filter((e) => !e.dir).map((e) => e.name);
  const dbName = names.find((n) => /(^|\/)main\.db$/i.test(n)) ?? names.find((n) => /\.db$/i.test(n));
  if (!dbName) throw new Error('No database found inside the schedule.');

  const dbBuf = await zipStream.readEntry(filePath, dbName);
  if (isFirebird(dbBuf)) {
    throw new Error('This schedule holds a Firebird database, which needs EasyWorship itself to read. Re-save it from EasyWorship 7 and try again.');
  }
  if (!isSqlite(dbBuf)) throw new Error('The database inside the schedule is in an unrecognised format.');

  const engineRef = await engine();
  const db = new engineRef.Database(new Uint8Array(dbBuf));
  let result;
  try {
    result = extractSongs(db);
    result.tables = tablesOf(db);
  } finally { db.close(); }

  const media = entries
    .filter((e) => !e.dir && /\.(jpe?g|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv)$/i.test(e.name))
    .map((e) => ({ name: path.basename(e.name), entry: e.name, bytes: e.size }));

  return {
    ok: true,
    format: 'ewsx',
    database: dbName,
    tables: result.tables,
    songs: result.songs,
    media,
    notes: result.notes,
    totalBytes: entries.reduce((n, e) => n + e.size, 0),
  };
}

/**
 * Read a `.ewsx` schedule.
 * @param {Buffer} buffer raw file contents
 */
async function readEwsx(buffer) {
  const JSZip = require('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new Error('That file is not a readable EasyWorship schedule (expected a zip archive).'); }

  const names = Object.keys(zip.files);
  const dbName = names.find((n) => /(^|\/)main\.db$/i.test(n))
    ?? names.find((n) => /\.db$/i.test(n));
  if (!dbName) throw new Error('No database found inside the schedule.');

  const dbBuf = Buffer.from(await zip.files[dbName].async('uint8array'));
  if (isFirebird(dbBuf)) {
    throw new Error('This schedule holds a Firebird database, which needs EasyWorship itself to read. Re-save it from EasyWorship 7 and try again.');
  }
  if (!isSqlite(dbBuf)) throw new Error('The database inside the schedule is in an unrecognised format.');

  const engineRef = await engine();
  const db = new engineRef.Database(new Uint8Array(dbBuf));
  let result;
  try {
    result = extractSongs(db);
    result.tables = tablesOf(db);
  } finally { db.close(); }

  // Media travelling with the schedule, so backgrounds come across too.
  const media = names
    .filter((n) => !zip.files[n].dir && /\.(jpe?g|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv)$/i.test(n))
    .map((n) => ({ name: path.basename(n), entry: n }));

  return {
    ok: true,
    format: 'ewsx',
    database: dbName,
    tables: result.tables,
    songs: result.songs,
    media,
    notes: result.notes,
  };
}

/** Extract one media entry from a schedule, for writing to the media library. */
async function extractMedia(buffer, entry) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.files[entry];
  if (!file) throw new Error(`"${entry}" is not in this schedule.`);
  return Buffer.from(await file.async('uint8array'));
}

/**
 * Write one entry from a schedule straight to disk.
 *
 * Streaming keeps peak memory at the size of a chunk rather than the size of
 * the file, so a schedule carrying a 2 GB video costs megabytes to import
 * instead of failing outright.
 *
 * @param {import('jszip')} zip an already-loaded archive
 * @param {string} entry
 * @param {string} dest
 * @returns {Promise<number>} bytes written
 */
async function streamEntryToFile(filePath, entry, dest, onProgress = null) {
  return zipStream.extractToFile(filePath, entry, dest, onProgress);
}

module.exports = {
  readEwsx, readEwsxFile, extractMedia, streamEntryToFile, checkSize,
  rtfToText, toSections, isSqlite, isFirebird,
  LARGE_FILE_BYTES, MAX_BUFFERABLE_BYTES,
};
