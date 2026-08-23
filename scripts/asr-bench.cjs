'use strict';
/**
 * Measures decode latency for realistic utterance lengths.
 *
 * The number that matters is not throughput but the gap between a speaker
 * finishing a phrase and the verse appearing. That is endpoint detection plus
 * decode, and decode is the part measured here.
 */

const { app, BrowserWindow } = require('electron');
require('../electron/main.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(3500);
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));

  const fs = require('node:fs');
  const p = require('node:path');
  const assetsDir = p.join(__dirname, '..', 'dist', 'assets');
  const workerFile = fs.readdirSync(assetsDir).find((f) => /^asr\.worker-.*\.js$/.test(f));

  const model = process.env.BENCH_MODEL || 'onnx-community/whisper-base.en';
  console.log(`\n  model: ${model}`);

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const worker = new Worker(new URL('./assets/${workerFile}', document.baseURI), { type: 'module' });
      const durations = [1.5, 2.5, 4, 6];
      const out = { backend: '?', runs: [] };

      return await new Promise((resolve) => {
        let ready = false;
        let i = 0;
        const timer = setTimeout(() => resolve({ error: 'timed out' }), 280000);

        const next = () => {
          if (i >= durations.length) {
            clearTimeout(timer); worker.terminate(); resolve(out); return;
          }
          const secs = durations[i];
          // Speech-shaped noise: a few formant-ish tones plus jitter.
          const n = Math.round(secs * 16000);
          const a = new Float32Array(n);
          for (let k = 0; k < n; k++) {
            const t = k / 16000;
            a[k] = 0.08 * (Math.sin(2*Math.PI*140*t) + 0.5*Math.sin(2*Math.PI*700*t)
                 + 0.3*Math.sin(2*Math.PI*1800*t)) + (Math.random()-0.5)*0.01;
          }
          out.runs.push({ seconds: secs, sentAt: performance.now() });
          worker.postMessage({ type: 'transcribe', id: i + 1, audio: a }, [a.buffer]);
        };

        worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready' && !ready) { ready = true; out.backend = m.backend; next(); return; }
          if (m.type === 'result') {
            const run = out.runs[i];
            run.ms = m.ms;
            run.wall = Math.round(performance.now() - run.sentAt);
            out.backend = m.backend;
            i++; next(); return;
          }
          if (m.type === 'error' && m.fatal !== false) {
            clearTimeout(timer); worker.terminate(); resolve({ error: m.message });
          }
        };

        worker.postMessage({
          type: 'load',
          model: ${JSON.stringify(model)},
          wasmBase: new URL('ort/', document.baseURI).href,
        });
      });
    })()
  `, true);

  if (result.error) {
    console.log(`  FAILED: ${result.error}\n`);
    app.exit(1);
    return;
  }

  console.log(`  backend: ${result.backend}\n`);
  console.log('  utterance   decode    + endpoint (0.42s) = cue latency');
  console.log('  ---------   -------   -----------------------------');
  for (const r of result.runs) {
    const cue = ((r.ms + 420) / 1000).toFixed(2);
    const flag = Number(cue) <= 3 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${String(r.seconds).padEnd(9)}s  ${String((r.ms/1000).toFixed(2)).padStart(5)}s   ${String(cue).padStart(5)}s  ${flag}`);
  }
  const worst = Math.max(...result.runs.map((r) => r.ms + 420));
  console.log(`\n  worst-case cue latency: ${(worst/1000).toFixed(2)}s ${worst <= 3000 ? '— within the 1-3s target' : '— ABOVE target'}\n`);
  app.exit(0);
});

app.on('window-all-closed', () => {});
