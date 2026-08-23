#!/usr/bin/env node
/**
 * Copies the ONNX Runtime WASM binaries into public/ort/.
 *
 * transformers.js defaults to fetching these from a CDN at runtime. That would
 * make speech recognition require the network on every launch, which defeats
 * the point. Serving them from the app bundle keeps transcription offline.
 */

import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const DEST = path.join(ROOT, 'public', 'ort');

await mkdir(DEST, { recursive: true });

const files = await readdir(SRC);
// The JSEP build carries WebGPU support; keep the plain SIMD build as fallback.
const wanted = files.filter((f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f));

let bytes = 0;
for (const file of wanted) {
  await copyFile(path.join(SRC, file), path.join(DEST, file));
  bytes += (await stat(path.join(SRC, file))).size;
}

console.log(`[ort] ${wanted.length} runtime file(s), ${(bytes / 1048576).toFixed(1)} MB → public/ort/`);
for (const f of wanted) console.log(`      ${f}`);
