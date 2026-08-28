/**
 * Sermon notes.
 *
 * The outline is written beforehand and followed live, with the congregation
 * seeing the current point and the rest of the message dimmed around it. The
 * thing worth guarding is that taking a point puts *that* point on the screen.
 */

import { test, expect } from '../fixtures/app';
import { seedSermon } from '../fixtures/seed';

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Notes');
});

test('an empty state offers to start an outline', async ({ app }) => {
  await expect(app.console.locator('.empty-title')).toHaveText(/No sermon notes yet/i);
});

test('a sermon is created and opens its outline', async ({ app }) => {
  await app.console.locator('.panel-host').getByRole('button', { name: /New/ }).first().click();

  const sermons = await app.bp(() => window.bp.sermons.all());
  expect(sermons.sermons).toHaveLength(1);
});

test('points are added and listed in order', async ({ app }) => {
  await seedSermon(app, 'The Good Shepherd', [
    'He knows his sheep by name',
    'He lays down his life',
    'He gathers one flock',
  ]);
  await app.console.reload();
  await app.gotoPanel('Notes');

  await app.console.locator('.list-row').first().click();

  const body = app.console.locator('.panel-host');
  await expect(body).toContainText('He knows his sheep by name');
  await expect(body).toContainText('He lays down his life');
  await expect(body).toContainText('He gathers one flock');
});

test('taking a point puts that point on the audience screen', async ({ app }) => {
  await seedSermon(app, 'The Good Shepherd', [
    'He knows his sheep by name',
    'He lays down his life',
  ]);
  await app.console.reload();
  await app.gotoPanel('Notes');
  await app.console.locator('.list-row').first().click();

  // Take the *second* point, so a passing test cannot be explained by the
  // outline simply starting at the top.
  await app.console.getByRole('button', { name: 'Take', exact: true }).nth(1).click();

  await expect.poll(async () => {
    const state = await app.live();
    return state.program.slides[state.program.index]?.lines.join(' ') ?? '';
  }, { timeout: 15_000 }).toContain('He lays down his life');
});

test('the whole outline previews from the start', async ({ app }) => {
  await seedSermon(app, 'Three Points', ['First point', 'Second point', 'Third point']);
  await app.console.reload();
  await app.gotoPanel('Notes');
  await app.console.locator('.list-row').first().click();

  await app.console.getByRole('button', { name: 'Preview' }).first().click();

  await expect.poll(async () => (await app.live()).preview.slides.length).toBeGreaterThan(0);
  expect((await app.live()).program.slides).toHaveLength(0);
});

test('a sermon is deleted', async ({ app }) => {
  await seedSermon(app, 'Disposable Outline', ['Only point']);
  await app.console.reload();
  await app.gotoPanel('Notes');

  await expect(app.console.locator('.list-row')).toHaveCount(1);

  await app.stubMessageBox(1);
  await app.console.locator('.list-row').first().getByRole('button').last().click();

  await expect.poll(async () => {
    const sermons = await app.bp(() => window.bp.sermons.all());
    return sermons.sermons.length;
  }).toBe(0);
});
