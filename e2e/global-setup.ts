/**
 * One-time preparation for the end-to-end suite.
 *
 * Two jobs, both about making the per-test cost small:
 *
 *   1. Confirm `dist/` is a real build. The suite drives the packaged renderer,
 *      not the dev server, so a stale or missing build must fail loudly here
 *      rather than as a hundred confusing selector timeouts.
 *
 *   2. Build a user-data *template* — a seeded profile with the core English
 *      translations and a warm search index — which every test then copies.
 *      Without it, each test would trip main.cjs's first-run seeding and copy
 *      all 44 translations (167 MB), then rebuild the BM25 index from cold.
 *      With it, a test starts from ~12 MB of already-indexed data.
 */

import { _electron as electron } from '@playwright/test';
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT, TEMPLATE_DIR, E2E_TMP } from './fixtures/paths';
import { launchArgs, launchEnv, documentsFor, shutdown } from './fixtures/launch';
import { buildFixtureFiles } from './fixtures/files';

/** Translations the suite needs. Everything else is dead weight in a test. */
const SEED_TRANSLATIONS = ['kjv.json', 'web.json', 'asv.json', 'manifest.json'];

async function exists(target: string) {
  try { await stat(target); return true; } catch { return false; }
}

export default async function globalSetup() {
  const dist = path.join(REPO_ROOT, 'dist');
  const consoleHtml = path.join(dist, 'index.html');

  if (!(await exists(consoleHtml))) {
    throw new Error(
      `No renderer build found at ${consoleHtml}.\n` +
      'The end-to-end suite drives the built app, not the dev server.\n' +
      'Run `npm run build` first, or use `npm run e2e` which builds for you.',
    );
  }

  // A build older than the newest source file is almost always the real cause
  // of a baffling failure, so say so rather than testing yesterday's bundle.
  const builtAt = (await stat(consoleHtml)).mtimeMs;
  const newestSource = await newestMtime(path.join(REPO_ROOT, 'src'));
  if (newestSource > builtAt) {
    console.warn(
      '\n  ⚠  dist/ is older than src/ — you are testing a stale bundle.' +
      '\n     Run `npm run build` (or `npm run e2e`) to rebuild.\n',
    );
  }

  await rm(E2E_TMP, { recursive: true, force: true });
  await mkdir(E2E_TMP, { recursive: true });

  const { audio } = await buildFixtureFiles();
  console.log(
    `  · fixture files written${audio ? '' : ' (no `say` on this platform — speech specs will skip)'}`,
  );

  console.log('  · building user-data template (seed translations + warm index)…');
  const started = Date.now();

  // Seed the translations directory directly. main.cjs only copies its bundled
  // seed when the folder holds no .json at all, so pre-filling it both skips
  // the 167 MB copy and pins the suite to a known set of translations.
  const translations = path.join(TEMPLATE_DIR, 'translations');
  await mkdir(translations, { recursive: true });

  const source = path.join(REPO_ROOT, 'resources', 'data-dist');
  const fallback = path.join(REPO_ROOT, 'resources', 'data');
  const from = (await exists(source)) ? source : fallback;

  for (const file of SEED_TRANSLATIONS) {
    const src = path.join(from, file);
    if (await exists(src)) await cp(src, path.join(translations, file));
  }

  const seeded = await readdir(translations);
  if (!seeded.includes('kjv.json')) {
    throw new Error(
      `Could not seed KJV from ${from}.\n` +
      'Run `npm run data` to fetch the core translations before testing.',
    );
  }

  // Boot the app once against the template so the BM25 index is built and
  // cached to disk. Every test that copies this template then loads it warm.
  const app = await electron.launch({
    args: launchArgs(TEMPLATE_DIR),
    cwd: REPO_ROOT,
    env: launchEnv({ BP_DOCUMENTS_DIR: documentsFor(TEMPLATE_DIR) }),
    timeout: 60_000,
  });

  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');

  // Force the index to build now rather than on a test's first search.
  await win.waitForFunction(() => typeof window.bp?.bible?.search === 'function', null, { timeout: 30_000 });
  const primed = await win.evaluate(async () => {
    const manifest = await window.bp.bible.manifest();
    // A real search is what actually forces the index to build and cache.
    const hits = await window.bp.bible.search('good shepherd', { limit: 3 });
    return { translations: manifest.translations?.length ?? 0, hits: hits.total ?? 0 };
  });

  await shutdown(app);

  console.log(
    `  · template ready in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `(${primed.translations} translations, index warm — ${primed.hits} hits on a probe search)\n`,
  );
}

/** Newest mtime anywhere under `dir`, for the stale-build warning. */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else newest = Math.max(newest, (await stat(full)).mtimeMs);
    }
  };
  await walk(dir);
  return newest;
}
