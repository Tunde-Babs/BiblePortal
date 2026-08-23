/**
 * Settings — presentation defaults, the translation manager, and backup.
 *
 * The translation manager is where the licensing story is made explicit: the
 * catalogue holds only public-domain texts, and anything under copyright is
 * installed by the user from a module they already licence.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../shared/api';
import type { CatalogueGroup, TranslationInfo } from '../../shared/types';
import type { EwInspection } from '../../shared/api';
import { useApp } from '../stores/app';
import { IconImport, IconTrash, IconCheck } from '../components/Icons';

type Tab = 'general' | 'translations' | 'migrate' | 'data';

interface Catalogue {
  groups: CatalogueGroup[];
  installedCount: number;
  licensed: { abbr: string; name: string; holder: string }[];
}

export function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const refreshTranslations = useApp((s) => s.refreshTranslations);
  const toast = useApp((s) => s.toast);

  const [tab, setTab] = useState<Tab>('general');
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; percent: number } | null>(null);
  const [info, setInfo] = useState<{ version: string; dataPath: string; electron: string } | null>(null);
  const [ewFile, setEwFile] = useState<string | null>(null);
  const [ewLook, setEwLook] = useState<EwInspection | null>(null);
  const [ewBusy, setEwBusy] = useState(false);

  const loadCatalogue = useCallback(async () => {
    try { setCatalogue(await api.translations.catalogue()); } catch { /* offline is fine */ }
  }, []);

  useEffect(() => { if (tab === 'translations') void loadCatalogue(); }, [tab, loadCatalogue]);
  useEffect(() => { api.app.info().then((i) => setInfo(i)).catch(() => {}); }, []);
  useEffect(() => {
    const off = api.on(api.events().TRANSLATION_PROGRESS, (p: never) => setProgress(p as { id: string; percent: number }));
    return off;
  }, []);

  const install = useCallback(async (t: TranslationInfo) => {
    setInstalling(t.id);
    try {
      const res = await api.translations.install(t.id);
      await Promise.all([refreshTranslations(), loadCatalogue()]);
      toast(`Installed ${res.name} — ${res.verseCount.toLocaleString()} verses`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setInstalling(null); setProgress(null); }
  }, [refreshTranslations, loadCatalogue, toast]);

  const removeTranslation = useCallback(async (t: TranslationInfo) => {
    try {
      await api.translations.remove(t.id);
      await Promise.all([refreshTranslations(), loadCatalogue()]);
      toast(`Removed ${t.name}`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshTranslations, loadCatalogue, toast]);

  /** Import a module the user owns — inspect first, then confirm. */
  const importModule = useCallback(async () => {
    try {
      const picked = await api.translations.pickModule();
      if (!picked.path) return;

      const info = await api.translations.inspect(picked.path);
      toast(`Reading ${info.format.toUpperCase()} — ${info.verseCount.toLocaleString()} verses…`, 'info');

      const res = await api.translations.import(picked.path);
      await Promise.all([refreshTranslations(), loadCatalogue()]);
      toast(`Installed ${res.name} (${res.abbr}) — ${res.verseCount.toLocaleString()} verses`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [refreshTranslations, loadCatalogue, toast]);

  /** Read a schedule and show what it holds before importing anything. */
  const ewPick = useCallback(async () => {
    try {
      const picked = await api.ew.pickFile();
      if (!picked.paths?.length) return;
      setEwBusy(true);
      setEwFile(picked.paths[0]);
      setEwLook(await api.ew.inspect(picked.paths[0]));
    } catch (err) {
      setEwLook(null);
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setEwBusy(false); }
  }, [toast]);

  const ewImport = useCallback(async (withPlan: boolean) => {
    if (!ewFile) return;
    setEwBusy(true);
    try {
      const res = await api.ew.importSchedule(ewFile, { songs: true, media: true, plan: withPlan });
      toast(
        `Imported ${res.songs} song(s) and ${res.media} media file(s)`
        + (res.skipped ? `, ${res.skipped} already in your library` : ''),
        res.errors.length ? 'warn' : 'success',
      );
      setEwLook(null);
      setEwFile(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setEwBusy(false); }
  }, [ewFile, toast]);

  const ewFolder = useCallback(async () => {
    try {
      const picked = await api.ew.pickFolder();
      if (!picked.path) return;
      setEwBusy(true);
      const res = await api.ew.importFolder(picked.path, { songs: true, media: true });
      toast(
        `${res.files} schedule(s): ${res.songs} song(s), ${res.media} media file(s)`
        + (res.skipped ? `, ${res.skipped} duplicates skipped` : ''),
        res.errors.length ? 'warn' : 'success',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setEwBusy(false); }
  }, [toast]);

  const backup = useCallback(async () => {
    try {
      const res = await api.app.backup();
      if ((res as { cancelled?: boolean }).cancelled) return;
      toast(`Backed up ${res.songs} songs and ${res.plans} plans`, 'success');
    } catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
  }, [toast]);

  const restore = useCallback(async () => {
    try {
      const res = await api.app.restore();
      if ((res as { cancelled?: boolean }).cancelled) return;
      toast(`Restored ${res.songs} songs and ${res.plans} plans`, 'success');
    } catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
  }, [toast]);

  if (!settings) return <div className="panel"><div className="panel-head"><h2 className="panel-title">Settings</h2></div></div>;

  const p = settings.presentation;
  const stage = settings.stage;

  return (
    <div className="panel">
      <div className="panel-head"><h2 className="panel-title">Settings</h2></div>

      <div className="panel-toolbar">
        {(['general', 'translations', 'migrate', 'data'] as Tab[]).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : 'ghost'}`} onClick={() => setTab(t)}>
            {t === 'general' ? 'Presentation'
              : t === 'translations' ? 'Translations'
              : t === 'migrate' ? 'Migrate' : 'Data'}
          </button>
        ))}
      </div>

      <div className="panel-scroll panel-pad">
        {/* ------------------------------------------------------- general */}
        {tab === 'general' && (
          <>
            <div className="settings-group">
              <span className="section-label">Slides</span>
              <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
                <span className="field-label">Verses per scripture slide — {p.versesPerSlide}</span>
                <input type="range" min={1} max={6} value={p.versesPerSlide}
                  onChange={(e) => void patchSettings({ presentation: { versesPerSlide: Number(e.target.value) } })} />
              </div>
              <div className="field">
                <span className="field-label">Lyric lines per slide — {p.maxLinesPerSlide}</span>
                <input type="range" min={2} max={8} value={p.maxLinesPerSlide}
                  onChange={(e) => void patchSettings({ presentation: { maxLinesPerSlide: Number(e.target.value) } })} />
              </div>
              <div className="switch-row">
                <div><div className="switch-label">Verse numbers</div><div className="switch-desc">Superscript numbers before each verse</div></div>
                <button className={`switch ${p.showVerseNumbers ? 'on' : ''}`}
                  onClick={() => void patchSettings({ presentation: { showVerseNumbers: !p.showVerseNumbers } })}
                  aria-pressed={p.showVerseNumbers} />
              </div>
              <div className="switch-row">
                <div><div className="switch-label">Translation on screen</div><div className="switch-desc">Append the abbreviation to the reference</div></div>
                <button className={`switch ${p.showTranslationAbbr ? 'on' : ''}`}
                  onClick={() => void patchSettings({ presentation: { showTranslationAbbr: !p.showTranslationAbbr } })}
                  aria-pressed={p.showTranslationAbbr} />
              </div>
            </div>

            <div className="settings-group">
              <span className="section-label">Stage display</span>
              <div className="switch-row">
                <div><div className="switch-label">Clock</div></div>
                <button className={`switch ${stage.showClock ? 'on' : ''}`}
                  onClick={() => void patchSettings({ stage: { showClock: !stage.showClock } })} aria-pressed={stage.showClock} />
              </div>
              <div className="switch-row">
                <div><div className="switch-label">Next slide preview</div></div>
                <button className={`switch ${stage.showNextSlide ? 'on' : ''}`}
                  onClick={() => void patchSettings({ stage: { showNextSlide: !stage.showNextSlide } })} aria-pressed={stage.showNextSlide} />
              </div>
            </div>
          </>
        )}

        {/* -------------------------------------------------- translations */}
        {tab === 'translations' && (
          <>
            <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
              <button className="btn primary" onClick={() => void importModule()}>
                <IconImport size={12} /> Import a module you own
              </button>
              <div className="panel-head-spacer" />
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {catalogue?.installedCount ?? 0} installed
              </span>
            </div>

            <div className="notice" style={{ marginBottom: 'var(--sp-5)' }}>
              <strong>About copyrighted translations.</strong> The catalogue below holds only
              public-domain texts, which BiblePortal can legally distribute. Modern translations —
              {catalogue?.licensed.slice(0, 5).map((l) => ` ${l.abbr}`).join(',') || ' NIV, NLT, NKJV, AMP, MSG'} and
              others — are owned by their publishers and cannot be bundled or downloaded by any app.
              <br /><br />
              If your church licenses one, use <strong>Import a module you own</strong> above. It reads
              Zefania, OSIS, USFX, JSON and CSV modules entirely on this machine — nothing is uploaded,
              and your licence stays between you and the publisher.
            </div>

            {progress && installing && (
              <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
                <div className="row"><div className="spinner" /><span>Installing {installing}… {progress.percent}%</span></div>
              </div>
            )}

            {catalogue?.groups.map((group) => (
              <div key={group.language} className="settings-group">
                <span className="section-label">{group.language}</span>
                <div className="stack" style={{ marginTop: 'var(--sp-3)' }}>
                  {group.translations.map((t) => (
                    <div key={t.id} className="card row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 'var(--sp-2)' }}>
                          <span className="list-title">{t.abbr}</span>
                          <span className="muted truncate" style={{ fontSize: 'var(--fs-sm)' }}>{t.name}</span>
                          {t.scope === 'nt' && <span className="chip">NT only</span>}
                          {t.scope === 'ot' && <span className="chip">OT only</span>}
                          {t.imported && <span className="chip accent">Your module</span>}
                        </div>
                        <div className="list-sub">
                          {[t.year, t.license, t.verseCount ? `${t.verseCount.toLocaleString()} verses` : null, t.note]
                            .filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {t.installed ? (
                        <>
                          <span className="chip preview"><IconCheck size={10} /> Installed</span>
                          <button className="btn sm icon ghost" title="Remove" onClick={() => void removeTranslation(t)}>
                            <IconTrash size={12} />
                          </button>
                        </>
                      ) : (
                        <button className="btn sm" disabled={installing === t.id} onClick={() => void install(t)}>
                          {installing === t.id ? 'Installing…' : 'Install'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {!catalogue && <p className="field-hint">Loading catalogue…</p>}
          </>
        )}

        {/* ------------------------------------------------------- migrate */}
        {tab === 'migrate' && (
          <>
            <div className="notice" style={{ marginBottom: 'var(--sp-5)' }}>
              <strong>Bring your EasyWorship library across.</strong> A schedule file
              (<span className="mono">.ewsx</span>) carries its songs and the backgrounds it uses.
              Everything is read on this computer — your songs stay yours and nothing is uploaded.
            </div>

            <div className="settings-group">
              <span className="section-label">One schedule</span>
              <p className="field-hint" style={{ margin: 'var(--sp-3) 0' }}>
                Pick a <span className="mono">.ewsx</span> file to see what it holds before importing.
              </p>
              <div className="row">
                <button className="btn primary" onClick={() => void ewPick()} disabled={ewBusy}>
                  <IconImport size={12} /> Choose a schedule…
                </button>
                {ewBusy && <div className="spinner" />}
              </div>

              {ewLook && (
                <div className="card" style={{ marginTop: 'var(--sp-4)' }}>
                  <div className="card-title">{ewLook.file}</div>
                  <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
                    <span className="chip accent">{ewLook.songs} songs</span>
                    <span className="chip">{ewLook.media} media</span>
                    <span className="chip">{ewLook.format}</span>
                  </div>

                  {ewLook.sample.length > 0 && (
                    <div style={{ marginBottom: 'var(--sp-3)' }}>
                      {ewLook.sample.map((sg) => (
                        <div key={sg.title} className="list-sub truncate">
                          {sg.title}{sg.author ? ` · ${sg.author}` : ''} · {sg.sections} sections
                        </div>
                      ))}
                      {ewLook.songs > ewLook.sample.length && (
                        <div className="list-sub faint">…and {ewLook.songs - ewLook.sample.length} more</div>
                      )}
                    </div>
                  )}

                  <div className="row">
                    <button className="btn primary" onClick={() => void ewImport(false)} disabled={ewBusy}>
                      Import songs &amp; media
                    </button>
                    <button className="btn" onClick={() => void ewImport(true)} disabled={ewBusy}>
                      Import and build a service plan
                    </button>
                    <button className="btn ghost" onClick={() => { setEwLook(null); setEwFile(null); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-group">
              <span className="section-label">A whole folder</span>
              <p className="field-hint" style={{ margin: 'var(--sp-3) 0' }}>
                Point at your EasyWorship <span className="mono">Schedules</span> folder to bring every
                schedule across at once. Songs already in your library are skipped rather than duplicated.
              </p>
              <button className="btn" onClick={() => void ewFolder()} disabled={ewBusy}>
                <IconImport size={12} /> Choose a folder…
              </button>
            </div>

            <div className="notice warn">
              <strong>If a schedule will not open.</strong> EasyWorship 6 and earlier stored data in
              Firebird databases that only EasyWorship itself can read. Open the schedule in
              EasyWorship 7 and re-save it, then import that file.
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- data */}
        {tab === 'data' && (
          <>
            <div className="settings-group">
              <span className="section-label">Backup</span>
              <p className="field-hint" style={{ margin: 'var(--sp-3) 0' }}>
                Writes your songs, service plans, themes and settings to a single file.
                Scripture isn’t included — it reinstalls from the catalogue.
              </p>
              <div className="row">
                <button className="btn" onClick={() => void backup()}>Back up library…</button>
                <button className="btn" onClick={() => void restore()}>Restore from backup…</button>
              </div>
            </div>

            <div className="settings-group">
              <span className="section-label">Storage</span>
              <p className="field-hint" style={{ margin: 'var(--sp-3) 0' }}>
                Everything BiblePortal knows lives in one folder on this computer.
                No account, no sync, no telemetry.
              </p>
              <button className="btn" onClick={() => void api.app.revealDataFolder()}>Open data folder</button>
              {info && (
                <p className="faint mono selectable" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-3)', wordBreak: 'break-all' }}>
                  {info.dataPath}
                </p>
              )}
            </div>

            {info && (
              <div className="settings-group">
                <span className="section-label">About</span>
                <div className="card" style={{ marginTop: 'var(--sp-3)' }}>
                  <div className="list-sub">BiblePortal Studio v{info.version}</div>
                  <div className="list-sub">Electron {info.electron}</div>
                  <div className="list-sub" style={{ marginTop: 'var(--sp-2)' }}>
                    Scripture: public-domain translations. Strong’s Concordance (1890), public domain.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
