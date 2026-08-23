import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../../shared/api';
import { useApp } from '../stores/app';

/** Persistent bottom strip: what is live, which screens are open, library size. */
export function StatusBar() {
  const live = useApp((s) => s.live);
  const songs = useApp((s) => s.songs);
  const translations = useApp((s) => s.translations);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screens, setScreens] = useState({ output: false, stage: false });

  useEffect(() => { api.app.info().then(setInfo).catch(() => {}); }, []);

  // Poll display status: windows can be closed by the OS without telling us.
  useEffect(() => {
    const check = () => api.displays.status().then((s) => setScreens({ output: s.output, stage: s.stage })).catch(() => {});
    check();
    const id = setInterval(check, 2500);
    return () => clearInterval(id);
  }, []);

  const onAir = !!live?.program?.slides?.length && !live.blackout && !live.cleared;

  return (
    <footer className="statusbar">
      <span className="status-item">
        <span className={`status-dot ${live?.blackout ? 'warn' : onAir ? 'live' : ''}`} />
        {live?.blackout ? 'Blackout' : onAir ? `On air — ${live?.program.title}` : 'Standing by'}
      </span>

      <span className="status-item">
        <span className={`status-dot ${screens.output ? 'on' : ''}`} />
        Audience {screens.output ? 'open' : 'closed'}
      </span>

      <span className="status-item">
        <span className={`status-dot ${screens.stage ? 'on' : ''}`} />
        Stage {screens.stage ? 'open' : 'closed'}
      </span>

      <div className="status-spacer" />

      <span className="status-item">{translations.length} translation{translations.length === 1 ? '' : 's'}</span>
      <span className="status-item">{songs.length} song{songs.length === 1 ? '' : 's'}</span>
      <span className="status-item" title="All content is stored on this computer">Offline</span>
      {info && <span className="status-item mono">v{info.version}</span>}
      <span className="status-item mono" title="Renderer build timestamp — check this matches the build you expect">
        build {__BUILD_STAMP__}
      </span>
    </footer>
  );
}
