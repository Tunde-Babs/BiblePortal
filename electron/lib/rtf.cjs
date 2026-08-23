'use strict';
/**
 * RTF to plain text.
 *
 * EasyWorship stores song words as RTF, so importing a library means decoding
 * it. This is not a general RTF renderer — it extracts the text and the line
 * breaks, which is all a lyric slide needs, and deliberately discards
 * formatting rather than trying to map it onto themes.
 */

/** Control words that produce a line break. */
const BREAKS = new Set(['par', 'line', 'sect', 'page', 'column']);

/**
 * Destination groups whose contents are metadata, not text. Their entire
 * group is skipped — emitting a font table as lyrics is a classic RTF bug.
 */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'generator', 'listtable',
  'listoverridetable', 'rsidtbl', 'xmlnstbl', 'filetbl', 'header', 'footer',
  'footnote', 'annotation', 'nonshppict', 'shppict', 'shpinst', 'bkmkstart', 'bkmkend',
]);

/**
 * Decode an RTF document to plain text.
 * @param {string} rtf
 * @returns {string}
 */
function rtfToText(rtf) {
  const src = String(rtf ?? '');
  if (!src.includes('\\rtf') && !src.startsWith('{\\')) return src.trim(); // already plain

  let out = '';
  let i = 0;
  /** Depth at which we started skipping a destination group, or -1. */
  let skipDepth = -1;
  let depth = 0;
  /** Characters to swallow after a \uN escape (the ANSI fallback). */
  let skipChars = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '{') { depth++; i++; continue; }

    if (ch === '}') {
      depth--;
      if (skipDepth >= 0 && depth < skipDepth) skipDepth = -1;
      i++;
      continue;
    }

    if (ch === '\\') {
      // Escaped literal characters.
      const next = src[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDepth < 0) out += next;
        i += 2;
        continue;
      }
      // Hex escape: \'xx
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (skipDepth < 0 && !skipChars) {
          const code = parseInt(hex, 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
        }
        if (skipChars) skipChars--;
        i += 4;
        continue;
      }

      // Control word: \word, optional minus, optional digits, optional space.
      const m = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(src.slice(i));
      if (!m) { i++; continue; }

      const word = m[1];
      const param = m[2] != null ? Number(m[2]) : null;
      i += m[0].length;

      // A destination we do not want any text from.
      if (SKIP_DESTINATIONS.has(word)) { if (skipDepth < 0) skipDepth = depth; continue; }
      if (skipDepth >= 0) continue;

      if (BREAKS.has(word)) { out += '\n'; continue; }
      if (word === 'tab') { out += '\t'; continue; }
      if (word === 'u' && param != null) {
        // Unicode escape; a following fallback character must be swallowed.
        out += String.fromCharCode(param < 0 ? param + 65536 : param);
        skipChars = 1;
        continue;
      }
      if (word === 'uc' && param != null) { skipChars = 0; continue; }
      // Every other control word is formatting we intentionally drop.
      continue;
    }

    // Ignore an ignorable-destination marker.
    if (ch === '*' && src[i - 1] === '\\') { i++; continue; }

    if (skipDepth < 0) {
      if (skipChars && ch !== '\n' && ch !== '\r') { skipChars--; i++; continue; }
      if (ch !== '\r' && ch !== '\n') out += ch;
    }
    i++;
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trimEnd()).join('\n')
    .trim();
}

module.exports = { rtfToText };
