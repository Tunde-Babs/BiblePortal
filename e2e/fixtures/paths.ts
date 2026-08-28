/** Shared filesystem locations for the end-to-end suite. */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Scratch space for the run. Kept outside the repo so a crashed run cannot
 * leave multi-megabyte profiles in the working tree, and outside `~/Documents`
 * so nothing a test writes can touch the operator's own files.
 */
export const E2E_TMP = path.join(os.tmpdir(), 'bibleportal-e2e');

/** The seeded, index-warm profile that every test copies. Built in global setup. */
export const TEMPLATE_DIR = path.join(E2E_TMP, 'template');

/**
 * Generated input files (songs, decks, images, audio) shared by all tests.
 *
 * Deliberately outside the repository. Beyond keeping generated files out of the
 * working tree, this matters for the speech suite: the repo sits under
 * `~/Documents`, which macOS protects with TCC, and Chromium's sandboxed audio
 * helper cannot read the fake-capture WAV from there. It reports that as
 * "Failed to read ... Try disabling the sandbox with --no-sandbox", which reads
 * like a sandbox flag problem and is really a file-location one.
 */
export const FIXTURE_DIR = path.join(E2E_TMP, 'files');
