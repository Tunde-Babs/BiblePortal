/**
 * Live scripture detection.
 *
 * Transcribes the room with Whisper running on this machine, then cues the
 * verse the speaker named or quoted. The model downloads once; after that the
 * whole chain — capture, transcription, matching — is offline.
 *
 * Every stage reports its real state. An operator must never be looking at
 * "Listening…" while the engine is actually dead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../shared/api';
import type { Detection } from '../../shared/types';
import { scriptureDeck, useApp } from '../stores/app';
import { useTranscription, ASR_MODELS, type AsrStatus } from '../hooks/useTranscription';

const STATUS_TEXT: Record<AsrStatus, string> = {
  idle: 'Not running',
  'loading-model': 'Preparing speech model',
  ready: 'Ready — not listening',
  listening: 'Listening',
  transcribing: 'Transcribing',
  error: 'Stopped',
};

export function DetectPanel() {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const preview = useApp((s) => s.preview);
  const previewAndTake = useApp((s) => s.previewAndTake);
  const toast = useApp((s) => s.toast);

  const [detections, setDetections] = useState<Detection[]>([]);
  const [manual, setManual] = useState('');
  const [model, setModel] = useState(ASR_MODELS[1].id);
  const [history, setHistory] = useState<string[]>([]);

  const sensitivity = settings?.ai.detectionSensitivity ?? 0.62;
  const autoAdvance = settings?.ai.autoAdvance ?? false;
  const versesPerSlide = settings?.presentation.versesPerSlide ?? 2;

  // Keep the latest settings visible to the transcript callback without
  // re-creating the whole audio chain every time a slider moves.
  const cfg = useRef({ sensitivity, autoAdvance, versesPerSlide, translation: settings?.general.defaultTranslation });
  useEffect(() => {
    cfg.current = { sensitivity, autoAdvance, versesPerSlide, translation: settings?.general.defaultTranslation };
  }, [sensitivity, autoAdvance, versesPerSlide, settings]);

  /** Run a transcript window through the detection engine. */
  const handleTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setHistory((h) => [text, ...h].slice(0, 8));
    try {
      const res = await api.ai.detect(text, {
        translation: cfg.current.translation,
        sensitivity: cfg.current.sensitivity,
      });
      if (!res.detections.length) return;

      setDetections((prev) => [...res.detections, ...prev].slice(0, 12));

      if (cfg.current.autoAdvance && res.detections[0]?.verses?.length) {
        const hit = res.detections[0];
        await previewAndTake(scriptureDeck(hit.label, hit.verses!, hit.translationAbbr ?? '', cfg.current.versesPerSlide));
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [previewAndTake, toast]);

  const asr = useTranscription({ model, onTranscript: handleTranscript });

  const cue = useCallback(async (hit: Detection, take = false) => {
    if (!hit.verses?.length) return;
    const deck = scriptureDeck(hit.label, hit.verses, hit.translationAbbr ?? '', versesPerSlide);
    if (take) await previewAndTake(deck); else await preview(deck);
  }, [preview, previewAndTake, versesPerSlide]);

  const testPhrase = useCallback(() => {
    if (!manual.trim()) return;
    void handleTranscript(manual);
    setManual('');
  }, [manual, handleTranscript]);

  const running = asr.status === 'listening' || asr.status === 'transcribing';
  const busy = asr.status === 'loading-model';

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Live Detect</h2>
        <div className="panel-head-spacer" />
        {running
          ? <button className="btn live" onClick={asr.stop}>● Stop listening</button>
          : <button className="btn primary" onClick={() => void asr.start()} disabled={busy}>
              {busy ? 'Preparing…' : 'Start listening'}
            </button>}
      </div>

      <div className="panel-scroll panel-pad">
        {/* --------------------------------------------------------- status */}
        <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className={`status-dot ${asr.status === 'error' ? 'warn' : running ? 'live' : asr.status === 'ready' ? 'on' : ''}`} />
            <span className="switch-label">{STATUS_TEXT[asr.status]}</span>
            {/* Capturing audio and being able to transcribe it are different
                things; when they disagree, say so plainly. */}
            {asr.listening && !asr.modelReady && <span className="chip warn">mic open · model not ready</span>}
            {asr.buffered && <span className="chip accent">holding audio</span>}
            {asr.lastLatencyMs != null && running && (
              <span className={`chip ${asr.lastLatencyMs < 3000 ? 'preview' : 'warn'}`}>
                {(asr.lastLatencyMs / 1000).toFixed(1)}s cue
              </span>
            )}
            {asr.backend !== '—' && running && <span className="chip">{asr.backend}</span>}
            <div className="panel-head-spacer" />
            {running && (
              <div className="level-meter" title="Microphone level">
                <div className="level-fill" style={{ width: `${Math.min(100, asr.level * 420)}%` }} />
              </div>
            )}
          </div>

          {busy && (
            <>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${asr.progress}%` }} /></div>
              <p className="field-hint" style={{ marginTop: 6 }}>
                {asr.progress > 0 && asr.progress < 100
                  ? `Downloading the speech model — ${asr.progress}%${asr.progressLabel ? ` (${asr.progressLabel})` : ''}. This happens once; afterwards detection works with no connection.`
                  : 'Loading the speech model — this can take a minute the first time.'}
                {asr.listening && ' Your microphone is already open; audio from now is kept and transcribed as soon as it is ready.'}
              </p>
            </>
          )}

          {asr.error && (
            <div className="notice warn" style={{ marginTop: 'var(--sp-3)' }}>
              <strong>Speech input stopped.</strong> {asr.error}
              <br /><br />
              Detection still works from the text box below — the matching engine is the same one.
            </div>
          )}

          {!busy && !asr.error && (
            <p className="field-hint">
              {running
                ? 'Transcribing on this machine. Nothing is sent anywhere.'
                : asr.modelReady
                  ? 'Model loaded. Press Start listening to begin.'
                  : 'Whisper runs locally. The model downloads once, then works offline.'}
            </p>
          )}
        </div>

        {/* ---------------------------------------------------- diagnostics */}
        {(running || asr.diag.callbacks > 0) && (
          <details className="card" style={{ marginBottom: 'var(--sp-4)' }} open={running && asr.diag.results === 0 && asr.diag.callbacks > 40}>
            <summary className="card-title" style={{ cursor: 'pointer' }}>Audio diagnostics</summary>
            <div className="grid-2" style={{ marginTop: 'var(--sp-3)', gap: 'var(--sp-2)' }}>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Engine state</span>
              <span className={`mono ${asr.diag.contextState === 'running' ? '' : 'chip warn'}`} style={{ fontSize: 'var(--fs-xs)' }}>
                {asr.diag.contextState} @ {asr.diag.sampleRate || '—'}Hz
              </span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Audio callbacks</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{asr.diag.callbacks}</span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Windows captured</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {asr.diag.windows}{asr.diag.skippedSilent ? ` (${asr.diag.skippedSilent} skipped as silent)` : ''}
              </span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Sent to transcribe</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{asr.diag.sent}</span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Transcripts returned</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{asr.diag.results}</span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Mic level (peak)</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{asr.diag.peakRms.toFixed(4)}</span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Noise floor / speaking</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {asr.diag.noiseFloor.toFixed(4)} {asr.diag.inSpeech ? '· speaking' : ''}
              </span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Last utterance</span>
              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {asr.diag.lastUtteranceSeconds ? `${asr.diag.lastUtteranceSeconds}s` : '—'}
                {asr.lastDecodeMs != null ? ` · decoded in ${(asr.lastDecodeMs / 1000).toFixed(1)}s` : ''}
              </span>

              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Last worker message</span>
              <span className="mono truncate" style={{ fontSize: 'var(--fs-xs)' }}>{asr.diag.lastWorker}</span>
            </div>
            <p className="field-hint" style={{ marginTop: 'var(--sp-3)' }}>
              Audio flows left to right. The first number that stops rising is where the problem is.
            </p>
          </details>
        )}

        {/* ----------------------------------------------------- transcript */}
        <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="card-title">Heard</div>
          <p
            className="selectable"
            style={{
              minHeight: 42,
              fontSize: 'var(--fs-md)',
              lineHeight: 1.6,
              color: asr.transcript ? 'var(--text-dim)' : 'var(--text-faint)',
            }}
          >
            {asr.transcript || (running ? 'Waiting for speech…' : 'Not listening')}
          </p>
          {history.length > 1 && (
            <div style={{ marginTop: 'var(--sp-3)', borderTop: '1px solid var(--line-soft)', paddingTop: 'var(--sp-2)' }}>
              {history.slice(1, 4).map((h, i) => (
                <p key={i} className="faint truncate" style={{ fontSize: 'var(--fs-xs)' }}>{h}</p>
              ))}
            </div>
          )}
        </div>

        {/* -------------------------------------------------- manual detect */}
        <div className="field">
          <span className="field-label">Test a phrase</span>
          <div className="row">
            <input
              className="input"
              placeholder="e.g. turn with me to romans chapter eight verse twenty eight"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') testPhrase(); }}
            />
            <button className="btn" onClick={testPhrase} disabled={!manual.trim()}>Detect</button>
          </div>
          <span className="field-hint">
            Understands spoken numbers (“chapter three verse sixteen”), ordinals (“first corinthians”)
            and quoted scripture read aloud. Works whether or not the microphone is running.
          </span>
        </div>

        {/* ----------------------------------------------------- model pick */}
        <div className="field">
          <span className="field-label">Speech model</span>
          <select
            className="select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={running || busy}
          >
            {ASR_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.size}</option>)}
          </select>
          <span className="field-hint">
            {ASR_MODELS.find((m) => m.id === model)?.note}
            {' '}Each model downloads once and is then cached on this computer.
          </span>
          {!running && !busy && (
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={asr.prepare}>
              Download now
            </button>
          )}
        </div>

        {/* -------------------------------------------------------- tuning */}
        <div className="switch-row">
          <div>
            <div className="switch-label">Auto-take detections</div>
            <div className="switch-desc">
              Send a detected verse straight to the screen with no confirmation.
              Off by default — a false positive is worse than a slow cue.
            </div>
          </div>
          <button
            className={`switch ${autoAdvance ? 'on' : ''}`}
            onClick={() => void patchSettings({ ai: { autoAdvance: !autoAdvance } })}
            aria-pressed={autoAdvance}
            aria-label="Auto-take detections"
          />
        </div>

        <div className="field" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="field-label">Sensitivity — {Math.round(sensitivity * 100)}%</span>
          <input
            type="range"
            min={0.35}
            max={0.95}
            step={0.01}
            value={sensitivity}
            onChange={(e) => void patchSettings({ ai: { detectionSensitivity: Number(e.target.value) } })}
          />
          <span className="field-hint">
            Lower catches more references but risks false cues. Higher only fires on confident matches.
            Above about 90% only an explicit “book chapter verse” will trigger.
          </span>
        </div>

        {/* --------------------------------------------------- detections */}
        <div className="settings-group" style={{ marginTop: 'var(--sp-5)' }}>
          <div className="row">
            <span className="section-label">Detections</span>
            <div className="panel-head-spacer" />
            {!!detections.length && (
              <button className="btn sm ghost" onClick={() => setDetections([])}>Clear</button>
            )}
          </div>

          {!detections.length ? (
            <p className="field-hint" style={{ marginTop: 'var(--sp-3)' }}>
              Nothing detected yet. Start listening, or type a test phrase above.
            </p>
          ) : (
            <div className="stack" style={{ marginTop: 'var(--sp-3)' }}>
              {detections.map((hit, i) => (
                <div key={`${hit.label}_${i}`} className="card">
                  <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
                    <span className="result-ref">{hit.label}</span>
                    <span className={`chip ${hit.confidence > 0.8 ? 'preview' : 'warn'}`}>
                      {Math.round(hit.confidence * 100)}%
                    </span>
                    <span className="chip">{hit.via}</span>
                    <div className="panel-head-spacer" />
                    <button className="btn sm" onClick={() => void cue(hit)}>Preview</button>
                    <button className="btn sm live" onClick={() => void cue(hit, true)}>Take</button>
                  </div>
                  {hit.verses?.[0] && <p className="result-text truncate">{hit.verses[0].text}</p>}
                  <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>heard: “{hit.matched}”</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
