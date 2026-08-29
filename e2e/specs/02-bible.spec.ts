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

test('book-name autocomplete offers completions for a partial name', async ({ app }) => {
  // Asserted through the bridge, not the dropdown.
  //
  // The completion list is real, but it is on screen for under 100 ms: it
  // appears as soon as the query changes and unmounts again the moment the
  // debounced search resolves "phil" to Philippians 1. Playwright cannot sample
  // a window that short — the earlier version of this test passed locally by
  // winning a coin flip and failed all three attempts on the slower CI runner,
  // and driving Tab completion instead succeeded only 3 times in 6.
  //
  // So this covers the data path an operator depends on — canon aliases through
  // reference.suggest, over real IPC — and deliberately does not assert on the
  // transient rendering. Making that testable would mean changing how long the
  // panel keeps the list open, which is a product decision, not a test one.
  const suggestions = await app.bp(() => window.bp.bible.suggest('phil', { limit: 8 }));

  const books = suggestions.suggestions.map((s: any) => s.book);
  expect(books).toContain('Philippians');
  expect(books).toContain('Philemon');

  // The completion is what Tab inserts, and the hint is what disambiguates two
  // books sharing a prefix.
  const philippians = suggestions.suggestions.find((s: any) => s.book === 'Philippians');
  expect(philippians.completion).toBe('Philippians');
  expect(philippians.hint).toMatch(/4 chapters/);
});

test('a partial book name still resolves when submitted', async ({ app }) => {
  // The operator-facing half of the same feature, and stable: typing a prefix
  // and pressing Enter must land on the book, whether or not the completion
  // list was ever seen.
  await searchField(app).fill('phil');
  await searchField(app).press('Enter');

  // Assert on the passage itself rather than the reference chip: two elements
  // carry the class the chip sits in, and the text on screen is what matters.
  await expect(app.console.locator('.reader')).toBeVisible();
  await expect(app.console.locator('.reader')).toContainText('Paul and Timotheus');
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
