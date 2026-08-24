/**
 * Song editor.
 *
 * Songs are written as labelled stanzas rather than one block of text, because
 * that is how they are performed: an arrangement is "verse, chorus, verse,
 * chorus, bridge, chorus", and the operator needs each part addressable. The
 * preview renders through the same SlideSurface as the projector, so the
 * formatting controls show their real effect rather than an approximation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../shared/api';
import type { Slide, Song, SongSection, SongStyle } from '../../shared/types';
import { SlideSurface } from '../../shared/SlideSurface';
import { useApp } from '../stores/app';
import { IconPlus, IconTrash, IconChevron, IconClose } from './Icons';

/** Labels available for a stanza, in the order they usually appear. */
const LABELS = [
  'Verse 1', 'Verse 2', 'Verse 3', 'Verse 4', 'Verse 5', 'Verse 6',
  'Pre-Chorus', 'Chorus', 'Chorus 2', 'Bridge', 'Tag', 'Refrain',
  'Intro', 'Interlude', 'Outro', 'Ending', 'Vamp',
];

const FONTS = [
  { label: 'Theme default', value: '' },
  { label: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { label: 'System sans', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Avenir', value: "'Avenir Next', Avenir, sans-serif" },
  { label: 'Georgia (serif)', value: "Georgia, 'Iowan Old Style', serif" },
  { label: 'Palatino (serif)', value: "'Palatino Linotype', Palatino, serif" },
];

const uid = () => `s_${Math.random().toString(36).slice(2, 10)}`;

/** Infer the machine-readable type from a human label. */
function typeOf(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('pre')) return 'prechorus';
  if (l.includes('chorus')) return 'chorus';
  if (l.includes('bridge')) return 'bridge';
  if (l.includes('tag')) return 'tag';
  if (l.includes('refrain')) return 'refrain';
  if (l.includes('intro')) return 'intro';
  if (l.includes('outro') || l.includes('ending')) return 'outro';
  if (l.includes('interlude') || l.includes('vamp')) return 'interlude';
  return 'verse';
}

const emptySection = (label: string): SongSection => ({
  id: uid(),
  type: typeOf(label),
  number: /(\d+)/.test(label) ? Number(RegExp.$1) : null,
  label,
  body: '',
});

interface Props {
  /** Song to edit, or null to start a new one. */
  song: Song | null;
  onClose: () => void;
  onSaved: (song: Song) => void;
}

export function SongEditor({ song, onClose, onSaved }: Props) {
  const live = useApp((s) => s.live);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);

  const [title, setTitle] = useState(song?.title ?? '');
  const [author, setAuthor] = useState(song?.author ?? '');
  const [ccli, setCcli] = useState(song?.ccli ?? '');
  const [copyright, setCopyright] = useState(song?.copyright ?? '');
  const [songKey, setSongKey] = useState(song?.key ?? '');
  const [style, setStyle] = useState<SongStyle>(song?.style ?? {});
  const [sections, setSections] = useState<SongSection[]>(
    song?.sections?.length ? song.sections : [emptySection('Verse 1')],
  );
  const [activeId, setActiveId] = useState<string>(
    song?.sections?.[0]?.id ?? '',
  );
  const [saving, setSaving] = useState(false);
  /** Rows highlighted for a bulk paste. Always includes the active stanza. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Row being edited inline in the left-hand list, if any. */
  const [inlineId, setInlineId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (!activeId && sections[0]) setActiveId(sections[0].id);
  }, [activeId, sections]);

  const active = sections.find((s) => s.id === activeId) ?? sections[0] ?? null;

  const patchSection = useCallback((id: string, fields: Partial<SongSection>) => {
    setSections((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...fields };
      // Keep the type in step when the label changes.
      if (fields.label !== undefined) next.type = typeOf(fields.label);
      return next;
    }));
  }, []);

  /** Suggest the next sensible label rather than always "Verse 1". */
  const nextLabel = useCallback(() => {
    const verses = sections.filter((s) => s.type === 'verse').length;
    return sections.some((s) => s.type === 'chorus') || verses === 0
      ? `Verse ${verses + 1}`
      : 'Chorus';
  }, [sections]);

  const addSection = useCallback(() => {
    const section = emptySection(nextLabel());
    setSections((prev) => [...prev, section]);
    setActiveId(section.id);
  }, [nextLabel]);

  const removeSection = useCallback((id: string) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== id);
      // Never leave the song with nothing to edit.
      return next.length ? next : [emptySection('Verse 1')];
    });
  }, []);

  const move = useCallback((index: number, delta: number) => {
    setSections((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /**
   * Take a pasted song and lay it into stanzas.
   *
   * Blocks separated by a blank line become separate stanzas — that is how
   * songs are written and copied. Existing empty stanzas are filled first so a
   * fresh editor does not leave a stray blank at the top, then any remaining
   * blocks are appended. If rows are selected, those are replaced instead.
   */
  const applyPaste = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Continue verse numbering from what is already labelled.
    const startVerse = sections.reduce(
      (n, s) => (s.type === 'verse' && s.number != null ? Math.max(n, s.number) : n), 0,
    );

    let blocks: SongSection[];
    try {
      blocks = await api.songs.splitStanzas(trimmed, { startVerse });
    } catch {
      blocks = [{ ...emptySection(`Verse ${startVerse + 1}`), body: trimmed }];
    }
    if (!blocks.length) return;

    setSections((prev) => {
      const targets = selected.size
        ? prev.filter((s) => selected.has(s.id))
        : prev.filter((s) => !s.body.trim());

      const next = [...prev];
      let used = 0;

      // Reuse the target rows, keeping their position.
      for (const target of targets) {
        if (used >= blocks.length) break;
        const i = next.findIndex((s) => s.id === target.id);
        const block = blocks[used++];
        next[i] = { ...next[i], body: block.body, label: block.label, type: block.type, number: block.number };
      }

      // Anything left over becomes new stanzas at the end.
      for (; used < blocks.length; used++) next.push(blocks[used]);

      return next;
    });

    setSelected(new Set());
    setPasteOpen(false);
    setPasteText('');
    toast(
      blocks.length === 1
        ? 'Pasted into one stanza'
        : `Split into ${blocks.length} stanzas on blank lines`,
      'success',
    );
  }, [sections, selected, toast]);

  /** Click behaviour: plain selects, ⌘/Ctrl adds, Shift extends. */
  const rowClick = useCallback((id: string, index: number, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setActiveId(id);
      return;
    }
    if (e.shiftKey && activeId) {
      const from = sections.findIndex((s) => s.id === activeId);
      if (from >= 0) {
        const [lo, hi] = from < index ? [from, index] : [index, from];
        setSelected(new Set(sections.slice(lo, hi + 1).map((s) => s.id)));
        return;
      }
    }
    setSelected(new Set());
    setActiveId(id);
  }, [activeId, sections]);

  // Paste and select-all have to be caught at the window: the stanza list is a
  // plain div, which takes no focus, so a handler bound to it never sees a
  // Cmd+V aimed at the page.
  useEffect(() => {
    const inField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target)) return;              // let a field handle its own paste
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      void applyPaste(text);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || inField(e.target)) return;
      if (e.key === 'a') {
        e.preventDefault();
        setSelected(new Set(sections.map((x) => x.id)));
      }
      if (e.key === 'd') {                         // deselect
        e.preventDefault();
        setSelected(new Set());
      }
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [applyPaste, sections]);

  /** What the active stanza will look like on the screen. */
  const previewDeck = useMemo(() => {
    const maxLines = settings?.presentation.maxLinesPerSlide ?? 4;
    const lines = (active?.body ?? '')
      .replace(/\[[^\]]*\]/g, '')       // chords are not projected
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim())
      .slice(0, maxLines);

    const slide: Slide = {
      id: active?.id ?? 'empty',
      lines: lines.length ? lines : ['Type the words for this stanza'],
      caption: active?.label ?? '',
    };
    return {
      kind: 'song' as const,
      title: title || 'Untitled',
      slides: [slide],
      index: 0,
      meta: { style },
    };
  }, [active, title, style, settings]);

  const setStyleField = useCallback(<K extends keyof SongStyle>(key: K, value: SongStyle[K]) => {
    setStyle((prev) => {
      const next = { ...prev };
      // An empty value means "fall back to the theme", not "set to empty".
      if (value === '' || value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!title.trim()) { toast('Give the song a title first', 'warn'); return; }
    setSaving(true);
    try {
      const cleaned = sections.filter((s) => s.body.trim() || s.label.trim());
      const saved = await api.songs.upsert({
        ...(song?.id ? { id: song.id } : {}),
        title: title.trim(),
        author: author.trim(),
        ccli: ccli.trim(),
        copyright: copyright.trim(),
        key: songKey.trim(),
        originalKey: song?.originalKey || songKey.trim(),
        sections: cleaned,
        arrangement: cleaned.map((s) => s.id),
        style: Object.keys(style).length ? style : null,
      });
      toast(song?.id ? `Saved "${saved.title}"` : `Added "${saved.title}"`, 'success');
      onSaved(saved);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setSaving(false); }
  }, [title, author, ccli, copyright, songKey, sections, style, song, toast, onSaved]);

  return (
    <div className="song-editor">
      {/* ------------------------------------------------------------ head */}
      <div className="panel-head">
        <input
          className="input song-title-input"
          placeholder="Song title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <button className="btn sm icon ghost" onClick={onClose} title="Close">
          <IconClose size={13} />
        </button>
      </div>

      {/* ------------------------------------------------------- formatting */}
      <div className="panel-toolbar format-bar">
        <select
          className="select"
          style={{ width: 128 }}
          value={style.fontFamily ?? ''}
          onChange={(e) => setStyleField('fontFamily', e.target.value || undefined)}
          title="Typeface for this song"
        >
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>

        <select
          className="select"
          style={{ width: 78 }}
          value={style.size ?? ''}
          onChange={(e) => setStyleField('size', e.target.value ? Number(e.target.value) : undefined)}
          title="Text size"
        >
          <option value="">Auto</option>
          {[36, 44, 52, 58, 62, 70, 80, 92, 104].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <div className="btn-group">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              className={`btn sm icon ${style.align === a ? 'primary' : 'ghost'}`}
              onClick={() => setStyleField('align', style.align === a ? undefined : a)}
              title={`Align ${a}`}
            >
              <span className={`align-glyph ${a}`} />
            </button>
          ))}
        </div>

        <div className="btn-group">
          <button
            className={`btn sm ${(style.weight ?? 0) >= 700 ? 'primary' : 'ghost'}`}
            onClick={() => setStyleField('weight', (style.weight ?? 0) >= 700 ? undefined : 800)}
            title="Bold"
            style={{ fontWeight: 800 }}
          >
            B
          </button>
          <button
            className={`btn sm ${style.italic ? 'primary' : 'ghost'}`}
            onClick={() => setStyleField('italic', style.italic ? undefined : true)}
            title="Italic"
            style={{ fontStyle: 'italic' }}
          >
            I
          </button>
          <button
            className={`btn sm ${style.uppercase ? 'primary' : 'ghost'}`}
            onClick={() => setStyleField('uppercase', style.uppercase ? undefined : true)}
            title="Uppercase"
          >
            AA
          </button>
        </div>

        <input
          type="color"
          className="input"
          style={{ width: 34, padding: 2 }}
          value={style.color ?? settings?.themes.find((t) => t.id === settings.activeThemeId)?.text.color ?? '#ffffff'}
          onChange={(e) => setStyleField('color', e.target.value)}
          title="Text colour"
        />

        <div className="panel-head-spacer" />
        {Object.keys(style).length > 0 && (
          <button className="btn sm ghost" onClick={() => setStyle({})} title="Fall back to the theme">
            Reset styles
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------ body */}
      <div className="song-editor-body">
        {/* stanza list */}
        <div
          className="stanza-list"
          onPaste={(e) => {
            // Only intercept a paste aimed at the list itself, never one aimed
            // at a field inside it.
            const el = e.target as HTMLElement;
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
            const text = e.clipboardData.getData('text/plain');
            if (!text.includes('\n')) return;
            e.preventDefault();
            void applyPaste(text);
          }}
        >
          <div className="stanza-tools">
            <button className="btn sm" onClick={() => setPasteOpen((v) => !v)}>
              Paste song
            </button>
            {selected.size > 0 ? (
              <>
                <span className="chip accent">{selected.size} selected</span>
                <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
              </>
            ) : (
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                <span className="kbd">⌘A</span> select all · <span className="kbd">⌘V</span> paste a song
              </span>
            )}
          </div>

          {pasteOpen && (
            <div className="stanza-paste">
              <textarea
                className="textarea"
                autoFocus
                rows={7}
                placeholder={'Paste the whole song here.\n\nLeave a blank line between stanzas — each block becomes its own stanza.'}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
                <button className="btn primary" onClick={() => void applyPaste(pasteText)} disabled={!pasteText.trim()}>
                  Split into stanzas
                </button>
                <button className="btn ghost" onClick={() => { setPasteOpen(false); setPasteText(''); }}>Cancel</button>
              </div>
              <span className="field-hint">
                {selected.size
                  ? `Replaces the ${selected.size} selected stanza(s), then adds any extras.`
                  : 'Fills empty stanzas first, then adds more as needed.'}
              </span>
            </div>
          )}
          {sections.map((section, i) => (
            <div
              key={section.id}
              className={`stanza-row ${section.id === activeId ? 'active' : ''} ${selected.has(section.id) ? 'picked' : ''}`}
              onClick={(e) => rowClick(section.id, i, e)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveId(section.id); }}
            >
              <span className="stanza-num mono">{i + 1}</span>
              <div className="stanza-main">
                <input
                  className="stanza-label-input"
                  value={section.label}
                  list="stanza-labels"
                  onChange={(e) => patchSection(section.id, { label: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Label for stanza ${i + 1}`}
                />

                {inlineId === section.id ? (
                  /* Edit here rather than only on the right, so the list is a
                     working surface and not just a table of contents. */
                  <textarea
                    className="stanza-inline"
                    autoFocus
                    value={section.body}
                    onChange={(e) => patchSection(section.id, { body: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => setInlineId(null)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') setInlineId(null);
                    }}
                    rows={Math.min(Math.max(section.body.split('\n').length, 2), 8)}
                  />
                ) : (
                  <div
                    className="stanza-preview"
                    onClick={(e) => { e.stopPropagation(); setActiveId(section.id); setInlineId(section.id); }}
                    title="Click to edit here"
                  >
                    {section.body.trim()
                      ? section.body.split('\n').filter((l) => l.trim()).slice(0, 3).map((l, k) => (
                          <div className="truncate" key={k}>{l}</div>
                        ))
                      : <span className="faint">empty — click to write</span>}
                  </div>
                )}
              </div>
              <div className="stanza-actions">
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                  disabled={i === 0}
                  title="Move up"
                >
                  <IconChevron size={10} className="rot-up" />
                </button>
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                  disabled={i === sections.length - 1}
                  title="Move down"
                >
                  <IconChevron size={10} className="rot-down" />
                </button>
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); removeSection(section.id); }}
                  title="Delete stanza"
                >
                  <IconTrash size={10} />
                </button>
              </div>
            </div>
          ))}

          <button className="btn stanza-add" onClick={addSection}>
            <IconPlus size={12} /> Add stanza
          </button>
        </div>

        {/* editor + preview */}
        <div className="stanza-editor">
          {active && (
            <>
              <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
                <span className="section-label">Label</span>
                <input
                  className="input"
                  style={{ width: 150 }}
                  list="stanza-labels"
                  value={active.label}
                  onChange={(e) => patchSection(active.id, { label: e.target.value })}
                />
                <datalist id="stanza-labels">
                  {LABELS.map((l) => <option key={l} value={l} />)}
                </datalist>
                <span className="chip">{active.type}</span>
              </div>

              <textarea
                className="textarea stanza-text"
                placeholder={'One line per line of the song.\nLeave a blank line to split onto a new slide.'}
                value={active.body}
                onChange={(e) => patchSection(active.id, { body: e.target.value })}
                spellCheck
              />

              <div className="stanza-preview-pane">
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="section-label">On screen</span>
                  <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                    first {settings?.presentation.maxLinesPerSlide ?? 4} lines
                  </span>
                </div>
                <div className="stanza-surface">
                  <SlideSurface
                    slide={previewDeck.slides[0]}
                    deck={previewDeck}
                    theme={live?.theme ?? null}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- footer */}
      <div className="song-editor-foot">
        <input className="input" style={{ width: 150 }} placeholder="Author"
               value={author} onChange={(e) => setAuthor(e.target.value)} />
        <input className="input" style={{ width: 80 }} placeholder="Key"
               value={songKey} onChange={(e) => setSongKey(e.target.value)} />
        <input className="input" style={{ width: 110 }} placeholder="CCLI"
               value={ccli} onChange={(e) => setCcli(e.target.value)} />
        <input className="input" style={{ flex: 1 }} placeholder="Copyright"
               value={copyright} onChange={(e) => setCopyright(e.target.value)} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={saving || !title.trim()}>
          {saving ? 'Saving…' : song?.id ? 'Save' : 'Add song'}
        </button>
      </div>
    </div>
  );
}
