'use strict';
/**
 * Splitting continuous prose into readable slides.
 *
 * Some translations are paragraphed rather than versified — The Message is the
 * common case — so a passage arrives as one block with no verse divisions. Left
 * alone that becomes a single slide holding the whole reading, which the
 * auto-fit then shrinks toward illegibility.
 *
 * Splitting on sentence boundaries keeps each slide readable without inventing
 * verse numbers the translation does not have. Sentences are never broken
 * mid-way; a single sentence longer than the target simply gets its own slide.
 */

/** Roughly what fits comfortably at projection size on four lines. */
const TARGET_CHARS = 240;

/** Fragments that end in one of these are abbreviations, not sentence ends. */
const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|St|Rev|vs|etc|i\.e|e\.g|cf)\.$/i;

/**
 * Break text into sentences, keeping terminal punctuation attached.
 * Deliberately conservative: a slightly long slide beats a severed sentence.
 */
function toSentences(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const out = [];
  let current = '';

  for (const part of clean.split(/(?<=[.!?…])["'’”]?\s+/)) {
    const piece = part.trim();
    if (!piece) continue;
    if (current && ABBREVIATIONS.test(current)) {
      current = `${current} ${piece}`;
      continue;
    }
    if (current) out.push(current);
    current = piece;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Group prose into slide-sized chunks on sentence boundaries.
 * @param {string} text
 * @param {number} targetChars soft ceiling; a lone long sentence may exceed it
 */
function chunkProse(text, targetChars = TARGET_CHARS) {
  const sentences = toSentences(text);
  if (!sentences.length) return [];

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (!current) { current = sentence; continue; }
    if (`${current} ${sentence}`.length <= targetChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Wrap a chunk onto display lines without breaking words. */
function toLines(chunk, maxLines = 4) {
  const words = String(chunk ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const perLine = Math.ceil(words.length / maxLines);
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) {
    lines.push(words.slice(i, i + perLine).join(' '));
  }
  return lines;
}

module.exports = { toSentences, chunkProse, toLines, TARGET_CHARS };
