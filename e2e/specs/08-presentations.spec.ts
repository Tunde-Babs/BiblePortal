/**
 * Imported PowerPoint decks.
 *
 * Announcement decks arrive as .pptx and are re-rendered through the service
 * theme rather than shown as images, so the text has to come across intact —
 * including speaker notes, which the operator reads but the room does not see.
 */

import { test, expect } from '../fixtures/app';
import { files, expected } from '../fixtures/files';

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Slides');
});

test('a .pptx imports with every slide', async ({ app }) => {
  await app.stubOpenDialog([files.deck]);
  await app.console.locator('.panel-host').getByRole('button', { name: /Import|Add/ }).first().click();

  await expect.poll(async () => {
    const decks = await app.bp(() => window.bp.presentations.all());
    return decks.decks.length;
  }, { timeout: 20_000 }).toBe(1);

  const decks = await app.bp(() => window.bp.presentations.all());
  expect(decks.decks[0].slides).toHaveLength(expected.deck.slideCount);
});

test('inspecting a deck reports what it holds before importing', async ({ app }) => {
  // `inspect` is the pre-import summary the picker shows: counts and a sample,
  // not the slides themselves.
  const inspected = await app.bp(
    async (file) => window.bp.presentations.inspect(file),
    files.deck,
  );

  expect(inspected.slideCount).toBe(expected.deck.slideCount);
  expect(inspected.withNotes).toBe(1);
  expect(inspected.sample[0].title).toContain(expected.deck.titles[0]);
});

test('slide text and speaker notes survive the import', async ({ app }) => {
  const deck = await app.bp(async (file) => {
    await window.bp.presentations.import([file]);
    const all = await window.bp.presentations.all();
    return (await window.bp.presentations.get(all.decks[0].id)).deck;
  }, files.deck);

  expect(deck.slides).toHaveLength(expected.deck.slideCount);
  expect(deck.slides.map((s: any) => s.title)).toEqual(expected.deck.titles);

  const first = deck.slides[0];
  // Notes belong to the operator, so they must come across but never become a
  // line the congregation would see.
  expect(first.notes).toContain(expected.deck.noteOnFirstSlide);
  expect(first.lines.join(' ')).not.toContain(expected.deck.noteOnFirstSlide);
});

test('an imported deck stages to preview', async ({ app }) => {
  await app.bp(async (file) => window.bp.presentations.import([file]), files.deck);
  await app.console.reload();
  await app.gotoPanel('Slides');

  // Clicking a deck row opens it; its own Preview button is what stages it.
  await app.console.locator('.list-row').first()
    .getByRole('button', { name: 'Preview' }).click();

  await expect
    .poll(async () => (await app.live()).preview.slides.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect((await app.live()).program.slides).toHaveLength(0);
});

test('a deck is renamed and removed', async ({ app }) => {
  const deckId = await app.bp(async (file) => {
    const res = await window.bp.presentations.import([file]);
    const all = await window.bp.presentations.all();
    return all.decks[0].id;
  }, files.deck);

  const renamed = await app.bp(
    async (id) => window.bp.presentations.rename(id, 'Week 12 Notices'),
    deckId,
  );
  expect(renamed.deck.name).toBe('Week 12 Notices');

  await app.bp(async (id) => window.bp.presentations.remove(id), deckId);
  const after = await app.bp(() => window.bp.presentations.all());
  expect(after.decks).toHaveLength(0);
});

test('a file that is not a deck is refused with a clear reason', async ({ app }) => {
  const result = await app.bp(
    async (file) => window.bp.presentations.inspect(file).catch((e: Error) => ({ error: e.message })),
    files.background,
  );

  expect(result.error ?? result.message ?? '').toMatch(/slide|pptx|powerpoint/i);
});
