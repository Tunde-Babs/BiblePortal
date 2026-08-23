/**
 * On-device speech recognition worker.
 *
 * Runs Whisper as ONNX through transformers.js, off the main thread so the
 * console stays responsive while a service is live. The model is fetched once
 * and cached; after that transcription needs no network at all.
 *
 * This replaces the browser's SpeechRecognition API, which cannot work here:
 * Chromium's implementation calls a Google speech service using API keys that
 * only official Chrome builds carry, so in Electron it fails immediately with
 * `not-allowed` no matter what permissions are granted.
 */

import { pipeline, env } from '@huggingface/transformers';

// Models come from the hub on first run, then out of the local cache.
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
  // Whisper decode is the latency budget. One thread was leaving most of the
  // machine idle; leave a couple of cores for the console and audio graph.
  const cores = (self.navigator?.hardwareConcurrency ?? 4);
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(cores - 2, 6));
}

/**
 * Point the ONNX runtime at the copy inside the app bundle rather than a CDN.
 * The path is supplied by the main thread: this worker's own URL sits under
 * /src in development and under /assets in a build, so resolving relative to
 * `import.meta.url` lands somewhere different in each.
 */
function useLocalRuntime(wasmBase: string) {
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = wasmBase;
}

export type AsrRequest =
  | { type: 'load'; model: string; wasmBase: string }
  | { type: 'transcribe'; id: number; audio: Float32Array }
  | { type: 'dispose' };

export type AsrResponse =
  | { type: 'progress'; file: string; percent: number; status: string }
  | { type: 'ready'; model: string; backend: string }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'result'; id: number; text: string; ms: number; backend: string };

/**
 * Minimal local shape for the loaded pipeline. The library's own type is a very
 * wide overload union that TypeScript cannot represent once it is referenced,
 * and we only ever call it one way.
 */
interface AsrPipeline {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<{ text?: string } | { text?: string }[]>;
  dispose?: () => Promise<void>;
}

let asr: AsrPipeline | null = null;
/**
 * English-only Whisper builds (the `.en` variants) reject `language` and
 * `task`: they can only ever transcribe English, so the options are meaningless
 * and transformers.js throws rather than ignoring them. Multilingual builds
 * require them. Getting this wrong fails every window while everything upstream
 * looks healthy.
 */
let englishOnly = false;
let backend = 'wasm';
let loading: Promise<void> | null = null;
let currentModel = '';

const post = (msg: AsrResponse) => (self as unknown as Worker).postMessage(msg);

async function load(model: string, wasmBase: string) {
  useLocalRuntime(wasmBase);
  if (asr && currentModel === model) { post({ type: 'ready', model, backend: 'wasm' }); return; }
  if (loading) return loading;

  loading = (async () => {
    try {
      // WebGPU is markedly faster where it exists; WASM is the dependable
      // fallback. Failing over is cheap, so try the fast path first.
      const hasWebGPU = 'gpu' in (self.navigator ?? {});
      let device: 'webgpu' | 'wasm' = hasWebGPU ? 'webgpu' : 'wasm';

      let built;
      try {
        built = await pipeline('automatic-speech-recognition', model, {
          dtype: device === 'webgpu' ? 'fp32' : 'q8',
          device,
        progress_callback: (p: { file?: string; progress?: number; status?: string }) => {
          post({
            type: 'progress',
            file: p.file ?? '',
            percent: Math.round(p.progress ?? 0),
            status: p.status ?? 'loading',
          });
          },
        });
      } catch (gpuErr) {
        if (device !== 'webgpu') throw gpuErr;
        // The GPU path can fail on some drivers; fall back rather than give up.
        device = 'wasm';
        built = await pipeline('automatic-speech-recognition', model, {
          dtype: 'q8',
          device: 'wasm',
        });
      }

      asr = built as unknown as AsrPipeline;
      currentModel = model;
      englishOnly = /\.en$/i.test(model.split('/').pop() ?? '');
      backend = device;

      // First decode pays for graph and shader compilation — measured at ~1.8s
      // against ~0.45s steady state. Spend that now, on a second of silence,
      // rather than on the operator's first live cue of the service.
      try {
        const warm = new Float32Array(16_000);
        await asr(warm, {
          ...(englishOnly ? {} : { language: 'en', task: 'transcribe' }),
          return_timestamps: false,
        });
      } catch {
        // A failed warm-up costs nothing; the real decode will report properly.
      }

      post({ type: 'ready', model, backend: device });
    } catch (err) {
      asr = null;
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      });
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * Remove Whisper's non-speech annotations.
 *
 * Fed a door click or room tone, Whisper reports the sound rather than staying
 * quiet: "(static)", "(clicking)", "[BLANK_AUDIO]", "[Music]". Those are not
 * things anybody said, so they should never reach the transcript or the
 * detector.
 */
function stripNonSpeech(text: string): string {
  const cleaned = String(text)
    .replace(/\[[^\]]*\]/g, ' ')     // [BLANK_AUDIO], [Music]
    .replace(/\([^)]*\)/g, ' ')      // (static), (clicking)
    .replace(/\*[^*]*\*/g, ' ')      // *coughs*
    .replace(/♪[^♪]*♪?/g, ' ')      // music runs
    .replace(/\s+/g, ' ')
    .trim();

  // Whisper also emits a bare "you" or "thank you" for near-silence.
  if (/^(?:you|thank you|thanks|bye|okay|oh)[.!?]?$/i.test(cleaned)) return '';
  return cleaned;
}

self.addEventListener('message', async (event: MessageEvent<AsrRequest>) => {
  const msg = event.data;

  if (msg.type === 'load') { await load(msg.model, msg.wasmBase); return; }

  if (msg.type === 'dispose') {
    await asr?.dispose?.().catch(() => {});
    asr = null;
    currentModel = '';
    englishOnly = false;
    return;
  }

  if (msg.type === 'transcribe') {
    if (!asr) { post({ type: 'error', message: 'Model is not loaded yet', fatal: false }); return; }
    const started = performance.now();
    try {
      // Whisper handles up to 30s in a single pass. Passing chunk_length_s
      // switches on the long-form chunked pipeline, which is markedly slower
      // and pointless for a phrase of a few seconds.
      const seconds = msg.audio.length / 16_000;
      const longForm = seconds > 28;

      const out = await asr(msg.audio, {
        // Only a multilingual model accepts these.
        ...(englishOnly ? {} : { language: 'en', task: 'transcribe' }),
        return_timestamps: false,
        ...(longForm ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
      });
      const raw = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : (out?.text ?? '');
      const text = stripNonSpeech(raw);
      post({
        type: 'result',
        id: msg.id,
        text: String(text).trim(),
        ms: Math.round(performance.now() - started),
        backend,
      });
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        fatal: false,
      });
    }
  }
});
