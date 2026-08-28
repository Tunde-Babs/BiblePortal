/**
 * Boot and shell.
 *
 * If these fail nothing else in the suite means anything, so they assert the
 * foundations plainly: the app starts, the bridge is present, services report
 * ready, and every panel opens without throwing.
 */

import { test, expect, PANEL_TITLES, type PanelLabel } from '../fixtures/app';

test('the console window opens and finishes booting', async ({ app }) => {
  await expect(app.console.locator('.console')).toBeVisible();
  await expect(app.console.locator('.boot')).toHaveCount(0);
  await expect(app.console.locator('.titlebar-name')).toHaveText('BiblePortal Studio');
});

test('the preload bridge is exposed with the expected surface', async ({ app }) => {
  const bridge = await app.bp(() => ({
    hasBible: typeof window.bp.bible?.lookup === 'function',
    hasLive: typeof window.bp.live?.take === 'function',
    hasSongs: typeof window.bp.songs?.upsert === 'function',
    hasAi: typeof window.bp.ai?.detect === 'function',
    // Context isolation must hold: Node must not be reachable from the page.
    nodeLeaked:
      typeof (window as any).require === 'function' || typeof (window as any).process === 'object',
  }));

  expect(bridge.hasBible).toBe(true);
  expect(bridge.hasLive).toBe(true);
  expect(bridge.hasSongs).toBe(true);
  expect(bridge.hasAi).toBe(true);
  expect(bridge.nodeLeaked, 'node integration must stay off in the renderer').toBe(false);
});

test('the seeded translations are installed and searchable', async ({ app }) => {
  const manifest = await app.bp(() => window.bp.bible.manifest());
  expect(manifest.translations.length).toBeGreaterThan(0);
  expect(manifest.translations.map((t: any) => t.id)).toContain('kjv');
});

test('every panel opens without throwing', async ({ app }) => {
  const panels: PanelLabel[] = [
    'Bible', 'Songs', 'Service', 'Theme', 'Media',
    'Slides', 'Notes', 'Detect', 'Screens', 'Study', 'Settings',
  ];

  for (const panel of panels) {
    await app.gotoPanel(panel);
    // The shell wraps each panel in an ErrorBoundary; if one caught something,
    // the panel is replaced by its fallback rather than the real content.
    await expect(
      app.console.locator('.panel-host .error-boundary, .panel-host .boundary'),
      `the ${panel} panel hit its error boundary`,
    ).toHaveCount(0);
  }
});

test('panel titles match the rail', async ({ app }) => {
  await app.gotoPanel('Slides');
  await expect(app.console.locator('.panel-host .panel-title').first()).toHaveText(PANEL_TITLES.Slides);

  await app.gotoPanel('Detect');
  await expect(app.console.locator('.panel-host .panel-title').first()).toHaveText(PANEL_TITLES.Detect);
});

test('the live transport starts empty', async ({ app }) => {
  const state = await app.live();
  expect(state.preview.slides).toHaveLength(0);
  expect(state.program.slides).toHaveLength(0);
  expect(state.blackout).toBe(false);
});
