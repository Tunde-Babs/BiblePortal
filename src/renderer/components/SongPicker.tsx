/**
 * Searchable song chooser.
 *
 * A library of a couple of thousand songs cannot be picked from a flat list of
 * buttons — rendering it is slow and reading it is worse. The same search that
 * backs the Songs panel is used here, so a title, an author or a half-remembered
 * line all find the song, and the results are capped so the list stays quick.
 */

import { useEffect, useState } from 'react';

import { api } from '../../shared/api';
import type { Song } from '../../shared/types';
import { IconSearch } from './Icons';

const LIMIT = 40;

interface Props {
  songs: Song[];
  onPick: (song: Song) => void;
  /** Show a leading "+" on each result, for the quick-add strip. */
  plus?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}

export function SongPicker({ songs, onPick, plus = false, autoFocus = false, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);

  useEffect(() => {
    let cancelled = false;
    const term = query.trim();
    if (!term) {
      // No query: show the most recently used, which is what an operator
      // building this week's order usually reaches for.
      const recent = [...songs].sort((a, b) =>
        (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')
        || (b.usageCount ?? 0) - (a.usageCount ?? 0));
      setResults(recent.slice(0, LIMIT));
      return;
    }
    api.songs.search(term, LIMIT)
      .then((r) => { if (!cancelled) setResults(r.map((x) => x.song)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query, songs]);

  if (!songs.length) {
    return (
      <span className="field-hint">
        No songs in your library yet — import or write one in the Songs panel.
      </span>
    );
  }

  return (
    <>
      <div className="search-field" style={{ marginBottom: 'var(--sp-2)' }}>
        <IconSearch />
        <input
          className="input"
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder={placeholder ?? 'Search songs by title, author or words…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter takes the top hit, so a song can be added without reaching
            // for the mouse.
            if (e.key === 'Enter' && results[0]) { onPick(results[0]); setQuery(''); }
            if (e.key === 'Escape') setQuery('');
          }}
        />
      </div>

      {results.length === 0 ? (
        <span className="field-hint">Nothing matches “{query}”.</span>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {results.map((song) => (
            <button
              key={song.id}
              className="btn sm"
              onClick={() => { onPick(song); setQuery(''); }}
              title={[song.author, song.key].filter(Boolean).join(' · ') || undefined}
            >
              {plus ? `+ ${song.title}` : song.title}
            </button>
          ))}
          {results.length === LIMIT && (
            <span className="field-hint" style={{ alignSelf: 'center' }}>
              showing the first {LIMIT} — keep typing to narrow it
            </span>
          )}
        </div>
      )}
    </>
  );
}
