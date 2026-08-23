/**
 * Live transcription: microphone → on-device Whisper → detection engine.
 *
 * Owns the whole chain and reports one honest status at every step. The panel
 * must never sit on "Listening…" while something upstream is broken — that was
 * the original failure, and it is the thing most likely to waste an operator's
 * Sunday morning.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MicCapture, type MicStats } from '../lib/mic';
import type { AsrRequest, AsrResponse } from '../workers/asr.worker';

export type AsrStatus =
  | 'idle'            // nothing running
  | 'loading-model'   // fetching or warming the model
  | 'ready'           // model loaded, not capturing
  | 'listening'       // capturing audio
  | 'transcribing'    // a window is being decoded
  | 'error';

/** Whisper builds available for local use, smallest first. */
export const ASR_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Tiny (English)', size: '~42 MB', note: 'Fastest. Good for clear speech close to the mic.' },
  { id: 'onnx-community/whisper-base.en', label: 'Base (English)', size: '~82 MB', note: 'Noticeably more accurate. Recommended.' },
  { id: 'onnx-community/whisper-small.en', label: 'Small (English)', size: '~250 MB', note: 'Best accuracy. Needs a capable machine.' },
];

export interface TranscriptionState {
  /** Derived from the flags below — never set directly, so it cannot lie. */
  status: AsrStatus;
  /** The model has finished loading and can accept audio. */
  modelReady: boolean;
  /** Audio windows arrived while the model was still loading. */
  buffered: boolean;
  /** A window is currently being decoded. */
  transcribing: boolean;
  /** The microphone is open and capturing. */
  capturing: boolean;
  /** Where audio actually stops, when it stops. */
  diag: MicStats & { sent: number; results: number; lastWorker: string };
  /** Model download / warm-up percentage, 0–100. */
  progress: number;
  progressLabel: string;
  error: string | null;
  /** Most recent transcript window. */
  transcript: string;
  /** Microphone level, 0–1, for the meter. */
  level: number;
  /** Round-trip decode time of the last window, in ms. */
  lastDecodeMs: number | null;
  /** Utterance end to transcript in hand, in ms — what the operator feels. */
  lastLatencyMs: number | null;
  /** Which compute path the model actually ran on. */
  backend: string;
}

interface Options {
  model: string;
  onTranscript: (text: string) => void;
}

export function useTranscription({ model, onTranscript }: Options) {
  const [state, setState] = useState<TranscriptionState>({
    status: 'idle',
    modelReady: false,
    buffered: false,
    transcribing: false,
    capturing: false,
    diag: {
      contextState: 'none', sampleRate: 0, callbacks: 0, windows: 0,
      skippedSilent: 0, lastRms: 0, peakRms: 0, noiseFloor: 0, inSpeech: false,
      lastUtteranceSeconds: 0, sent: 0, results: 0, lastWorker: '—',
    },
    progress: 0,
    progressLabel: '',
    error: null,
    transcript: '',
    level: 0,
    lastDecodeMs: null,
    lastLatencyMs: null,
    backend: '—',
  });

  const workerRef = useRef<Worker | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const jobRef = useRef(0);
  const busyRef = useRef(false);
  const modelReadyRef = useRef(false);
  const sentRef = useRef(0);
  const resultsRef = useRef(0);
  const lastWorkerRef = useRef('—');
  /** When the current utterance was handed to the worker. */
  const sentAtRef = useRef(0);
  /** Newest audio window captured before the model was ready. */
  const pendingAudioRef = useRef<Float32Array | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const wantListeningRef = useRef(false);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const patch = useCallback((p: Partial<TranscriptionState>) => setState((s) => ({ ...s, ...p })), []);

  /** Spin up the worker and load the model. Safe to call repeatedly. */
  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('../workers/asr.worker.ts', import.meta.url), { type: 'module' });

    worker.addEventListener('message', (event: MessageEvent<AsrResponse>) => {
      const msg = event.data;
      lastWorkerRef.current = msg.type === 'error'
        ? `error: ${msg.message.slice(0, 70)}`
        : msg.type === 'result'
          ? `result (${msg.ms}ms, ${msg.text.length} chars)`
          : msg.type;

      if (msg.type === 'progress') {
        patch({
          progress: msg.percent,
          progressLabel: msg.file ? `${msg.status} ${msg.file.split('/').pop()}` : msg.status,
        });
      }

      if (msg.type === 'ready') {
        modelReadyRef.current = true;
        patch({ modelReady: true, progress: 100, progressLabel: '', error: null, backend: msg.backend });

        // Anything captured during the download is transcribed now rather than lost.
        const pending = pendingAudioRef.current;
        pendingAudioRef.current = null;
        if (pending && wantListeningRef.current && !busyRef.current) {
          busyRef.current = true;
          jobRef.current += 1;
          patch({ buffered: false });
          worker.postMessage({ type: 'transcribe', id: jobRef.current, audio: pending }, [pending.buffer]);
        } else {
          patch({ buffered: false });
        }
      }

      if (msg.type === 'error') {
        busyRef.current = false;
        if (msg.fatal) {
          wantListeningRef.current = false;
          micRef.current?.stop();
          patch({ error: msg.message, transcribing: false, capturing: false });
        } else if (/not loaded/i.test(msg.message)) {
          // The model is still warming. Say so instead of pretending to listen.
          modelReadyRef.current = false;
          patch({ modelReady: false, transcribing: false });
        } else {
          // A single bad window shouldn't take the whole session down.
          patch({ transcribing: false });
        }
      }

      if (msg.type === 'result') {
        busyRef.current = false;
        resultsRef.current += 1;
        const latency = sentAtRef.current ? Math.round(performance.now() - sentAtRef.current) : null;
        setState((s) => ({ ...s, transcribing: false }));
        patch({ transcript: msg.text, lastDecodeMs: msg.ms, lastLatencyMs: latency, backend: msg.backend });
        if (msg.text) onTranscriptRef.current(msg.text);
      }
    });

    workerRef.current = worker;
    return worker;
  }, [patch]);

  /**
   * Where the ONNX runtime lives, as an absolute URL. Vite serves `public/` at
   * the site root in dev and copies it beside index.html in a build, so
   * resolving against the document base is correct for both.
   */
  const wasmBase = useRef(new URL('ort/', document.baseURI).href);

  const send = useCallback((msg: AsrRequest, transfer?: Transferable[]) => {
    const worker = ensureWorker();
    if (transfer) worker.postMessage(msg, transfer);
    else worker.postMessage(msg);
  }, [ensureWorker]);

  /** Download and warm the model without starting the microphone. */
  const prepare = useCallback(() => {
    patch({ progress: 0, error: null });
    send({ type: 'load', model, wasmBase: wasmBase.current });
  }, [model, send, patch]);

  const start = useCallback(async () => {
    wantListeningRef.current = true;
    sentRef.current = 0;
    resultsRef.current = 0;
    lastWorkerRef.current = '—';
    patch({ error: null });
    send({ type: 'load', model, wasmBase: wasmBase.current });

    const mic = new MicCapture({
      // Cue on the pause after a phrase rather than on a fixed timer: a spoken
      // reference is usually followed by a breath, and waiting out a whole
      // window costs seconds on every single cue.
      endpointMs: 420,
      minUtteranceMs: 500,
      maxUtteranceMs: 9000,
      preRollMs: 300,
      onLevel: (rms) => setState((s) => (Math.abs(s.level - rms) > 0.004 ? { ...s, level: rms } : s)),
      onWindow: (audio) => {
        // Still downloading: keep only the newest window so the first thing said
        // after the model lands is still transcribed, and say that we are holding it.
        if (!modelReadyRef.current) {
          pendingAudioRef.current = audio;
          setState((s) => (s.buffered ? s : { ...s, buffered: true }));
          return;
        }
        // Drop a window rather than queue behind a slow decode; the next one
        // arrives in seconds and stale audio is worse than a gap.
        if (busyRef.current) return;
        busyRef.current = true;
        jobRef.current += 1;
        sentRef.current += 1;
        sentAtRef.current = performance.now();
        setState((s) => ({ ...s, transcribing: true }));
        send({ type: 'transcribe', id: jobRef.current, audio }, [audio.buffer]);
      },
      onError: (message) => {
        wantListeningRef.current = false;
        patch({ error: message, capturing: false });
      },
    });

    micRef.current = mic;
    await mic.start();
    // Record only that capture started. Capturing audio is not the same as
    // being able to transcribe it, and conflating the two is what made this
    // panel sit on "Listening" while the model was never loaded.
    patch({ capturing: mic.active });
  }, [model, send, patch]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    micRef.current?.stop();
    micRef.current = null;
    busyRef.current = false;
    pendingAudioRef.current = null;
    patch({ level: 0, buffered: false, capturing: false, transcribing: false });
  }, [patch]);

  // Mirror the capture counters into render state a few times a second.
  useEffect(() => {
    if (!state.capturing) return;
    const id = setInterval(() => {
      const mic = micRef.current;
      if (!mic) return;
      setState((s) => ({
        ...s,
        diag: { ...mic.stats, sent: sentRef.current, results: resultsRef.current, lastWorker: lastWorkerRef.current },
      }));
    }, 500);
    return () => clearInterval(id);
  }, [state.capturing]);

  useEffect(() => () => {
    wantListeningRef.current = false;
    micRef.current?.stop();
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // Read from render state, never from a ref: a ref change does not re-render,
  // so a status derived from one would go stale exactly when it matters.
  const listening = state.capturing;

  /**
   * The one place status is decided. Derived rather than assigned, so the panel
   * can never show "Listening" while the model is absent or an error is live.
   */
  const status: AsrStatus =
    state.error ? 'error'
    : !state.modelReady && (listening || state.progress > 0 || state.progressLabel) ? 'loading-model'
    : state.transcribing ? 'transcribing'
    : listening ? 'listening'
    : state.modelReady ? 'ready'
    : 'idle';

  return { ...state, status, start, stop, prepare, listening };
}
