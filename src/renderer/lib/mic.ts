/**
 * Microphone capture with voice-activity endpointing.
 *
 * The naive approach — transcribe a fixed 6-second window — costs a full window
 * of latency on every phrase, however short. "John three sixteen" takes two
 * seconds to say and then waits four more for the timer.
 *
 * Instead this watches for the pause at the end of an utterance and transcribes
 * immediately. A speaker naming a reference almost always pauses right after it,
 * so the cue lands within a few hundred milliseconds of them finishing.
 *
 * The noise floor is measured continuously rather than assumed, because a
 * sanctuary with air conditioning and a room with none differ by more than any
 * fixed threshold can span.
 */

const TARGET_RATE = 16_000;

export interface MicStats {
  contextState: string;
  sampleRate: number;
  callbacks: number;
  windows: number;
  skippedSilent: number;
  lastRms: number;
  peakRms: number;
  /** Measured background level — the VAD threshold floats above this. */
  noiseFloor: number;
  /** True while an utterance is being collected. */
  inSpeech: boolean;
  /** Length of the utterance most recently emitted, in seconds. */
  lastUtteranceSeconds: number;
}

export interface MicOptions {
  /** Silence needed to close an utterance. Shorter cues faster but clips pauses. */
  endpointMs?: number;
  /** Utterances shorter than this are discarded as coughs and door clicks. */
  minUtteranceMs?: number;
  /** Force a cut in continuous speech so a monologue still produces cues. */
  maxUtteranceMs?: number;
  /** Audio kept from before speech onset, so the first word is never clipped. */
  preRollMs?: number;
  onWindow: (audio: Float32Array) => void;
  onLevel?: (rms: number) => void;
  onError?: (message: string) => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private running = false;

  /** Audio collected for the utterance in progress. */
  private speech: Float32Array[] = [];
  private speechSamples = 0;
  /** Rolling pre-onset audio, so the attack of the first word survives. */
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;

  private inSpeech = false;
  private silentSamples = 0;
  /** Running estimate of the room's background level. */
  private noiseFloor = 0.004;
  private framesSeen = 0;

  private readonly endpointSamples: number;
  private readonly minSamples: number;
  private readonly maxSamples: number;
  private readonly preRollLimit: number;

  readonly stats: MicStats = {
    contextState: 'none', sampleRate: 0, callbacks: 0, windows: 0,
    skippedSilent: 0, lastRms: 0, peakRms: 0, noiseFloor: 0,
    inSpeech: false, lastUtteranceSeconds: 0,
  };

  constructor(private opts: MicOptions) {
    const ms = (v: number | undefined, d: number) => Math.round(((v ?? d) / 1000) * TARGET_RATE);
    this.endpointSamples = ms(opts.endpointMs, 420);
    this.minSamples = ms(opts.minUtteranceMs, 500);
    this.maxSamples = ms(opts.maxUtteranceMs, 9000);
    this.preRollLimit = ms(opts.preRollMs, 300);
  }

  get active() { return this.running; }

  async start() {
    if (this.running) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      this.opts.onError?.(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Grant it in your system privacy settings, then start again.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one and try again.'
            : `Could not open the microphone: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    this.context = new AudioContext();

    // Chromium creates an AudioContext suspended; until resumed the graph never
    // runs and no audio is delivered, silently.
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
    this.stats.contextState = this.context.state;
    this.stats.sampleRate = this.context.sampleRate;

    if (this.context.state !== 'running') {
      this.opts.onError?.(`The audio engine did not start (state: ${this.context.state}).`);
      return;
    }

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = this.context.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => this.consume(e.inputBuffer.getChannelData(0), this.context!.sampleRate);

    this.source.connect(this.node);
    // ScriptProcessor only runs when connected onward, but the microphone must
    // never be echoed into the room.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.context.destination);

    this.running = true;
  }

  private consume(input: Float32Array, sampleRate: number) {
    if (!this.running) return;
    this.stats.callbacks += 1;
    this.stats.contextState = this.context?.state ?? 'none';

    const frame = sampleRate === TARGET_RATE ? Float32Array.from(input) : downsample(input, sampleRate, TARGET_RATE);

    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);

    this.stats.lastRms = rms;
    this.stats.peakRms = Math.max(this.stats.peakRms, rms);
    this.opts.onLevel?.(rms);
    this.framesSeen += 1;

    // Track the quiet background. Adapt down quickly to a room going silent and
    // up slowly, so a sustained voice never drags the floor along with it.
    if (!this.inSpeech) {
      this.noiseFloor = rms < this.noiseFloor
        ? this.noiseFloor * 0.9 + rms * 0.1
        : this.noiseFloor * 0.995 + rms * 0.005;
      this.noiseFloor = Math.max(this.noiseFloor, 0.0008);
    }
    this.stats.noiseFloor = this.noiseFloor;

    // Speech must clear the floor by a clear margin, with an absolute minimum so
    // a silent room's tiny floor doesn't make every rustle count as speech.
    const openGate = Math.max(this.noiseFloor * 3.2, 0.008);
    const closeGate = Math.max(this.noiseFloor * 2.0, 0.005);
    const isSpeech = this.inSpeech ? rms > closeGate : rms > openGate;

    if (!this.inSpeech) {
      // Keep a short rolling pre-roll so the first syllable is never lost.
      this.preRoll.push(frame);
      this.preRollSamples += frame.length;
      while (this.preRollSamples > this.preRollLimit && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()!.length;
      }

      if (isSpeech && this.framesSeen > 3) {
        this.inSpeech = true;
        this.stats.inSpeech = true;
        this.speech = [...this.preRoll];
        this.speechSamples = this.preRollSamples;
        this.preRoll = [];
        this.preRollSamples = 0;
        this.silentSamples = 0;
      }
      return;
    }

    this.speech.push(frame);
    this.speechSamples += frame.length;
    this.silentSamples = isSpeech ? 0 : this.silentSamples + frame.length;

    // Close on a pause, or cut a long monologue so it still yields cues.
    const endedByPause = this.silentSamples >= this.endpointSamples;
    const endedByLength = this.speechSamples >= this.maxSamples;
    if (endedByPause || endedByLength) this.flush(endedByLength);
  }

  /** Emit the collected utterance, if it is worth transcribing. */
  private flush(forced: boolean) {
    const samples = this.speechSamples;
    const chunks = this.speech;

    this.inSpeech = false;
    this.stats.inSpeech = false;
    this.speech = [];
    this.speechSamples = 0;
    this.silentSamples = 0;

    if (samples < this.minSamples) { this.stats.skippedSilent += 1; return; }

    const utterance = new Float32Array(samples);
    let offset = 0;
    for (const c of chunks) { utterance.set(c, offset); offset += c.length; }

    this.stats.windows += 1;
    this.stats.lastUtteranceSeconds = Number((samples / TARGET_RATE).toFixed(2));

    // A forced cut lands mid-sentence; carry a little tail so the next
    // utterance does not begin with a severed word.
    if (forced) {
      const tail = utterance.slice(Math.max(0, utterance.length - Math.round(0.25 * TARGET_RATE)));
      this.speech = [tail];
      this.speechSamples = tail.length;
      this.inSpeech = true;
      this.stats.inSpeech = true;
    }

    this.opts.onWindow(utterance);
  }

  stop() {
    this.running = false;
    this.stats.contextState = 'closed';
    this.stats.inSpeech = false;
    try { this.node?.disconnect(); } catch { /* already gone */ }
    try { this.source?.disconnect(); } catch { /* already gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close().catch(() => {});
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.speech = [];
    this.preRoll = [];
    this.speechSamples = 0;
    this.preRollSamples = 0;
    this.inSpeech = false;
  }
}

/** Linear-interpolation resample. Adequate for speech at these rates. */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return Float32Array.from(input);
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, input.length - 1);
    const frac = pos - low;
    out[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return out;
}
