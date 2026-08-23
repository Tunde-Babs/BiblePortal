/**
 * Stage display — the confidence monitor facing the platform.
 *
 * Shows the band and the speaker what the congregation is seeing, plus the
 * things only they need: what is coming next, the clock, and chords. It follows
 * program (never preview) so it can never disagree with the room.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '../renderer/components/ErrorBoundary';

import { useLiveState } from '../shared/useLiveState';
import { slideOf, nextSlideOf, captionOf } from '../shared/slide-render';

import './stage.css';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Countdown to a target time, formatted mm:ss (or hh:mm:ss when long). */
function useCountdown(endsAt: number | null | undefined) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!endsAt) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [endsAt]);
  return remaining;
}

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function Stage() {
  const live = useLiveState();
  const now = useClock();
  const countdown = useCountdown(live?.countdown?.endsAt);

  useEffect(() => { document.body.style.cursor = 'none'; }, []);

  const deck = live?.program ?? null;
  const current = slideOf(deck);
  const next = nextSlideOf(deck);
  const isBlank = !current || live?.blackout || live?.cleared;

  // The stage screen must say *why* the room is dark, or the band assumes a fault.
  const blankReason = live?.blackout ? 'BLACKOUT' : live?.cleared ? 'SCREEN CLEARED' : 'NOTHING LIVE';

  return (
    <div className="stage-root">
      <header className="stage-bar">
        <div className="stage-bar-left">
          <span className={`stage-tally ${isBlank ? 'off' : 'on'}`} />
          <span className="stage-deck-title">{deck?.title || 'Standing by'}</span>
          {deck?.meta?.key ? <span className="stage-key">{String(deck.meta.key)}</span> : null}
        </div>
        <div className="stage-bar-right">
          {live?.countdown && (
            <span className={`stage-countdown ${countdown <= 30 ? 'urgent' : ''}`}>
              {live.countdown.label ? `${live.countdown.label} ` : ''}{formatDuration(countdown)}
            </span>
          )}
          <span className="stage-clock">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </header>

      <main className="stage-main">
        {isBlank ? (
          <div className="stage-blank">{blankReason}</div>
        ) : (
          <>
            <div className="stage-current">
              {(current.chordLines ?? current.lines).map((line, i) => (
                <div className="stage-line" key={i}>{line}</div>
              ))}
            </div>
            {captionOf(current, deck) && (
              <div className="stage-caption">{captionOf(current, deck)}</div>
            )}
          </>
        )}
      </main>

      <footer className="stage-next">
        <div className="stage-next-label">Next</div>
        <div className="stage-next-body">
          {next
            ? (next.chordLines ?? next.lines).slice(0, 2).join(' / ')
            : <span className="stage-next-end">End of item</span>}
        </div>
        {deck?.slides?.length ? (
          <div className="stage-progress">{(deck.index ?? 0) + 1} / {deck.slides.length}</div>
        ) : null}
      </footer>

      {live?.stage?.notes && <div className="stage-notes">{live.stage.notes}</div>}

      {live?.alert && (
        <div className={`stage-alert ${live.alert.style}`}>{live.alert.text}</div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary area={'The stage display'}><Stage /></ErrorBoundary>
  </StrictMode>,
);
