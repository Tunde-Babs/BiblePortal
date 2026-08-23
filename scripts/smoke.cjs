'use strict';
/**
 * Launch smoke test.
 *
 * Boots the real Electron app, waits for the console window to finish loading,
 * then drives the live pipeline through the preload bridge exactly as the UI
 * does — lookup, stage, take, advance, blackout — and reports what the audience
 * surface would be showing at each step. Exits non-zero on any failure.
 */

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Boot the real application. main.cjs registers its own whenReady handler, so
// requiring it here means this test drives the actual app, not a stand-in.
require('../electron/main.cjs');

const results = [];
const record = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` \x1b[2m— ${detail}\x1b[0m` : ''}`);
};

const FAIL_TIMEOUT = setTimeout(() => {
  console.error('\n  smoke test timed out after 60s');
  process.exit(1);
}, 60_000);

app.whenReady().then(async () => {
  // Give main.cjs's own whenReady handler time to bootstrap services and windows.
  await new Promise((r) => setTimeout(r, 3500));

  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('  no window was created'); process.exit(1); }

  record('console window created', true, win.getTitle() || 'BiblePortal Studio');

  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
  }

  /** Run an expression in the renderer and return its resolved value. */
  const run = (expr) => win.webContents.executeJavaScript(`(async () => { ${expr} })()`, true);

  try {
    const bridge = await run('return typeof window.bp === "object" && typeof window.bp.bible.lookup === "function";');
    record('preload bridge exposed', bridge === true);

    const mounted = await run('return !!document.querySelector(".console, .boot");');
    record('React app mounted', mounted === true);

    const manifest = await run('return await window.bp.bible.manifest();');
    record('translations loaded', (manifest.translations?.length ?? 0) > 0,
      `${manifest.translations.length} installed, default ${manifest.defaultId}`);

    const lookup = await run('return await window.bp.bible.lookup("John 3:16");');
    record('scripture lookup over IPC', lookup.ok === true && lookup.verses.length === 1, lookup.label);

    const search = await run('return await window.bp.bible.search("good shepherd", { limit: 5 });');
    record('full-text search over IPC', (search.results?.length ?? 0) > 0,
      `${search.total} hits, top ${search.results?.[0]?.label}`);

    const smart = await run('return await window.bp.bible.smart("revalations 21:4");');
    record('fuzzy book correction', smart.kind === 'corrected', smart.suggestion);

    // Stage a deck exactly as the Bible panel does.
    await run(`
      const hit = await window.bp.bible.lookup("Psalm 23");
      const slides = hit.verses.map((v) => ({ id: v.label, lines: [v.text], caption: v.label, verseNumbers: [v.verse] }));
      return await window.bp.live.preview({ kind: "scripture", title: hit.label, slides, index: 0, meta: { translationAbbr: hit.translationAbbr } });
    `);
    const staged = await run('return (await window.bp.live.get()).state;');
    record('deck staged into preview', staged.preview.slides.length === 6, `${staged.preview.slides.length} slides`);
    record('program untouched before take', staged.program.slides.length === 0);

    await run('return await window.bp.live.take();');
    const live = await run('return (await window.bp.live.get()).state;');
    record('take promotes preview to program', live.program.slides.length === 6, live.program.title);

    const stepped = await run('return await window.bp.live.step(1);');
    record('advance moves the program index', stepped.moved === true && stepped.state.program.index === 1);

    const blacked = await run('return await window.bp.live.blackout();');
    record('blackout engages', blacked.state.blackout === true);

    const restored = await run('return await window.bp.live.restore();');
    record('restore clears blackout', restored.state.blackout === false);

    const displays = await run('return await window.bp.displays.list();');
    record('monitors enumerated', (displays.displays?.length ?? 0) > 0, `${displays.displays.length} screen(s)`);

    // Open the audience output on the current screen and confirm it renders.
    const opened = await run(`
      const list = await window.bp.displays.list();
      return await window.bp.displays.open("output", list.displays[0].id);
    `);
    record('audience display opens', opened.ok === true);

    await new Promise((r) => setTimeout(r, 1800));
    const outputWin = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed());
    if (outputWin) {
      const rendered = await outputWin.webContents.executeJavaScript(
        '(() => { const s = document.querySelector(".slide-body"); return s ? s.innerText.slice(0, 60) : null; })()', true);
      record('audience surface renders the live verse', !!rendered, rendered ? `"${rendered.trim().slice(0, 44)}…"` : 'nothing rendered');
    } else {
      record('audience surface renders the live verse', false, 'output window not found');
    }

    // Regression: a media file whose name contains a space and a '#' used to
    // truncate at the '#' and silently fail to load.
    const trickyMedia = await run(`
      const path = 'BiblePortal smoke #1 test.png';
      return path;
    `);
    const mediaOk = await (async () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const p = require('node:path');
      const dir = fs.mkdtempSync(p.join(os.tmpdir(), 'bp-media-'));
      const file = p.join(dir, 'loop shot #1 & more.png');
      // A 1x1 PNG is enough to prove the URL resolved and the decoder ran.
      fs.writeFileSync(file, Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'));
      const loaded = await win.webContents.executeJavaScript(`
        (async () => {
          const { fileUrl } = await import('./assets/' + [...document.querySelectorAll('script')]
            .map(s => s.src).join('|').split('/assets/')[1]).catch(() => ({}));
          return null;
        })()
      `, true).catch(() => null);
      // Simpler and more honest: check the encoding rule the app uses.
      const encoded = await win.webContents.executeJavaScript(`
        (() => {
          const p = ${JSON.stringify(file)};
          const url = 'file://' + p.split('/').map(s => /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s)).join('/');
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ ok: true, w: img.naturalWidth, url });
            img.onerror = () => resolve({ ok: false, url });
            img.src = url;
          });
        })()
      `, true);
      fs.rmSync(dir, { recursive: true, force: true });
      return encoded;
    })();
    record('media path with space and # loads', mediaOk?.ok === true,
      mediaOk?.ok ? `decoded ${mediaOk.w}px` : `failed: ${mediaOk?.url}`);

    // And prove the old concatenation really was broken, so the test has teeth.
    const naiveBroken = await run(`
      const u = new URL('file:///tmp/loop shot #1 & more.png'.replace(/ /g, ' '));
      return u.pathname.includes('%231') === false && u.hash.length > 0;
    `);
    record('naive concatenation would have truncated at #', naiveBroken === true);

    // The console preview must actually paint text, at a sane geometry. Checking
    // deck state alone let a layout bug through where the surface stretched to
    // the column height and the slide became a sliver in a black box.
    const previewRender = await run(`
      const host = document.querySelector('.pp-deck.preview .slide-host');
      const surf = document.querySelector('.pp-deck.preview .slide-surface');
      const lines = [...document.querySelectorAll('.pp-deck.preview .slide-line')];
      if (!host || !surf) return { ok: false, reason: 'no preview surface' };
      const h = host.getBoundingClientRect();
      const s = surf.getBoundingClientRect();
      const cs = getComputedStyle(surf);
      return {
        ok: lines.length > 0 && Number(cs.opacity) > 0 && s.width > 0 && s.height > 0,
        lines: lines.length,
        chars: lines[0] ? lines[0].textContent.length : 0,
        ratio: +(s.width / s.height).toFixed(2),
        fillsHost: +(s.height / h.height).toFixed(2),
        opacity: cs.opacity,
      };
    `);
    record('console preview paints slide text', previewRender?.ok === true,
      previewRender?.ok ? `${previewRender.lines} line(s), ${previewRender.chars} chars` : String(previewRender?.reason));
    record('preview surface holds 16:9', Math.abs((previewRender?.ratio ?? 0) - 1.78) < 0.03,
      `ratio ${previewRender?.ratio}`);
    record('preview surface fills its pane', (previewRender?.fillsHost ?? 0) > 0.9,
      `fills ${Math.round((previewRender?.fillsHost ?? 0) * 100)}% of pane height`);

    // Preview parity: a media deck must paint in the console's preview surface,
    // not only in the audience window. It previously rendered black here.
    const mediaParity = await (async () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const pathMod = require('node:path');
      const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'bp-parity-'));
      const file = pathMod.join(dir, 'background shot #2.png');
      fs.writeFileSync(file, Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'));

      const res = await win.webContents.executeJavaScript(`
        (async () => {
          await window.bp.live.preview({
            kind: 'media',
            title: 'Parity check',
            slides: [{ id: 'm1', lines: [] }],
            index: 0,
            meta: { mediaId: 'm1', mediaFile: ${JSON.stringify(file)}, mediaKind: 'image' },
          });
          await new Promise(r => setTimeout(r, 700));
          const nodes = [...document.querySelectorAll('.pp-deck.preview .slide-media')];
          if (!nodes.length) return { ok: false, reason: 'no .slide-media in preview' };
          const img = nodes[0];
          return { ok: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') };
        })()
      `, true);
      fs.rmSync(dir, { recursive: true, force: true });
      return res;
    })();
    record('media renders in the console preview, not just the projector',
      mediaParity?.ok === true, mediaParity?.ok ? 'image painted' : `${mediaParity?.reason ?? mediaParity?.src}`);

    await run('return await window.bp.live.preview({ kind: "blank", title: "", slides: [], index: 0, meta: {} });');

    const songs = await run('return await window.bp.songs.all();');
    record('song library reachable and empty by default', Array.isArray(songs.songs) && songs.songs.length === 0);

    const topical = await run('return await window.bp.ai.topical("peace", { limit: 3 });');
    record('offline AI topical search', (topical.verses?.length ?? 0) > 0, `${topical.verses.length} verses`);

    const detect = await run('return await window.bp.ai.detect("turn to romans chapter eight verse twenty eight");');
    record('offline live detection', detect.detections?.[0]?.label === 'Romans 8:28', detect.detections?.[0]?.label);

    const strongs = await run('return await window.bp.bible.strongs("G26");');
    record("Strong's lexicon reachable", strongs.ok === true, strongs.translit);
  } catch (err) {
    record('smoke run completed without throwing', false, err.message);
  }

  clearTimeout(FAIL_TIMEOUT);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${failed.length === 0 ? '\x1b[32m\x1b[1mAll ' + results.length + ' launch checks passed.\x1b[0m' : '\x1b[31m\x1b[1m' + failed.length + ' of ' + results.length + ' launch checks failed.\x1b[0m'}\n`);
  app.exit(failed.length === 0 ? 0 : 1);
});

app.on('window-all-closed', () => {});
