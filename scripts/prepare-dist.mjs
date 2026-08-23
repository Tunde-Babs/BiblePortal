#!/usr/bin/env node
/**
 * Stages the translations that ship inside the installer.
 *
 * Bundling all 44 would add ~170 MB to every download for content most churches
 * never open. The core English set covers the common case offline from first
 * launch, and Settings ▸ Translations installs any of the rest on demand.
 *
 *   BP_BUNDLE=core   KJV, WEB, ASV        (default)
 *   BP_BUNDLE=all    everything installed locally
 *   BP_BUNDLE=kjv,rvr,lsg   an explicit list
 */

import { mkdir, rm, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'resources', 'data');
const OUT = path.join(ROOT, 'resources', 'data-dist');

const CORE = ['kjv', 'web', 'asv'];
const spec = (process.env.BP_BUNDLE ?? 'core').trim();
const wanted = spec === 'all' ? null : (spec === 'core' ? CORE : spec.split(',').map((s) => s.trim()));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8'));
const shipped = [];
let bytes = 0;

for (const t of manifest.translations) {
  if (wanted && !wanted.includes(t.id)) continue;
  const file = t.file ?? `${t.id}.json`;
  const from = path.join(SRC, file);
  try {
    await copyFile(from, path.join(OUT, file));
    bytes += (await stat(from)).size;
    shipped.push(t);
  } catch {
    console.warn(`[dist] ${t.id} missing from resources/data — skipped`);
  }
}

if (!shipped.length) {
  console.error('[dist] nothing to bundle. Run `npm run data` first.');
  process.exit(1);
}

// The shipped manifest must describe only what is actually in the package.
await writeFile(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ ...manifest, translations: shipped, bundled: spec }, null, 2),
  'utf8',
);

const total = (await readdir(OUT)).length;
console.log(`[dist] bundling ${shipped.length} translation(s), ${(bytes / 1048576).toFixed(1)} MB (${total} files)`);
console.log(`[dist] ${shipped.map((t) => t.abbr).join(', ')}`);
console.log('[dist] the remaining translations install from Settings ▸ Translations');
