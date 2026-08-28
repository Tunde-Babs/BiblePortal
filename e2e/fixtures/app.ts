/**
 * The end-to-end fixture: one isolated BiblePortal instance per test.
 *
 * Isolation comes from `--user-data-dir`. That single switch buys three things
 * at once:
 *
 *   • a private library, settings and cache, so tests cannot see each other's
 *     songs or leave state behind;
 *   • a private single-instance lock — main.cjs calls requestSingleInstanceLock
 *     and the lock lives in the user-data directory, so tests can run in
 *     parallel and can run while the real app is open on the same machine;
 *   • a private search-index cache, copied warm from the template so no test
 *     pays the ~700 ms cold build.
 *
 * Every window exposes the preload bridge as `window.bp`. The suite uses it for
 * arranging state and for asserting on what the main process actually holds —
 * never as a substitute for the interaction under test. A test that seeds three
 * songs over the bridge and then *clicks* to stage one is testing the UI; a
 * test that stages over the bridge is testing nothing.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { REPO_ROOT, TEMPLATE_DIR, E2E_TMP } from './paths';
import { launchArgs, launchEnv, shutdown } from './launch';

export interface LiveSlide { id: string; lines: string[]; caption?: string; verseNumbers?: number[] }
export interface LiveDeck { kind: string; title: string; slides: LiveSlide[]; index: number; meta?: Record<string, unknown> }
export interface LiveSnapshot {
  preview: LiveDeck;
  program: LiveDeck;
  blackout: boolean;
  logo?: boolean;
  cleared?: boolean;
}

export interface AppHandle {
  /** The Electron application under test. */
  electronApp: ElectronApplication;
  /** The operator console window. */
  console: Page;
  /** This instance's private user-data directory. */
  userDataDir: string;
  /** Where this instance writes saved schedules and templates. */
  documentsDir: string;
  /** Port reserved for this test's output server, unique per worker. */
  outputPort: number;

  /**
   * Run a function inside the console window.
   *
   * The bridge is reached as `window.bp` from within the callback rather than
   * being passed in: Playwright serialises the function and runs it in the
   * page, so a live object cannot be handed across, and rebuilding one there
   * would need `new Function`, which the app's CSP rightly blocks.
   */
  bp<T>(fn: () => Promise<T> | T): Promise<T>;
  bp<T, A>(fn: (arg: A) => Promise<T> | T, arg: A): Promise<T>;
  /** Current live state straight from the main process. */
  live(): Promise<LiveSnapshot>;
  /** Switch panels by clicking the rail, and wait for the panel to render. */
  gotoPanel(label: PanelLabel): Promise<void>;
  /** Open an output or stage window on the first display and return its page. */
  openDisplay(kind: 'output' | 'stage'): Promise<Page>;

  /**
   * Answer the next native open dialog with these paths.
   *
   * Import flows (media, songs, decks, opening a schedule) go through
   * `dialog.showOpenDialog` in the main process. A native dialog cannot be
   * driven from the renderer and nobody is watching a 6am run, so the suite
   * replaces the dialog itself and leaves the rest of the flow — validation,
   * copying, parsing, library writes — completely real.
   */
  stubOpenDialog(filePaths: string[]): Promise<void>;
  /** Answer the next native save dialog with this path. */
  stubSaveDialog(filePath: string): Promise<void>;
  /** Answer the next message box by button index. */
  stubMessageBox(responseIndex: number): Promise<void>;
  /** Cancel the next open dialog, as a user pressing Escape would. */
  stubCancelledDialog(): Promise<void>;
}

export type PanelLabel =
  | 'Bible' | 'Songs' | 'Service' | 'Theme' | 'Media'
  | 'Slides' | 'Notes' | 'Detect' | 'Screens' | 'Study' | 'Settings';

/**
 * Output-server ports are handed out per worker rather than per test.
 * A port is a machine-wide resource, so two workers must never pick the same
 * one; within a worker, tests run in series and can reuse it safely.
 */
const PORT_BASE = 17_300;

export const test = base.extend<{ app: AppHandle }>({
  app: async ({}, use, testInfo) => {
    const id = `${testInfo.workerIndex}-${crypto.randomBytes(4).toString('hex')}`;
    const userDataDir = path.join(E2E_TMP, `run-${id}`);
    const documentsDir = path.join(userDataDir, 'documents');
    const outputPort = PORT_BASE + testInfo.workerIndex;

    // Start from the warm template rather than a bare directory: this skips
    // main.cjs's first-run translation seeding and the cold index build.
    await cp(TEMPLATE_DIR, userDataDir, { recursive: true });
    await mkdir(documentsDir, { recursive: true });

    const electronApp = await electron.launch({
      args: launchArgs(userDataDir),
      cwd: REPO_ROOT,
      env: launchEnv({ BP_DOCUMENTS_DIR: documentsDir }),
      timeout: 60_000,
    });

    // Surface main-process crashes and console errors in the test report.
    // Without this a renderer exception shows up only as a selector timeout.
    const mainLog: string[] = [];
    electronApp.process().stderr?.on('data', (b) => mainLog.push(String(b)));

    const consoleWindow = await electronApp.firstWindow({ timeout: 30_000 });
    await consoleWindow.waitForLoadState('domcontentloaded');

    const rendererErrors: string[] = [];
    consoleWindow.on('pageerror', (err) => rendererErrors.push(err.message));

    // The shell renders a `.boot` splash until services report ready.
    await consoleWindow.waitForSelector('.console', { timeout: 30_000 });

    // Disable the quit confirmation before a test can put anything on air.
    //
    // main.cjs guards `before-quit` with a modal dialog whenever output is live
    // or a plan has unsaved edits. That guard is right for an operator and fatal
    // for an unattended run: nobody is there to answer it, so teardown would
    // block until the whole job timed out. `confirmOnQuit` is the app's own
    // supported way to turn it off, so the suite uses that rather than
    // simulating a click on a native dialog.
    await consoleWindow.evaluate(() =>
      window.bp.settings.patch({ general: { confirmOnQuit: false } }),
    );

    const handle: AppHandle = {
      electronApp,
      console: consoleWindow,
      userDataDir,
      documentsDir,
      outputPort,

      bp: ((fn: any, arg?: any) => consoleWindow.evaluate(fn, arg)) as AppHandle['bp'],

      live: async () => {
        const res = await consoleWindow.evaluate(() => window.bp.live.get());
        return res.state as LiveSnapshot;
      },

      gotoPanel: async (label) => {
        const button = consoleWindow.locator('.rail-btn', { hasText: new RegExp(`^${label}$`) });
        await button.click();
        // Assert on the rail's own active state rather than the panel heading:
        // Slides opens a panel titled "Presentations", and the Notes heading
        // becomes the sermon's name as soon as one is open.
        await expect(button).toHaveClass(/\bactive\b/, { timeout: 10_000 });
        await expect(consoleWindow.locator('.panel-host .panel')).toBeVisible({ timeout: 10_000 });
      },

      openDisplay: async (kind) => {
        const opened = electronApp.waitForEvent('window', { timeout: 20_000 });
        await consoleWindow.evaluate(async (which) => {
          const list = await window.bp.displays.list();
          return window.bp.displays.open(which, list.displays[0].id);
        }, kind);
        const page = await opened;
        await page.waitForLoadState('domcontentloaded');
        return page;
      },

      stubOpenDialog: (filePaths) =>
        electronApp.evaluate(({ dialog }, paths) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
        }, filePaths),

      stubSaveDialog: (filePath) =>
        electronApp.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
        }, filePath),

      stubMessageBox: (responseIndex) =>
        electronApp.evaluate(({ dialog }, response) => {
          dialog.showMessageBox = async () => ({ response, checkboxChecked: false });
        }, responseIndex),

      stubCancelledDialog: () =>
        electronApp.evaluate(({ dialog }) => {
          dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
        }),
    };

    await use(handle);

    // ------------------------------------------------------------- teardown
    if (rendererErrors.length) {
      testInfo.attach('renderer-errors.txt', { body: rendererErrors.join('\n'), contentType: 'text/plain' });
    }
    if (mainLog.length && testInfo.status !== testInfo.expectedStatus) {
      testInfo.attach('main-process.log', { body: mainLog.join(''), contentType: 'text/plain' });
    }

    await shutdown(electronApp);

    // Keep the profile when a test failed — the library and settings files are
    // usually the fastest way to understand what actually happened.
    if (testInfo.status === testInfo.expectedStatus) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    } else {
      testInfo.attach('user-data-dir', { body: userDataDir, contentType: 'text/plain' });
    }

    // A renderer exception is a real defect even when assertions passed.
    expect(rendererErrors, `renderer threw:\n${rendererErrors.join('\n')}`).toEqual([]);
  },
});

/**
 * The heading each rail button opens. Not always the rail label: the Slides
 * button opens "Presentations", and Notes shows the sermon title once one is
 * loaded — so this is a reference for specs that want to assert on it, not
 * something `gotoPanel` relies on.
 */
export const PANEL_TITLES: Record<PanelLabel, string> = {
  Bible: 'Bible',
  Songs: 'Songs',
  Service: 'Service',
  Theme: 'Theme',
  Media: 'Media',
  Slides: 'Presentations',
  Notes: 'Sermon Notes',
  Detect: 'Live Detect',
  Screens: 'Screens',
  Study: 'Study',
  Settings: 'Settings',
};

export { expect };
