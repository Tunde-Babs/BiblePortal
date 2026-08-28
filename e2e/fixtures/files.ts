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

import { mkdir, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';

import { FIXTURE_DIR } from './paths';

const require = createRequire(import.meta.url);

/** Everything the suite can import, by absolute path. */
export const files = {
  chordpro: path.join(FIXTURE_DIR, 'alpha-hymn.cho'),
  plainText: path.join(FIXTURE_DIR, 'delta-song.txt'),
  openLyrics: path.join(FIXTURE_DIR, 'epsilon-song.xml'),
  background: path.join(FIXTURE_DIR, 'background.png'),
  /** Deliberately awkward name — spaces, '#' and '&' broke media loading once. */
  awkwardMedia: path.join(FIXTURE_DIR, 'loop shot #1 & more.png'),
  deck: path.join(FIXTURE_DIR, 'announcements.pptx'),
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
};

export async function buildFixtureFiles(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  await writeFile(files.chordpro, CHORDPRO, 'utf8');
  await writeFile(files.plainText, PLAIN_TEXT, 'utf8');
  await writeFile(files.openLyrics, OPENLYRICS, 'utf8');

  const png = solidPng(320, 180, [26, 34, 64]);
  await writeFile(files.background, png);
  await writeFile(files.awkwardMedia, png);

  await writeFile(files.deck, await buildPptx());
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
