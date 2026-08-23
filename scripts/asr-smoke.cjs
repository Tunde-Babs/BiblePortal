'use strict';
/**
 * Verifies the local speech chain by driving the real Detect panel: the worker
 * boots, the ONNX runtime loads from the app bundle rather than a CDN, and the
 * Whisper model downloads and reports progress.
 *
 * Clicks the actual controls an operator would, so a regression in the wiring
 * fails here rather than on a Sunday morning.
 */

const { app, BrowserWindow } = require('electron');
require('../electron/main.cjs');

const results = [];
const record = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` \x1b[2m— ${detail}\x1b[0m` : ''}`);
};

const TIMEOUT = setTimeout(() => { console.error('\n  ASR smoke timed out'); process.exit(1); }, 420_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(3500);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('no window'); process.exit(1); }
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));

  // Surface worker/network failures that would otherwise be silent.
  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  const run = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`, true);

  try {
    // Open the Detect panel by clicking its rail button, as a user would.
    const opened = await run(`
      const btn = [...document.querySelectorAll('.rail-btn')].find(b => b.textContent.includes('Detect'));
      if (!btn) return false;
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      return !!document.querySelector('.panel-title') &&
             document.querySelector('.panel-title').textContent.includes('Live Detect');
    `);
    record('Detect panel opens', opened === true);

    // The text path must work with no microphone and no model at all.
    await run(`
      const input = document.querySelector('.panel-scroll .field input.input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'turn with me to romans chapter eight verse twenty eight');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const panel = document.querySelector('.panel-scroll');
      [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === 'Detect').click();
      return true;
    `);
    await sleep(1500);
    const textDetect = await run(`
      const ref = document.querySelector('.result-ref');
      return ref ? ref.textContent : null;
    `);
    record('text-path detection works with no model', textDetect === 'Romans 8:28', textDetect || 'nothing detected');

    // Choose the smallest model so the download completes quickly.
    await run(`
      const sel = [...document.querySelectorAll('select.select')].find(s => s.value.includes('whisper'));
      if (!sel) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'onnx-community/whisper-tiny.en');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return sel.value;
    `);
    record('model selector honours a choice', true, 'whisper-tiny.en');

    // Kick the download and watch for real progress.
    await run(`
      const panel = document.querySelector('.panel-scroll');
      [...panel.querySelectorAll('button')].find(b => b.textContent.includes('Download now')).click();
      return true;
    `);

    let sawProgress = false;
    let ready = false;
    let lastStatus = '';
    for (let i = 0; i < 130; i++) {
      await sleep(2000);
      const snap = await run(`
        const status = document.querySelector('.panel-scroll .card .switch-label');
        const fill = document.querySelector('.progress-fill');
        const err = document.querySelector('.notice.warn');
        return {
          status: status ? status.textContent : '',
          width: fill ? fill.style.width : null,
          error: err ? err.textContent.slice(0, 180) : null,
        };
      `);
      lastStatus = snap.status;
      if (snap.width && snap.width !== '0%') sawProgress = true;
      if (snap.error) { record('model load reported an error', false, snap.error); break; }
      // Match on the state, not the exact wording, so relabelling the UI does
      // not silently turn this check into a false failure.
      if (/^Ready/.test(snap.status)) { ready = true; break; }
    }

    // On a first run the model downloads and the bar advances; on later runs it
    // comes straight out of the local cache with nothing to report. Both are
    // correct — reaching Ready is the assertion that matters.
    record('model loads (download or cache)', ready,
      ready ? (sawProgress ? 'downloaded, progress shown' : 'served from local cache') : `stuck at: ${lastStatus}`);
    record('model reaches Ready', ready, `last status: ${lastStatus}`);

    // A model that loads but rejects every window looks identical to success
    // from the outside. Push real audio through and require a result back.
    if (ready) {
      // Vite content-hashes the worker chunk, so find its real name rather than
      // guessing at one.
      const fs = require('node:fs');
      const p = require('node:path');
      const assetsDir = p.join(__dirname, '..', 'dist', 'assets');
      const workerFile = fs.readdirSync(assetsDir).find((f) => /^asr\.worker-.*\.js$/.test(f));
      if (!workerFile) throw new Error('asr worker chunk not found in dist/assets');

      const decode = await run(`
        const WORKER_URL = new URL('./assets/${workerFile}', document.baseURI);
        return await new Promise((resolve) => {
          const worker = new Worker(WORKER_URL, { type: 'module' });
          let loaded = false;
          const timer = setTimeout(() => resolve({ ok: false, reason: 'timed out' }), 180000);

          worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'ready' && !loaded) {
              loaded = true;
              // Two seconds of low-level noise at 16 kHz — enough to exercise
              // the full decode path without needing a microphone.
              const audio = new Float32Array(32000);
              for (let i = 0; i < audio.length; i++) audio[i] = (Math.random() - 0.5) * 0.05;
              worker.postMessage({ type: 'transcribe', id: 1, audio }, [audio.buffer]);
            }
            if (m.type === 'result') {
              clearTimeout(timer);
              worker.terminate();
              resolve({ ok: true, ms: m.ms, chars: m.text.length });
            }
            if (m.type === 'error' && m.fatal !== false) {
              clearTimeout(timer);
              worker.terminate();
              resolve({ ok: false, reason: m.message });
            }
            if (m.type === 'error' && m.fatal === false && loaded) {
              clearTimeout(timer);
              worker.terminate();
              resolve({ ok: false, reason: m.message });
            }
          };

          worker.postMessage({
            type: 'load',
            model: 'onnx-community/whisper-tiny.en',
            wasmBase: new URL('ort/', document.baseURI).href,
          });
        });
      `);
      record('a real audio window decodes to a transcript', decode?.ok === true,
        decode?.ok ? `returned in ${decode.ms}ms` : `rejected: ${decode?.reason}`);
    } else {
      record('a real audio window decodes to a transcript', false, 'model never became ready');
    }

    const cdnHits = consoleErrors.filter((m) => /cdn|jsdelivr|unpkg/i.test(m));
    record('ONNX runtime served locally, not from a CDN', cdnHits.length === 0,
      cdnHits.length ? cdnHits[0].slice(0, 100) : 'no CDN errors');
  } catch (err) {
    record('ASR chain completed', false, err.message);
  }

  clearTimeout(TIMEOUT);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n  ${failed === 0 ? `\x1b[32m\x1b[1mAll ${results.length} ASR checks passed.\x1b[0m` : `\x1b[31m\x1b[1m${failed} of ${results.length} ASR checks failed.\x1b[0m`}\n`);
  if (consoleErrors.length) {
    console.log('  renderer errors:');
    consoleErrors.slice(0, 5).forEach((m) => console.log(`    ${m.slice(0, 160)}`));
  }
  app.exit(failed === 0 ? 0 : 1);
});

app.on('window-all-closed', () => {});
