/**
 * Service plans and the .bpsx file format.
 *
 * The cue list is what an operator actually runs the service from, and the file
 * is how it travels between the machine it was built on and the one in the
 * booth. The round-trip matters most: songs are embedded in the file precisely
 * so a plan opened elsewhere still has its set.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { test, expect } from '../fixtures/app';
import { seedSongs } from '../fixtures/seed';

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Service');
});

test('an empty state offers to create a plan', async ({ app }) => {
  await expect(app.console.locator('.empty-title')).toHaveText(/No service plans yet/i);
});

test('a new plan is created and named', async ({ app }) => {
  await app.console.locator('.panel-host').getByRole('button', { name: /New/ }).first().click();

  await expect(app.console.getByLabel('Open plan')).toBeVisible();
  const plans = await app.bp(() => window.bp.plans.all());
  expect(plans.plans).toHaveLength(1);
});

test('scripture, songs and headings are added as cue items', async ({ app }) => {
  await seedSongs(app, ['Blessed Assurance']);
  await app.console.locator('.panel-host').getByRole('button', { name: /New/ }).first().click();

  // Scripture, typed as a reference.
  await app.console.getByRole('button', { name: '+ Scripture' }).click();
  await app.console.getByPlaceholder(/Reference/).fill('Romans 8:28-30');
  await app.console.getByPlaceholder(/Reference/).press('Enter');

  // A heading, to divide the running order.
  await app.console.getByRole('button', { name: '+ Heading' }).click();
  await app.console.locator('.panel-host input:visible').last().fill('Worship');
  await app.console.locator('.panel-host input:visible').last().press('Enter');

  await expect.poll(async () => {
    const plans = await app.bp(() => window.bp.plans.all());
    return plans.plans[0].items.length;
  }).toBe(2);

  const plans = await app.bp(() => window.bp.plans.all());
  const kinds = plans.plans[0].items.map((i: any) => i.kind);
  expect(kinds).toContain('scripture');
});

test('a plan saves to a .bpsx file and opens again with its items', async ({ app }) => {
  await seedSongs(app, ['Great Is Thy Faithfulness']);

  // Build a plan through the API, then exercise the file round-trip itself.
  const planId = await app.bp(async () => {
    const created = await window.bp.plans.create({ name: 'Sunday Morning' });
    const songs = await window.bp.songs.all();
    await window.bp.plans.addItem(created.plan.id, { kind: 'header', title: 'Welcome' });
    await window.bp.plans.addItem(created.plan.id, {
      kind: 'song', title: 'Great Is Thy Faithfulness', songId: songs.songs[0].id,
    });
    await window.bp.plans.addItem(created.plan.id, { kind: 'scripture', title: 'Romans 8:28' });
    return created.plan.id;
  });

  const target = path.join(app.documentsDir, 'sunday-morning.bpsx');
  const saved = await app.bp(
    async ({ id, file }) => window.bp.schedule.save(id, file),
    { id: planId, file: target },
  );
  expect(saved.ok).toBe(true);

  // The file must be self-contained: a plan opened on another machine needs its
  // songs, not just a reference to a library that machine may not have.
  const raw = await readFile(target, 'utf8');
  expect(raw).toContain('Great Is Thy Faithfulness');

  const reopened = await app.bp(async (file) => window.bp.schedule.openPath(file), target);
  expect(reopened.ok).toBe(true);
  expect(reopened.plan.items).toHaveLength(3);
  expect(reopened.plan.items.map((i: any) => i.kind)).toEqual(['header', 'song', 'scripture']);
});

test('a plan item stages to preview from the cue list', async ({ app }) => {
  // Added through the panel rather than seeded: a scripture cue only builds a
  // deck when it carries a parsed `ref`, which the "+ Scripture" flow attaches
  // by looking the reference up. An item hand-made without one falls back to a
  // plain text slide, which would make this test pass for the wrong reason.
  await app.console.locator('.panel-host').getByRole('button', { name: /New/ }).first().click();
  await app.console.getByRole('button', { name: '+ Scripture' }).click();
  await app.console.getByPlaceholder(/Reference/).fill('Psalm 23');
  await app.console.getByPlaceholder(/Reference/).press('Enter');

  const row = app.console.locator('.plan-row').first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Click the item's title, not the row's centre. A note field sits in the
  // middle of every row and stops propagation so that clicking it starts
  // editing rather than firing the cue — which is right for an operator, and
  // means a centre click here would silently do nothing.
  await row.locator('.list-title').click();

  await expect
    .poll(async () => (await app.live()).preview.title, { timeout: 15_000 })
    .toContain('Psalm 23');

  // A cue click stages only; the audience screen waits for a take.
  expect((await app.live()).program.slides).toHaveLength(0);

  await row.getByRole('button', { name: 'Take' }).click();
  await expect
    .poll(async () => (await app.live()).program.title, { timeout: 15_000 })
    .toContain('Psalm 23');
});

test('a saved plan is offered in the recent list', async ({ app }) => {
  const planId = await app.bp(async () => {
    const created = await window.bp.plans.create({ name: 'Recent Test' });
    return created.plan.id;
  });

  const target = path.join(app.documentsDir, 'recent-test.bpsx');
  await app.bp(async ({ id, file }) => window.bp.schedule.save(id, file), { id: planId, file: target });

  const recent = await app.bp(() => window.bp.schedule.recent());
  expect(recent.files.some((r: any) => r.path === target)).toBe(true);
});

test('a plan is saved as a reusable template', async ({ app }) => {
  const planId = await app.bp(async () => {
    const created = await window.bp.plans.create({ name: 'Weekly Order' });
    await window.bp.plans.addItem(created.plan.id, { kind: 'header', title: 'Welcome' });
    return created.plan.id;
  });

  // Saving a template goes through a native save dialog, and templates are
  // only listed from the Templates folder — saving elsewhere writes a perfectly
  // good file that the "New from template" picker will never show.
  await app.stubSaveDialog(
    path.join(app.documentsDir, 'BiblePortal', 'Templates', 'weekly-order.bpsx'),
  );
  const saved = await app.bp(async (id) => window.bp.schedule.saveTemplate(id), planId);
  expect(saved.ok).toBe(true);

  const templates = await app.bp(() => window.bp.schedule.templates());
  expect(templates.templates.length).toBeGreaterThan(0);
});
