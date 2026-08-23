#!/usr/bin/env node
/**
 * Backfills language metadata onto translation files written by an earlier
 * build of the data script, then rebuilds the manifest. Safe to re-run.
 */

import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { byId } = require('../electron/lib/catalog.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'resources', 'data');

const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
const translations = [];
let repaired = 0;

for (const file of files) {
  const full = path.join(DATA_DIR, file);
  const doc = JSON.parse(await readFile(full, 'utf8'));
  const entry = byId(doc.id);

  // `language` must be the human-readable name; `lang` is the ISO code.
  const needsFix = entry && (doc.language !== entry.language || doc.lang !== entry.lang || doc.scope !== entry.scope);
  if (needsFix) {
    doc.lang = entry.lang;
    doc.language = entry.language;
    doc.scope = entry.scope;
    doc.note = entry.note ?? null;
    await writeFile(full, JSON.stringify(doc), 'utf8');
    repaired++;
    console.log(`  repaired ${doc.abbr}: language "${entry.language}", scope ${entry.scope}`);
  }

  translations.push({
    id: doc.id, name: doc.name, abbr: doc.abbr, year: doc.year ?? null,
    lang: doc.lang ?? 'en', language: doc.language ?? 'English',
    license: doc.license, scope: doc.scope ?? 'full', note: doc.note ?? null,
    verseCount: doc.verseCount, bookCount: doc.bookCount ?? Object.keys(doc.books).length,
    imported: doc.imported ?? false, file,
  });
}

translations.sort((a, b) => (a.lang === 'en' ? 0 : 1) - (b.lang === 'en' ? 0 : 1) || a.name.localeCompare(b.name));

const manifest = JSON.parse(await readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
manifest.translations = translations;
manifest.builtAt = new Date().toISOString();
await writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n  ${repaired} file(s) repaired · ${translations.length} translations in manifest`);
