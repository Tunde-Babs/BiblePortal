'use strict';
/**
 * Reader for Paradox database tables.
 *
 * EasyWorship stores its song library in Borland Paradox tables — a format from
 * the early 1990s with no public specification. A church moving off EasyWorship
 * has no export path (the application offers none for songs), so reading these
 * files directly is the only way to recover a library that may hold thousands
 * of songs the church wrote or licensed itself.
 *
 * Layout, established by decoding a real table and checking the arithmetic:
 *
 *   header    fixed fields, then one 2-byte descriptor per field (type, size),
 *             then a table-name pointer and one pointer per field, then the
 *             NUL-terminated names themselves.
 *   data      blocks of `maxTableSize * 1024` bytes from `headerSize`, each
 *             starting with a 6-byte block header whose third word gives the
 *             bytes of record data present.
 *   memos     long text lives in a sibling .MB file; the record holds a leading
 *             inline fragment followed by an offset/length pair.
 *
 * The reader validates itself: the field sizes must sum to the declared record
 * size, and a table failing that is rejected rather than silently misread.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Paradox field type codes. */
const TYPES = {
  1: 'alpha', 2: 'date', 3: 'short', 4: 'long', 5: 'currency', 6: 'number',
  9: 'logical', 0x0C: 'memo', 0x0D: 'blob', 0x0E: 'fmtMemo', 0x10: 'graphic',
  0x14: 'time', 0x15: 'timestamp', 0x16: 'autoInc', 0x18: 'bcd', 0x19: 'bytes',
};

/** Types whose value lives in a sibling .MB file. */
const MEMO_TYPES = new Set(['memo', 'fmtMemo', 'blob', 'graphic']);

/** Read the header: field descriptors and names. */
function readHeader(buf) {
  if (buf.length < 0x80) throw new Error('Too small to be a Paradox table.');

  const recordSize = buf.readUInt16LE(0x00);
  const headerSize = buf.readUInt16LE(0x02);
  const fileType = buf.readUInt8(0x04);
  const maxTableSize = buf.readUInt8(0x05);
  const numRecords = buf.readUInt32LE(0x06);
  const numFields = buf.readUInt16LE(0x21);

  if (!recordSize || !headerSize || !numFields || numFields > 255) {
    throw new Error('Header values are out of range — this is not a Paradox table.');
  }

  const fields = [];
  let offset = 0;
  for (let i = 0, off = 0x78; i < numFields; i++, off += 2) {
    const type = buf.readUInt8(off);
    const size = buf.readUInt8(off + 1);
    fields.push({ index: i, type: TYPES[type] ?? `type${type}`, rawType: type, size, offset });
    offset += size;
  }

  // The sizes must account for exactly one record. If they do not, the layout
  // was misread and every value after that point would be garbage.
  if (offset !== recordSize) {
    throw new Error(`Field sizes total ${offset} but a record is ${recordSize} bytes — layout not understood.`);
  }

  // Names follow the pointer table; the table name is NUL-padded to a fixed width.
  let p = 0x78 + numFields * 2 + 4 + numFields * 4;
  const readStr = () => {
    const end = buf.indexOf(0x00, p);
    if (end < 0 || end > headerSize) return '';
    const s = buf.toString('latin1', p, end);
    p = end + 1;
    return s;
  };
  const tableName = readStr();
  while (p < headerSize && buf[p] === 0x00) p++;
  for (let i = 0; i < numFields && p < headerSize; i++) {
    fields[i].name = readStr() || `field${i}`;
  }

  return { recordSize, headerSize, fileType, maxTableSize, numRecords, numFields, tableName, fields };
}

/** Trim the NUL and space padding Paradox uses on fixed-width text. */
function cleanAlpha(buf) {
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0x00 || buf[end - 1] === 0x20)) end--;
  return buf.toString('latin1', 0, end).trim();
}

/**
 * Paradox stores signed numbers with the high bit flipped so that a plain byte
 * comparison sorts correctly. Undo that before reading the value.
 */
function readLong(buf, at) {
  const v = buf.readUInt32BE(at);
  return v & 0x80000000 ? v ^ 0x80000000 : v - 0x80000000;
}

function readShort(buf, at) {
  const v = buf.readUInt16BE(at);
  return v & 0x8000 ? v ^ 0x8000 : v - 0x8000;
}

/**
 * Decode one field from a record.
 * A field of all-zero bytes is Paradox's NULL and reads as null.
 */
function readField(record, field, memo) {
  const slice = record.subarray(field.offset, field.offset + field.size);
  if (slice.every((b) => b === 0)) return null;

  switch (field.type) {
    case 'alpha':
      return cleanAlpha(slice);
    case 'short':
      return readShort(slice, 0);
    case 'long':
    case 'autoInc':
      return readLong(slice, 0);
    case 'logical':
      return slice[0] === 0x81;
    case 'memo':
    case 'fmtMemo':
      return memo ? memo.read(slice, field) : null;
    case 'blob':
    case 'graphic':
      return null;                       // binary payloads are not migrated
    default:
      return cleanAlpha(slice);
  }
}

/**
 * Reader for the sibling .MB file that holds long text.
 *
 * A memo field carries a leading inline fragment, then an offset into the .MB
 * file and the total length. Short values sit entirely inline.
 */
class MemoFile {
  constructor(buffer) { this.buf = buffer; }

  static async open(dbPath) {
    for (const ext of ['.MB', '.mb']) {
      const candidate = dbPath.replace(/\.db$/i, ext);
      try { return new MemoFile(await fsp.readFile(candidate)); }
      catch { /* try the next casing */ }
    }
    return null;
  }

  read(slice, field) {
    // The last 10 bytes are the reference; everything before is inline text.
    const inlineLen = Math.max(0, field.size - 10);
    const ref = slice.subarray(inlineLen);
    if (ref.length < 8) return cleanAlpha(slice);

    const offset = ref.readUInt32LE(0);
    const length = ref.readUInt32LE(4);

    // No pointer, or a nonsensical one: the value is whatever sits inline.
    if (!offset || !length || offset >= this.buf.length) {
      return cleanAlpha(slice.subarray(0, inlineLen));
    }

    // The pointer addresses a block; the low byte indexes within it.
    const blockStart = offset & ~0xff;
    const index = offset & 0xff;
    if (blockStart >= this.buf.length) return cleanAlpha(slice.subarray(0, inlineLen));

    const blockType = this.buf[blockStart];
    let start;
    if (blockType === 0x02) {
      // A block holding one large value. The payload begins 9 bytes in —
      // established by locating where documents actually start in a real file,
      // not from a specification, since none is published.
      start = blockStart + 9;
    } else if (blockType === 0x03) {
      // A block of several values; a 5-byte descriptor per slot from 12.
      const desc = blockStart + 12 + index * 5;
      if (desc + 3 > this.buf.length) return cleanAlpha(slice.subarray(0, inlineLen));
      start = blockStart + this.buf[desc] * 16;
    } else {
      return cleanAlpha(slice.subarray(0, inlineLen));
    }

    const end = Math.min(start + length, this.buf.length);
    if (start < 0 || start >= end) return cleanAlpha(slice.subarray(0, inlineLen));
    return cleanAlpha(this.buf.subarray(start, end));
  }
}

/**
 * Read every record from a Paradox table.
 *
 * @param {string} filePath  path to the .DB file
 * @param {{onProgress?:(done:number,total:number)=>void, limit?:number}} opts
 * @returns {Promise<{table:string, fields:object[], rows:object[]}>}
 */
async function readTable(filePath, opts = {}) {
  const buf = await fsp.readFile(filePath);
  const head = readHeader(buf);
  const memo = await MemoFile.open(filePath);

  const blockSize = (head.maxTableSize || 1) * 1024;
  const rows = [];
  const limit = opts.limit ?? Infinity;

  for (let blockStart = head.headerSize; blockStart + 6 <= buf.length; blockStart += blockSize) {
    // Third word of the block header: bytes of record data present, less one
    // record. A negative value marks an unused block.
    const addDataSize = buf.readInt16LE(blockStart + 4);
    if (addDataSize < 0) continue;

    const count = Math.floor(addDataSize / head.recordSize) + 1;
    for (let i = 0; i < count && rows.length < limit; i++) {
      const start = blockStart + 6 + i * head.recordSize;
      if (start + head.recordSize > buf.length) break;
      const record = buf.subarray(start, start + head.recordSize);

      const row = {};
      for (const field of head.fields) {
        if (field.type === 'blob' || field.type === 'graphic') continue;
        row[field.name] = readField(record, field, memo);
      }
      rows.push(row);
    }
    opts.onProgress?.(rows.length, head.numRecords);
    if (rows.length >= limit) break;
  }

  return { table: head.tableName, fields: head.fields, rows, declared: head.numRecords };
}

/** Read only the header, for inspecting a table before committing to it. */
async function inspect(filePath) {
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    await fd.read(buf, 0, 4096, 0);
    const head = readHeader(buf);
    const stat = await fd.stat();
    const memoPath = filePath.replace(/\.db$/i, '.MB');
    const memoBytes = fs.existsSync(memoPath) ? (await fsp.stat(memoPath)).size : 0;
    return {
      table: head.tableName,
      records: head.numRecords,
      recordSize: head.recordSize,
      fields: head.fields.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      bytes: stat.size,
      memoBytes,
      file: path.basename(filePath),
    };
  } finally { await fd.close(); }
}

module.exports = { readTable, inspect, readHeader, TYPES, MEMO_TYPES };
