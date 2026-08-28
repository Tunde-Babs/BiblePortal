/**
 * Backgrounds and the theme designer.
 *
 * Media is copied into BiblePortal on import, so moving the original later is
 * safe — that copy is the thing worth proving. The theme designer writes
 * through live, with no apply step, so a change must reach the audience surface
 * without any further action.
 */

import { test, expect } from '../fixtures/app';
import { files } from '../fixtures/files';
import { stageScripture } from '../fixtures/seed';

test.describe('media', () => {
  test.beforeEach(async ({ app }) => {
    await app.gotoPanel('Media');
  });

  test('an empty library explains what media is for', async ({ app }) => {
    await expect(app.console.locator('.empty-title')).toHaveText(/No media yet/i);
  });

  test('an image imports and is copied into the app', async ({ app }) => {
    await app.stubOpenDialog([files.background]);
    await app.console.getByRole('button', { name: /Add files|Add media files/ }).first().click();

    await expect.poll(async () => {
      const media = await app.bp(() => window.bp.media.all());
      return media.media.length;
    }, { timeout: 20_000 }).toBe(1);

    const media = await app.bp(() => window.bp.media.all());
    // The stored path must be inside BiblePortal's own folder, not the source.
    expect(media.media[0].path ?? media.media[0].file ?? '').toContain(app.userDataDir);
  });

  test('a file whose name has spaces, # and & still loads', async ({ app }) => {
    // A '#' in a filename once truncated the URL and the background silently
    // failed to appear — the kind of fault only noticed mid-service.
    await app.stubOpenDialog([files.awkwardMedia]);
    await app.console.getByRole('button', { name: /Add files|Add media files/ }).first().click();

    await expect.poll(async () => {
      const media = await app.bp(() => window.bp.media.all());
      return media.media.length;
    }, { timeout: 20_000 }).toBe(1);

    const item = (await app.bp(() => window.bp.media.all())).media[0];
    expect(item.name).toContain('#');
  });

  test('media stages as its own deck', async ({ app }) => {
    await app.stubOpenDialog([files.background]);
    await app.console.getByRole('button', { name: /Add files|Add media files/ }).first().click();
    await expect(app.console.locator('.grid-2')).toBeVisible({ timeout: 20_000 });

    await app.console.getByRole('button', { name: 'Preview' }).first().click();

    await expect.poll(async () => (await app.live()).preview.kind, { timeout: 15_000 }).toBe('media');
  });
});

test.describe('theme', () => {
  test.beforeEach(async ({ app }) => {
    await app.gotoPanel('Theme');
  });

  test('the default theme is active and named', async ({ app }) => {
    const theme = await app.bp(() => window.bp.themes.active());
    expect(theme.theme?.name ?? theme.name).toBeTruthy();
  });

  test('a theme change reaches the live state with no apply step', async ({ app }) => {
    const before: any = await app.live();
    expect(before.theme.text.uppercase).toBe(false);

    // The switches carry no accessible name of their own, so find the one in
    // the row labelled "Uppercase" rather than guessing at an index.
    const uppercase = app.console
      .locator('.switch-row', { hasText: 'Uppercase' })
      .locator('.switch');
    await uppercase.click();

    // Every control writes through live; there is no apply step to forget.
    await expect
      .poll(async () => (await app.live() as any).theme.text.uppercase, { timeout: 15_000 })
      .toBe(true);
    await expect(uppercase).toHaveAttribute('aria-pressed', 'true');
  });

  test('a theme edit is visible on the audience window immediately', async ({ app }) => {
    await stageScripture(app, 'John 3:16');
    await app.console.locator('.pp-take-btn').click();
    const audience = await app.openDisplay('output');
    await expect(audience.locator('.slide-body')).toContainText('For God so loved');

    // Write a distinctive text colour straight through the theme API and check
    // the audience surface picks it up without any further interaction.
    await app.bp(async () => {
      const active = await window.bp.themes.active();
      const theme = active.theme ?? active;
      await window.bp.themes.save({ ...theme, text: { ...theme.text, color: '#ff0000' } });
    });

    await expect.poll(async () => {
      const state: any = await app.live();
      return state.theme?.text?.color;
    }, { timeout: 15_000 }).toBe('#ff0000');
  });
});
