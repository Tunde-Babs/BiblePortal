# BiblePortal Studio

A church presentation console — scripture, songs, service plans and live output
across multiple screens — that runs **completely offline**, with speech
recognition on your own machine.

Built for the room where the wi-fi drops out five minutes before the service
starts.

![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black)
![Licence](https://img.shields.io/badge/licence-GPL--3.0-blue)
![Tests](https://img.shields.io/badge/checks-293%20passing-brightgreen)
![Offline](https://img.shields.io/badge/offline-no%20account%2C%20no%20telemetry-informational)

---

## What it does

| | |
|---|---|
| **Bible** | 31,102 verses across 44 public-domain translations in 18 languages. One search field takes a reference (`jn 3:16`), a phrase, or a misspelling (`revalations 21:4` → Revelation 21:4) and works out which you meant, with book-name autocomplete as you type. |
| **Songs** | Write songs as labelled stanzas — verse, chorus, bridge — with per-song typeface, size, alignment and colour that override the theme, and a live preview of the real slide. Or import ChordPro, OnSong, OpenLyrics XML and plain text, with automatic section detection and chord transposition. Group into collections. |
| **Service plans** | A drag-and-drop cue list saved as portable `.bpsx` files — New / Open / Save, a recent list, and reusable templates. Songs embed into the file, so a plan opened on another machine still has its set. |
| **Sermon notes** | Write the outline beforehand, then follow the preacher live. The congregation sees the point being made with the rest of the message dimmed around it — or one point large, for a big room. |
| **Presentations** | Import `.pptx` announcement decks. Text, bullets, pictures and speaker notes come across and render through your service theme. |
| **Live output** | Preview/program split with a hard **take** step. Audience display, stage confidence monitor, blackout, clear and logo. |
| **Backgrounds** | Assign a still or motion loop per content type — one behind scripture, another behind lyrics. |
| **Theme designer** | Typography, colour, reference styling. Every control writes through live; there is no "apply" step to forget. |
| **Word study** | Strong's Hebrew and Greek — 14,298 public-domain entries — plus topical search and passage outlines. |
| **Live detection** | Whisper running locally transcribes the room and cues the verse the speaker named or quoted. |
| **Migration** | Bring an existing EasyWorship library across — songs, media and running orders. |

---

## Offline by design

There is no account, no cloud sync and no telemetry. The only time BiblePortal
touches the network is when you explicitly install a translation or download a
speech model; after that it never does again.

Text search, topical expansion and reference matching run on a compact inverted
index — no model, no warm-up, no network, ever:

```
Cold search index build   ~700 ms   (31,102 verses)
Warm index load from disk  ~66 ms
Full-text search          ~7–9 ms
Reference lookup            ~4 ms
Speech cue latency        ~0.9 s    (endpoint + decode, WebGPU)
```

**A note on why speech is built this way.** Chromium's `SpeechRecognition` API
cannot work in Electron at all — it calls a Google service using API keys only
official Chrome builds carry, so it fails with `not-allowed` no matter what
permissions are granted. Local Whisper is the only route that actually
transcribes, and it has the better privacy property anyway: audio never leaves
the building.

---

## Content licensing

This is the one area with legal weight, and the design is deliberate.

### Scripture

**Included** — 44 translations, all public domain: KJV, AKJV, ASV, WEB, YLT,
BBE, Webster's, Douay-Rheims, Tyndale, Wycliffe, Weymouth, KJV-with-Strong's;
Greek (Textus Receptus, Westcott & Hort, Tischendorf, LXX) and the Latin
Vulgate; plus Spanish, French, German, Portuguese, Italian, Dutch, Chinese,
Korean, Russian, Arabic, Swahili, Tagalog, Vietnamese, Afrikaans and Romanian.

**Not included** — NIV, NLT, NKJV, ESV, NASB, AMP, MSG, CSB and NRSV. These are
under active copyright held by their publishers. **No application may legally
bundle or download them.**

**If your church licenses one**, there are two routes.

**Online, via API.Bible.** Enter your own key under
**Settings ▸ Translations ▸ Licensed translations**, choose which appear in the
picker, and they sit alongside the bundled ones. The key is stored in your user
profile — never in this repository — and the translation abbreviation is shown
with every passage, as publishers require. Passages are cached so a service is
not at the mercy of the church wi-fi.

**Offline, from a module you own** — via
**Settings ▸ Translations ▸ Import a module you own**:

| Format | Extensions | Notes |
|---|---|---|
| MyBible / MySword | `.SQLite3`, `.bbl.mybible` | How most commercial modules ship |
| e-Sword | `.bblx`, `.bbli` | |
| Zefania | `.xml` | |
| OSIS | `.xml`, `.osis` | Milestone and container forms |
| USFX | `.xml`, `.usfx` | |
| JSON / CSV | `.json`, `.csv`, `.tsv` | Several layouts auto-detected |

Everything is read on your machine. Nothing is uploaded and nothing is
redistributed, so the licence stays between your church and the publisher.

### Songs and media

The song library starts **empty**, and no backgrounds are bundled. Worship
lyrics are licensed to the local church, usually through CCLI, so BiblePortal
imports what you already own rather than shipping anyone else's catalogue.

For backgrounds, Pexels, Pixabay and Unsplash are licence-clear for stills;
MotionWorship and CreationSwap have free worship motion loops.

---

## Getting started

```bash
npm install          # deps, ONNX runtime, and the core translations
npm start            # build and launch
```

`npm start` rebuilds, clears any stale instance, then launches. Use
`npm run stop` if a process is left behind.

Optional:

```bash
npm run data:all     # all 44 translations (~170 MB) instead of the core three
npm run icons        # regenerate the app icon from assets/icon.svg
```

### Building a release

```bash
npm run dist:mac     # DMG + ZIP for Apple Silicon
```

The installer bundles the core English set (KJV, WEB, ASV) plus the Strong's
lexicon; the other 41 translations install from within the app. Set
`BP_BUNDLE=all` to ship everything, or `BP_BUNDLE=kjv,rvr,lsg` for a specific
list.

Builds are unsigned unless you supply a certificate, so macOS Gatekeeper will
ask for a right-click → Open on first launch.

---

## Verifying your install

```bash
npm test             # typecheck + 293 unit checks + production build
npm run smoke        # boots the app and drives the live pipeline
npm run smoke:asr    # speech model load, local ONNX, real audio decode
npm run bench:asr    # measures cue latency
```

`npm run verify` validates parsers and services against the actual bundled
scripture — including that every chapter and verse count in the KJV matches the
canon exactly, and that no verse is empty.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Take preview to the audience screen |
| `Esc` | Blackout |
| `↑` `↓` | Previous / next slide on **program** |
| `←` `→` | Previous / next slide in **preview** |
| `⌘S` / `⇧⌘S` | Save schedule / Save As |
| `⌘O` | Open a schedule |
| `⌘1`–`⌘0` | Switch panel |
| `⌘,` | Settings |
| `⌘⌥B` | Blackout — works even when the console isn't focused |

---

## Architecture

```
electron/
  main.cjs              app lifecycle, windows, all IPC
  preload.cjs           the only renderer↔Node bridge (context isolation on)
  live-state.cjs        preview/program state, the single source of truth
  windows.cjs           console + audience + stage window management
  lib/                  pure logic, fully unit-tested
    canon.cjs             66 books, chapter/verse counts, alias table
    reference.cjs         reference parsing, formatting, autocomplete
    search.cjs            BM25 inverted index, phrase scoring, fuzzy matching
    chords.cjs            transposition with correct enharmonic spelling
    song-format.cjs       ChordPro / OpenLyrics / plain-text import
    spoken.cjs            spoken-language scripture detection
    module-import.cjs     Zefania / OSIS / USFX / JSON / CSV modules
    sqlite-module.cjs     MyBible / MySword / e-Sword modules
    easyworship.cjs       .ewsx schedules, schema-discovering
    pptx.cjs              PowerPoint text and image extraction
    rtf.cjs               RTF decoding for EasyWorship song text
    zip-stream.cjs        random-access streaming zip reads
    catalog.cjs           installable translations + licensing rules
  services/             stateful services over that logic
    bible.cjs             translations, LRU caching, search index
    songs.cjs             library, import, slide building
    plan.cjs              service plans (cue list)
    schedule-file.cjs     .bpsx files, templates, recent list
    sermon.cjs            sermon outlines and live highlighting
    presentations.cjs     imported .pptx decks
    easyworship-import.cjs  migrating an EasyWorship library
    translations.cjs      installing and importing translations
    media.cjs             backgrounds and motion loops
    collections.cjs       song grouping
    settings.cjs          settings and themes
    store.cjs             atomic JSON document store
    ai.cjs                detection, topical search, outlines
src/
  shared/               types, typed API, slide rendering (all three windows)
  renderer/             operator console
    panels/               Bible, Songs, Service, Theme, Media, Slides,
                          Notes, Detect, Screens, Study, Settings
    components/           SongEditor, PreviewProgram, StatusBar, ErrorBoundary
    workers/asr.worker    Whisper transcription, off the main thread
    lib/mic.ts            capture, resampling, voice-activity endpointing
  output/               audience display
  stage/                stage confidence monitor
scripts/                data fetch, verification, smoke tests, packaging
```

**Preview parity.** The console preview, the audience output and the stage
display all render through one `SlideSurface`. What the operator sees is what
the room gets — a live console lives or dies on that guarantee.

**Security.** Context isolation on, node integration off, a strict CSP in every
window, and renderer-supplied filesystem paths validated before use. The
renderer reaches Node only through an explicit allow-list of IPC channels.

**Durability.** Library writes are atomic (temp file, `fsync`, rename), so a
crash or power loss mid-save cannot leave a half-written library on disk. A
corrupt file is quarantined rather than discarded.

**Memory.** Translations and search indexes are held in an LRU with the default
translation pinned, so opening a dozen languages does not grow without bound.
Large archives stream from disk rather than being buffered.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The content-licensing rules there are
not stylistic — please read them before adding data of any kind.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).

Scripture texts are public domain. Strong's Concordance (1890) is public domain.
