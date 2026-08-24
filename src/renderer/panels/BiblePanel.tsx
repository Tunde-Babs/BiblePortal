/**
 * Bible panel — the fastest path from "what the preacher just said" to a verse
 * on the screen.
 *
 * One field handles everything: a reference, a phrase, or a misspelled book
 * name. The main process decides which it was and says so, rather than making
 * the operator choose a mode first.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, type SmartResult, type Suggestion, type OnlineBible } from '../../shared/api';
import type { Verse } from '../../shared/types';
import { scriptureDeck, useApp } from '../stores/app';
import { IconSearch } from '../components/Icons';

/** Wrap highlight ranges in <mark> without risking HTML injection. */
function Highlighted({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges?.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(<mark key={i}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

export function BiblePanel() {
  const settings = useApp((s) => s.settings);
  const translations = useApp((s) => s.translations);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [query, setQuery] = useState('');
  const [translation, setTranslation] = useState('');
  const [result, setResult] = useState<SmartResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /** Licensed translations the operator has enabled, shown alongside bundled ones. */
  const [online, setOnline] = useState<OnlineBible[]>([]);
  const [copyright, setCopyright] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTranslation = translation || settings?.general.defaultTranslation || translations[0]?.id || '';
  const versesPerSlide = settings?.presentation.versesPerSlide ?? 2;

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Load whichever licensed translations are switched on.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.online.config();
        if (!cfg.enabled || !cfg.bibles.length) { if (!cancelled) setOnline([]); return; }
        const all = await api.online.bibles();
        if (!cancelled) setOnline(all.filter((b) => cfg.bibles.includes(b.id)));
      } catch { if (!cancelled) setOnline([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  /** A licensed translation is fetched, not read from disk. */
  const isOnline = online.some((b) => b.id === activeTranslation);

  // Book-name completions. A partial name like "Jo" is the commonest thing
  // typed and is not a full-text query, so it gets its own lookup.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSuggestions([]); return; }
    let cancelled = false;
    api.bible.suggest(q, { limit: 8 })
      .then((list) => {
        if (cancelled) return;
        setSuggestions(list);
        setHighlight(0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query]);

  /** Accept a completion and run it. */
  const accept = useCallback((s: Suggestion) => {
    setQuery(s.completion);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  // Debounced search. A bundled translation goes through the offline engine; a
  // licensed one is fetched under the user's own key, so only references are
  // supported there — full-text search over a licensed text is not ours to do.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResult(null); setCopyright(''); return; }
    let cancelled = false;
    setBusy(true);

    const id = setTimeout(() => {
      const run = isOnline
        ? api.online.lookup(activeTranslation, q).then((hit) => {
            setCopyright(hit.copyright ?? '');
            return {
              kind: 'reference' as const,
              query: q,
              ok: true,
              reference: hit.verses[0]
                ? { bookId: hit.verses[0].bookId, book: hit.verses[0].book ?? '', chapter: hit.verses[0].chapter,
                    verse: hit.verses[0].verse, endChapter: hit.verses[0].chapter, endVerse: hit.verses[0].verse }
                : null,
              label: hit.label,
              translation: hit.translation,
              translationName: hit.translationName,
              translationAbbr: hit.translationAbbr,
              verses: hit.verses,
            } as unknown as SmartResult;
          })
        : api.bible.smart(q, { translation: activeTranslation, limit: 80 })
            .then((res) => { setCopyright(''); return res; });

      run
        .then((res) => { if (!cancelled) setResult(res); })
        .catch((err: Error) => { if (!cancelled) { toast(err.message, 'error'); setResult(null); } })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, isOnline ? 420 : 180);

    return () => { cancelled = true; clearTimeout(id); };
  }, [query, activeTranslation, isOnline, toast]);

  /** Stage a passage (whole reference result, or one verse from a text search). */
  const stage = useCallback(async (label: string, verses: Verse[], abbr: string, take = false) => {
    const deck = scriptureDeck(label, verses, abbr, versesPerSlide);
    if (take) await previewAndTake(deck); else await preview(deck);
    setSelected(label);
  }, [preview, previewAndTake, versesPerSlide]);

  /** Stage one verse found by text search. */
  const stageVerse = useCallback(async (verse: Verse, abbr: string, take = false) => {
    await stage(verse.label, [verse], abbr, take);
  }, [stage]);

  const isPassage = result?.kind === 'reference' || result?.kind === 'corrected';

  const header = useMemo(() => {
    if (!result || result.kind === 'empty') return null;
    if (result.kind === 'corrected') {
      return <span className="chip warn">Did you mean {result.suggestion}?</span>;
    }
    if (result.kind === 'reference') return <span className="chip accent">Reference</span>;
    return <span className="chip">{result.total} match{result.total === 1 ? '' : 'es'}</span>;
  }, [result]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Bible</h2>
        <div className="panel-head-spacer" />
        <select
          className="select"
          style={{ width: 'auto', minWidth: 110 }}
          value={activeTranslation}
          onChange={(e) => setTranslation(e.target.value)}
          aria-label="Translation"
        >
          <optgroup label="Installed">
            {translations.map((t) => (
              <option key={t.id} value={t.id}>{t.abbr} — {t.name}</option>
            ))}
          </optgroup>
          {online.length > 0 && (
            <optgroup label="Licensed (online)">
              {online.map((b) => (
                <option key={b.id} value={b.id}>{b.abbr} — {b.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="panel-toolbar">
        <div className="search-field">
          <IconSearch />
          <input
            ref={inputRef}
            className="input"
            placeholder="John 3:16, Ps 23, or search any phrase…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
            onKeyDown={(e) => {
              const open = showSuggestions && suggestions.length > 0;

              if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setHighlight((h) => {
                  const next = e.key === 'ArrowDown' ? h + 1 : h - 1;
                  return (next + suggestions.length) % suggestions.length;
                });
                return;
              }
              if (open && e.key === 'Tab') {
                e.preventDefault();
                accept(suggestions[highlight]);
                return;
              }
              if (e.key === 'Enter') {
                // A highlighted completion wins only while the list is showing
                // and the query is not already a resolved passage.
                if (open && !isPassage) { e.preventDefault(); accept(suggestions[highlight]); return; }
                if (isPassage && result) {
                  void stage(result.label, result.verses, result.translationAbbr, e.shiftKey);
                  setShowSuggestions(false);
                }
                return;
              }
              if (e.key === 'Escape') {
                if (open) setShowSuggestions(false); else setQuery('');
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {busy && <div className="spinner" />}

        {showSuggestions && suggestions.length > 0 && (
          <ul className="suggest" role="listbox">
            {suggestions.map((s, i) => (
              <li key={`${s.bookId}_${s.completion}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`suggest-item ${i === highlight ? 'active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault() /* keep focus */}
                  onClick={() => accept(s)}
                >
                  <span className="suggest-label">{s.label}</span>
                  <span className="suggest-hint">{s.hint}</span>
                </button>
              </li>
            ))}
            <li className="suggest-foot">
              <span className="kbd">↑</span><span className="kbd">↓</span> to choose ·
              <span className="kbd">Tab</span> to complete
            </li>
          </ul>
        )}
      </div>

      {isOnline && (
        <div className="panel-toolbar" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <span className="chip warn">licensed · online</span>
          <span className="faint truncate" style={{ fontSize: 'var(--fs-xs)' }}>
            {copyright || 'Fetched under your API.Bible key. References only — no full-text search.'}
          </span>
        </div>
      )}

      {header && (
        <div className="panel-toolbar" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {header}
          {isPassage && result && (
            <>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{result.label}</span>
              <div className="panel-head-spacer" />
              <button className="btn sm" onClick={() => void stage(result.label, result.verses, result.translationAbbr)}>
                Preview
              </button>
              <button className="btn sm live" onClick={() => void stage(result.label, result.verses, result.translationAbbr, true)}>
                Take
              </button>
            </>
          )}
        </div>
      )}

      <div className="panel-scroll">
        {/* ------------------------------------------------ passage reader */}
        {isPassage && result && (
          <div className="reader">
            {result.verses.map((v) => (
              <button
                key={v.label}
                className={`reader-verse ${selected === v.label ? 'selected' : ''}`}
                onClick={() => void stageVerse(v, result.translationAbbr)}
                onDoubleClick={() => void stageVerse(v, result.translationAbbr, true)}
                title="Click to preview this verse alone · double-click to take"
              >
                <span className="reader-num">{v.verse}</span>
                {v.text}
              </button>
            ))}
          </div>
        )}

        {/* -------------------------------------------------- text results */}
        {result?.kind === 'text' && (
          <div className="result-list">
            {result.results.map((v) => (
              <button
                key={v.label}
                className={`result ${selected === v.label ? 'selected' : ''}`}
                onClick={() => void stageVerse(v, result.translationAbbr ?? '')}
                onDoubleClick={() => void stageVerse(v, result.translationAbbr ?? '', true)}
              >
                <span className="result-head">
                  <span className="result-ref">{v.label}</span>
                </span>
                <span className="result-text">
                  <Highlighted text={v.text} ranges={v.highlights} />
                </span>
              </button>
            ))}
            {!result.results.length && (
              <div className="empty">
                <div className="empty-title">{suggestions.length ? 'Keep typing' : 'No matches'}</div>
                <div className="empty-body">
                  {suggestions.length
                    ? <>Did you mean <strong>{suggestions[0].label}</strong>? Press Tab to complete it.</>
                    : <>Nothing in {result.translationAbbr} contains that. Try fewer words, or a different translation.</>}
                </div>
              </div>
            )}
          </div>
        )}

        {!query && (
          <div className="empty">
            <div className="empty-title">Search scripture</div>
            <div className="empty-body">
              Type a reference like <strong>Jn 3:16</strong> or <strong>1 cor 13</strong>, or search
              a phrase. Spoken forms and misspellings are understood.
              <br /><br />
              <span className="faint">Enter previews · Shift+Enter takes it live</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
