'use strict';
/**
 * Random-access, streaming reads from a zip file.
 *
 * The obvious approach — read the whole archive into a Buffer and hand it to a
 * zip library — caps out hard: Node cannot hold more than 4 GB in one Buffer,
 * and a church schedule carrying HD video reaches that easily. Worse, the
 * failure is an out-of-memory crash rather than a message.
 *
 * yauzl reads the central directory through a file descriptor and decompresses
 * one entry at a time, so peak memory tracks the chunk size rather than the
 * archive. That makes a multi-gigabyte schedule ordinary rather than fatal.
 */

const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

/** Open an archive, yielding a yauzl handle. */
function open(filePath) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(new Error(`Could not read the archive: ${err.message}`));
      else resolve(zip);
    });
  });
}

/**
 * List every entry without decompressing anything.
 * @returns {Promise<{name:string, size:number, compressedSize:number, dir:boolean}[]>}
 */
async function listEntries(filePath) {
  const zip = await open(filePath);
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on('entry', (entry) => {
      entries.push({
        name: entry.fileName,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        dir: /\/$/.test(entry.fileName),
      });
      zip.readEntry();
    });
    zip.on('end', () => { zip.close(); resolve(entries); });
    zip.on('error', (err) => { zip.close(); reject(err); });
    zip.readEntry();
  });
}

/** Locate one entry by name, leaving the archive positioned on it. */
function findEntry(zip, name) {
  return new Promise((resolve, reject) => {
    let found = false;
    const onEntry = (entry) => {
      if (entry.fileName === name) {
        found = true;
        cleanup();
        resolve(entry);
        return;
      }
      zip.readEntry();
    };
    const onEnd = () => {
      cleanup();
      if (!found) reject(new Error(`"${name}" is not in this archive.`));
    };
    const onError = (err) => { cleanup(); reject(err); };
    const cleanup = () => {
      zip.removeListener('entry', onEntry);
      zip.removeListener('end', onEnd);
      zip.removeListener('error', onError);
    };
    zip.on('entry', onEntry);
    zip.on('end', onEnd);
    zip.on('error', onError);
    zip.readEntry();
  });
}

/** A readable stream for one entry. */
function entryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) reject(err); else resolve(stream);
    });
  });
}

/**
 * Copy one entry straight to disk.
 *
 * Peak memory is one chunk, so archive size stops mattering.
 * @returns {Promise<number>} bytes written
 */
async function extractToFile(filePath, entryName, dest, onProgress = null) {
  const zip = await open(filePath);
  try {
    const entry = await findEntry(zip, entryName);
    const source = await entryStream(zip, entry);

    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        onProgress?.(bytes, entry.uncompressedSize);
        cb(null, chunk);
      },
    });

    await pipeline(source, counter, fs.createWriteStream(dest));
    return bytes;
  } finally {
    zip.close();
  }
}

/**
 * Read one entry into memory. Only for small parts — a database or an XML
 * document — never for media.
 * @param {number} maxBytes refuse anything larger, rather than risk the heap
 */
async function readEntry(filePath, entryName, maxBytes = 256 * 1024 * 1024) {
  const zip = await open(filePath);
  try {
    const entry = await findEntry(zip, entryName);
    if (entry.uncompressedSize > maxBytes) {
      throw new Error(
        `"${entryName}" is ${(entry.uncompressedSize / 1048576).toFixed(0)} MB, too large to read into memory.`,
      );
    }
    const source = await entryStream(zip, entry);
    const chunks = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    zip.close();
  }
}

module.exports = { open, listEntries, findEntry, entryStream, extractToFile, readEntry };
