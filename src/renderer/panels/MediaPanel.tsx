/**
 * Media panel — background stills and motion loops.
 *
 * Files are copied into the app's own folder on import, so a service never
 * breaks because someone tidied their Desktop on Saturday night.
 */

import { useCallback, useMemo, useState } from 'react';

import { api } from '../../shared/api';
import type { MediaItem } from '../../shared/types';
import { mediaDeck, useApp } from '../stores/app';
import { fileUrl } from '../../shared/file-url';
import { IconImport, IconTrash, IconCheck } from '../components/Icons';

const formatBytes = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

/** Where a background can be assigned. */
const SLOTS = [
  { key: 'scripture', label: 'Scripture' },
  { key: 'song', label: 'Songs' },
  { key: 'slide', label: 'Slides' },
  { key: 'default', label: 'Everything else' },
] as const;

export function MediaPanel() {
  const media = useApp((s) => s.media);
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const refreshMedia = useApp((s) => s.refreshMedia);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const backgrounds = settings?.backgrounds;

  const shown = useMemo(
    () => media.filter((m) => filter === 'all' || m.kind === filter),
    [media, filter],
  );

  /** Which slots a given item currently backs. */
  const slotsFor = useCallback((id: string) =>
    SLOTS.filter((s) => backgrounds?.[s.key] === id).map((s) => s.label),
  [backgrounds]);

  /** Assign or clear this item as the background for a slot. */
  const assign = useCallback(async (slot: string, id: string | null) => {
    await patchSettings({ backgrounds: { [slot]: id } });
    const name = SLOTS.find((s) => s.key === slot)?.label ?? slot;
    toast(id ? `Background set for ${name}` : `Background cleared for ${name}`, 'success');
  }, [patchSettings, toast]);

  const importMedia = useCallback(async () => {
    try {
      const res = await api.media.import();
      if ((res as { cancelled?: boolean }).cancelled) return;
      await refreshMedia();
      toast(`Added ${res.imported} file${res.imported === 1 ? '' : 's'}`, res.failed ? 'warn' : 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshMedia, toast]);

  const remove = useCallback(async (item: MediaItem) => {
    await api.media.remove(item.id);
    await refreshMedia();
  }, [refreshMedia]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Media</h2>
        <div className="panel-head-spacer" />
        <button className="btn sm" onClick={() => void importMedia()}>
          <IconImport size={12} /> Add files
        </button>
      </div>

      {!!media.length && (
        <div className="panel-toolbar">
          {(['all', 'image', 'video'] as const).map((f) => (
            <button key={f} className={`btn sm ${filter === f ? 'primary' : 'ghost'}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${media.length})`
                : f === 'image' ? `Stills (${media.filter((m) => m.kind === 'image').length})`
                : `Motion (${media.filter((m) => m.kind === 'video').length})`}
            </button>
          ))}
          <div className="panel-head-spacer" />
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            {SLOTS.filter((s) => backgrounds?.[s.key]).length} background{SLOTS.filter((s) => backgrounds?.[s.key]).length === 1 ? '' : 's'} assigned
          </span>
        </div>
      )}

      <div className="panel-scroll">
        {!media.length ? (
          <div className="empty">
            <div className="empty-title">No media yet</div>
            <div className="empty-body">
              Add background images and motion loops to sit behind lyrics and scripture,
              then assign one to each kind of content. Files are copied into BiblePortal,
              so moving the originals later is safe.
              <br /><br />
              <span className="faint">JPG · PNG · WEBP · GIF · MP4 · MOV · WEBM</span>
              <br /><br />
              <span className="faint">
                Free, licence-clear backgrounds: Pexels, Pixabay and Unsplash for stills;
                MotionWorship and CreationSwap for worship motion loops.
              </span>
            </div>
            <button className="btn primary" onClick={() => void importMedia()}>
              <IconImport size={12} /> Add media files
            </button>
          </div>
        ) : (
          <div className="panel-pad">
            <div className="grid-2">
              {shown.map((item) => (
                <div key={item.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative' }}>
                    {item.kind === 'image' ? (
                      <img
                        src={fileUrl(item.file)}
                        alt={item.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <video
                        src={fileUrl(item.file)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        muted
                        loop
                        onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                        onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                      />
                    )}
                    <span className="chip" style={{ position: 'absolute', top: 6, left: 6 }}>
                      {item.kind === 'video' ? 'motion' : 'still'}
                    </span>
                    {slotsFor(item.id).length > 0 && (
                      <span className="chip accent" style={{ position: 'absolute', top: 6, right: 6 }}>
                        {slotsFor(item.id).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: 'var(--sp-3)' }}>
                    <div className="list-title truncate">{item.name}</div>
                    <div className="list-sub">{formatBytes(item.bytes)}</div>
                    <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
                      <button className="btn sm" style={{ flex: 1 }} onClick={() => void preview(mediaDeck(item))}>
                        Preview
                      </button>
                      <button className="btn sm live" style={{ flex: 1 }} onClick={() => void previewAndTake(mediaDeck(item))}>
                        Take
                      </button>
                      <button className="btn sm icon ghost" onClick={() => void remove(item)} title="Remove">
                        <IconTrash size={12} />
                      </button>
                    </div>

                    {/* Assign as the backdrop behind scripture, lyrics or slides. */}
                    <div className="bg-slots">
                      <span className="section-label">Background for</span>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                        {SLOTS.map((slot) => {
                          const active = backgrounds?.[slot.key] === item.id;
                          return (
                            <button
                              key={slot.key}
                              className={`btn sm ${active ? 'primary' : 'ghost'}`}
                              style={{ fontSize: 'var(--fs-xs)', height: 20, padding: '0 6px' }}
                              onClick={() => void assign(slot.key, active ? null : item.id)}
                              title={active ? `Clear ${slot.label} background` : `Use behind ${slot.label}`}
                            >
                              {active && <IconCheck size={9} />} {slot.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
