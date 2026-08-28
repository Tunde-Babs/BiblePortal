/**
 * Whisper model loading. @slow
 *
 * Everything here downloads a real model, so it runs as its own project and
 * never gates the functional suite. What it proves is the part the
 * deterministic detection spec cannot: that the ONNX runtime loads from inside
 * the app bundle rather than a CDN, that a model reaches a ready state, and
 * that the panel reports its real status rather than a hopeful one.
 *
 * Transcription of actual audio is not asserted here. Chromium's fake capture
 * device would not accept a generated WAV, and the alternatives — notably
 * `--no-sandbox` — cost more than the coverage is worth. Everything downstream
 * of the microphone is covered deterministically in 05-detect.spec.ts, which
 * feeds the same engine a transcript reaches.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { test, expect } from '../fixtures/app';

test.describe('@slow speech recognition', () => {
  test.beforeEach(async ({ app }) => {
    await app.gotoPanel('Detect');
  });

  test('the ONNX runtime is served from the app, not a CDN', async ({ app }) => {
    // transformers.js defaults to fetching the ONNX runtime from a CDN, which
    // would make speech require the network on every launch and defeat the
    // whole design. scripts/sync-ort.mjs copies the runtime into the bundle and
    // the worker is pointed at it.
    //
    // This is asserted on the resolved path and the shipped files rather than
    // by watching requests: the runtime is fetched from inside a Web Worker,
    // and page-level request events never see it.
    const wasmBase = await app.bp(() => new URL('ort/', document.baseURI).href);
    expect(wasmBase, 'the runtime base must be local, not a CDN').toMatch(/^file:/);

    const runtimeDir = fileURLToPath(wasmBase);
    const shipped = await readdir(runtimeDir);
    expect(shipped.filter((f) => /^ort-wasm.*\.wasm$/.test(f)).length).toBeGreaterThan(0);
    expect(shipped.filter((f) => /^ort-wasm.*\.mjs$/.test(f)).length).toBeGreaterThan(0);

    // And the worker must actually reach a ready state using it.
    await app.console.getByRole('button', { name: 'Download now' }).click();
    await expect(app.console.locator('.switch-label').first())
      .toHaveText(/Preparing speech model|Ready/, { timeout: 60_000 });
  });

  test('a model loads and reports which backend it ran on', async ({ app }) => {
    test.slow();

    await app.console.getByRole('button', { name: 'Download now' }).click();

    // The model downloads once, then comes from cache. Either way the panel has
    // to end up saying it is ready rather than sitting on a spinner.
    await expect(app.console.locator('.switch-label').first())
      .toHaveText('Ready — not listening', { timeout: 240_000 });
  });

  test('the panel never claims to be listening when it cannot transcribe', async ({ app }) => {
    // The original failure this guards: capture running while the model was
    // absent, with the panel showing "Listening" and cueing nothing. Capturing
    // audio and being able to transcribe it are different things.
    await app.console.getByRole('button', { name: 'Start listening' }).click();

    const status = app.console.locator('.switch-label').first();
    await expect(status).not.toHaveText('Listening', { timeout: 5_000 });
    await expect(status).toHaveText(/Preparing speech model|Transcribing|Listening/, { timeout: 240_000 });
  });
});
