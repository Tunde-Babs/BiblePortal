/**
 * How the suite starts an Electron instance.
 *
 * Shared by the fixture and by global setup so the two can never drift into
 * launching subtly different applications.
 */

import type { ElectronApplication } from '@playwright/test';
import path from 'node:path';

import { REPO_ROOT } from './paths';

/**
 * Environment for a launched instance.
 *
 * `ELECTRON_RUN_AS_NODE` is the important one. When it is set — and it is set
 * by some shells, editors and CI images — Electron starts as a plain Node
 * process with no browser and no window, so Playwright waits forever for a
 * DevTools line that will never arrive and reports only "Process failed to
 * launch!". The project's own npm scripts clear it for the same reason.
 * Playwright replaces the whole environment, so the key must be deleted rather
 * than set to an empty string.
 */
export function launchEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }

  delete env.ELECTRON_RUN_AS_NODE;

  // Never inherit a developer's dev-server flag: the built renderer and the
  // Vite-served one differ enough that a test would be lying about which ran.
  delete env.BP_DEV;

  return { ...env, BP_E2E: '1', ...overrides };
}

/**
 * Arguments for a launched instance.
 *
 * `--user-data-dir` is what makes the suite safe to run in parallel and safe to
 * run while the real app is open: main.cjs calls requestSingleInstanceLock, and
 * that lock lives inside the user-data directory, so a private directory means
 * a private lock as well as a private library.
 */
export function launchArgs(userDataDir: string): string[] {
  return [
    REPO_ROOT,
    `--user-data-dir=${userDataDir}`,

    // Never let getUserMedia reach a real microphone or a permission prompt
    // nobody is there to answer. The fake device generates a tone, which is all
    // the suite needs: no test asserts on transcribed audio.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',

    // An AudioContext created without a user gesture stays suspended, and the
    // capture graph then never runs.
    '--autoplay-policy=no-user-gesture-required',

  ];
}

/** Where a launched instance keeps its saved schedules and templates. */
export const documentsFor = (userDataDir: string) => path.join(userDataDir, 'documents');

/**
 * Stop an instance without ever waiting on something that may not happen.
 *
 * `electronApp.close()` closes the windows and then waits for the process to
 * exit, which on macOS it never does: main.cjs's `window-all-closed` handler
 * deliberately keeps the app alive there, the way a Mac app should. So quit
 * explicitly through the app object, and if the process is still up shortly
 * after — a stuck dialog, a pending store flush — kill it. A leaked Electron
 * instance per test would exhaust the machine long before the suite finished.
 */
export async function shutdown(electronApp: ElectronApplication): Promise<void> {
  const exited = electronApp.waitForEvent('close').catch(() => {});

  await electronApp
    .evaluate(({ app }) => { app.quit(); })
    .catch(() => { /* already tearing down */ });

  const timedOut = Symbol('timeout');
  const raced = await Promise.race([
    exited.then(() => 'closed' as const),
    new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 10_000)),
  ]);

  if (raced === timedOut) {
    electronApp.process().kill('SIGKILL');
    await electronApp.close().catch(() => {});
  }
}
