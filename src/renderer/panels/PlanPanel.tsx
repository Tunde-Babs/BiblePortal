/**
 * Service plan — the cue list an operator actually runs the service from.
 *
 * Items are ordered, draggable and typed. Clicking one stages it in preview;
 * double-clicking takes it live. The plan is what turns a pile of songs and
 * passages into a service that runs itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type RecentSchedule, type ScheduleTemplate } from '../../shared/api';
import type { Plan, PlanItem } from '../../shared/types';
import { scriptureDeck, songDeck, textDeck, useApp } from '../stores/app';
import { IconPlus, IconTrash, IconImport, IconDown } from '../components/Icons';

const KIND_LABEL: Record<string, string> = {
  scripture: 'Scripture', song: 'Song', media: 'Media',
  slide: 'Slide', announcement: 'Notice', header: 'Heading',
};

export function PlanPanel() {
  const plans = useApp((s) => s.plans);
  const songs = useApp((s) => s.songs);
  const settings = useApp((s) => s.settings);
  const activePlanId = useApp((s) => s.activePlanId);
  const setActivePlan = useApp((s) => s.setActivePlan);
  const refreshPlans = useApp((s) => s.refreshPlans);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [adding, setAdding] = useState<'scripture' | 'slide' | null>(null);
  const [draft, setDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Schedule-file state: where this plan lives on disk, plus the Open menu.
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);
  const [recent, setRecent] = useState<RecentSchedule[]>([]);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);

  useEffect(() => {
    if (!activePlanId) { setPlan(null); return; }
    let cancelled = false;
    api.plans.get(activePlanId).then((p) => { if (!cancelled) setPlan(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activePlanId, plans]);

  const refreshFiles = useCallback(async () => {
    const [files, tpl] = await Promise.all([
      api.schedule.recent().catch(() => []),
      api.schedule.templates().catch(() => []),
    ]);
    setRecent(files);
    setTemplates(tpl);
  }, []);

  useEffect(() => { void refreshFiles(); }, [refreshFiles]);

  // A plan switched in the dropdown is not the file we last saved.
  useEffect(() => { setFilePath(null); setDirty(false); }, [activePlanId]);

  const saveSchedule = useCallback(async (forceDialog = false) => {
    if (!plan) return;
    try {
      const res = forceDialog
        ? await api.schedule.saveAs(plan.id)
        : await api.schedule.save(plan.id, filePath);
      if ((res as { cancelled?: boolean }).cancelled) return;
      setFilePath(res.path);
      setDirty(false);
      await refreshFiles();
      toast(`Saved to ${res.path.split(/[\\/]/).pop()}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [plan, filePath, refreshFiles, toast]);

  const saveTemplate = useCallback(async () => {
    if (!plan) return;
    try {
      const res = await api.schedule.saveTemplate(plan.id);
      if ((res as { cancelled?: boolean }).cancelled) return;
      await refreshFiles();
      toast('Saved as a reusable template', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [plan, refreshFiles, toast]);

  const openSchedule = useCallback(async (path?: string) => {
    try {
      const res = path ? await api.schedule.openPath(path) : await api.schedule.open();
      if ((res as { cancelled?: boolean }).cancelled) return;
      await refreshPlans();
      setActivePlan(res.plan.id);
      setFilePath(res.path ?? null);
      setDirty(false);
      setOpenMenu(false);
      await refreshFiles();
      toast(
        res.restoredSongs
          ? `Opened "${res.plan.name}" — ${res.restoredSongs} song(s) restored from the file`
          : `Opened "${res.plan.name}"`,
        'success',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshPlans, setActivePlan, refreshFiles, toast]);

  const newFromTemplate = useCallback(async (templatePath: string) => {
    try {
      const res = await api.schedule.newFromTemplate(templatePath);
      await refreshPlans();
      setActivePlan(res.plan.id);
      setFilePath(null);
      setDirty(true);
      setOpenMenu(false);
      toast(`New service from template — ${res.plan.items.length} items`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshPlans, setActivePlan, toast]);

  const createPlan = useCallback(async () => {
    const created = await api.plans.create({ name: 'Sunday Service' });
    await refreshPlans();
    setActivePlan(created.id);
  }, [refreshPlans, setActivePlan]);

  const addItem = useCallback(async (item: Partial<PlanItem>) => {
    if (!plan) return;
    await api.plans.addItem(plan.id, item);
    setPlan(await api.plans.get(plan.id));
    setDirty(true);
    await refreshPlans();
  }, [plan, refreshPlans]);

  /** Add a scripture item, validating the reference before it goes in the plan. */
  const addScripture = useCallback(async () => {
    if (!draft.trim() || !plan) return;
    try {
      const hit = await api.bible.lookup(draft, settings?.general.defaultTranslation);
      await addItem({ kind: 'scripture', title: hit.label, ref: hit.reference });
      setDraft('');
      setAdding(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [draft, plan, addItem, settings, toast]);

  const addSlide = useCallback(async () => {
    if (!draft.trim()) return;
    const [first, ...rest] = draft.split('\n');
    await addItem({ kind: 'slide', title: first.slice(0, 60), body: rest.length ? rest.join('\n') : first });
    setDraft('');
    setAdding(null);
  }, [draft, addItem]);

  /** Turn a plan item into a deck and stage it. */
  const stageItem = useCallback(async (item: PlanItem, take = false) => {
    try {
      setSelectedItem(item.id);
      if (item.kind === 'scripture' && item.ref) {
        const label = item.title;
        const hit = await api.bible.lookup(label, settings?.general.defaultTranslation);
        const deck = scriptureDeck(hit.label, hit.verses, hit.translationAbbr, settings?.presentation.versesPerSlide ?? 2);
        return take ? previewAndTake(deck) : preview(deck);
      }
      if (item.kind === 'song' && item.songId) {
        const song = songs.find((s) => s.id === item.songId);
        if (!song) { toast('That song is no longer in the library', 'warn'); return; }
        const slides = await api.songs.slides(song.id, { maxLines: settings?.presentation.maxLinesPerSlide ?? 4 });
        const deck = songDeck(song, slides, item.key ?? song.key);
        return take ? previewAndTake(deck) : preview(deck);
      }
      const deck = textDeck(item.title, item.body || item.title);
      return take ? previewAndTake(deck) : preview(deck);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [songs, settings, preview, previewAndTake, toast]);

  const removeItem = useCallback(async (itemId: string) => {
    if (!plan) return;
    await api.plans.removeItem(plan.id, itemId);
    setPlan(await api.plans.get(plan.id));
    setDirty(true);
  }, [plan]);

  /** Commit a drag-reorder. */
  const drop = useCallback(async (toIndex: number) => {
    if (!plan || dragIndex === null || dragIndex === toIndex) { setDragIndex(null); return; }
    await api.plans.reorder(plan.id, dragIndex, toIndex);
    setPlan(await api.plans.get(plan.id));
    setDirty(true);
    setDragIndex(null);
  }, [plan, dragIndex]);

  // Tell the main process whether there is work that is not on disk, so it can
  // guard the exit. Reported on every change rather than only on quit.
  useEffect(() => {
    void api.app.setDirty(dirty, plan?.name ?? 'Service plan').catch(() => {});
  }, [dirty, plan?.name]);

  // The quit dialog can ask us to save first, then quit.
  useEffect(() => {
    const off = api.on(api.events().HOTKEY, (action: never) => {
      if (String(action) === 'schedule:save-and-quit') {
        void saveSchedule().then(() => api.app.quit()).catch(() => {});
      }
    });
    return off;
  }, [saveSchedule]);

  // File shortcuts, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 's') { e.preventDefault(); void saveSchedule(e.shiftKey); }
      if (e.key === 'o') { e.preventDefault(); void openSchedule(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveSchedule, openSchedule]);

  if (!plans.length) {
    return (
      <div className="panel">
        <div className="panel-head"><h2 className="panel-title">Service</h2></div>
        <div className="empty">
          <div className="empty-title">No service plans yet</div>
          <div className="empty-body">
            Build the order of service once, then run Sunday from a single list —
            songs, readings, notices and slides in the order they happen.
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void createPlan()}>
              <IconPlus size={12} /> New service plan
            </button>
            <button className="btn" onClick={() => void openSchedule()}>
              <IconImport size={12} /> Open a schedule file
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Service</h2>
        <div className="panel-head-spacer" />
        <select
          className="select"
          style={{ width: 'auto', maxWidth: 168 }}
          value={activePlanId ?? ''}
          onChange={(e) => setActivePlan(e.target.value)}
          aria-label="Open plan"
        >
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* File bar — New / Open / Save, the workflow operators already know. */}
      <div className="panel-toolbar file-bar">
        <button className="btn sm" onClick={() => void createPlan()} title="New service plan (⌘N)">
          <IconPlus size={12} /> New
        </button>

        <div className="menu-anchor">
          <button className="btn sm" onClick={() => { setOpenMenu((v) => !v); void refreshFiles(); }}>
            Open <IconDown size={11} />
          </button>
          {openMenu && (
            <>
              <div className="menu-backdrop" onClick={() => setOpenMenu(false)} />
              <div className="menu" role="menu">
                <button className="menu-item" onClick={() => void openSchedule()}>
                  <IconImport size={12} /> Browse…
                </button>

                {!!templates.length && (
                  <>
                    <div className="menu-label">New from template</div>
                    {templates.map((t) => (
                      <button key={t.path} className="menu-item" onClick={() => void newFromTemplate(t.path)}>
                        <span className="truncate">{t.name}</span>
                        <span className="faint" style={{ marginLeft: 'auto' }}>{t.items} items</span>
                      </button>
                    ))}
                  </>
                )}

                <div className="menu-label">Recent</div>
                {recent.length ? recent.map((f) => (
                  <button key={f.path} className="menu-item" onClick={() => void openSchedule(f.path)} title={f.path}>
                    <span className="truncate">{f.name}</span>
                    <span className="faint mono" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
                      {f.modifiedAt ? new Date(f.modifiedAt).toLocaleDateString() : ''}
                    </span>
                  </button>
                )) : <div className="menu-empty">No recent schedules</div>}

                {!!recent.length && (
                  <button
                    className="menu-item faint"
                    onClick={async () => { await api.schedule.clearRecent(); await refreshFiles(); }}
                  >
                    Clear recent
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <button className="btn sm" onClick={() => void saveSchedule()} disabled={!plan} title="Save schedule (⌘S)">
          Save{dirty ? ' •' : ''}
        </button>
        <button className="btn sm ghost" onClick={() => void saveSchedule(true)} disabled={!plan}>Save As…</button>
        <button className="btn sm ghost" onClick={() => void saveTemplate()} disabled={!plan} title="Reuse this running order every week">
          Template
        </button>
      </div>

      {filePath && (
        <div className="file-path truncate" title={filePath}>
          {filePath}{dirty ? ' — unsaved changes' : ''}
        </div>
      )}

      <div className="panel-toolbar">
        <button className="btn sm" onClick={() => { setAdding('scripture'); setDraft(''); }}>+ Scripture</button>
        <button className="btn sm" onClick={() => { setAdding('slide'); setDraft(''); }}>+ Slide</button>
        <div className="panel-head-spacer" />
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {plan?.items.length ?? 0} item{plan?.items.length === 1 ? '' : 's'}
        </span>
      </div>

      {adding && (
        <div className="panel-pad" style={{ borderBottom: '1px solid var(--line-soft)' }}>
          {adding === 'scripture' ? (
            <input
              className="input"
              autoFocus
              placeholder="Reference — e.g. Romans 8:28-30"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addScripture(); if (e.key === 'Escape') setAdding(null); }}
            />
          ) : (
            <textarea
              className="textarea"
              autoFocus
              rows={4}
              placeholder={'Title\nBody line one\nBody line two'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <button
              className="btn primary"
              onClick={() => void (adding === 'scripture' ? addScripture() : addSlide())}
              disabled={!draft.trim()}
            >
              Add
            </button>
            <button className="btn ghost" onClick={() => { setAdding(null); setDraft(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="panel-scroll">
        {!plan?.items.length ? (
          <div className="empty">
            <div className="empty-title">This plan is empty</div>
            <div className="empty-body">
              Add scripture readings and slides above, or drag songs in from the Songs panel.
            </div>
          </div>
        ) : (
          plan.items.map((item, i) => (
            <div
              key={item.id}
              className={`list-row ${selectedItem === item.id ? 'selected' : ''}`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void drop(i)}
              onDragEnd={() => setDragIndex(null)}
              onClick={() => void stageItem(item)}
              onDoubleClick={() => void stageItem(item, true)}
              style={{ opacity: dragIndex === i ? 0.4 : 1, cursor: 'grab' }}
            >
              <span className="mono faint" style={{ width: 20, flex: 'none', fontSize: 'var(--fs-xs)' }}>{i + 1}</span>
              <div className="list-main">
                <div className="list-title truncate">{item.title}</div>
                <div className="list-sub">{KIND_LABEL[item.kind] ?? item.kind}{item.key ? ` · ${item.key}` : ''}</div>
              </div>
              <div className="list-actions">
                <button className="btn sm live" onClick={(e) => { e.stopPropagation(); void stageItem(item, true); }}>
                  Take
                </button>
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); void removeItem(item.id); }}
                  title="Remove from plan"
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {!!songs.length && (
        <div className="panel-pad" style={{ borderTop: '1px solid var(--line)', flex: 'none', maxHeight: 180, overflowY: 'auto' }}>
          <span className="section-label">Add a song</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            {songs.slice(0, 12).map((song) => (
              <button
                key={song.id}
                className="btn sm"
                onClick={() => void addItem({ kind: 'song', title: song.title, songId: song.id, key: song.key })}
              >
                + {song.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
