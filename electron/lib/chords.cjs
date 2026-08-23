'use strict';
/**
 * Chord parsing and transposition.
 *
 * Understands the chord vocabulary worship teams actually write: slash bass
 * ("G/B"), extensions ("Cmaj7", "Asus4", "F#m7b5"), and both sharp and flat
 * spellings — and it picks the spelling that matches the destination key rather
 * than blindly emitting sharps.
 */

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Pitch class for a root note name, or null when it isn't a note. */
const PITCH = (() => {
  const m = new Map();
  SHARP.forEach((n, i) => m.set(n, i));
  FLAT.forEach((n, i) => m.set(n, i));
  // Enharmonic spellings that show up in real charts.
  Object.entries({ 'E#': 5, 'B#': 0, 'Fb': 4, 'Cb': 11, 'G##': 9, 'A##': 11 }).forEach(([k, v]) => m.set(k, v));
  return m;
})();

/** Keys conventionally written with flats. */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

const CHORD_RE = /^([A-G](?:#{1,2}|b{1,2})?)(.*)$/;

function pitchOf(note) {
  return PITCH.has(note) ? PITCH.get(note) : null;
}

/** Should the output use flats? Driven by the destination key. */
function prefersFlats(key) {
  if (!key) return false;
  const k = String(key).trim();
  return FLAT_KEYS.has(k) || /b/.test(k.replace(/^[A-G]/, '') ? k[1] ?? '' : '');
}

function spell(pitch, useFlats) {
  const table = useFlats ? FLAT : SHARP;
  return table[((pitch % 12) + 12) % 12];
}

/**
 * Transpose a single chord symbol by `semitones`.
 * Non-chords (like "N.C." or a lyric fragment) are returned untouched.
 */
function transposeChord(chord, semitones, targetKey) {
  const raw = String(chord).trim();
  if (!raw) return chord;

  // Slash chords: transpose both halves.
  const slash = raw.split('/');
  const useFlats = prefersFlats(targetKey);

  const out = slash.map((part) => {
    const m = CHORD_RE.exec(part);
    if (!m) return part;
    const pitch = pitchOf(m[1]);
    if (pitch === null) return part;
    return spell(pitch + semitones, useFlats) + m[2];
  });

  // A chord symbol counts as transposable when any segment parsed as a note.
  // This admits a bare bass marking like "/G", which charts do use, while still
  // returning plain text untouched.
  const anyParsed = slash.some((part) => {
    const m = CHORD_RE.exec(part);
    return m != null && pitchOf(m[1]) !== null;
  });
  return anyParsed ? out.join('/') : raw;
}

/** Semitone distance from one key to another (always the shortest sensible path). */
function interval(fromKey, toKey) {
  const from = pitchOf(String(fromKey).replace(/m$/, '').trim());
  const to = pitchOf(String(toKey).replace(/m$/, '').trim());
  if (from === null || to === null) return 0;
  return ((to - from) % 12 + 12) % 12;
}

/** Transpose every [chord] in a ChordPro body. */
function transposeBody(body, semitones, targetKey) {
  return String(body).replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, semitones, targetKey)}]`);
}

/**
 * Conventional key-signature spelling by pitch class. These are the names
 * musicians actually write on a chart, not raw sharp/flat table lookups.
 */
const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEY_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** All twelve keys, conventionally spelled, starting from a given key. */
function keyWheel(fromKey) {
  const raw = String(fromKey || 'C').trim();
  const minor = /m$/.test(raw) && !/maj/i.test(raw);
  const base = pitchOf(raw.replace(/m$/, '').trim()) ?? 0;
  const table = minor ? MINOR_KEY_NAMES : KEY_NAMES;
  return Array.from({ length: 12 }, (_, i) => ({
    semitones: i,
    key: table[(base + i) % 12],
  }));
}

/**
 * Split a ChordPro line into ordered segments so the UI can render chords
 * above their syllable rather than inline.
 * @returns {{chord:string|null, lyric:string}[]}
 */
function splitChordLine(line) {
  const segments = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let pending = null;
  let m;
  while ((m = re.exec(line)) !== null) {
    const lyric = line.slice(last, m.index);
    if (pending !== null || lyric) segments.push({ chord: pending, lyric });
    pending = m[1];
    last = m.index + m[0].length;
  }
  const tail = line.slice(last);
  if (pending !== null || tail) segments.push({ chord: pending, lyric: tail });
  return segments.length ? segments : [{ chord: null, lyric: line }];
}

/** Detect the key from the first chord in a body, when no {key:} was given. */
function detectKey(body) {
  const m = /\[([A-G](?:#|b)?(?:m(?!aj))?)/.exec(String(body));
  return m ? m[1] : null;
}

module.exports = {
  SHARP, FLAT, KEY_NAMES, MINOR_KEY_NAMES, transposeChord, transposeBody, interval, keyWheel,
  splitChordLine, detectKey, pitchOf, prefersFlats,
};
