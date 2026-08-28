# Working on BiblePortal

## Setup

```bash
npm install          # deps, ONNX runtime, and the core translations
npm run data         # core English translations (KJV, WEB, ASV) + Strong's
npm run data:all     # optional: all 44 public-domain translations (~170 MB)
npm start            # build and launch
```

`npm start` rebuilds, stops any stale instance, then launches. Use `npm run stop`
if a process is left behind.

## Before you push

```bash
npm test             # typecheck + 331 unit checks + production build
npm run smoke        # boots the app and drives the live pipeline
npm run smoke:asr    # speech model load, local ONNX, detection
npm run e2e          # end-to-end suite: drives the real app through its UI
```

`npm test` must be green. The smoke tests and `npm run e2e` need a display.

`npm run e2e` builds first and then drives the built app — console, audience
output and stage monitor — asserting on what the audience would actually see.
It runs every morning in CI and publishes an Allure report; see
[e2e/README.md](e2e/README.md) for how to write a test and what will catch you
out. The `@slow` Whisper suite is separate: `npm run e2e:speech`.

## Content licensing — read before adding data

This is the one rule with legal weight, and it is deliberate:

- **Scripture** — only public-domain translations ship. NIV, NLT, NKJV, ESV,
  NASB, AMP and MSG are under active copyright and must never be bundled or
  downloaded by the app. Users install those from a module they license, via
  Settings ▸ Translations ▸ Import.
- **Songs** — the library ships empty. Worship lyrics are licensed to the local
  church, usually through CCLI. Never commit lyrics, including as test fixtures.
  Fixtures use neutral placeholder text ("Alpha line", "Beta line").
- **Media** — no backgrounds or loops are bundled. Users add their own.

`scripts/verify.mjs` asserts every catalogue entry is public domain. Keep it that way.

- **API keys** — the API.Bible connector reads a key from the user's settings.
  It must never be committed, logged, put in an error message, or used in a
  cache filename. `redact()` in `services/online-bible.cjs` exists for this;
  there is a test asserting the key cannot leak into a cache path.

## Layout

```
electron/          main process — services, IPC, windows
  lib/             pure, unit-tested logic (canon, parsing, search, importers)
  services/        stateful services over that logic
src/
  shared/          types, typed API, slide rendering used by all three windows
  renderer/        operator console
  output/          audience display
  stage/           stage confidence monitor
scripts/           data fetch, verification, smoke tests, packaging
e2e/               end-to-end suite (Playwright + TypeScript)
  fixtures/        per-test app instance, seeding, generated input files
  specs/           one file per functional area
```

## Conventions worth knowing

- **Per-song styles are sparse.** A song stores only the fields it overrides;
  anything undefined falls through to the active theme. Never write a full
  style object with defaults filled in — that silently detaches the song from
  the theme.
- **Empty documents are factories, not constants.** `const empty = () => ({...})`,
  never `const EMPTY = {...}`. A shared empty object gets mutated by whoever
  reads it and then leaks into every later reader.
- **Large archives stream.** Reading a whole `.ewsx` or `.pptx` into a Buffer
  caps out at Node's 4 GB limit and fails as an out-of-memory crash. Use
  `lib/zip-stream.cjs`, which reads through a file descriptor.
- **Status is derived, never assigned.** Anything with several moving parts
  (the speech pipeline especially) computes its status from real sub-state.
  Assigning a status lets the UI claim something the engine is not doing.

## Testing notes

- Prefer asserting on **rendered output**, not internal state. Several bugs in
  this codebase passed state assertions while the screen was blank.
- Electron scripts must set `app.setName('BiblePortal Studio')` before requiring
  `main.cjs`, or they run against a different, empty user-data profile. This is
  easy to miss: the script appears to work while reading no real data.
- `scripts/stop.sh` before launching anything. A stale instance holds the
  single-instance lock and the new one exits silently with code 0, which looks
  identical to a crash.
- `ELECTRON_RUN_AS_NODE` in the environment makes `electron` run as plain Node
  and the app silently never starts. The npm scripts clear it, and so does the
  end-to-end launcher — where the symptom is Playwright reporting only
  "Process failed to launch!".
- End-to-end tests get isolation from `--user-data-dir`. That also gives each
  one its own single-instance lock, which is why the suite can run in parallel
  and while the real app is open. Saved schedules go to `BP_DOCUMENTS_DIR` so a
  test run cannot write into your real `~/Documents`.
- **Seed preconditions over the bridge, drive the behaviour under test through
  the UI.** A test that seeds a song and then clicks to stage it is testing the
  UI; one that stages over the bridge is testing nothing.
