/**
 * Input files the suite imports.
 *
 * These are generated rather than committed. A song file or a PowerPoint deck
 * checked into the repository drifts out of sync with the parser it is meant to
 * exercise, and nobody notices until it silently stops covering anything. Built
 * here, every run imports a deck whose structure this file states plainly.
 *
 * Every lyric here is neutral placeholder text, per CONTRIBUTING: worship lyrics
 * are licensed to the local church, so none may be committed — not even as a
 * fixture, and not even for a hymn that looks old enough to be safe.
 *
 * Written once by global setup; every spec reads them.
 */

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';

import { FIXTURE_DIR } from './paths';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

/** Everything the suite can import, by absolute path. */
export const files = {
  chordpro: path.join(FIXTURE_DIR, 'alpha-hymn.cho'),
  plainText: path.join(FIXTURE_DIR, 'delta-song.txt'),
  openLyrics: path.join(FIXTURE_DIR, 'epsilon-song.xml'),
  background: path.join(FIXTURE_DIR, 'background.png'),
  /** Deliberately awkward name — spaces, '#' and '&' broke media loading once. */
  awkwardMedia: path.join(FIXTURE_DIR, 'loop shot #1 & more.png'),
  deck: path.join(FIXTURE_DIR, 'announcements.pptx'),
  /** Spoken scripture reference, 16 kHz mono PCM. macOS only. */
  spokenReference: path.join(FIXTURE_DIR, 'spoken-reference.wav'),
};

/** What the generated song files contain, so specs can assert without guessing. */
export const expected = {
  chordpro: {
    title: 'Alpha Hymn',
    author: 'Placeholder Author',
    key: 'G',
    sectionCount: 3,
    firstLine: 'Alpha line one of this test song',
  },
  plainText: {
    title: 'Delta Song',
    sectionCount: 2,
  },
  openLyrics: {
    title: 'Epsilon Song',
    sectionCount: 2,
  },
  deck: {
    slideCount: 3,
    titles: ['Welcome', 'Notices', 'Next Sunday'],
    noteOnFirstSlide: 'Hold this slide until the band is ready.',
  },
  spoken: {
    phrase: 'turn with me to romans chapter eight verse twenty eight',
    reference: 'Romans 8:28',
  },
};

export async function buildFixtureFiles(): Promise<{ audio: boolean }> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  await writeFile(files.chordpro, CHORDPRO, 'utf8');
  await writeFile(files.plainText, PLAIN_TEXT, 'utf8');
  await writeFile(files.openLyrics, OPENLYRICS, 'utf8');

  const png = solidPng(320, 180, [26, 34, 64]);
  await writeFile(files.background, png);
  await writeFile(files.awkwardMedia, png);

  await writeFile(files.deck, await buildPptx());

  const audio = await buildSpokenAudio();
  return { audio };
}

// ------------------------------------------------------------------- songs

const CHORDPRO = `{title: Alpha Hymn}
{artist: Placeholder Author}
{key: G}
{ccli: 1234567}

{start_of_verse: Verse 1}
[G]Alpha line one of [C]this test [G]song
Alpha line two follows [D]here
{end_of_verse}

{start_of_chorus}
[G]Beta chorus line [C]number [G]one
Beta chorus line two [D]here
{end_of_chorus}

{start_of_verse: Verse 2}
[G]Gamma line one of [C]this test [G]song
Gamma line two follows [D]here
{end_of_verse}
`;

const PLAIN_TEXT = `Delta Song

Verse 1
Delta verse line one for the importer
Delta verse line two for the importer

Chorus
Delta chorus line one for the importer
Delta chorus line two for the importer
`;

const OPENLYRICS = `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8">
  <properties>
    <titles><title>Epsilon Song</title></titles>
    <authors><author>Placeholder Author</author></authors>
    <songbooks><songbook name="Hymnal" entry="415"/></songbooks>
  </properties>
  <lyrics>
    <verse name="v1">
      <lines>Epsilon verse one line one<br/>Epsilon verse one line two</lines>
    </verse>
    <verse name="v2">
      <lines>Epsilon verse two line one<br/>Epsilon verse two line two</lines>
    </verse>
  </lyrics>
</song>
`;

// -------------------------------------------------------------------- png

/**
 * A real PNG, built rather than pasted as base64 so its size and colour are
 * readable here. Truecolour, no alpha, one solid fill.
 */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const at = rowStart + 1 + x * 3;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------- pptx

/**
 * A minimal but genuine .pptx.
 *
 * electron/lib/pptx.cjs reads `ppt/slides/slideN.xml` and pulls text out of
 * `<a:p>` / `<a:t>` runs, with speaker notes from the matching notesSlide. This
 * builds exactly that shape — enough for the importer to be tested honestly,
 * without pretending to be everything PowerPoint writes.
 */
async function buildPptx(): Promise<Buffer> {
  const JSZip = require('jszip');
  const zip = new JSZip();

  const slide = (title: string, bullets: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>${title}</a:t></a:r></a:p>
${bullets.map((b) => `      <a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join('\n')}
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;

  const notes = (text: string) => `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>${text}</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');

  zip.file('ppt/slides/slide1.xml', slide(expected.deck.titles[0], ['We are glad you are here']));
  zip.file('ppt/slides/slide2.xml', slide(expected.deck.titles[1], ['Prayer meeting Wednesday', 'Youth group Friday']));
  zip.file('ppt/slides/slide3.xml', slide(expected.deck.titles[2], ['Guest speaker at both services']));

  zip.file('ppt/notesSlides/notesSlide1.xml', notes(expected.deck.noteOnFirstSlide));

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ------------------------------------------------------------------ audio

/**
 * Speech for the Whisper suite, synthesised with macOS `say`.
 *
 * Chromium's fake capture device needs 16-bit PCM, which `LEI16@16000` gives
 * directly — the same rate the app resamples to, so nothing is guessing.
 * Returns false where `say` does not exist; the speech specs skip themselves
 * rather than fail on a platform that cannot produce the input.
 */
async function buildSpokenAudio(): Promise<boolean> {
  try {
    await stat('/usr/bin/say');
  } catch {
    return false;
  }

  try {
    await run('/usr/bin/say', [
      '-o', files.spokenReference,
      '--data-format=LEI16@16000',
      expected.spoken.phrase,
    ]);
    await canonicaliseWav(files.spokenReference);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrite a WAV with only the `fmt ` and `data` chunks.
 *
 * `say` emits a valid file, but pads it with Apple's `JUNK` and `FLLR`
 * alignment chunks. Chromium's fake capture device uses a deliberately minimal
 * WAV parser that rejects those, and then reports the misleading "Failed to
 * read ... as input to the fake device. Try disabling the sandbox with
 * --no-sandbox" — which sends you chasing a permissions problem that does not
 * exist. Stripping the padding is the actual fix.
 */
async function canonicaliseWav(file: string): Promise<void> {
  const buf = await readFile(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return;

  let fmt: Buffer | null = null;
  let data: Buffer | null = null;

  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + size);
    if (id === 'fmt ') fmt = body;
    else if (id === 'data') data = body;
    // Chunks are word-aligned: an odd size carries a trailing pad byte.
    at += 8 + size + (size % 2);
  }

  if (!fmt || !data) return;

  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + (8 + fmt.length) + (8 + data.length), 4);
  header.write('WAVE', 8, 'ascii');

  const chunkOf = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  };

  await writeFile(file, Buffer.concat([header, chunkOf('fmt ', fmt), chunkOf('data', data)]));
}
