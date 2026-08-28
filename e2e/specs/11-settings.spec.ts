/**
 * Settings, translations and licensed-translation configuration.
 *
 * The licensing rules here are the ones with legal weight, so they are asserted
 * rather than assumed: copyrighted translations are never offered for download,
 * and a church's API key stays in its own profile and out of every error path.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from '../fixtures/app';

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Settings');
});

test('the installed translations are listed', async ({ app }) => {
  const manifest = await app.bp(() => window.bp.bible.manifest());
  const ids = manifest.translations.map((t: any) => t.id);

  expect(ids).toContain('kjv');
  expect(ids).toContain('web');
});

test('the catalogue offers public-domain translations only', async ({ app }) => {
  const catalogue = await app.bp(() => window.bp.translations.catalogue());

  const all = (catalogue.groups ?? []).flatMap((g: any) => g.translations ?? []);
  expect(all.length).toBeGreaterThan(0);

  // No application may legally bundle or download these; if one ever appears in
  // the catalogue that is a licensing failure, not a cosmetic one.
  const copyrighted = /^(niv|nlt|nkjv|esv|nasb|amp|msg|csb|nrsv)$/i;
  const offending = all.filter((t: any) => copyrighted.test(t.id) || copyrighted.test(t.abbr ?? ''));
  expect(offending.map((t: any) => t.id)).toEqual([]);
});

test('settings persist across a restart of the console', async ({ app }) => {
  await app.bp(() => window.bp.settings.patch({ presentation: { versesPerSlide: 4 } }));

  await app.console.reload();
  await app.console.waitForSelector('.console');

  const { settings } = await app.bp(() => window.bp.settings.get());
  expect(settings.presentation.versesPerSlide).toBe(4);
});

test('settings reset to defaults', async ({ app }) => {
  await app.bp(() => window.bp.settings.patch({ presentation: { versesPerSlide: 6 } }));
  await app.bp(() => window.bp.settings.reset());

  const { settings } = await app.bp(() => window.bp.settings.get());
  expect(settings.presentation.versesPerSlide).not.toBe(6);
});

test('an API.Bible key is stored in the user profile and never handed back', async ({ app }) => {
  const secret = 'e2e-test-key-do-not-ship-2f8a1c';
  await app.bp(async (key) => window.bp.online.setKey(key), secret);

  // The renderer is told *whether* a key is set, never what it is. The key
  // belongs to the church, and nothing that can reach a screenshot, a log or a
  // support paste has any reason to carry it.
  const config = await app.bp(() => window.bp.online.config());
  expect(config.hasKey).toBe(true);
  expect(JSON.stringify(config)).not.toContain(secret);

  // It lives in this profile — and nowhere in the working tree.
  const settingsFile = path.join(app.userDataDir, 'library', 'settings.json');
  const onDisk = await readFile(settingsFile, 'utf8').catch(() => '');
  expect(onDisk, 'the key must be persisted for the app that owns it').toContain(secret);
});

test('licensed translations stay off until a key is supplied', async ({ app }) => {
  const config = await app.bp(() => window.bp.online.config());
  expect(config.enabled).toBe(false);
  expect(config.hasKey).toBe(false);
});

test('a diagnosis of the online connector never echoes the key', async ({ app }) => {
  const secret = 'e2e-secret-key-9z8y7x';
  await app.bp(async (key) => window.bp.online.setKey(key), secret);

  // Publishers permit church display on condition the key stays private, and a
  // support paste of a diagnostic must never carry it.
  const diagnosis = await app.bp(() =>
    window.bp.online.diagnose().catch((e: Error) => ({ error: e.message })),
  );

  expect(JSON.stringify(diagnosis)).not.toContain(secret);
});

test('importing a translation module from a file is offered', async ({ app }) => {
  // The import path exists so a church can use a module it already owns; the
  // file dialog is the entry point and cancelling must be harmless.
  await app.stubCancelledDialog();
  const result = await app.bp(() =>
    window.bp.translations.pickModule().catch((e: Error) => ({ error: e.message })),
  );

  expect(result.cancelled ?? result.ok === false).toBeTruthy();
});
