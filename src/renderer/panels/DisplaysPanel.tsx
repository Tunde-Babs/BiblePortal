/**
 * Screens panel — routing the audience and stage outputs to real monitors.
 *
 * Monitors get unplugged mid-service, so the list refreshes on a display change
 * event as well as on a timer, and every screen shows its resolution so the
 * operator can tell two identical-looking entries apart.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type DisplayInfo } from '../../shared/api';
import { useApp } from '../stores/app';

export function DisplaysPanel() {
  const toast = useApp((s) => s.toast);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [open, setOpen] = useState({ output: false, stage: false });

  const refresh = useCallback(async () => {
    try {
      const status = await api.displays.status();
      setDisplays(status.displays);
      setOpen({ output: status.output, stage: status.stage });
    } catch { /* the window may be closing */ }
  }, []);

  useEffect(() => {
    void refresh();
    const off = api.on(api.events().DISPLAYS_CHANGED, () => void refresh());
    const id = setInterval(() => void refresh(), 3000);
    return () => { off(); clearInterval(id); };
  }, [refresh]);

  const openOn = useCallback(async (kind: 'output' | 'stage', screenId: string) => {
    try {
      await api.displays.open(kind, screenId);
      await refresh();
      toast(`${kind === 'output' ? 'Audience' : 'Stage'} display opened`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refresh, toast]);

  const close = useCallback(async (kind: 'output' | 'stage') => {
    await api.displays.close(kind);
    await refresh();
  }, [refresh]);

  const singleScreen = displays.length <= 1;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Screens</h2>
        <div className="panel-head-spacer" />
        <button className="btn sm ghost" onClick={() => void refresh()}>Refresh</button>
      </div>

      <div className="panel-scroll panel-pad">
        {singleScreen && (
          <div className="notice warn" style={{ marginBottom: 'var(--sp-5)' }}>
            <strong>One screen detected.</strong> You can still open the outputs to test them —
            they’ll appear as windows on this display rather than going full-screen.
            Connect a projector or second monitor before the service.
          </div>
        )}

        <div className="settings-group">
          <span className="section-label">Audience display</span>
          <p className="field-hint" style={{ marginBottom: 'var(--sp-3)' }}>
            What the congregation sees. Shows the program deck only.
          </p>
          <div className="stack">
            {displays.map((d) => (
              <div key={`out_${d.id}`} className="card row">
                <div style={{ flex: 1 }}>
                  <div className="list-title">{d.label}</div>
                  <div className="list-sub mono">{d.size} · {d.scaleFactor}× scale{d.internal ? ' · built-in' : ''}</div>
                </div>
                {d.inUse.output ? (
                  <>
                    <span className="chip live">In use</span>
                    <button className="btn sm" onClick={() => void close('output')}>Close</button>
                  </>
                ) : (
                  <button className="btn sm primary" onClick={() => void openOn('output', d.id)}>
                    Use this screen
                  </button>
                )}
              </div>
            ))}
          </div>
          {open.output && (
            <button className="btn" style={{ marginTop: 'var(--sp-3)' }} onClick={() => void close('output')}>
              Close audience display
            </button>
          )}
        </div>

        <div className="settings-group">
          <span className="section-label">Stage display</span>
          <p className="field-hint" style={{ marginBottom: 'var(--sp-3)' }}>
            The confidence monitor facing the platform: current slide, what’s next, the clock.
          </p>
          <div className="stack">
            {displays.map((d) => (
              <div key={`stage_${d.id}`} className="card row">
                <div style={{ flex: 1 }}>
                  <div className="list-title">{d.label}</div>
                  <div className="list-sub mono">{d.size} · {d.scaleFactor}× scale{d.internal ? ' · built-in' : ''}</div>
                </div>
                {d.inUse.stage ? (
                  <>
                    <span className="chip accent">In use</span>
                    <button className="btn sm" onClick={() => void close('stage')}>Close</button>
                  </>
                ) : (
                  <button className="btn sm" onClick={() => void openOn('stage', d.id)}>Use this screen</button>
                )}
              </div>
            ))}
          </div>
          {open.stage && (
            <button className="btn" style={{ marginTop: 'var(--sp-3)' }} onClick={() => void close('stage')}>
              Close stage display
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
