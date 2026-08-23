/**
 * Study panel — Strong's word study, topical search and passage outlines.
 *
 * All three run against the offline index and the public-domain Strong's
 * lexicon, so study works in a building with no connection at all.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type Outline } from '../../shared/api';
import type { StrongsEntry, Verse } from '../../shared/types';
import { scriptureDeck, useApp } from '../stores/app';
import { IconSearch } from '../components/Icons';

type Tab = 'topics' | 'words' | 'outline';

export function StudyPanel() {
  const settings = useApp((s) => s.settings);
  const preview = useApp((s) => s.preview);
  const toast = useApp((s) => s.toast);

  const [tab, setTab] = useState<Tab>('topics');
  const [topics, setTopics] = useState<string[]>([]);
  const [theme, setTheme] = useState('');
  const [topicVerses, setTopicVerses] = useState<Verse[]>([]);
  const [wordQuery, setWordQuery] = useState('');
  const [words, setWords] = useState<(StrongsEntry & { code: string })[]>([]);
  const [outlineRef, setOutlineRef] = useState('');
  const [outline, setOutline] = useState<Outline | null>(null);
  const [busy, setBusy] = useState(false);

  const translation = settings?.general.defaultTranslation;
  const versesPerSlide = settings?.presentation.versesPerSlide ?? 2;

  useEffect(() => { api.ai.topics().then(setTopics).catch(() => {}); }, []);

  const runTopic = useCallback(async (t: string) => {
    setTheme(t);
    setBusy(true);
    try {
      const res = await api.ai.topical(t, { translation, limit: 30 });
      setTopicVerses(res.verses);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { setBusy(false); }
  }, [translation, toast]);

  // Debounced lexicon search.
  useEffect(() => {
    if (tab !== 'words' || wordQuery.trim().length < 2) { setWords([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      api.bible.lexiconSearch(wordQuery, 40)
        .then((r) => { if (!cancelled) setWords(r); })
        .catch(() => {});
    }, 200);
    return () => { cancelled = true; clearTimeout(id); };
  }, [wordQuery, tab]);

  const runOutline = useCallback(async () => {
    if (!outlineRef.trim()) return;
    setBusy(true);
    try {
      setOutline(await api.ai.outline(outlineRef, { translation }));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setOutline(null);
    } finally { setBusy(false); }
  }, [outlineRef, translation, toast]);

  const stageVerse = useCallback(async (v: Verse) => {
    await preview(scriptureDeck(v.label, [v], '', versesPerSlide));
  }, [preview, versesPerSlide]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Study</h2>
        <div className="panel-head-spacer" />
        {busy && <div className="spinner" />}
      </div>

      <div className="panel-toolbar">
        {(['topics', 'words', 'outline'] as Tab[]).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : 'ghost'}`} onClick={() => setTab(t)}>
            {t === 'topics' ? 'Topics' : t === 'words' ? "Strong's" : 'Outline'}
          </button>
        ))}
      </div>

      <div className="panel-scroll">
        {/* ------------------------------------------------------- topics */}
        {tab === 'topics' && (
          <>
            <div className="panel-pad" style={{ borderBottom: '1px solid var(--line-soft)' }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                {topics.map((t) => (
                  <button
                    key={t}
                    className={`btn sm ${theme === t ? 'primary' : ''}`}
                    onClick={() => void runTopic(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="result-list">
              {topicVerses.map((v) => (
                <button key={v.label} className="result" onClick={() => void stageVerse(v)}>
                  <span className="result-head">
                    <span className="result-ref">{v.label}</span>
                  </span>
                  <span className="result-text">{v.text}</span>
                </button>
              ))}
              {!topicVerses.length && (
                <div className="empty">
                  <div className="empty-title">Pick a theme</div>
                  <div className="empty-body">
                    Each theme expands into the related vocabulary scripture actually uses,
                    so “anxiety” also finds “careful”, “troubled” and “peace”.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ----------------------------------------------------- Strong's */}
        {tab === 'words' && (
          <>
            <div className="panel-toolbar">
              <div className="search-field">
                <IconSearch />
                <input
                  className="input"
                  placeholder="Search a meaning, or a code like G26 / H1254…"
                  value={wordQuery}
                  onChange={(e) => setWordQuery(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="panel-pad stack">
              {words.map((w) => (
                <div key={w.code} className="card">
                  <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
                    <span className="result-ref mono">{w.code}</span>
                    <span style={{ fontSize: 'var(--fs-lg)', fontFamily: 'var(--font-serif)' }}>{w.lemma}</span>
                    <span className="muted">{w.translit}</span>
                    <div className="panel-head-spacer" />
                    <span className="chip">{w.lang}</span>
                  </div>
                  <p className="selectable" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--text-dim)' }}>
                    {w.definition}
                  </p>
                  {w.usage && (
                    <p className="faint selectable" style={{ fontSize: 'var(--fs-xs)', marginTop: 6, lineHeight: 1.55 }}>
                      KJV usage: {w.usage}
                    </p>
                  )}
                </div>
              ))}
              {!words.length && (
                <div className="empty">
                  <div className="empty-title">Strong's Hebrew &amp; Greek</div>
                  <div className="empty-body">
                    14,000+ entries from Strong's Concordance (1890, public domain).
                    Search an English meaning or enter a code directly.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ------------------------------------------------------ outline */}
        {tab === 'outline' && (
          <>
            <div className="panel-toolbar">
              <div className="search-field">
                <IconSearch />
                <input
                  className="input"
                  placeholder="Passage — e.g. Philippians 4:4-9"
                  value={outlineRef}
                  onChange={(e) => setOutlineRef(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runOutline(); }}
                />
              </div>
              <button className="btn" onClick={() => void runOutline()} disabled={!outlineRef.trim()}>Build</button>
            </div>

            {outline ? (
              <div className="panel-pad stack">
                <div className="row">
                  <span className="result-ref">{outline.label}</span>
                  <span className="chip">{outline.verseCount} verses</span>
                  <span className="chip">~{outline.readingTimeSeconds}s read</span>
                </div>

                <div className="card">
                  <div className="card-title">Key terms</div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                    {outline.keyTerms.map((k) => <span key={k.term} className="chip accent">{k.term}</span>)}
                  </div>
                </div>

                {outline.movements.map((m, i) => (
                  <div key={m.range} className="card">
                    <div className="card-title">Movement {i + 1} · {m.range}</div>
                    {m.verses.map((v) => (
                      <button
                        key={v.label}
                        className="reader-verse"
                        style={{ padding: '4px 0' }}
                        onClick={() => void stageVerse(v)}
                      >
                        <span className="reader-num">{v.verse}</span>{v.text}
                      </button>
                    ))}
                  </div>
                ))}

                {!!outline.crossRefs.length && (
                  <div className="card">
                    <div className="card-title">Cross references</div>
                    {outline.crossRefs.map((v) => (
                      <button key={v.label} className="reader-verse" style={{ padding: '4px 0' }} onClick={() => void stageVerse(v)}>
                        <span className="reader-num">{v.label}</span> {v.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-title">Passage outline</div>
                <div className="empty-body">
                  Breaks a passage into movements, pulls out its distinctive vocabulary,
                  and finds cross references that share that language.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
