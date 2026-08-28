/**
 * The Bible panel.
 *
 * One search field has to take a reference, a phrase or a misspelling and work
 * out which was meant. These tests drive that field the way an operator does —
 * typing — and assert on what reaches the screen.
 */

import { test, expect } from '../fixtures/app';

/** The panel's single search input. */
const searchField = (app: { console: any }) =>
  app.console.getByPlaceholder(/John 3:16/i);

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Bible');
});

test('a reference lookup renders the passage', async ({ app }) => {
  await searchField(app).fill('John 3:16');
  await searchField(app).press('Enter');

  const reader = app.console.locator('.reader');
  await expect(reader).toBeVisible();
  await expect(reader.locator('.reader-verse')).toHaveCount(1);
  await expect(reader).toContainText('For God so loved the world');
});

test('an abbreviated reference resolves to the full book', async ({ app }) => {
  await searchField(app).fill('ps 23');
  await searchField(app).press('Enter');

  // Psalm 23 has six verses; the whole chapter should come back.
  await expect(app.console.locator('.reader .reader-verse')).toHaveCount(6);
  // Case-insensitive: the bundled text renders "The Lord", not the small-caps
  // "LORD" many printed editions use for the divine name.
  await expect(app.console.locator('.reader')).toContainText(/the lord is my shepherd/i);
});

test('a verse range returns exactly the verses asked for', async ({ app }) => {
  await searchField(app).fill('John 3:16-18');
  await searchField(app).press('Enter');

  await expect(app.console.locator('.reader .reader-verse')).toHaveCount(3);
});

test('a phrase search ranks matching verses', async ({ app }) => {
  await searchField(app).fill('good shepherd');
  await searchField(app).press('Enter');

  const results = app.console.locator('.result-list .result');
  await expect(results.first()).toBeVisible();
  expect(await results.count()).toBeGreaterThan(0);
  await expect(results.first()).toContainText(/shepherd/i);
});

test('a misspelled book is corrected rather than rejected', async ({ app }) => {
  await searchField(app).fill('revalations 21:4');

  // The panel offers the correction as a chip before anything is committed.
  await expect(app.console.locator('.chip.warn')).toContainText(/Revelation 21:4/i);
});

test('a verse that does not exist is refused with a usable reason', async ({ app }) => {
  // Jeremiah 11 has 23 verses. Asking for 29 must not quietly return verse 23:
  // showing different scripture than was requested, labelled as correct, is the
  // worst failure this panel can have.
  const explained = await app.bp(() => window.bp.bible.lookup('Jeremiah 11:29'));

  expect(explained.ok).toBe(false);
  expect(explained.error).toMatch(/23 verses/i);
});

test('book-name autocomplete appears while typing', async ({ app }) => {
  await searchField(app).fill('phil');

  // One assertion, deliberately, on the option itself.
  //
  // The list is transient: it unmounts on blur after a 120 ms timer, and again
  // whenever a later suggestion fetch comes back empty. Waiting for the list and
  // *then* asserting on its text leaves a window in which it can disappear
  // between the two — which is exactly how this test flaked.
  await expect(
    app.console
      .locator('.suggest [role="option"]', { hasText: /Philippians|Philemon/ })
      .first(),
  ).toBeVisible();
});

test('Enter stages the passage into preview without touching the program', async ({ app }) => {
  await searchField(app).fill('Psalm 23');
  await searchField(app).press('Enter');

  await app.console.getByRole('button', { name: /^Preview$/ }).click();

  const state = await app.live();
  expect(state.preview.title).toContain('Psalm 23');
  expect(state.preview.slides.length).toBeGreaterThan(0);
  expect(state.program.slides, 'the program must not change until a take').toHaveLength(0);
});

test('switching translation re-renders the same passage', async ({ app }) => {
  await searchField(app).fill('John 3:16');
  await searchField(app).press('Enter');
  const kjv = await app.console.locator('.reader').innerText();

  await app.console.getByLabel('Translation').selectOption('web');

  await expect(app.console.locator('.reader')).not.toHaveText(kjv, { timeout: 10_000 });
  await expect(app.console.locator('.reader')).toContainText(/God so loved the world/i);
});
