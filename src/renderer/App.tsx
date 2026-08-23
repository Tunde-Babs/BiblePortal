/**
 * Operator console shell.
 *
 * Fixed three-region layout: a panel rail on the left, the working panel in the
 * middle, and the preview/program pair pinned to the right where it is always
 * visible. A live operator should never have to navigate away from the thing
 * that is on air.
 */

import { useEffect } from 'react';

import { api } from '../shared/api';
import { useApp, type PanelId } from './stores/app';
import { PreviewProgram } from './components/PreviewProgram';
import { Toasts } from './components/Toasts';
import { StatusBar } from './components/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  IconBible, IconSong, IconPlan, IconTheme, IconMedia,
  IconDetect, IconDisplays, IconStudy, IconSettings, IconPlan as IconDeck, IconBible as IconNotes,
} from './components/Icons';

import { BiblePanel } from './panels/BiblePanel';
import { SongsPanel } from './panels/SongsPanel';
import { PlanPanel } from './panels/PlanPanel';
import { ThemePanel } from './panels/ThemePanel';
import { MediaPanel } from './panels/MediaPanel';
import { PresentationsPanel } from './panels/PresentationsPanel';
import { NotesPanel } from './panels/NotesPanel';
import { DetectPanel } from './panels/DetectPanel';
import { DisplaysPanel } from './panels/DisplaysPanel';
import { StudyPanel } from './panels/StudyPanel';
import { SettingsPanel } from './panels/SettingsPanel';

const PANELS: { id: PanelId; label: string; icon: typeof IconBible; key: string }[] = [
  { id: 'bible', label: 'Bible', icon: IconBible, key: '1' },
  { id: 'songs', label: 'Songs', icon: IconSong, key: '2' },
  { id: 'plan', label: 'Service', icon: IconPlan, key: '3' },
  { id: 'theme', label: 'Theme', icon: IconTheme, key: '4' },
  { id: 'media', label: 'Media', icon: IconMedia, key: '5' },
  { id: 'presentations', label: 'Slides', icon: IconDeck, key: '9' },
  { id: 'notes', label: 'Notes', icon: IconNotes, key: '0' },
  { id: 'detect', label: 'Detect', icon: IconDetect, key: '6' },
  { id: 'displays', label: 'Screens', icon: IconDisplays, key: '7' },
  { id: 'study', label: 'Study', icon: IconStudy, key: '8' },
];

function PanelBody({ panel }: { panel: PanelId }) {
  switch (panel) {
    case 'bible': return <BiblePanel />;
    case 'songs': return <SongsPanel />;
    case 'plan': return <PlanPanel />;
    case 'theme': return <ThemePanel />;
    case 'media': return <MediaPanel />;
    case 'presentations': return <PresentationsPanel />;
    case 'notes': return <NotesPanel />;
    case 'detect': return <DetectPanel />;
    case 'displays': return <DisplaysPanel />;
    case 'study': return <StudyPanel />;
    case 'settings': return <SettingsPanel />;
    default: return null;
  }
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  const boot = useApp((s) => s.boot);
  const toast = useApp((s) => s.toast);

  useEffect(() => { void boot(); }, [boot]);

  // Menu accelerators arrive from the main process as hotkey events.
  useEffect(() => {
    const off = api.on(api.events().HOTKEY, (action: never) => {
      const name = String(action);
      if (name.startsWith('panel:')) setPanel(name.slice(6) as PanelId);
      if (name === 'songs:import') void importSongs();
      if (name === 'plan:new') setPanel('plan');
      if (name === 'translations:import') setPanel('settings');
    });
    return off;

    async function importSongs() {
      const picked = await api.songs.pickFiles();
      if (!picked.paths?.length) return;
      const res = await api.songs.import(picked.paths);
      toast(`Imported ${res.imported} song${res.imported === 1 ? '' : 's'}`, res.failed ? 'warn' : 'success');
    }
  }, [setPanel, toast]);

  // Cmd/Ctrl+number switches panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const hit = PANELS.find((p) => p.key === e.key);
      if (hit) { e.preventDefault(); setPanel(hit.id); }
      if (e.key === ',') { e.preventDefault(); setPanel('settings'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPanel]);

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-mark">✝</div>
        <div className="boot-name">BiblePortal Studio</div>
        <div className="spinner" />
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="boot">
        <div className="boot-name">BiblePortal could not start</div>
        <p className="boot-error selectable">{bootError}</p>
        <button className="btn primary" onClick={() => void boot()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="console">
      <header className="titlebar drag">
        <div className="titlebar-brand">
          <span className="titlebar-mark">✝</span>
          <span className="titlebar-name">BiblePortal Studio</span>
          <span className="titlebar-build mono" title="Renderer build — confirms which bundle is running">
            {__BUILD_STAMP__}
          </span>
        </div>
      </header>

      <div className="console-body">
        <nav className="rail no-drag" aria-label="Panels">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`rail-btn ${panel === id ? 'active' : ''}`}
              onClick={() => setPanel(id)}
              title={`${label} (⌘${PANELS.find((p) => p.id === id)?.key})`}
              aria-current={panel === id}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
          <div className="rail-spacer" />
          <button
            className={`rail-btn ${panel === 'settings' ? 'active' : ''}`}
            onClick={() => setPanel('settings')}
            title="Settings (⌘,)"
          >
            <IconSettings />
            <span>Settings</span>
          </button>
        </nav>

        <main className="panel-host">
          {/* Keyed by panel so switching away from a broken one clears the error. */}
          <ErrorBoundary key={panel} area={`The ${panel} panel`}>
            <PanelBody panel={panel} />
          </ErrorBoundary>
        </main>

        {/* The transport is the last thing that should ever go down. */}
        <ErrorBoundary area="The preview/program view">
          <PreviewProgram />
        </ErrorBoundary>
      </div>

      <StatusBar />
      <Toasts />
    </div>
  );
}
