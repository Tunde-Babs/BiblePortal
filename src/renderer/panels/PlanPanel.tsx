/**
 * Service plan — the cue list an operator actually runs the service from.
 *
 * Items are ordered, draggable and typed. Clicking one stages it in preview;
 * double-clicking takes it live. The plan is what turns a pile of songs and
 * passages into a service that runs itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type RecentSchedule, type ScheduleTemplate } from '../../shared/api';
import type { Deck, MediaItem, Plan, PlanItem } from '../../shared/types';
import { mediaDeck, scriptureDeck, songDeck, textDeck, useApp } from '../stores/app';
import { SlideSurface } from '../../shared/SlideSurface';
import { fileUrl } from '../../shared/file-url';
import { slideOf } from '../../shared/slide-render';
import {
  IconPlus, IconTrash, IconImport, IconDown, IconBible, IconSong, IconMedia, IconPlan,
} from '../components/Icons';

/** The badge on a thumbnail, so the kind of item reads at a glance. */
function KindBadge({ kind }: { kind: string }) {
  const icon = kind === 'song' ? <IconSong size={10} />
    : kind === 'scripture' ? <IconBible size={10} />
      : kind === 'media' ? <IconMedia size={10} />
        : <IconPlan size={10} />;
  return <span className="plan-thumb-badge">{icon}</span>;
}

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
  const live = useApp((s) => s.live);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [adding, setAdding] = useState<'scripture' | 'slide' | 'heading' | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  /** Open picker: choosing a song or a background to drop into the plan. */
  const [picker, setPicker] = useState<'song' | 'media' | null>(null);
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

  const addHeading = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    await addItem({ kind: 'header', title: text });
    setDraft('');
    setAdding(null);
  }, [draft, addItem]);

  const addSlide = useCallback(async () => {
    if (!draft.trim()) return;
    const [first, ...rest] = draft.split('\n');
    await addItem({ kind: 'slide', title: first.slice(0, 60), body: rest.length ? rest.join('\n') : first });
    setDraft('');
    setAdding(null);
  }, [draft, addItem]);

  useEffect(() => { api.media.all().then(setLibrary).catch(() => {}); }, []);

  /**
   * Build the deck an item would put on screen, without staging it.
   *
   * Shared by staging, the row thumbnail and the expanded slide list, so what
   * the operator scrubs through in the running order is the same deck that
   * goes out — not a second rendering that can drift from it.
   */
  const deckFor = useCallback(async (item: PlanItem): Promise<Partial<Deck> | null> => {
    if (item.kind === 'scripture' && item.ref) {
      const hit = await api.bible.lookup(item.title, settings?.general.defaultTranslation);
      return scriptureDeck(hit.label, hit.verses, hit.translationAbbr,
        settings?.presentation.versesPerSlide ?? 2);
    }
    if (item.kind === 'song' && item.songId) {
      const song = songs.find((s) => s.id === item.songId);
      if (!song) return null;
      const slides = await api.songs.slides(song.id,
        { maxLines: settings?.presentation.maxLinesPerSlide ?? 4 });
      return songDeck(song, slides, item.key ?? song.key);
    }
    if (item.kind === 'media' && item.mediaId) {
      const found = library.find((m) => m.id === item.mediaId);
      return found ? mediaDeck(found) : null;
    }
    // A heading groups the running order; it is not something to project.
    if (item.kind === 'header') return null;
    return textDeck(item.title, item.body || item.title);
  }, [songs, settings, library]);

  /**
   * Fill in a deck's optional fields so it can be rendered directly.
   * The builders return partials because the main process completes them.
   */
  const whole = useCallback((d: Partial<Deck> | null | undefined): Deck | null => (
    d ? {
      kind: d.kind ?? 'blank', title: d.title ?? '', slides: d.slides ?? [],
      index: d.index ?? 0, meta: d.meta ?? {},
    } as Deck : null
  ), []);

  /** Decks already built, so expanding and re-expanding costs nothing. */
  const [decks, setDecks] = useState<Record<string, Partial<Deck> | null>>({});

  const loadDeck = useCallback(async (item: PlanItem) => {
    if (decks[item.id] !== undefined) return decks[item.id];
    try {
      const deck = await deckFor(item);
      setDecks((prev) => ({ ...prev, [item.id]: deck }));
      return deck;
    } catch {
      setDecks((prev) => ({ ...prev, [item.id]: null }));
      return null;
    }
  }, [decks, deckFor]);

  /** Stage an item, optionally opening at one particular slide. */
  const stageItem = useCallback(async (item: PlanItem, take = false, index = 0) => {
    try {
      setSelectedItem(item.id);
      const deck = await deckFor(item);
      if (!deck) { toast('That song is no longer in the library', 'warn'); return; }
      const at = index > 0 ? { ...deck, index } : deck;
      return take ? previewAndTake(at) : preview(at);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [deckFor, preview, previewAndTake, toast]);

  /**
   * Build every item's deck when the plan opens, so the running order shows
   * its thumbnails straight away rather than filling in as the mouse passes
   * over them. Sequential on purpose: a plan is a handful of items, and this
   * must never compete with the lookup behind a live take.
   */
  useEffect(() => {
    if (!plan?.items.length) return;
    let cancelled = false;
    (async () => {
      for (const item of plan.items) {
        if (cancelled) return;
        let built: Partial<Deck> | null = null;
        try { built = await deckFor(item); } catch { built = null; }
        if (cancelled) return;
        setDecks((prev) => (item.id in prev ? prev : { ...prev, [item.id]: built }));
      }
    })();
    return () => { cancelled = true; };
  }, [plan?.id, plan?.items.length, deckFor]);

  /** Item whose notes are being typed, and the text so far. */
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const saveNotes = useCallback(async (item: PlanItem) => {
    setNotesFor(null);
    if (!plan || notesDraft === (item.notes ?? '')) return;
    await api.plans.updateItem(plan.id, item.id, { notes: notesDraft });
    setPlan(await api.plans.get(plan.id));
    setDirty(true);
  }, [plan, notesDraft]);

  /** Items whose slides are showing. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = useCallback(async (item: PlanItem) => {
    const open = expanded.has(item.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(item.id); else next.add(item.id);
      return next;
    });
    if (!open) await loadDeck(item);
  }, [expanded, loadDeck]);

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
        <button className="btn sm" onClick={() => { setAdding('scripture'); setDraft(''); setPicker(null); }}>+ Scripture</button>
        <button className="btn sm" onClick={() => { setPicker(picker === 'song' ? null : 'song'); setAdding(null); }}>+ Song</button>
        <button className="btn sm" onClick={() => { setPicker(picker === 'media' ? null : 'media'); setAdding(null); }}>+ Media</button>
        <button className="btn sm" onClick={() => { setAdding('slide'); setDraft(''); setPicker(null); }}>+ Slide</button>
        <button className="btn sm" onClick={() => { setAdding('heading'); setDraft(''); setPicker(null); }}>+ Heading</button>
        <div className="panel-head-spacer" />
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {plan?.items.length ?? 0} item{plan?.items.length === 1 ? '' : 's'}
        </span>
      </div>

      {picker === 'song' && (
        <div className="panel-pad" style={{ borderBottom: '1px solid var(--line-soft)', maxHeight: 220, overflowY: 'auto' }}>
          {songs.length === 0 ? (
            <span className="field-hint">No songs in your library yet — import or write one in the Songs panel.</span>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              {songs.map((song) => (
                <button
                  key={song.id}
                  className="btn sm"
                  onClick={() => { void addItem({ kind: 'song', title: song.title, songId: song.id, key: song.key }); setPicker(null); }}
                >
                  {song.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {picker === 'media' && (
        <div className="panel-pad" style={{ borderBottom: '1px solid var(--line-soft)' }}>
          {library.length === 0 ? (
            <span className="field-hint">
              Nothing in your media library yet — add images or motion loops in the Media panel.
            </span>
          ) : (
            <div className="backdrop-grid">
              {library.map((m) => (
                <button
                  key={m.id}
                  className="backdrop-tile"
                  title={m.name}
                  onClick={() => { void addItem({ kind: 'media', title: m.name, mediaId: m.id }); setPicker(null); }}
                >
                  {m.kind === 'video'
                    ? <video src={fileUrl(m.file)} muted playsInline preload="metadata" />
                    : <img src={fileUrl(m.file)} alt="" />}
                  <span className="backdrop-name truncate">{m.name}</span>
                  {m.kind === 'video' && <span className="backdrop-badge">MOTION</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
          ) : adding === 'heading' ? (
            <input
              className="input"
              autoFocus
              placeholder="Section name — e.g. Praise and Worship"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addHeading(); if (e.key === 'Escape') setAdding(null); }}
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
              onClick={() => void (adding === 'scripture' ? addScripture()
                : adding === 'heading' ? addHeading() : addSlide())}
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
            item.kind === 'header' ? (
              /* A heading groups the running order rather than going on screen,
                 so it carries no thumbnail and no take. */
              <div
                key={item.id}
                className="plan-heading"
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void drop(i)}
                onDragEnd={() => setDragIndex(null)}
                style={{ opacity: dragIndex === i ? 0.4 : 1 }}
              >
                <span className="plan-heading-text truncate">{item.title}</span>
                <button
                  className="btn sm icon ghost"
                  onClick={(e) => { e.stopPropagation(); void removeItem(item.id); }}
                  title="Remove from plan"
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ) : (
            <div key={item.id}>
              <div
                className={`list-row plan-row ${selectedItem === item.id ? 'selected' : ''}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void drop(i)}
                onDragEnd={() => setDragIndex(null)}
                onClick={() => void stageItem(item)}
                onDoubleClick={() => void stageItem(item, true)}
                style={{ opacity: dragIndex === i ? 0.4 : 1, cursor: 'grab' }}
              >
                <span className="mono faint plan-num">{i + 1}</span>

                <button
                  className={`plan-caret ${expanded.has(item.id) ? 'open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); void toggleExpand(item); }}
                  title={expanded.has(item.id) ? 'Hide slides' : 'Show slides'}
                  aria-label={expanded.has(item.id) ? 'Hide slides' : 'Show slides'}
                >
                  ▸
                </button>

                {/* The real surface, so the running order shows exactly what
                    will go out rather than an approximation of it. */}
                <div className="plan-thumb">
                  {decks[item.id] ? (
                    <SlideSurface
                      slide={slideOf(whole(decks[item.id]))}
                      deck={whole(decks[item.id])}
                      theme={live?.theme ?? null}
                      showSectionLabel={false}
                      showVerseNumbers={false}
                      still
                    />
                  ) : (
                    <span className="plan-thumb-kind">{(KIND_LABEL[item.kind] ?? item.kind).slice(0, 4)}</span>
                  )}
                  <KindBadge kind={item.kind} />
                </div>

                <div className="list-main">
                  <div className="list-title truncate">{item.title}</div>
                  <div className="list-sub truncate">
                    {KIND_LABEL[item.kind] ?? item.kind}{item.key ? ` · ${item.key}` : ''}
                    {decks[item.id] ? ` · ${decks[item.id]!.slides?.length ?? 0} slide${(decks[item.id]!.slides?.length ?? 0) === 1 ? '' : 's'}` : ''}
                  </div>
                  {notesFor === item.id ? (
                    <input
                      className="input plan-notes-input"
                      autoFocus
                      value={notesDraft}
                      placeholder="notes"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onBlur={() => void saveNotes(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveNotes(item);
                        if (e.key === 'Escape') setNotesFor(null);
                      }}
                    />
                  ) : (
                    <div
                      className={`plan-notes truncate ${item.notes ? '' : 'empty'}`}
                      onClick={(e) => { e.stopPropagation(); setNotesDraft(item.notes ?? ''); setNotesFor(item.id); }}
                      title="Click to write a note for this item"
                    >
                      {item.notes || 'notes'}
                    </div>
                  )}
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

              {/* Every slide in the item, so the operator can jump straight to
                  the chorus or the third verse without stepping there. */}
              {expanded.has(item.id) && (
                <div className="plan-slides">
                  {decks[item.id] === undefined && <span className="field-hint">Loading…</span>}
                  {decks[item.id] === null && (
                    <span className="field-hint">This item can’t be opened — the song may have been deleted.</span>
                  )}
                  {decks[item.id]?.slides?.map((sl, n) => (
                    <button
                      key={n}
                      className="plan-slide"
                      onClick={(e) => { e.stopPropagation(); void stageItem(item, false, n); }}
                      onDoubleClick={(e) => { e.stopPropagation(); void stageItem(item, true, n); }}
                      title={`${sl.sectionLabel || sl.caption || `Slide ${n + 1}`} — click to preview, double-click to take`}
                    >
                      <SlideSurface
                        slide={sl}
                        deck={whole(decks[item.id])}
                        theme={live?.theme ?? null}
                        showSectionLabel={false}
                        showVerseNumbers={false}
                        still
                      />
                      <span className="plan-slide-no">{n + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )
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
