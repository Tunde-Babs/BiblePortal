'use strict';
/**
 * PowerPoint (.pptx) import.
 *
 * A .pptx is a ZIP of XML parts. This pulls out what a church actually needs
 * from an announcement deck — the text of each slide, in reading order, plus
 * any images — and hands it to BiblePortal's own renderer so it picks up the
 * service theme.
 *
 * It is deliberately NOT a PowerPoint renderer. Shape geometry, transitions,
 * SmartArt, charts and animations are not reproduced; a deck that depends on
 * those should be exported to images from PowerPoint and imported as media.
 * Pretending otherwise would put a broken approximation on the screen, which is
 * worse than saying plainly what is supported.
 */

const path = require('node:path');

/** Decode the XML entities PowerPoint emits. */
const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** Sort slideN.xml by N, since ZIP order is not slide order. */
function slideNumber(name) {
  const m = /slide(\d+)\.xml$/i.exec(name);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Extract the text of one slide, preserving paragraph structure.
 *
 * Each <a:p> is a paragraph; each <a:t> inside it is a run of text. Runs must
 * be joined without separators (PowerPoint splits mid-word on formatting
 * changes) while paragraphs become separate lines.
 */
function slideText(xml) {
  const paragraphs = [];
  for (const p of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const runs = [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]));
    // A <a:br/> inside a paragraph is a hard line break.
    const text = runs.join('').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

/** Speaker notes travel in a separate part and are useful on the stage display. */
function notesFor(zip, slideName) {
  const n = slideNumber(slideName);
  const notesPart = `ppt/notesSlides/notesSlide${n}.xml`;
  return zip.files[notesPart] ? notesPart : null;
}

/**
 * Read a .pptx.
 * @param {Buffer} buffer
 * @returns {Promise<{slides:{index:number,title:string,lines:string[],notes:string,images:string[]}[], images:{entry:string,name:string}[]}>}
 */
async function readPptx(buffer) {
  const JSZip = require('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new Error('That file is not a readable PowerPoint file (expected a .pptx archive).'); }

  const names = Object.keys(zip.files);
  if (!names.some((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))) {
    // .ppt (pre-2007) is a binary format entirely unlike this one.
    throw new Error('No slides found. If this is an older .ppt file, re-save it as .pptx in PowerPoint first.');
  }

  const slideNames = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides = [];
  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i];
    const xml = await zip.files[name].async('string');
    const lines = slideText(xml);

    // Images this slide references, resolved through its relationships part.
    const relName = `ppt/slides/_rels/${path.basename(name)}.rels`;
    const images = [];
    if (zip.files[relName]) {
      const rels = await zip.files[relName].async('string');
      for (const r of rels.matchAll(/Target="([^"]+\.(?:png|jpe?g|gif|bmp|webp|emf|wmf))"/gi)) {
        const target = r[1].replace(/^\.\.\//, 'ppt/');
        if (zip.files[target]) images.push(target);
      }
    }

    let notes = '';
    const notesPart = notesFor(zip, name);
    if (notesPart) {
      notes = slideText(await zip.files[notesPart].async('string'))
        // PowerPoint appends the slide number as its own paragraph.
        .filter((l) => !/^\d+$/.test(l))
        .join('\n');
    }

    slides.push({
      index: i + 1,
      // The first paragraph is the title in almost every real deck.
      title: lines[0] ?? `Slide ${i + 1}`,
      lines,
      notes,
      images,
    });
  }

  const images = names
    .filter((n) => /^ppt\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(n))
    .map((n) => ({ entry: n, name: path.basename(n) }));

  return { slides, images, slideCount: slides.length };
}

/** Pull one image out, for copying into the media library. */
async function extractImage(buffer, entry) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.files[entry];
  if (!file) throw new Error(`"${entry}" is not in this presentation.`);
  return Buffer.from(await file.async('uint8array'));
}

module.exports = { readPptx, extractImage, slideText, decode };
