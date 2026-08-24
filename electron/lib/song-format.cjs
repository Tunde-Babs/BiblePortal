'use strict';
/**
 * Song import/export.
 *
 * BiblePortal ships with an empty song library by design: worship lyrics are
 * almost always under copyright or a CCLI licence held by the local church, so
 * the app imports what the user already owns rather than redistributing
 * anything. These parsers cover the formats those libraries come in.
 *
 *   • ChordPro / OnSong   (.cho .crd .chopro .pro .txt)
 *   • OpenLyrics 0.8/0.9  (.xml)  — OpenLP, SongBeamer, ProPresenter exports
 *   • Plain text          (.txt)  — section headers detected heuristically
 */

const chords = require('./chords.cjs');

/** Canonical section types and the labels that map onto them. */
const SECTION_TYPES = {
  intro: 'Intro', verse: 'Verse', prechorus: 'Pre-Chorus', chorus: 'Chorus',
  bridge: 'Bridge', tag: 'Tag', outro: 'Outro', interlude: 'Interlude',
  ending: 'Ending', refrain: 'Refrain', vamp: 'Vamp', other: 'Section',
};

const SECTION_ALIASES = {
  v: 'verse', verse: 'verse', vs: 'verse',
  c: 'chorus', chorus: 'chorus', ch: 'chorus',
  p: 'prechorus', prechorus: 'prechorus', 'pre-chorus': 'prechorus', pre: 'prechorus',
  b: 'bridge', bridge: 'bridge', br: 'bridge',
  i: 'intro', intro: 'intro',
  o: 'outro', outro: 'outro',
  t: 'tag', tag: 'tag',
  e: 'ending', ending: 'ending',
  r: 'refrain', refrain: 'refrain',
  interlude: 'interlude', instrumental: 'interlude', vamp: 'vamp',
};

/** Normalise a section label like "Verse 2", "C1", "Pre-Chorus" -> {type, number}. */
function parseSectionLabel(label) {
  const raw = String(label || '').trim().replace(/[:\]]+$/, '').replace(/^\[/, '');
  const m = /^([A-Za-z\- ]*?)\s*(\d+)?$/.exec(raw);
  if (!m) return { type: 'other', number: null, label: raw || 'Section' };
  const word = (m[1] || '').trim().toLowerCase().replace(/\s+/g, '');
  const type = SECTION_ALIASES[word] || SECTION_ALIASES[word.replace(/s$/, '')] || 'other';
  const number = m[2] ? Number(m[2]) : null;
  const name = type === 'other' && m[1]?.trim() ? m[1].trim() : SECTION_TYPES[type];
  return { type, number, label: number ? `${name} ${number}` : name };
}

const uid = () => `s_${Math.random().toString(36).slice(2, 10)}`;

function makeSection(label, lines) {
  const meta = parseSectionLabel(label);
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { id: uid(), type: meta.type, number: meta.number, label: meta.label, body };
}

// ------------------------------------------------------------------ ChordPro

/**
 * Parse a ChordPro / OnSong document.
 * Directives ({title:} {key:} {ccli:}) become metadata; {start_of_verse} and
 * bracketed headers ("[Chorus]") delimit sections.
 */
function parseChordPro(text) {
  const meta = {};
  const sections = [];
  let label = null;
  let buffer = [];

  const flush = () => {
    if (buffer.some((l) => l.trim())) sections.push(makeSection(label ?? `Verse ${sections.length + 1}`, buffer));
    buffer = [];
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');

    // {directive: value}
    const dir = /^\s*\{\s*([a-zA-Z_]+)\s*:?\s*([^}]*)\}\s*$/.exec(line);
    if (dir) {
      const key = dir[1].toLowerCase();
      const value = dir[2].trim();
      switch (key) {
        case 'title': case 't': meta.title = value; break;
        case 'subtitle': case 'st': case 'artist': case 'composer': meta.author = meta.author || value; break;
        case 'key': meta.key = value; break;
        case 'tempo': case 'bpm': meta.tempo = Number(value) || undefined; break;
        case 'time': meta.timeSignature = value; break;
        case 'ccli': meta.ccli = value; break;
        case 'copyright': meta.copyright = value; break;
        case 'capo': meta.capo = Number(value) || undefined; break;
        case 'comment': case 'c': break;
        default:
          if (key.startsWith('start_of_')) { flush(); label = key.slice(9); }
          else if (key.startsWith('end_of_')) { flush(); label = null; }
      }
      continue;
    }

    // A bare bracketed header on its own line: "[Chorus]", "[Verse 2]"
    const header = /^\s*\[([A-Za-z][A-Za-z\-\s]*\d*)\]\s*$/.exec(line);
    if (header && !chords.pitchOf(header[1].trim().replace(/\d+$/, ''))) {
      flush();
      label = header[1];
      continue;
    }

    // "Chorus:" / "Verse 2:" plain header
    const plain = /^\s*((?:pre-?chorus|chorus|verse|bridge|intro|outro|tag|ending|refrain|interlude|vamp)\s*\d*)\s*:?\s*$/i.exec(line);
    if (plain) { flush(); label = plain[1]; continue; }

    if (!line.trim() && !buffer.length) continue;
    buffer.push(line);
  }
  flush();

  if (!meta.key) {
    const detected = chords.detectKey(sections.map((s) => s.body).join('\n'));
    if (detected) meta.key = detected;
  }
  return { meta, sections };
}

// ---------------------------------------------------------------- OpenLyrics

const decodeEntities = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** Pull the text of the first matching tag. */
function tagText(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1].replace(/<[^>]*>/g, '').trim()) : '';
}

/** Parse an OpenLyrics XML document (OpenLP / SongBeamer / ProPresenter export). */
function parseOpenLyrics(xml) {
  const src = String(xml);
  const meta = {};
  meta.title = tagText(src, 'title');

  const authors = [...src.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]*>/g, '').trim())).filter(Boolean);
  if (authors.length) meta.author = authors.join(', ');

  const ccli = /<ccliNo>([\s\S]*?)<\/ccliNo>/i.exec(src);
  if (ccli) meta.ccli = ccli[1].trim();
  const copyright = /<copyright>([\s\S]*?)<\/copyright>/i.exec(src);
  if (copyright) meta.copyright = decodeEntities(copyright[1].trim());
  const key = /<key>([\s\S]*?)<\/key>/i.exec(src);
  if (key) meta.key = key[1].trim();
  const tempo = /<tempo\b[^>]*>([\s\S]*?)<\/tempo>/i.exec(src);
  if (tempo && Number(tempo[1])) meta.tempo = Number(tempo[1]);

  const themes = [...src.matchAll(/<theme\b[^>]*>([\s\S]*?)<\/theme>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]*>/g, '').trim())).filter(Boolean);
  if (themes.length) meta.tags = themes;

  const sections = [];
  /** OpenLyrics verse name ("v1", "c") -> our generated section id. */
  const byName = new Map();
  for (const m of src.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)) {
    const nameAttr = /\bname="([^"]*)"/i.exec(m[1]);
    const body = m[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/lines>\s*<lines[^>]*>/gi, '\n\n')
      .replace(/<comment>[\s\S]*?<\/comment>/gi, '')
      // <chord name="G"/> -> inline [G]
      .replace(/<chord\b[^>]*\bname="([^"]*)"[^>]*\/?>/gi, '[$1]')
      .replace(/<[^>]*>/g, '')
      .split('\n').map((l) => l.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    const sourceName = decodeEntities(nameAttr?.[1] ?? `Verse ${sections.length + 1}`);
    const section = makeSection(sourceName, body.split('\n'));
    // Keep the first section under a given name; a repeat in verseOrder reuses it.
    if (!byName.has(sourceName.toLowerCase())) byName.set(sourceName.toLowerCase(), section.id);
    sections.push(section);
  }

  // OpenLyrics carries a presentation order like "v1 c v2 c b c". Translate
  // those source names into our section ids so the arrangement is playable.
  const order = /<verseOrder>([\s\S]*?)<\/verseOrder>/i.exec(src);
  let arrangement = null;
  if (order) {
    const mapped = order[1].trim().split(/\s+/).filter(Boolean)
      .map((name) => byName.get(name.toLowerCase()))
      .filter(Boolean);
    if (mapped.length) arrangement = mapped;
  }

  return { meta, sections, arrangement };
}

// -------------------------------------------------------------------- plain

/** Parse plain lyrics, detecting section headers and blank-line groups. */
function parsePlainText(text) {
  const lines = String(text).split(/\r?\n/);
  const sections = [];
  let label = null;
  let buffer = [];
  const flush = () => {
    if (buffer.some((l) => l.trim())) sections.push(makeSection(label ?? `Verse ${sections.length + 1}`, buffer));
    buffer = [];
    label = null;
  };

  for (const line of lines) {
    const header = /^\s*\[?((?:pre-?chorus|chorus|verse|bridge|intro|outro|tag|ending|refrain|interlude|vamp)\s*\d*)\]?\s*:?\s*$/i.exec(line);
    if (header) { flush(); label = header[1]; continue; }
    if (!line.trim()) {
      // A blank line ends an unlabelled block.
      if (buffer.some((l) => l.trim()) && !label) flush();
      else if (buffer.length) buffer.push('');
      continue;
    }
    buffer.push(line);
  }
  flush();

  const title = lines.find((l) => l.trim())?.trim() ?? 'Untitled';

  // A lone first line followed by real sections is the song title, not lyrics.
  if (sections.length > 1) {
    const first = sections[0];
    if (first.body === title && !first.body.includes('\n')) sections.shift();
  }

  // Renumber the unlabelled verses left behind so they read 1, 2, 3…
  let n = 0;
  for (const section of sections) {
    if (section.type === 'verse' && section.number != null) {
      n += 1;
      section.number = n;
      section.label = `Verse ${n}`;
    }
  }

  return { meta: { title }, sections };
}

// ------------------------------------------------------------------ dispatch

/**
 * Split pasted text into stanzas.
 *
 * A blank line is the separator — that is how people actually type and copy
 * songs, and how every other presentation program reads them. A line that is
 * only a section name ("Chorus", "Verse 2") labels the block that follows
 * rather than becoming a line of it.
 *
 * Unlike `parsePlainText`, nothing is treated as a title: this is used from the
 * editor, where the title has its own field and a first line is real content.
 *
 * @param {string} text
 * @param {{startVerse?:number}} opts  number to continue verse labelling from
 * @returns {{id:string,type:string,number:number|null,label:string,body:string}[]}
 */
function splitStanzas(text, opts = {}) {
  const blocks = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((b) => b.replace(/[ \t]+$/gm, '').trim())
    .filter(Boolean);

  const sections = [];
  let verse = opts.startVerse ?? 0;

  for (const block of blocks) {
    const lines = block.split('\n');
    const header = /^\[?\s*((?:pre-?chorus|chorus|verse|bridge|intro|outro|tag|ending|refrain|interlude|vamp)\s*\d*)\s*\]?\s*:?\s*$/i
      .exec(lines[0] ?? '');

    let label;
    let body;
    if (header && lines.length > 1) {
      const meta = parseSectionLabel(header[1]);
      label = meta.label;
      body = lines.slice(1).join('\n').trim();
      // Keep auto-numbering ahead of any number the paste already used, so a
      // later unlabelled block cannot reuse it.
      if (meta.type === 'verse' && meta.number != null) verse = Math.max(verse, meta.number);
    } else {
      verse += 1;
      label = `Verse ${verse}`;
      body = block;
    }
    if (!body) continue;

    const meta = parseSectionLabel(label);
    sections.push({
      id: `s_${Math.random().toString(36).slice(2, 10)}`,
      type: meta.type,
      number: meta.type === 'verse' ? verse : null,
      label,
      body,
    });
  }

  return sections;
}

/**
 * Import a song from file contents, choosing the parser by shape then filename.
 * @param {string} content
 * @param {string} filename
 */
function importSong(content, filename = '') {
  const text = String(content);
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

  let parsed;
  let format;
  if (/<\s*song\b/i.test(text) || ext === 'xml') { parsed = parseOpenLyrics(text); format = 'openlyrics'; }
  else if (/\{\s*(title|t|start_of_)/i.test(text) || /\[[A-G][#b]?[^\]]{0,8}\]/.test(text) || ['cho', 'crd', 'chopro', 'pro', 'onsong'].includes(ext)) {
    parsed = parseChordPro(text); format = 'chordpro';
  } else { parsed = parsePlainText(text); format = 'text'; }

  const fallbackTitle = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  const meta = parsed.meta ?? {};

  return {
    format,
    title: (meta.title || fallbackTitle || 'Untitled').trim(),
    author: meta.author ?? '',
    key: meta.key ?? '',
    tempo: meta.tempo ?? null,
    timeSignature: meta.timeSignature ?? '',
    ccli: meta.ccli ?? '',
    copyright: meta.copyright ?? '',
    capo: meta.capo ?? null,
    tags: meta.tags ?? [],
    sections: parsed.sections ?? [],
    arrangement: parsed.arrangement ?? (parsed.sections ?? []).map((s) => s.id),
    hasChords: /\[[A-G]/.test((parsed.sections ?? []).map((s) => s.body).join('\n')),
  };
}

/** Serialise a song back to ChordPro — the portable format for backup/export. */
function exportChordPro(song) {
  const out = [];
  if (song.title) out.push(`{title: ${song.title}}`);
  if (song.author) out.push(`{artist: ${song.author}}`);
  if (song.key) out.push(`{key: ${song.key}}`);
  if (song.tempo) out.push(`{tempo: ${song.tempo}}`);
  if (song.timeSignature) out.push(`{time: ${song.timeSignature}}`);
  if (song.ccli) out.push(`{ccli: ${song.ccli}}`);
  if (song.copyright) out.push(`{copyright: ${song.copyright}}`);
  out.push('');
  for (const s of song.sections ?? []) {
    out.push(`[${s.label}]`);
    out.push(s.body);
    out.push('');
  }
  return out.join('\n').trim() + '\n';
}

/**
 * Break a song's sections into presentation slides, respecting `maxLines`.
 * Long sections split at a blank line where possible, otherwise on line count.
 */
function toSlides(song, { maxLines = 4, arrangement = null, includeChords = false } = {}) {
  const byId = new Map((song.sections ?? []).map((s) => [s.id, s]));
  const order = (arrangement ?? song.arrangement ?? []).map((id) => byId.get(id)).filter(Boolean);
  const list = order.length ? order : (song.sections ?? []);

  const slides = [];
  for (const section of list) {
    const stripped = includeChords ? section.body : section.body.replace(/\[[^\]]*\]/g, '');
    const blocks = stripped.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
      for (let i = 0; i < lines.length; i += maxLines) {
        slides.push({
          id: `${section.id}_${slides.length}`,
          sectionId: section.id,
          sectionLabel: section.label,
          sectionType: section.type,
          lines: lines.slice(i, i + maxLines),
          continued: i > 0,
        });
      }
    }
  }
  return slides;
}

module.exports = {
  SECTION_TYPES, parseSectionLabel, parseChordPro, parseOpenLyrics,
  parsePlainText, splitStanzas, importSong, exportChordPro, toSlides,
};
