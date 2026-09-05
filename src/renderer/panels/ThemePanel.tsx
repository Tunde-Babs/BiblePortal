/**
 * Theme designer.
 *
 * Every control writes straight through to the live theme, so the preview and
 * the audience screen update as the operator drags — there is no "apply" step
 * to forget before the service starts.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../shared/api';
import { fileUrl } from '../../shared/file-url';
import type { Backdrop, MediaItem, Theme } from '../../shared/types';

/** The three backgrounds a theme can carry, in the order they are shown. */
type BackdropSlot = 'scripture' | 'song' | 'default';

const SLOTS: { slot: BackdropSlot; label: string; hint: string }[] = [
  { slot: 'scripture', label: 'Scripture', hint: 'Behind Bible verses' },
  { slot: 'song', label: 'Songs', hint: 'Behind song lyrics' },
  { slot: 'default', label: 'Everything else', hint: 'Sermons, slides, announcements' },
];
import { useApp } from '../stores/app';

const FONTS = [
  { label: 'Inter (sans)', value: "'Inter', system-ui, -apple-system, sans-serif" },
  { label: 'System sans', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: 'Georgia (serif)', value: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  { label: 'Palatino (serif)', value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Avenir', value: "'Avenir Next', Avenir, 'Segoe UI', sans-serif" },
];

const PRESETS: { name: string; from: string; to: string; text: string; ref: string }[] = [
  { name: 'Sanctuary', from: '#0b1020', to: '#131a33', text: '#ffffff', ref: '#9db4ff' },
  { name: 'Midnight', from: '#000000', to: '#0a0a0a', text: '#ffffff', ref: '#8a8a8a' },
  { name: 'Deep Ocean', from: '#04141f', to: '#0a2c3d', text: '#eaf6ff', ref: '#6fc4e8' },
  { name: 'Warm Stone', from: '#1a1410', to: '#2e241b', text: '#fdf6ec', ref: '#e0b57a' },
  { name: 'Vineyard', from: '#150a1c', to: '#2a1338', text: '#f6ecff', ref: '#c79aec' },
  { name: 'Forest', from: '#08150f', to: '#12281c', text: '#eefaf2', ref: '#7fd6a3' },
];

export function ThemePanel() {
  const live = useApp((s) => s.live);
  const toast = useApp((s) => s.toast);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  /** Which backdrop slot the media picker is choosing for. */
  const [picking, setPicking] = useState<BackdropSlot | null>(null);

  useEffect(() => { api.themes.active().then(setTheme).catch(() => {}); }, []);
  useEffect(() => { api.media.all().then(setLibrary).catch(() => {}); }, []);
  // Keep in step when another surface changes the theme.
  useEffect(() => { if (live?.theme) setTheme(live.theme); }, [live?.theme]);

  /** Patch a nested section of the theme and persist immediately. */
  const patch = useCallback(async (part: Partial<Theme>) => {
    if (!theme) return;
    const next = { ...theme, ...part } as Theme;
    setTheme(next);
    try { await api.themes.save(next); }
    catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
  }, [theme, toast]);

  /** Replace one backdrop slot, or clear it with null. */
  const setBackdrop = useCallback(async (slot: BackdropSlot, value: Backdrop | null) => {
    if (!theme) return;
    await patch({ backdrops: { ...theme.backdrops, [slot]: value } });
  }, [theme, patch]);

  const choose = useCallback(async (slot: BackdropSlot, item: MediaItem) => {
    const existing = theme?.backdrops?.[slot];
    await setBackdrop(slot, {
      file: item.file,
      kind: item.kind,
      // Keep the look already dialled in when swapping the picture itself.
      fit: existing?.fit ?? 'cover',
      opacity: existing?.opacity ?? 1,
      dim: existing?.dim ?? 0.35,
      blur: existing?.blur ?? 0,
    });
    setPicking(null);
  }, [theme, setBackdrop]);

  if (!theme) return <div className="panel"><div className="panel-head"><h2 className="panel-title">Theme</h2></div></div>;

  const t = theme.text;
  const bg = theme.background;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Theme</h2>
        <div className="panel-head-spacer" />
        <span className="chip accent">{theme.name}</span>
      </div>

      <div className="panel-scroll panel-pad">
        <div className="settings-group">
          <span className="section-label">Presets</span>
          <div className="grid-3" style={{ marginTop: 'var(--sp-3)' }}>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className="card"
                style={{
                  padding: 0, height: 56, overflow: 'hidden', cursor: 'pointer',
                  background: `linear-gradient(160deg, ${p.from}, ${p.to})`,
                  borderColor: bg.from === p.from ? 'var(--accent)' : 'var(--line)',
                }}
                onClick={() => void patch({
                  name: p.name,
                  background: { ...bg, type: 'gradient', from: p.from, to: p.to },
                  text: { ...t, color: p.text },
                  reference: { ...theme.reference, color: p.ref },
                })}
                title={p.name}
              >
                <span style={{ color: p.text, fontSize: 'var(--fs-xs)', fontWeight: 600 }}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <span className="section-label">Background</span>
          <div className="field-row" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="field">
              <span className="field-label">From</span>
              <input type="color" className="input" style={{ padding: 2, height: 32 }}
                value={bg.from} onChange={(e) => void patch({ background: { ...bg, from: e.target.value } })} />
            </div>
            <div className="field">
              <span className="field-label">To</span>
              <input type="color" className="input" style={{ padding: 2, height: 32 }}
                value={bg.to} onChange={(e) => void patch({ background: { ...bg, to: e.target.value } })} />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Angle — {bg.angle}°</span>
            <input type="range" min={0} max={360} value={bg.angle}
              onChange={(e) => void patch({ background: { ...bg, angle: Number(e.target.value) } })} />
          </div>
        </div>

        <div className="settings-group">
          <span className="section-label">Backgrounds</span>
          <p className="field-hint" style={{ marginBottom: 'var(--sp-3)' }}>
            A still or motion loop behind the words, chosen separately for scripture and
            songs. Media sent for one particular item still takes precedence over these.
          </p>

          {SLOTS.map(({ slot, label, hint }) => {
            const b = theme.backdrops?.[slot] ?? null;
            const item = b ? library.find((m) => m.file === b.file) : null;
            return (
              <div className="card" key={slot} style={{ marginBottom: 'var(--sp-3)' }}>
                <div className="row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">{label}</div>
                    <div className="list-sub truncate">
                      {b ? `${item?.name ?? 'Chosen file'} · ${b.kind}` : hint}
                    </div>
                  </div>
                  {b && (
                    <button className="btn sm ghost" onClick={() => void setBackdrop(slot, null)}>
                      Clear
                    </button>
                  )}
                  <button
                    className={`btn sm ${b ? '' : 'primary'}`}
                    onClick={() => setPicking(picking === slot ? null : slot)}
                  >
                    {b ? 'Change' : 'Choose'}
                  </button>
                </div>

                {b && (
                  <>
                    <div className="field-row" style={{ marginTop: 'var(--sp-3)' }}>
                      <div className="field">
                        <span className="field-label">Dim — {Math.round(b.dim * 100)}%</span>
                        <input
                          type="range" min={0} max={90} value={Math.round(b.dim * 100)}
                          onChange={(e) => void setBackdrop(slot, { ...b, dim: Number(e.target.value) / 100 })}
                        />
                      </div>
                      <div className="field">
                        <span className="field-label">Blur — {b.blur}px</span>
                        <input
                          type="range" min={0} max={24} value={b.blur}
                          onChange={(e) => void setBackdrop(slot, { ...b, blur: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <span className="field-hint">
                      Dim darkens the picture so white text stays readable over it.
                    </span>
                  </>
                )}

                {picking === slot && (
                  <div style={{ marginTop: 'var(--sp-3)' }}>
                    {library.length === 0 ? (
                      <span className="field-hint">
                        Nothing in your media library yet — add images or loops in the Media tab first.
                      </span>
                    ) : (
                      <div className="backdrop-grid">
                        {library.map((m) => (
                          <button
                            key={m.id}
                            className={`backdrop-tile ${b?.file === m.file ? 'chosen' : ''}`}
                            onClick={() => void choose(slot, m)}
                            title={m.name}
                          >
                            {m.kind === 'video' ? (
                              <video src={fileUrl(m.file)} muted playsInline preload="metadata" />
                            ) : (
                              <img src={fileUrl(m.file)} alt="" />
                            )}
                            <span className="backdrop-name truncate">{m.name}</span>
                            {m.kind === 'video' && <span className="backdrop-badge">MOTION</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="settings-group">
          <span className="section-label">Body text</span>
          <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
            <span className="field-label">Typeface</span>
            <select className="select" value={t.fontFamily} onChange={(e) => void patch({ text: { ...t, fontFamily: e.target.value } })}>
              {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Size — {t.size}px{t.autoFit !== false && ' at most'}</span>
            <input type="range" min={30} max={160} value={t.size}
              onChange={(e) => void patch({ text: { ...t, size: Number(e.target.value) } })} />
            <span className="field-hint">
              {t.autoFit !== false
                ? 'The size used when the words fit. A longer passage is measured against the screen and reduced only as far as it must be.'
                : 'Every slide uses exactly this size. A long passage will run off the screen.'}
            </span>
          </div>
          <div className="switch-row">
            <div>
              <div className="switch-label">Shrink long passages to fit</div>
              <div className="switch-desc">Measures each slide against the screen instead of guessing from its length</div>
            </div>
            <button
              className={`switch ${t.autoFit !== false ? 'on' : ''}`}
              onClick={() => void patch({ text: { ...t, autoFit: t.autoFit === false } })}
              aria-pressed={t.autoFit !== false}
            />
          </div>
          {t.autoFit !== false && (
            <div className="field">
              <span className="field-label">Never smaller than — {t.minSize ?? 34}px</span>
              <input
                type="range" min={16} max={Math.max(16, t.size)} value={Math.min(t.minSize ?? 34, t.size)}
                onChange={(e) => void patch({ text: { ...t, minSize: Number(e.target.value) } })}
              />
              <span className="field-hint">
                A passage that still will not fit at this size is left to overflow rather than shrunk past reading distance —
                raise the verses-per-slide setting instead.
              </span>
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <span className="field-label">Weight</span>
              <select className="select" value={t.weight} onChange={(e) => void patch({ text: { ...t, weight: Number(e.target.value) } })}>
                {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Align</span>
              <select className="select" value={t.align} onChange={(e) => void patch({ text: { ...t, align: e.target.value as Theme['text']['align'] } })}>
                <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
              </select>
            </div>
            <div className="field">
              <span className="field-label">Colour</span>
              <input type="color" className="input" style={{ padding: 2, height: 32 }}
                value={t.color} onChange={(e) => void patch({ text: { ...t, color: e.target.value } })} />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Line height — {t.lineHeight.toFixed(2)}</span>
            <input type="range" min={1} max={2} step={0.02} value={t.lineHeight}
              onChange={(e) => void patch({ text: { ...t, lineHeight: Number(e.target.value) } })} />
          </div>
          <div className="switch-row">
            <div><div className="switch-label">Drop shadow</div><div className="switch-desc">Keeps text readable over busy backgrounds</div></div>
            <button className={`switch ${t.shadow ? 'on' : ''}`} onClick={() => void patch({ text: { ...t, shadow: !t.shadow } })} aria-pressed={t.shadow} />
          </div>
          <div className="switch-row">
            <div><div className="switch-label">Uppercase</div></div>
            <button className={`switch ${t.uppercase ? 'on' : ''}`} onClick={() => void patch({ text: { ...t, uppercase: !t.uppercase } })} aria-pressed={t.uppercase} />
          </div>
        </div>

        <div className="settings-group">
          <span className="section-label">Reference line</span>
          <div className="switch-row">
            <div><div className="switch-label">Show reference</div><div className="switch-desc">The verse citation or song section under the text</div></div>
            <button className={`switch ${theme.reference.show ? 'on' : ''}`}
              onClick={() => void patch({ reference: { ...theme.reference, show: !theme.reference.show } })}
              aria-pressed={theme.reference.show} />
          </div>
          <div className="field-row" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="field">
              <span className="field-label">Size — {theme.reference.size}px</span>
              <input type="range" min={14} max={56} value={theme.reference.size}
                onChange={(e) => void patch({ reference: { ...theme.reference, size: Number(e.target.value) } })} />
            </div>
            <div className="field">
              <span className="field-label">Colour</span>
              <input type="color" className="input" style={{ padding: 2, height: 32 }}
                value={theme.reference.color} onChange={(e) => void patch({ reference: { ...theme.reference, color: e.target.value } })} />
            </div>
            <div className="field">
              <span className="field-label">Position</span>
              <select className="select" value={theme.reference.position}
                onChange={(e) => void patch({ reference: { ...theme.reference, position: e.target.value as 'top' | 'bottom' } })}>
                <option value="bottom">Bottom</option><option value="top">Top</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <span className="section-label">Layout</span>
          <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
            <span className="field-label">Edge padding — {theme.padding}%</span>
            <input type="range" min={0} max={20} value={theme.padding}
              onChange={(e) => void patch({ padding: Number(e.target.value) })} />
          </div>
          <div className="field">
            <span className="field-label">Text width — {t.maxWidth}%</span>
            <input type="range" min={40} max={100} value={t.maxWidth}
              onChange={(e) => void patch({ text: { ...t, maxWidth: Number(e.target.value) } })} />
          </div>
        </div>
      </div>
    </div>
  );
}
