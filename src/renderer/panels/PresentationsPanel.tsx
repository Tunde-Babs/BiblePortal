/**
 * Imported PowerPoint decks.
 *
 * Announcement decks are the common case, so the emphasis is on getting a
 * .pptx onto the screen quickly: import once, then click a slide to stage it.
 * Slides render through the service theme rather than PowerPoint's own layout —
 * see the note in the empty state about what that does and does not preserve.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type PresentationDeck } from '../../shared/api';
import type { Deck, Slide } from '../../shared/types';
import { useApp } from '../stores/app';
import { IconImport, IconTrash } from '../components/Icons';

/** Build a stageable deck from an imported presentation. */
function presentationDeck(deck: PresentationDeck, startAt = 0): Partial<Deck> {
  const slides: Slide[] = deck.slides.map((s) => ({
    id: `${deck.id}_${s.index}`,
    // The title already appears as the first line; don't print it twice.
    lines: s.lines.length ? s.lines : [s.title],
    caption: '',
    image: s.image,
  }));
  return {
    kind: 'presentation',
    title: deck.name,
    slides,
    index: Math.max(0, Math.min(startAt, slides.length - 1)),
    meta: { presentationId: deck.id },
  };
}

export function PresentationsPanel() {
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [decks, setDecks] = useState<PresentationDeck[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setDecks(await api.presentations.all()); } catch { /* nothing imported yet */ }
  }, []);

  useEffect(() => {
    void refresh();
    const off = api.on(api.events().LIBRARY_CHANGED, () => void refresh());
    return off;
  }, [refresh]);

  const importDecks = useCallback(async () => {
    try {
      const picked = await api.presentations.pick();
      if (!picked.paths?.length) return;
      setBusy(true);
      const res = await api.presentations.import(picked.paths);
      await refresh();
      toast(
        `Imported ${res.imported} presentation${res.imported === 1 ? '' : 's'}`
        + (res.failed ? `, ${res.failed} failed` : ''),
        res.failed ? 'warn' : 'success',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setBusy(false); }
  }, [refresh, toast]);

  const remove = useCallback(async (deck: PresentationDeck) => {
    await api.presentations.remove(deck.id);
    await refresh();
    if (openId === deck.id) setOpenId(null);
    toast(`Removed "${deck.name}"`, 'info');
  }, [refresh, openId, toast]);

  const open = decks.find((d) => d.id === openId) ?? null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Presentations</h2>
        <div className="panel-head-spacer" />
        {busy && <div className="spinner" />}
        <button className="btn sm" onClick={() => void importDecks()} disabled={busy}>
          <IconImport size={12} /> Import .pptx
        </button>
      </div>

      <div className="panel-scroll">
        {!decks.length ? (
          <div className="empty">
            <div className="empty-title">No presentations yet</div>
            <div className="empty-body">
              Import a PowerPoint deck — announcements, notices, a welcome loop — and each
              slide becomes stageable, rendered with your service theme.
              <br /><br />
              <span className="faint">
                Text, bullets, pictures and speaker notes come across. Shape layout,
                animations, charts and SmartArt do not — a deck that depends on those is
                better exported to images from PowerPoint and added under Media.
              </span>
            </div>
            <button className="btn primary" onClick={() => void importDecks()}>
              <IconImport size={12} /> Import a presentation
            </button>
          </div>
        ) : !open ? (
          decks.map((deck) => (
            <div
              key={deck.id}
              className="list-row"
              onClick={() => setOpenId(deck.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(deck.id); }}
            >
              <div className="list-main">
                <div className="list-title truncate">{deck.name}</div>
                <div className="list-sub">
                  {deck.slideCount} slide{deck.slideCount === 1 ? '' : 's'} · imported {deck.importedAt.slice(0, 10)}
                </div>
              </div>
              <div className="list-actions">
                <button
                  className="btn sm"
                  onClick={(e) => { e.stopPropagation(); void preview(presentationDeck(deck)); }}
                >
                  Preview
                </button>
                <button
                  className="btn sm live"
                  onClick={(e) => { e.stopPropagation(); void previewAndTake(presentationDeck(deck)); }}
                >
                  Take
                </button>
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); void remove(deck); }}
                  title="Remove"
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="panel-toolbar">
              <button className="btn sm ghost" onClick={() => setOpenId(null)}>← All decks</button>
              <span className="list-title truncate">{open.name}</span>
              <div className="panel-head-spacer" />
              <button className="btn sm live" onClick={() => void previewAndTake(presentationDeck(open))}>
                Take from start
              </button>
            </div>

            {open.slides.map((slide, i) => (
              <div
                key={slide.index}
                className="list-row"
                onClick={() => void preview(presentationDeck(open, i))}
                onDoubleClick={() => void previewAndTake(presentationDeck(open, i))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') void preview(presentationDeck(open, i)); }}
              >
                <span className="mono faint" style={{ width: 22, flex: 'none', fontSize: 'var(--fs-xs)' }}>
                  {slide.index}
                </span>
                <div className="list-main">
                  <div className="list-title truncate">{slide.title}</div>
                  {slide.lines.length > 1 && (
                    <div className="list-sub truncate">{slide.lines.slice(1).join(' · ')}</div>
                  )}
                  {slide.notes && <div className="list-sub faint truncate">Notes: {slide.notes}</div>}
                </div>
                {slide.image && <span className="chip">image</span>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
