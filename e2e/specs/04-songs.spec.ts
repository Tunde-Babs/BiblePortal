/**
 * The song library.
 *
 * Covers the three ways songs get in — typed, pasted, imported from a file —
 * and the two things done with them afterwards: found by searching, and staged.
 *
 * The library starts empty by design (worship lyrics are licensed to the local
 * church), so every test here creates what it needs — always from neutral
 * placeholder text, never from real lyrics, per CONTRIBUTING.
 */

import { test, expect } from '../fixtures/app';
import { seedSongs } from '../fixtures/seed';
import { files, expected } from '../fixtures/files';

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Songs');
});

test('an empty library explains how to fill it', async ({ app }) => {
  await expect(app.console.locator('.empty-title')).toHaveText(/song library is empty/i);
});

test('pasted song text is split into labelled stanzas', async ({ app }) => {
  await app.console.getByRole('button', { name: 'Paste' }).first().click();
  // Placeholder text, never real lyrics — see CONTRIBUTING.
  await app.console.getByPlaceholder(/Title/).fill(
    'Zeta Song\n\nVerse 1\nZeta verse line one\nZeta verse line two\n\nChorus\nZeta chorus line one',
  );
  await app.console.getByRole('button', { name: 'Add song' }).click();

  const row = app.console.locator('.list-row', { hasText: 'Zeta Song' });
  await expect(row).toBeVisible();
  // Section count is shown in the row's subtitle, and proves the split worked.
  await expect(row.locator('.list-sub')).toContainText('2 sections');
});

test('a ChordPro file imports with its metadata and chords', async ({ app }) => {
  await app.stubOpenDialog([files.chordpro]);
  await app.console.getByRole('button', { name: /Import/ }).first().click();

  const row = app.console.locator('.list-row', { hasText: expected.chordpro.title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.list-sub')).toContainText(expected.chordpro.author);
  await expect(row.locator('.list-sub')).toContainText(`${expected.chordpro.sectionCount} sections`);
});

test('an OpenLyrics file imports', async ({ app }) => {
  await app.stubOpenDialog([files.openLyrics]);
  await app.console.getByRole('button', { name: /Import/ }).first().click();

  await expect(
    app.console.locator('.list-row', { hasText: expected.openLyrics.title }),
  ).toBeVisible({ timeout: 15_000 });
});

test('a plain-text song imports with its sections detected', async ({ app }) => {
  await app.stubOpenDialog([files.plainText]);
  await app.console.getByRole('button', { name: /Import/ }).first().click();

  const row = app.console.locator('.list-row', { hasText: expected.plainText.title });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('.list-sub')).toContainText(`${expected.plainText.sectionCount} sections`);
});

test('cancelling the import dialog changes nothing', async ({ app }) => {
  await app.stubCancelledDialog();
  await app.console.getByRole('button', { name: /Import/ }).first().click();

  await expect(app.console.locator('.empty-title')).toHaveText(/song library is empty/i);
});

test('search narrows the library by title and by lyric', async ({ app }) => {
  await seedSongs(app, ['Great Is Thy Faithfulness', 'Blessed Assurance', 'It Is Well']);
  await app.console.reload();
  await app.gotoPanel('Songs');

  await expect(app.console.locator('.list-row')).toHaveCount(3);

  await app.console.getByPlaceholder(/Search titles/).fill('assurance');
  await expect(app.console.locator('.list-row')).toHaveCount(1);
  await expect(app.console.locator('.list-row')).toContainText('Blessed Assurance');

  // Lyrics are indexed too, not just titles.
  await app.console.getByPlaceholder(/Search titles/).fill('It Is Well chorus line');
  await expect(app.console.locator('.list-row').first()).toContainText('It Is Well');
});

test('a search with no matches says so', async ({ app }) => {
  await seedSongs(app, ['Blessed Assurance']);
  await app.console.reload();
  await app.gotoPanel('Songs');

  await app.console.getByPlaceholder(/Search titles/).fill('zzzznothing');
  await expect(app.console.locator('.empty-title')).toHaveText('No matches');
});

test('a song stages into preview and then takes live', async ({ app }) => {
  await seedSongs(app, ['Blessed Assurance']);
  await app.console.reload();
  await app.gotoPanel('Songs');

  await app.console.locator('.list-row', { hasText: 'Blessed Assurance' }).click();

  // The detail pane's Preview stages without touching the audience screen.
  await app.console.locator('.panel-pad').getByRole('button', { name: 'Preview' }).click();
  await expect.poll(async () => (await app.live()).preview.title).toContain('Blessed Assurance');
  expect((await app.live()).program.slides).toHaveLength(0);

  await app.console.locator('.panel-pad').getByRole('button', { name: 'Take' }).click();
  await expect.poll(async () => (await app.live()).program.title).toContain('Blessed Assurance');
});

test('a song is removed from the library', async ({ app }) => {
  await seedSongs(app, ['Temporary Song']);
  await app.console.reload();
  await app.gotoPanel('Songs');

  const row = app.console.locator('.list-row', { hasText: 'Temporary Song' });
  await expect(row).toBeVisible();

  // Removal is destructive, so the app confirms first.
  await app.stubMessageBox(1);
  await row.getByTitle('Remove from library').click();

  await expect(app.console.locator('.list-row', { hasText: 'Temporary Song' })).toHaveCount(0);
});

test('transposition offers a new performance key', async ({ app }) => {
  await seedSongs(app, ['Key Test Song']);
  await app.console.reload();
  await app.gotoPanel('Songs');

  await app.console.locator('.list-row', { hasText: 'Key Test Song' }).click();

  const keySelect = app.console.getByTitle('Transpose for performance');
  await expect(keySelect).toBeVisible();
  await keySelect.selectOption('A');
  await expect(keySelect).toHaveValue('A');
});
