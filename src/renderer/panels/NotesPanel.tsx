/**
 * Sermon notes: write an outline, then run it live.
 *
 * Two projection modes, because they serve different rooms. "Outline" shows the
 * whole message with the live point emphasised, so the congregation can see
 * where they are; "Point" shows one point large, which reads better from the
 * back of a big hall. The operator follows the preacher with Next/Back, or
 * jumps straight to a point by clicking it.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type Sermon } from '../../shared/api';
import { useApp } from '../stores/app';
import { IconPlus, IconTrash, IconChevron } from '../components/Icons';

type Mode = 'outline' | 'point';

export function NotesPanel() {
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const live = useApp((s) => s.live);
  const toast = useApp((s) => s.toast);

  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [mode, setMode] = useState<Mode>('outline');
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await api.sermons.all().catch(() => []);
    setSermons(all);
    return all;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!openId) { setSermon(null); return; }
    let cancelled = false;
    api.sermons.get(openId).then((s) => { if (!cancelled) setSermon(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [openId, sermons]);

  const create = useCallback(async () => {
    const s = await api.sermons.create({});
    await refresh();
    setOpenId(s.id);
  }, [refresh]);

  const patch = useCallback(async (fields: Partial<Sermon>) => {
    if (!sermon) return;
    const next = await api.sermons.update(sermon.id, fields);
    setSermon(next);
    await refresh();
  }, [sermon, refresh]);

  const patchPoint = useCallback(async (pointId: string, fields: Record<string, unknown>) => {
    if (!sermon) return;
    await api.sermons.updatePoint(sermon.id, pointId, fields);
    setSermon(await api.sermons.get(sermon.id));
  }, [sermon]);

  const addPoint = useCallback(async (after: number | null = null) => {
    if (!sermon) return;
    const point = await api.sermons.addPoint(sermon.id, 'New point', after);
    setSermon(await api.sermons.get(sermon.id));
    setEditing(point.id);
  }, [sermon]);

  const removePoint = useCallback(async (pointId: string) => {
    if (!sermon) return;
    await api.sermons.removePoint(sermon.id, pointId);
    setSermon(await api.sermons.get(sermon.id));
  }, [sermon]);

  const movePoint = useCallback(async (from: number, to: number) => {
    if (!sermon || to < 0 || to >= sermon.points.length) return;
    await api.sermons.movePoint(sermon.id, from, to);
    setSermon(await api.sermons.get(sermon.id));
  }, [sermon]);

  /** Stage the outline, optionally jumping straight to one point. */
  const stage = useCallback(async (at = 0, take = false) => {
    if (!sermon) return;
    try {
      const slides = await api.sermons.slides(sermon.id, { mode });
      if (!slides.length) { toast('Add a point before projecting', 'warn'); return; }
      const deck = {
        kind: 'sermon' as const,
        title: sermon.title,
        slides,
        index: Math.max(0, Math.min(at, slides.length - 1)),
        meta: { sermonId: sermon.id },
      };
      if (take) await previewAndTake(deck); else await preview(deck);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [sermon, mode, preview, previewAndTake, toast]);

  // Which point is currently on the audience screen, so the editor can mark it.
  const liveSermonId = live?.program?.meta?.sermonId as string | undefined;
  const livePoint = liveSermonId === sermon?.id
    ? (live?.program?.slides?.[live.program.index] as { pointIndex?: number } | undefined)?.pointIndex
    : undefined;

  // ---------------------------------------------------------------- listing

  if (!sermon) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Sermon Notes</h2>
          <div className="panel-head-spacer" />
          <button className="btn sm" onClick={() => void create()}><IconPlus size={12} /> New</button>
        </div>
        <div className="panel-scroll">
          {!sermons.length ? (
            <div className="empty">
              <div className="empty-title">No sermon notes yet</div>
              <div className="empty-body">
                Write the outline before the service, then follow the preacher live —
                the congregation sees the point being made, with the rest of the message
                dimmed around it.
              </div>
              <button className="btn primary" onClick={() => void create()}>
                <IconPlus size={12} /> Start a set of notes
              </button>
            </div>
          ) : sermons.map((s) => (
            <div
              key={s.id}
              className="list-row"
              onClick={() => setOpenId(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(s.id); }}
            >
              <div className="list-main">
                <div className="list-title truncate">{s.title}</div>
                <div className="list-sub truncate">
                  {[s.date, s.speaker, s.passage, `${s.points.length} points`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="list-actions">
                <button
                  className="btn sm icon ghost"
                  onClick={async (e) => { e.stopPropagation(); await api.sermons.remove(s.id); await refresh(); }}
                  title="Delete"
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- editor

  return (
    <div className="panel">
      <div className="panel-head">
        <button className="btn sm ghost" onClick={() => setOpenId(null)}>←</button>
        <h2 className="panel-title truncate">{sermon.title}</h2>
        <div className="panel-head-spacer" />
        <select
          className="select"
          style={{ width: 'auto' }}
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          title="How the outline appears on screen"
        >
          <option value="outline">Outline · highlight live point</option>
          <option value="point">One point at a time</option>
        </select>
      </div>

      <div className="panel-toolbar">
        <button className="btn sm" onClick={() => void stage(0)}>Preview</button>
        <button className="btn sm live" onClick={() => void stage(0, true)}>Take from start</button>
        <div className="panel-head-spacer" />
        <button className="btn sm" onClick={() => void addPoint(null)}><IconPlus size={12} /> Point</button>
      </div>

      <div className="panel-scroll panel-pad">
        <div className="field-row">
          <div className="field">
            <span className="field-label">Title</span>
            <input className="input" value={sermon.title} onChange={(e) => void patch({ title: e.target.value })} />
          </div>
          <div className="field">
            <span className="field-label">Speaker</span>
            <input className="input" value={sermon.speaker} onChange={(e) => void patch({ speaker: e.target.value })} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <span className="field-label">Passage</span>
            <input
              className="input"
              placeholder="e.g. Hebrews 11:1-6"
              value={sermon.passage}
              onChange={(e) => void patch({ passage: e.target.value })}
            />
          </div>
          <div className="field">
            <span className="field-label">Date</span>
            <input className="input" type="date" value={sermon.date} onChange={(e) => void patch({ date: e.target.value })} />
          </div>
        </div>

        <div className="settings-group">
          <span className="section-label">Outline</span>
          <p className="field-hint" style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>
            Click a point to project it. The live one is marked here and emphasised on screen.
          </p>

          {sermon.points.map((point, i) => {
            const isLive = livePoint === i;
            return (
              <div key={point.id} className={`point-row ${isLive ? 'live' : ''}`}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="point-num mono">{i + 1}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editing === point.id ? (
                      <input
                        className="input"
                        autoFocus
                        value={point.text}
                        onChange={(e) => void patchPoint(point.id, { text: e.target.value })}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { setEditing(null); void addPoint(i); }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        className="point-text"
                        onClick={() => void stage(i)}
                        onDoubleClick={() => void stage(i, true)}
                        title="Click to preview this point · double-click to take"
                      >
                        {point.text || <span className="faint">Empty point</span>}
                      </button>
                    )}

                    {!!point.subPoints?.length && (
                      <div className="point-subs">
                        {point.subPoints.map((sub, j) => (
                          <div key={j} className="point-sub truncate">{sub}</div>
                        ))}
                      </div>
                    )}

                    {point.ref && <span className="chip accent" style={{ marginTop: 4 }}>{point.ref}</span>}
                  </div>

                  <div className="point-actions">
                    {isLive && <span className="chip live">live</span>}
                    <button className="btn sm ghost" onClick={() => setEditing(point.id)} title="Rename">Edit</button>
                    <button className="btn sm live" onClick={() => void stage(i, true)}>Take</button>
                    <button
                      className="btn sm icon ghost"
                      onClick={() => void movePoint(i, i - 1)}
                      disabled={i === 0}
                      title="Move up"
                    >
                      <IconChevron size={11} className="rot-up" />
                    </button>
                    <button
                      className="btn sm icon ghost"
                      onClick={() => void movePoint(i, i + 1)}
                      disabled={i === sermon.points.length - 1}
                      title="Move down"
                    >
                      <IconChevron size={11} className="rot-down" />
                    </button>
                    <button className="btn sm icon ghost" onClick={() => void removePoint(point.id)} title="Delete">
                      <IconTrash size={11} />
                    </button>
                  </div>
                </div>

                <div className="field-row" style={{ marginTop: 'var(--sp-2)' }}>
                  <input
                    className="input"
                    placeholder="Scripture for this point (optional)"
                    value={point.ref}
                    onChange={(e) => void patchPoint(point.id, { ref: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Sub-points, separated by |"
                    value={(point.subPoints ?? []).join(' | ')}
                    onChange={(e) => void patchPoint(point.id, {
                      subPoints: e.target.value.split('|').map((t) => t.trim()).filter(Boolean),
                    })}
                  />
                </div>
              </div>
            );
          })}

          <button className="btn" style={{ marginTop: 'var(--sp-3)' }} onClick={() => void addPoint(null)}>
            <IconPlus size={12} /> Add a point
          </button>
        </div>
      </div>
    </div>
  );
}
