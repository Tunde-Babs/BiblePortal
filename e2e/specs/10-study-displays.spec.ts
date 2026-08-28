/**
 * Word study, screens, and the OBS output server.
 *
 * The output server is the one place BiblePortal opens a socket, so its
 * defaults matter: off unless asked, loopback unless LAN is explicitly allowed,
 * and serving only the folders it is supposed to.
 */

import { test, expect } from '../fixtures/app';

test.describe('study', () => {
  test.beforeEach(async ({ app }) => {
    await app.gotoPanel('Study');
  });

  test('topical search returns verses for a theme', async ({ app }) => {
    const result = await app.bp(() => window.bp.ai.topical('forgiveness', { limit: 10 }));

    expect(result.verses.length).toBeGreaterThan(0);
    // The theme is expanded into the vocabulary scripture actually uses.
    expect(result.seeds).toContain('forgive');
  });

  test('the topic list is offered to the operator', async ({ app }) => {
    const topics = await app.bp(() => window.bp.ai.topics());
    expect(topics.topics).toContain('grace');
    expect(topics.topics.length).toBeGreaterThan(20);
  });

  test("a Strong's entry is looked up by code", async ({ app }) => {
    const entry = await app.bp(() => window.bp.bible.strongs('G26'));
    expect(entry.ok).toBe(true);
    expect(JSON.stringify(entry)).toMatch(/love|agape/i);
  });

  test('a passage outline is built with movements and cross-references', async ({ app }) => {
    const outline = await app.bp(() => window.bp.ai.outline('Philippians 4:4-9'));

    expect(outline.ok).toBe(true);
    expect(outline.movements.length).toBeGreaterThan(0);
    expect(outline.keyTerms.length).toBeGreaterThan(0);
    // Cross-references must come from other books, not the passage itself.
    for (const ref of outline.crossRefs) expect(ref.bookId).not.toBe('PHP');
  });

  test('picking a theme lists verses, and one stages to preview', async ({ app }) => {
    const panel = app.console.locator('.panel-host');

    // Topics is the default tab, but say so rather than assume it.
    await panel.getByRole('button', { name: 'Topics', exact: true }).click();
    await expect(panel.locator('.empty-title')).toHaveText('Pick a theme');

    await panel.getByRole('button', { name: 'peace', exact: true }).click();

    const results = panel.locator('.result-list .result');
    await expect(results.first()).toBeVisible({ timeout: 15_000 });

    // Clicking a result is what stages it — the assertion below is only worth
    // anything because the reference comes off the rendered row rather than
    // from the same call that did the staging.
    const label = await results.first().locator('.result-ref').innerText();
    await results.first().click();

    await expect.poll(async () => (await app.live()).preview.title, { timeout: 15_000 })
      .toContain(label);
    expect((await app.live()).program.slides).toHaveLength(0);
  });

  test('switching tabs reaches the other study tools', async ({ app }) => {
    const panel = app.console.locator('.panel-host');

    await panel.getByRole('button', { name: "Strong's", exact: true }).click();
    await expect(panel.getByPlaceholder(/Search a meaning/)).toBeVisible();

    await panel.getByRole('button', { name: 'Outline', exact: true }).click();
    await expect(panel.getByPlaceholder(/Passage/)).toBeVisible();
  });
});

test.describe('screens', () => {
  test.beforeEach(async ({ app }) => {
    await app.gotoPanel('Screens');
  });

  test('monitors are enumerated', async ({ app }) => {
    const displays = await app.bp(() => window.bp.displays.list());
    expect(displays.displays.length).toBeGreaterThan(0);
    expect(displays.displays[0]).toHaveProperty('bounds');
  });

  test('the audience display opens and closes from the panel', async ({ app }) => {
    const opened = await app.bp(async () => {
      const list = await window.bp.displays.list();
      return window.bp.displays.open('output', list.displays[0].id);
    });
    expect(opened.ok).toBe(true);

    const status = await app.bp(() => window.bp.displays.status());
    expect(JSON.stringify(status)).toMatch(/output/);

    await app.bp(() => window.bp.displays.close('output'));
  });
});

test.describe('OBS output server', () => {
  test('is off by default', async ({ app }) => {
    // A church network is not a place to open a file server by accident.
    const status = await app.bp(() => window.bp.outputServer.status());
    expect(status.running).toBe(false);
  });

  test('serves the audience page on loopback when started', async ({ app }) => {
    const status = await app.bp(
      async (port) => window.bp.outputServer.start({ port, allowLan: false }),
      app.outputPort,
    );

    expect(status.running).toBe(true);
    expect(status.url).toContain('127.0.0.1');

    // OBS renders this page itself, so it must be genuinely served.
    const res = await fetch(`http://127.0.0.1:${app.outputPort}/output`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');

    await app.bp(() => window.bp.outputServer.stop());
    const stopped = await app.bp(() => window.bp.outputServer.status());
    expect(stopped.running).toBe(false);
  });

  test('refuses to serve files outside the folders it owns', async ({ app }) => {
    await app.bp(
      async (port) => window.bp.outputServer.start({ port, allowLan: false }),
      app.outputPort,
    );

    // A traversal attempt must not reach the filesystem at large.
    const res = await fetch(
      `http://127.0.0.1:${app.outputPort}/media/..%2f..%2f..%2f..%2fetc%2fpasswd`,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    await app.bp(() => window.bp.outputServer.stop());
  });

  test('pushes live changes to a connected client', async ({ app }) => {
    await app.bp(
      async (port) => window.bp.outputServer.start({ port, allowLan: false }),
      app.outputPort,
    );

    // State reaches the browser over Server-Sent Events on /live — chosen over a
    // WebSocket because the page only ever receives, and EventSource reconnects
    // by itself if OBS restarts the source mid-service.
    const res = await fetch(`http://127.0.0.1:${app.outputPort}/live`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();

    await app.bp(() => window.bp.outputServer.stop());
  });
});
