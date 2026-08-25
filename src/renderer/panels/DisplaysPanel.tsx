/**
 * Screens panel — routing the audience and stage outputs to real monitors.
 *
 * Monitors get unplugged mid-service, so the list refreshes on a display change
 * event as well as on a timer, and every screen shows its resolution so the
 * operator can tell two identical-looking entries apart.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type DisplayInfo, type OutputServerStatus } from '../../shared/api';
import { useApp } from '../stores/app';

export function DisplaysPanel() {
  const toast = useApp((s) => s.toast);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [open, setOpen] = useState({ output: false, stage: false });
  const [server, setServer] = useState<OutputServerStatus | null>(null);
  const [port, setPort] = useState(7373);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await api.displays.status();
      setDisplays(status.displays);
      setOpen({ output: status.output, stage: status.stage });
    } catch { /* the window may be closing */ }
    try {
      const s = await api.outputServer.status();
      setServer(s);
      if (s.port) setPort(s.port);
    } catch { /* ditto */ }
  }, []);

  const toggleServer = useCallback(async () => {
    setBusy(true);
    try {
      const next = server?.running
        ? await api.outputServer.stop()
        : await api.outputServer.start({ port });
      setServer(next);
      if (next.running) toast(`Output server on port ${next.port}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setBusy(false); }
  }, [server, port, toast]);

  const copyUrl = useCallback(async () => {
    if (!server?.url) return;
    await navigator.clipboard.writeText(server.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [server]);

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

        <div className="settings-group">
          <span className="section-label">Stream to OBS</span>
          <p className="field-hint" style={{ marginBottom: 'var(--sp-3)' }}>
            Serves the audience output to OBS on this machine. Add a{' '}
            <strong>Browser Source</strong> in OBS and paste the address below — OBS draws the
            page itself, so there’s no video encoding and nothing to go soft or out of sync.
          </p>

          <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
            <button
              className={`btn ${server?.running ? '' : 'primary'}`}
              onClick={() => void toggleServer()}
              disabled={busy}
            >
              {server?.running ? 'Stop server' : 'Start server'}
            </button>
            {!server?.running && (
              <label className="row" style={{ gap: 'var(--sp-2)' }}>
                <span className="field-label" style={{ margin: 0 }}>Port</span>
                <input
                  className="input"
                  style={{ width: 84 }}
                  type="number"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 7373)}
                />
              </label>
            )}
            {server?.running && (
              <span className={`chip ${server.clients ? 'accent' : ''}`}>
                {server.clients
                  ? `${server.clients} source${server.clients === 1 ? '' : 's'} connected`
                  : 'waiting for OBS'}
              </span>
            )}
          </div>

          {server?.running && (
            <div className="card">
              <span className="field-label">Browser Source URL</span>
              <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
                <code className="mono" style={{ flex: 1, userSelect: 'all' }}>{server.url}</code>
                <button className="btn sm" onClick={() => void copyUrl()}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <span className="field-hint" style={{ marginTop: 'var(--sp-3)', display: 'block' }}>
                In OBS: <strong>Sources → + → Browser</strong>, paste the URL, and set the size to
                your output resolution (1920 × 1080). Leave “Shutdown source when not visible”
                unticked so it stays connected through the service.
              </span>

              <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line-soft)' }}>
                <span className="field-label">Cropped or the wrong size?</span>
                <span className="field-hint" style={{ display: 'block', margin: 'var(--sp-2) 0' }}>
                  Point the Browser Source at the address below instead. If you can see all four
                  green corners and the whole red border, nothing is being cropped. If you can’t,
                  the crop is in OBS: select the source and press <strong>⌘R</strong> to reset its
                  transform, or <strong>⌘F</strong> to fit it to the canvas — OBS keeps a source’s
                  old scale when you change its width and height.
                </span>
                <div className="row">
                  <code className="mono" style={{ flex: 1, userSelect: 'all' }}>
                    {server.url.replace(/\/output$/, '/test')}
                  </code>
                  <button
                    className="btn sm"
                    onClick={() => void navigator.clipboard.writeText(server.url.replace(/\/output$/, '/test'))}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
