/**
 * Songs panel.
 *
 * The library starts empty and fills from what the church already owns:
 * ChordPro, OnSong, OpenLyrics XML or plain text. BiblePortal ships no lyrics
 * of its own — worship songs are licensed content, and that licence belongs
 * between the church and CCLI, not bundled into an app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../shared/api';
import type { Song } from '../../shared/types';
import { songDeck, useApp } from '../stores/app';
import { IconSearch, IconImport, IconTrash, IconPlus } from '../components/Icons';
import { SongEditor } from '../components/SongEditor';

/** Twelve keys, conventionally spelled — mirrors the transposer in the main process. */
const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

const pitchOf = (key: string) => {
  const table = /m$/.test(key) ? MINOR_KEYS : KEYS;
  const i = table.indexOf(key);
  return i >= 0 ? i : KEYS.indexOf(key.replace(/m$/, ''));
};

export function SongsPanel() {
  const songs = useApp((s) => s.songs);
  const settings = useApp((s) => s.settings);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const refreshSongs = useApp((s) => s.refreshSongs);
  const toast = useApp((s) => s.toast);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Song | null>(null);
  const [performKey, setPerformKey] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  /** null = closed; { song: null } = writing a new one. */
  const [editing, setEditing] = useState<{ song: Song | null } | null>(null);
  /** Ids ticked for a bulk action. Non-empty puts the list in selection mode. */
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [picking, setPicking] = useState(false);
  /** Anchor row for shift-click ranges. */
  const anchor = useRef<string | null>(null);

  const maxLines = settings?.presentation.maxLinesPerSlide ?? 4;

  // Re-run the search whenever the query or the library changes.
  useEffect(() => {
    let cancelled = false;
    api.songs.search(query, 60)
      .then((r) => { if (!cancelled) setResults(r.map((x) => x.song)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query, songs]);

  const select = useCallback((song: Song) => {
    setSelected(song);
    setPerformKey(song.key || '');
  }, []);

  /** Build slides for a song in the chosen key and stage them. */
  const stage = useCallback(async (song: Song, take = false) => {
    try {
      const semitones = performKey && song.key
        ? ((pitchOf(performKey) - pitchOf(song.key)) % 12 + 12) % 12
        : 0;
      const slides = await api.songs.slides(song.id, { maxLines, includeChords: false });
      const deck = songDeck(song, slides, performKey || song.key);
      if (take) await previewAndTake(deck); else await preview(deck);
      void api.songs.markUsed(song.id);
      if (semitones) toast(`Staged in ${performKey} (${semitones > 6 ? semitones - 12 : semitones} semitones)`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [maxLines, performKey, preview, previewAndTake, toast]);

  /**
   * @param collection optional group to file the imports under — used when
   *   dropping in a whole hymnal so it stays together.
   */
  const importFiles = useCallback(async (collection?: string) => {
    try {
      const picked = await api.songs.pickFiles();
      if (!picked.paths?.length) return;
      const res = await api.songs.import(picked.paths, collection);
      await refreshSongs();
      toast(
        `Imported ${res.imported} song${res.imported === 1 ? '' : 's'}${res.failed ? `, ${res.failed} failed` : ''}`,
        res.failed ? 'warn' : 'success',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshSongs, toast]);

  const importPaste = useCallback(async () => {
    if (!pasteText.trim()) return;
    try {
      const song = await api.songs.importText(pasteText, 'Pasted song.txt');
      await refreshSongs();
      setPasteOpen(false);
      setPasteText('');
      select(song);
      toast(`Added "${song.title}"`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [pasteText, refreshSongs, select, toast]);

  const selecting = picking || marked.size > 0;

  /** Tick one row, or extend from the last anchor when shift is held. */
  const toggleMark = useCallback((song: Song, shift: boolean) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (shift && anchor.current) {
        const from = results.findIndex((r) => r.id === anchor.current);
        const to = results.findIndex((r) => r.id === song.id);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          // Shift-click extends rather than toggles, so dragging back and
          // forth over a range does not punch holes in it.
          for (let i = lo; i <= hi; i += 1) next.add(results[i].id);
          return next;
        }
      }
      if (next.has(song.id)) next.delete(song.id); else next.add(song.id);
      anchor.current = song.id;
      return next;
    });
  }, [results]);

  const clearMarks = useCallback(() => {
    setMarked(new Set());
    setPicking(false);
    anchor.current = null;
  }, []);

  /**
   * Delete every ticked song in one pass.
   *
   * Whole-library clear-outs go through removeAll, which skips building and
   * shipping a list of thousands of ids across the bridge.
   */
  const removeMarked = useCallback(async () => {
    const ids = [...marked];
    if (!ids.length) return;
    const whole = ids.length === songs.length;
    const { confirmed } = await api.app.confirm({
      title: 'Delete songs',
      message: whole
        ? `Delete all ${ids.length.toLocaleString()} songs?`
        : `Delete ${ids.length.toLocaleString()} song${ids.length === 1 ? '' : 's'}?`,
      detail: 'This cannot be undone. Any service plan already built keeps its own copy of the words.',
      confirmLabel: `Delete ${ids.length.toLocaleString()}`,
    });
    if (!confirmed) return;
    try {
      const res = whole ? await api.songs.removeAll() : await api.songs.removeMany(ids);
      clearMarks();
      setSelected((cur) => (cur && marked.has(cur.id) ? null : cur));
      await refreshSongs();
      toast(`Deleted ${res.removed.toLocaleString()} song(s) · ${res.remaining.toLocaleString()} left`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [marked, songs.length, clearMarks, refreshSongs, toast]);

  const remove = useCallback(async (song: Song) => {
    await api.songs.remove(song.id);
    await refreshSongs();
    if (selected?.id === song.id) setSelected(null);
    toast(`Removed "${song.title}"`, 'info');
  }, [refreshSongs, selected, toast]);

  if (editing) {
    return (
      <SongEditor
        song={editing.song}
        onClose={() => setEditing(null)}
        onSaved={async (saved) => {
          await refreshSongs();
          setEditing(null);
          select(saved);
        }}
      />
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Songs</h2>
        <div className="panel-head-spacer" />
        <button className="btn sm primary" onClick={() => setEditing({ song: null })}>
          <IconPlus size={12} /> New song
        </button>
        <button className="btn sm" onClick={() => setPasteOpen((v) => !v)}>Paste</button>
        {!!songs.length && (
          <button
            className="btn sm"
            onClick={() => (selecting ? clearMarks() : setPicking(true))}
            title="Tick several songs to delete them together"
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        )}
        <button className="btn sm" onClick={() => void importFiles()}>
          <IconImport size={12} /> Import
        </button>
      </div>

      <div className="panel-toolbar">
        <div className="search-field">
          <IconSearch />
          <input
            className="input"
            placeholder="Search titles, authors or lyrics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {pasteOpen && (
        <div className="panel-pad" style={{ borderBottom: '1px solid var(--line-soft)' }}>
          <div className="field">
            <span className="field-label">Paste song text</span>
            <textarea
              className="textarea"
              rows={7}
              placeholder={'Title\n\nVerse 1\n…lyrics…\n\nChorus\n…lyrics…'}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <span className="field-hint">
              ChordPro directives and <span className="mono">[G]</span> chords are detected automatically,
              as are section headers like “Verse 1” and “Chorus”.
            </span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void importPaste()} disabled={!pasteText.trim()}>Add song</button>
            <button className="btn ghost" onClick={() => { setPasteOpen(false); setPasteText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {selecting && (
        <div className="bulk-bar">
          <span className="bulk-count">
            {marked.size.toLocaleString()} selected
          </span>
          <div className="row" style={{ gap: 'var(--sp-2)', marginLeft: 'auto' }}>
            {marked.size < songs.length && (
              <button
                className="btn sm"
                onClick={() => setMarked(new Set(songs.map((x) => x.id)))}
                title="Select every song in the library, not just the ones shown"
              >
                Select all {songs.length.toLocaleString()}
              </button>
            )}
            {results.length > 0 && marked.size < songs.length && !!query.trim() && (
              <button
                className="btn sm"
                onClick={() => setMarked(new Set(results.map((x) => x.id)))}
                title="Select the songs matching this search"
              >
                Select {results.length} matching
              </button>
            )}
            <button className="btn sm ghost" onClick={clearMarks}>Cancel</button>
            <button className="btn sm danger" onClick={() => void removeMarked()} disabled={!marked.size}>
              <IconTrash size={12} /> Delete {marked.size.toLocaleString()}
            </button>
          </div>
        </div>
      )}

      <div className="panel-scroll">
        {!songs.length && !pasteOpen && (
          <div className="empty">
            <div className="empty-title">Your song library is empty</div>
            <div className="empty-body">
              BiblePortal doesn’t ship songs — worship lyrics are licensed to your church,
              usually through CCLI. Import the files you already have and they stay on this machine.
              <br /><br />
              <span className="faint">ChordPro (.cho, .pro) · OnSong · OpenLyrics (.xml) · plain text</span>
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => setEditing({ song: null })}>
                <IconPlus size={12} /> Write a song
              </button>
              <button className="btn" onClick={() => void importFiles()}>
                <IconImport size={12} /> Import files
              </button>
              <button className="btn" onClick={() => setPasteOpen(true)}>Paste</button>
            </div>
            <button
              className="btn ghost"
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() => void importFiles('Hymns')}
              title="Files are filed under a Hymns collection so they stay grouped"
            >
              Import a hymnal into “Hymns”
            </button>
          </div>
        )}

        {results.map((song) => (
          <div
            key={song.id}
            className={`list-row ${selected?.id === song.id ? 'selected' : ''} ${marked.has(song.id) ? 'marked' : ''}`}
            onClick={(e) => {
              // Cmd/Ctrl-click starts a selection without hunting for a button.
              if (selecting || e.metaKey || e.ctrlKey) toggleMark(song, e.shiftKey);
              else select(song);
            }}
            onDoubleClick={() => { if (!selecting) void stage(song, true); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') select(song); }}
          >
            {selecting && (
              <input
                type="checkbox"
                className="list-check"
                checked={marked.has(song.id)}
                onChange={() => {}}
                onClick={(e) => { e.stopPropagation(); toggleMark(song, e.shiftKey); }}
                aria-label={`Select ${song.title}`}
              />
            )}
            <div className="list-main">
              <div className="list-title truncate">{song.title}</div>
              <div className="list-sub truncate">
                {[song.author, song.key, song.ccli && `CCLI ${song.ccli}`, `${song.sections.length} sections`]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="list-actions" style={selecting ? { display: 'none' } : undefined}>
              <button
                className="btn sm"
                onClick={(e) => { e.stopPropagation(); setEditing({ song }); }}
                title="Edit stanzas and formatting"
              >
                Edit
              </button>
              <button
                className="btn sm"
                onClick={(e) => { e.stopPropagation(); void stage(song); }}
                title="Preview"
              >
                Preview
              </button>
              <button
                className="btn sm icon ghost"
                onClick={(e) => { e.stopPropagation(); void remove(song); }}
                title="Remove from library"
              >
                <IconTrash size={12} />
              </button>
            </div>
          </div>
        ))}

        {!!songs.length && !results.length && (
          <div className="empty">
            <div className="empty-title">No matches</div>
            <div className="empty-body">Nothing in your library matches “{query}”.</div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ song detail */}
      {selected && (
        <div className="panel-pad" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-raised)', flex: 'none' }}>
          <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="list-title truncate">{selected.title}</div>
              <div className="list-sub truncate">{selected.author || 'Unknown author'}</div>
            </div>
            {selected.key && (
              <>
                <span className="section-label">Key</span>
                <select
                  className="select"
                  style={{ width: 78 }}
                  value={performKey || selected.key}
                  onChange={(e) => setPerformKey(e.target.value)}
                  title="Transpose for performance"
                >
                  {(/m$/.test(selected.key) ? MINOR_KEYS : KEYS).map((k) => (
                    <option key={k} value={k}>{k}{k === selected.key ? ' (orig)' : ''}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)', marginBottom: 'var(--sp-3)' }}>
            {selected.arrangement
              .map((id) => selected.sections.find((s) => s.id === id))
              .filter(Boolean)
              .map((section, i) => (
                <span key={`${section!.id}_${i}`} className="chip">{section!.label}</span>
              ))}
          </div>

          <div className="row">
            <button className="btn" onClick={() => setEditing({ song: selected })}>Edit</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => void stage(selected)}>Preview</button>
            <button className="btn live" style={{ flex: 1 }} onClick={() => void stage(selected, true)}>Take</button>
          </div>
        </div>
      )}
    </div>
  );
}
