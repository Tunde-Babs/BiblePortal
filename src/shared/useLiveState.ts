/**
 * Subscribes a window to the live presentation state.
 *
 * Used by the output and stage displays, which are otherwise passive: they hold
 * no state of their own, they only render whatever the main process last sent.
 */

import { useEffect, useState } from 'react';
import type { LiveStateShape } from './types';

export function useLiveState(): LiveStateShape | null {
  const [state, setState] = useState<LiveStateShape | null>(null);

  useEffect(() => {
    const bp = window.bp;

    // No bridge means we are being rendered in a plain browser — an OBS
    // Browser Source pointed at the local output server. Take state from the
    // event stream instead; EventSource reconnects on its own if OBS restarts
    // the source mid-service.
    if (!bp) {
      const source = new EventSource('/live');
      source.onmessage = (e) => {
        try { setState(JSON.parse(e.data) as LiveStateShape); } catch { /* keep last good frame */ }
      };
      return () => source.close();
    }

    let cancelled = false;
    // Pull once on mount — a window opened mid-service must not start blank.
    (bp.live.get() as Promise<{ ok: boolean; state: LiveStateShape }>)
      .then((res) => { if (!cancelled && res?.state) setState(res.state); })
      .catch(() => {});

    const off = bp.on(bp.EVENTS.LIVE_CHANGED, (next: never) => setState(next as LiveStateShape));
    return () => { cancelled = true; off(); };
  }, []);

  return state;
}
