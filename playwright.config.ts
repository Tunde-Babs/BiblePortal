/**
 * End-to-end configuration.
 *
 * The suite drives the real Electron app against the built renderer. There is
 * no `webServer` block and no baseURL: every test launches its own application
 * process through the fixture in e2e/fixtures/app.ts.
 */

import { defineConfig } from '@playwright/test';
import { createRequire } from 'node:module';

const CI = !!process.env.CI;

/** The Electron version under test, recorded in the Allure environment block. */
function electronVersion(): string {
  try {
    return createRequire(import.meta.url)('electron/package.json').version;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/global-setup.ts',

  // Electron boot is ~2s and some specs import files or build an index, so the
  // per-test budget is generous. A test that needs longer is telling us
  // something, so it should say so explicitly with test.slow().
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Each test owns a private user-data directory, so parallelism is safe.
  // Capped because every worker runs a full Electron instance: more workers
  // than physical cores makes the whole run slower, not faster.
  fullyParallel: true,
  workers: CI ? 2 : 3,

  // A flake that only reproduces at 6am is worse than useless as a signal.
  // Retry on CI, never locally, so a developer sees flakiness immediately.
  retries: CI ? 2 : 0,

  // Never let a `.only` slip into the scheduled run.
  forbidOnly: CI,

  /**
   * Allure is the report the pipeline publishes and links to; the built-in HTML
   * report stays as the local, zero-setup one. Allure results are raw JSON that
   * a later step turns into a site, so the reporter is on in both places —
   * generating a report locally then only needs `npm run e2e:report`.
   */
  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results',
        detail: true,
        // Shown on every test in the report, so a failure from the scheduled
        // run carries the context needed to reproduce it.
        environmentInfo: {
          os: process.platform,
          arch: process.arch,
          node: process.version,
          electron: electronVersion(),
          ci: String(CI),
          commit: process.env.GITHUB_SHA ?? 'local',
          branch: process.env.GITHUB_REF_NAME ?? 'local',
        },
      },
    ],
    ['html', { outputFolder: 'e2e-report', open: 'never' }],
    ...(CI
      ? ([['json', { outputFile: 'e2e-report/results.json' }], ['github']] as const)
      : []),
  ] as any,

  outputDir: 'e2e-results',

  use: {
    // Traces are the single most useful artifact for a failure nobody watched
    // happen, which is every failure in a scheduled run.
    trace: CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: CI ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'e2e',
      // The Whisper suite downloads a model and decodes real audio. It is
      // excluded here and run as its own project so a model-server hiccup can
      // never redden the functional signal.
      grepInvert: /@slow/,
    },
    {
      name: 'speech',
      grep: /@slow/,
      timeout: 300_000,
      retries: CI ? 1 : 0,
    },
  ],
});
