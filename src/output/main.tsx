/**
 * Audience display — what the congregation sees.
 *
 * Deliberately minimal: it renders the program deck and nothing else. No
 * controls, no state, no way for a stray click to change what is on screen.
 */

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '../renderer/components/ErrorBoundary';

import { SlideSurface } from '../shared/SlideSurface';
import { useLiveState } from '../shared/useLiveState';
import { slideOf } from '../shared/slide-render';

import '../shared/slide-surface.css';
import './output.css';

function Output() {
  const live = useLiveState();

  // The audience screen never shows a cursor.
  useEffect(() => { document.body.style.cursor = 'none'; }, []);

  const deck = live?.program ?? null;
  const slide = slideOf(deck);

  return (
    <div className="output-root">
      {/* Media is rendered by SlideSurface itself, so the console preview and
          this window cannot drift apart. */}
      <SlideSurface
        slide={slide}
        deck={deck}
        theme={live?.theme ?? null}
        blackout={live?.blackout ?? false}
        cleared={live?.cleared ?? false}
        logo={live?.logo ?? false}
        showVerseNumbers
      />

      {/* Alerts overlay everything except blackout — nursery calls, emergencies. */}
      {live?.alert && !live.blackout && (
        <div className={`output-alert ${live.alert.style}`}>
          <span>{live.alert.text}</span>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary area={'The audience display'}><Output /></ErrorBoundary>
  </StrictMode>,
);
