/**
 * The live transport and the output surfaces.
 *
 * This is the part that is unforgiving in a real service: the audience screen
 * must show exactly what the operator took, and nothing must reach it that they
 * did not. The preview/program separation and the hard take step are the whole
 * safety model, so they are tested through the actual controls.
 */

import { test, expect } from '../fixtures/app';
import { stageScripture } from '../fixtures/seed';

test('take promotes preview to program and leaves preview intact', async ({ app }) => {
  await stageScripture(app, 'Psalm 23');

  const before = await app.live();
  expect(before.program.slides).toHaveLength(0);

  await app.console.locator('.pp-take-btn').click();

  const after = await app.live();
  expect(after.program.title).toContain('Psalm 23');
  expect(after.program.slides).toHaveLength(6);
  expect(after.preview.slides, 'preview keeps its deck after a take').toHaveLength(6);
});

test('Space takes the preview live', async ({ app }) => {
  await stageScripture(app, 'John 3:16-18');

  // Focus the shell rather than an input, so the accelerator is not swallowed.
  await app.console.locator('.console').click({ position: { x: 5, y: 5 } });
  await app.console.keyboard.press('Space');

  await expect.poll(async () => (await app.live()).program.slides.length).toBe(3);
});

test('the program advances and steps back independently of preview', async ({ app }) => {
  await stageScripture(app, 'Psalm 23');
  await app.console.locator('.pp-take-btn').click();

  // The two decks carry deliberately different labels so an operator cannot
  // confuse the control that changes the audience screen with the one that does
  // not: the program advances and goes Back, the preview steps Next and Prev.
  const programDeck = app.console.locator('.pp-deck.program');
  await programDeck.getByRole('button', { name: /Advance/ }).click();
  await expect.poll(async () => (await app.live()).program.index).toBe(1);

  await programDeck.getByRole('button', { name: /Back/ }).click();
  await expect.poll(async () => (await app.live()).program.index).toBe(0);

  // Stepping the program must never move what is staged for the next cue.
  expect((await app.live()).preview.index).toBe(0);
});

test('stepping the preview never touches the audience screen', async ({ app }) => {
  await stageScripture(app, 'Psalm 23');
  await app.console.locator('.pp-take-btn').click();

  const previewDeck = app.console.locator('.pp-deck.preview');
  await previewDeck.getByRole('button', { name: /Next/ }).click();

  await expect.poll(async () => (await app.live()).preview.index).toBe(1);
  expect(
    (await app.live()).program.index,
    'moving through the preview must not move what the room is seeing',
  ).toBe(0);
});

test('blackout hides output and restore brings it back', async ({ app }) => {
  await stageScripture(app, 'John 3:16');
  await app.console.locator('.pp-take-btn').click();

  await app.bp(() => window.bp.live.blackout());
  expect((await app.live()).blackout).toBe(true);

  await app.bp(() => window.bp.live.restore());
  expect((await app.live()).blackout).toBe(false);
});

test('the audience window renders exactly what was taken', async ({ app }) => {
  await stageScripture(app, 'John 3:16');
  await app.console.locator('.pp-take-btn').click();

  const audience = await app.openDisplay('output');
  const body = audience.locator('.slide-body');

  await expect(body).toBeVisible({ timeout: 15_000 });
  await expect(body).toContainText('For God so loved the world');
});

test('the audience window goes dark on blackout', async ({ app }) => {
  await stageScripture(app, 'John 3:16');
  await app.console.locator('.pp-take-btn').click();

  const audience = await app.openDisplay('output');
  await expect(audience.locator('.slide-body')).toContainText('For God so loved');

  await app.bp(() => window.bp.live.blackout());

  // Whatever the mechanism — a class, an overlay — the verse must stop showing.
  await expect(audience.locator('.slide-body')).toBeHidden({ timeout: 10_000 });
});

test('the stage monitor shows the live content', async ({ app }) => {
  await stageScripture(app, 'Psalm 23');
  await app.console.locator('.pp-take-btn').click();

  const stage = await app.openDisplay('stage');
  await expect(stage.locator('body')).toContainText(/shepherd/i, { timeout: 15_000 });
});

test('preview and program stay independent while staging a second passage', async ({ app }) => {
  await stageScripture(app, 'John 3:16');
  await app.console.locator('.pp-take-btn').click();

  // Stage something else. The audience must keep showing the first passage.
  await stageScripture(app, 'Psalm 23');

  const state = await app.live();
  expect(state.program.title).toContain('John 3:16');
  expect(state.preview.title).toContain('Psalm 23');
});

test('clear takes the audience off content without dropping the deck', async ({ app }) => {
  await stageScripture(app, 'Psalm 23');
  await app.console.locator('.pp-take-btn').click();

  await app.bp(() => window.bp.live.clear());

  const state = await app.live();
  expect(state.cleared).toBe(true);
  expect(state.program.slides, 'the deck survives a clear so it can be restored').toHaveLength(6);
});
