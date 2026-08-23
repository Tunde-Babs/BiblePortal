/**
 * The preview/program pair — the heart of the console.
 *
 * Left is what the operator is preparing, right is what the room is seeing.
 * Both render through the same SlideSurface as the projector, so what the
 * operator sees is exactly what the congregation gets.
 */

import { useCallback, useEffect } from 'react';
import { api } from '../../shared/api';
import { SlideSurface } from '../../shared/SlideSurface';
import { slideOf, nextSlideOf } from '../../shared/slide-render';
import { useApp } from '../stores/app';

export function PreviewProgram() {
  const live = useApp((s) => s.live);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);

  const preview = live?.preview ?? null;
  const program = live?.program ?? null;
  const previewSlide = slideOf(preview);
  const programSlide = slideOf(program);
  const onAir = !!programSlide && !live?.blackout && !live?.cleared;

  const take = useCallback(async () => {
    if (!preview?.slides?.length) { toast('Nothing staged in preview', 'warn'); return; }
    await api.live.take();
  }, [preview, toast]);

  // Keyboard transport. Ignored while typing so search fields still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          void take();
          break;
        case 'Escape':
          e.preventDefault();
          void api.live.blackout();
          break;
        case 'ArrowDown': case 'PageDown':
          e.preventDefault();
          void api.live.step(1);
          break;
        case 'ArrowUp': case 'PageUp':
          e.preventDefault();
          void api.live.step(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          void api.live.stepPreview(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          void api.live.stepPreview(-1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [take]);

  const showVerseNumbers = settings?.presentation.showVerseNumbers ?? true;

  // Report what the preview surface actually measured and painted. A blank pane
  // has several possible causes that look identical from outside; these numbers
  // separate them.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const host = document.querySelector('.pp-deck.preview .slide-host');
      const surf = document.querySelector('.pp-deck.preview .slide-surface');
      const body = document.querySelector('.pp-deck.preview .slide-body');
      const lines = document.querySelectorAll('.pp-deck.preview .slide-line');
      if (!host || !surf) return;

      const hr = host.getBoundingClientRect();
      const sr = surf.getBoundingClientRect();
      const cs = getComputedStyle(surf);
      const bs = body ? getComputedStyle(body) : null;

      // A media deck carries no text, so line counts say nothing about whether
      // it painted. Record the image element itself.
      const media = document.querySelector('.pp-deck.preview .slide-media') as
        (HTMLImageElement & HTMLVideoElement) | null;
      const ms = media ? getComputedStyle(media) : null;
      const mr = media?.getBoundingClientRect();

      void api.app.diag('preview-surface', {
        deckTitle: preview?.title ?? null,
        deckKind: preview?.kind ?? null,
        slideCount: preview?.slides?.length ?? 0,
        host: `${Math.round(hr.width)}x${Math.round(hr.height)}`,
        surface: `${Math.round(sr.width)}x${Math.round(sr.height)}`,
        transform: cs.transform,
        opacity: cs.opacity,
        visibility: cs.visibility,
        surfaceBg: cs.backgroundImage.slice(0, 70),
        bodyPresent: !!body,
        bodyColor: bs?.color ?? null,
        bodyFontSize: bs?.fontSize ?? null,
        lineCount: lines.length,
        firstLineChars: lines[0]?.textContent?.length ?? 0,
        devicePixelRatio: window.devicePixelRatio,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        // Media specifics
        mediaExpected: !!(preview?.meta?.mediaFile),
        mediaElement: !!media,
        mediaTag: media?.tagName ?? null,
        mediaSrc: media?.getAttribute('src')?.slice(-70) ?? null,
        mediaComplete: media ? (media as HTMLImageElement).complete ?? null : null,
        mediaNaturalWidth: media ? (media as HTMLImageElement).naturalWidth ?? null : null,
        mediaRect: mr ? `${Math.round(mr.width)}x${Math.round(mr.height)}` : null,
        mediaOpacity: ms?.opacity ?? null,
        mediaDisplay: ms?.display ?? null,
        mediaZ: ms?.zIndex ?? null,
      }).catch(() => {});
    }, 900);
    return () => window.clearTimeout(id);
  }, [preview?.title, preview?.slides?.length, preview?.kind]);

  return (
    <section className="pp" aria-label="Preview and program">
      <div className="pp-decks">
        {/* -------------------------------------------------------- preview */}
        <div className="pp-deck preview">
          <header className="pp-head">
            <span className="chip preview">Preview</span>
            <span className="pp-title truncate">{preview?.title || 'Nothing staged'}</span>
            {preview?.slides?.length ? (
              <span className="pp-count mono">{preview.index + 1}/{preview.slides.length}</span>
            ) : null}
          </header>
          <div className="pp-surface">
            <SlideSurface
              slide={previewSlide}
              deck={preview}
              theme={live?.theme ?? null}
              showVerseNumbers={showVerseNumbers}
            />
          </div>
          <footer className="pp-foot">
            <button className="btn sm" onClick={() => void api.live.stepPreview(-1)} disabled={!preview?.slides?.length}>
              ← Prev
            </button>
            <button className="btn sm" onClick={() => void api.live.stepPreview(1)} disabled={!preview?.slides?.length}>
              Next →
            </button>
          </footer>
        </div>

        {/* --------------------------------------------------------- take */}
        <div className="pp-take">
          <button
            className="btn live pp-take-btn"
            onClick={() => void take()}
            disabled={!preview?.slides?.length}
            title="Send preview to the audience screen (Space)"
          >
            TAKE
            <span className="kbd">Space</span>
          </button>
        </div>

        {/* -------------------------------------------------------- program */}
        <div className={`pp-deck program ${onAir ? 'on-air' : ''}`}>
          <header className="pp-head">
            <span className={`chip ${onAir ? 'live' : ''}`}>
              {live?.blackout ? 'Blackout' : live?.cleared ? 'Cleared' : onAir ? '● On Air' : 'Program'}
            </span>
            <span className="pp-title truncate">{program?.title || 'Nothing live'}</span>
            {program?.slides?.length ? (
              <span className="pp-count mono">{program.index + 1}/{program.slides.length}</span>
            ) : null}
          </header>
          <div className="pp-surface">
            <SlideSurface
              slide={programSlide}
              deck={program}
              theme={live?.theme ?? null}
              blackout={live?.blackout ?? false}
              cleared={live?.cleared ?? false}
              logo={live?.logo ?? false}
              showVerseNumbers={showVerseNumbers}
            />
          </div>
          <footer className="pp-foot">
            <button className="btn sm" onClick={() => void api.live.step(-1)} disabled={!program?.slides?.length}>
              ← Back
            </button>
            <button className="btn sm" onClick={() => void api.live.step(1)} disabled={!program?.slides?.length}>
              Advance →
            </button>
            <div className="pp-foot-spacer" />
            <span className="pp-next truncate faint">
              {nextSlideOf(program)?.lines[0] ?? '— end —'}
            </span>
          </footer>
        </div>
      </div>

      {/* ---------------------------------------------------- live controls */}
      <div className="pp-controls">
        <button
          className={`btn ${live?.blackout ? 'live' : ''}`}
          onClick={() => void api.live.blackout()}
          title="Cut the audience screen to black (Esc)"
        >
          Blackout <span className="kbd">Esc</span>
        </button>
        <button className={`btn ${live?.cleared ? 'primary' : ''}`} onClick={() => void api.live.clear()}>
          Clear
        </button>
        <button className={`btn ${live?.logo ? 'primary' : ''}`} onClick={() => void api.live.logo()}>
          Logo
        </button>
        <button className="btn" onClick={() => void api.live.restore()}>Restore</button>
      </div>
    </section>
  );
}
