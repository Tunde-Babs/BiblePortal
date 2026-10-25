import { useState } from 'react';
import { useApp } from '../stores/app';

/** Shared lyric pagination setting used by the editor and every staging path. */
export function LyricLayoutSelect() {
  const maxLines = useApp((s) => s.settings?.presentation.maxLinesPerSlide ?? 4);
  const patchSettings = useApp((s) => s.patchSettings);
  const [saving, setSaving] = useState(false);

  const changeLayout = async (next: number) => {
    const settings = useApp.getState().settings;
    if (!settings) return;
    const previous = settings.presentation.maxLinesPerSlide;
    // Preview can be clicked before the preference finishes saving to disk.
    // Publish the choice immediately so that click uses the selected layout.
    useApp.setState({ settings: {
      ...settings, presentation: { ...settings.presentation, maxLinesPerSlide: next },
    } });
    setSaving(true);
    try {
      await patchSettings({ presentation: { maxLinesPerSlide: next } });
    } catch (error) {
      useApp.setState((state) => {
        if (!state.settings || state.settings.presentation.maxLinesPerSlide !== next) return {};
        return { settings: { ...state.settings,
          presentation: { ...state.settings.presentation, maxLinesPerSlide: previous },
        } };
      });
      useApp.getState().toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      className="select"
      style={{ width: 'auto', flex: 'none' }}
      aria-label="Lyric lines per slide"
      title="Layout for all songs. Applies when you preview or save. Blank lines start a new slide."
      value={maxLines}
      disabled={saving}
      onChange={(e) => void changeLayout(Number(e.target.value))}
    >
      <option value={0}>Full stanza</option>
      {Array.from({ length: 7 }, (_, i) => i + 2).map((n) => (
        <option key={n} value={n}>{n} lines per slide</option>
      ))}
    </select>
  );
}
