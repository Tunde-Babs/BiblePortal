# End-to-end suite

Drives the real Electron app — console, audience output and stage monitor — the
way an operator does, and asserts on what the audience would actually see.

```bash
npm run e2e            # build, then the functional suite
npm run e2e:headed     # same, with windows visible, one at a time
npm run e2e:ui         # Playwright's interactive runner
npm run e2e:speech     # the @slow Whisper suite (downloads a model)
npm run e2e:all        # both projects
npm run e2e:report     # build and open the Allure report locally
```

`npm run e2e` builds first on purpose: the suite drives `dist/`, not the dev
server, and testing a stale bundle wastes a whole cycle. Global setup warns if
`dist/` is older than `src/`.

---

## How a test gets its own app

Every test launches its own Electron instance with a private
`--user-data-dir`. That one switch buys three things:

- **a private library**, so tests cannot see each other's songs or leave state
  behind;
- **a private single-instance lock** — `main.cjs` calls
  `requestSingleInstanceLock()` and that lock lives in the user-data directory —
  so tests run in parallel, and run happily while the real app is open;
- **a private index cache**, copied warm from a template.

Global setup builds that template once: it seeds the three core translations
into a profile and boots the app against it so the BM25 index is built and
cached. Each test then copies ~12 MB of already-indexed data instead of tripping
first-run seeding (all 44 translations, 167 MB) and a cold index build.

Saved schedules go to `BP_DOCUMENTS_DIR`, pointed inside the test's own profile,
so nothing a run does can write into your real `~/Documents`.

## Writing a test

```ts
import { test, expect } from '../fixtures/app';
import { seedSongs } from '../fixtures/seed';

test('a song stages into preview', async ({ app }) => {
  await seedSongs(app, ['Blessed Assurance']);   // arrange, over the bridge
  await app.gotoPanel('Songs');
  await app.console.locator('.list-row').first().click();   // act, through the UI
  await app.console.getByRole('button', { name: 'Preview' }).click();

  expect((await app.live()).preview.title).toContain('Blessed Assurance');
});
```

The rule the suite follows: **seed the preconditions, drive the behaviour under
test through the interface.** A test that seeds three songs and then *clicks* to
stage one is testing the UI; a test that stages over the bridge is testing
nothing.

### What the `app` fixture gives you

| | |
|---|---|
| `app.console` | the operator console page |
| `app.bp(fn)` | run a function in the page — reach the bridge as `window.bp` |
| `app.live()` | live state straight from the main process |
| `app.gotoPanel(label)` | click a rail button and wait for the panel |
| `app.openDisplay(kind)` | open the `output` or `stage` window, returns its page |
| `app.stubOpenDialog(paths)` | answer the next native open dialog |
| `app.stubSaveDialog(path)` | answer the next native save dialog |
| `app.stubMessageBox(index)` | answer the next message box by button index |
| `app.stubCancelledDialog()` | cancel the next open dialog |
| `app.userDataDir` / `documentsDir` / `outputPort` | this test's private resources |

Native dialogs are replaced in the **main process**, leaving the rest of each
import flow — validation, copying, parsing, library writes — completely real.

### Things that will catch you out

- **`window.bp` is reached inside the page**, never passed in. Playwright
  serialises the callback, so a live object cannot cross the boundary, and
  rebuilding one there would need `new Function`, which the app's CSP blocks.
- **A new sermon is not empty.** `sermons.create` seeds a five-point starter
  outline. `seedSermon` passes `points` directly for that reason.
- **A plan row's centre is a notes field** that stops propagation. Click the
  item's `.list-title`, not the row.
- **Program and preview carry different labels** — "Advance →"/"← Back" versus
  "Next →"/"← Prev" — deliberately, so an operator cannot confuse the control
  that changes the audience screen with the one that does not.
- **A scripture plan item needs a parsed `ref`** to build a real deck; without
  one it silently falls back to a plain text slide.
- **Teardown quits explicitly.** `electronApp.close()` waits for an exit that
  never comes on macOS, and `before-quit` opens a modal when output is live — so
  the fixture turns off `confirmOnQuit` at boot and force-kills if a quit hangs.
- **Never pass `--reporter` on the command line.** It *replaces* the config's
  reporter list rather than adding to it, so `--reporter=list` silently turns
  Allure off and the run produces no `allure-results` at all. The `list`
  reporter is already on by default; if you want only it for one run, use
  `--reporter=list,allure-playwright`.

## Layout

```
e2e/
  global-setup.ts        build check, user-data template, fixture files
  fixtures/
    app.ts               the per-test Electron fixture
    launch.ts            launch args and env, and a safe shutdown
    paths.ts             where everything lives
    seed.ts              arranging library state over the bridge
    files.ts             generated songs, decks, images and speech audio
    bridge.d.ts          `window.bp` as seen from inside a page
  specs/
    01-boot              shell, bridge, every panel opens
    02-bible             references, search, fuzzy correction, staging
    03-live              preview/program, take, blackout, output + stage windows
    04-songs             editor, paste, ChordPro/OpenLyrics/text import, search
    05-detect            spoken references, quoted scripture, confidence, cueing
    06-plan              cue list and the .bpsx round-trip
    07-notes             sermon outlines and live point highlighting
    08-presentations     .pptx import, slide text and speaker notes
    09-media-theme       backgrounds, and theme edits writing through live
    10-study-displays    topical, Strong's, outlines, screens, the OBS server
    11-settings          translations, licensing rules, API-key handling
    12-speech            @slow — real Whisper through a fake capture device
```

Input files are **generated**, not committed: a deck or song file checked in
drifts away from the parser it is meant to exercise and nobody notices. See
`fixtures/files.ts`, which also states what each file contains so specs assert
against something explicit.

## The speech suite

`12-speech.spec.ts` is tagged `@slow` and runs as its own Playwright project, so
a model download can never redden the functional signal. Audio is fed through
Chromium's fake capture device from a WAV generated by macOS `say` at 16 kHz —
the rate the app resamples to. On a platform without `say`, global setup says so
and those specs skip rather than fail.

Everything downstream of the microphone is covered *deterministically* in
`05-detect.spec.ts` through the Detect panel's "Test a phrase" field, which feeds
the same engine a Whisper transcript reaches — in milliseconds, with no model.

### Known gap

One test — *spoken audio is transcribed and cues the verse* — is marked
`test.fixme()`. Chromium's fake capture device refuses the WAV with
`simple_sources.cc(38) Failed to read <path> ... Try disabling the sandbox with
--no-sandbox`. Four hypotheses were tested and all rejected: the audio-service
sandbox flag, running the audio service in-process, Apple's non-standard
`JUNK`/`FLLR` WAV padding (the generator now strips it anyway), and the
TCC-protected `~/Documents` location (fixtures now live in the system temp
directory anyway). `--no-sandbox` is not an acceptable fix: it would disable the
renderer sandbox for the whole suite to satisfy one test.

Model download, load, backend selection and honest status reporting are all
still covered by the other tests in that file, and the entire
transcript → reference → cue chain by `05-detect`. What is unproven is only that
captured audio physically reaches Whisper.

**Next thing to try:** drive the microphone from the page rather than the fake
device — an init script overriding `navigator.mediaDevices.getUserMedia` to
return a stream synthesised from the WAV via `AudioBufferSourceNode` →
`MediaStreamAudioDestinationNode`. That keeps capture, endpointing and decode
real and never touches the audio helper's file access. It is also worth simply
running the suite on a GitHub macOS runner, where sandbox and TCC behaviour
differ from a developer's machine.

## CI

`.github/workflows/e2e.yml` runs at **06:00 UTC daily** and on demand, on a
macOS runner. Every run publishes an **Allure report to GitHub Pages** and links
it from the run summary along with the pass/fail counts. Trends carry across
runs by pulling the previous report's `history/` off the live site.

The report is published even when the suite fails — that is precisely when it is
worth reading — and the workflow then fails afterwards to reflect the real
result.

**One-time setup:** in *Settings ▸ Pages*, set **Source** to **GitHub Actions**.
Without it the deploy step fails and no link is produced.
