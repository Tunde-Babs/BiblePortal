/**
 * Live scripture detection — the deterministic half.
 *
 * The Detect panel's "Test a phrase" field feeds text straight into the same
 * detection engine a Whisper transcript reaches, so everything downstream of
 * the microphone can be tested exactly and in milliseconds: spoken numbers,
 * ordinals, misheard book names, quoted scripture, confidence and cueing.
 *
 * The microphone and Whisper themselves are covered separately, tagged @slow,
 * so a model download can never redden this signal.
 */

import { test, expect } from '../fixtures/app';

/**
 * Everything is scoped to the panel body. The rail on the left also carries a
 * button called "Detect", and the panel has five `.field-hint` paragraphs, so
 * unscoped locators here match more than one element.
 */
const panel = (app: { console: any }) => app.console.locator('.panel-host');

const phraseField = (app: { console: any }) =>
  app.console.getByPlaceholder(/turn with me to romans/i);

async function detect(app: any, phrase: string) {
  await phraseField(app).fill(phrase);
  await panel(app).getByRole('button', { name: 'Detect', exact: true }).click();
}

/** The detection cards, newest first. */
const detections = (app: { console: any }) =>
  app.console.locator('.settings-group .stack .card');

/** The "nothing detected yet" line, which lives inside the detections group. */
const emptyNote = (app: { console: any }) =>
  app.console.locator('.settings-group > .field-hint');

test.beforeEach(async ({ app }) => {
  await app.gotoPanel('Detect');
});

test('the panel starts idle rather than pretending to listen', async ({ app }) => {
  await expect(app.console.locator('.switch-label').first()).toHaveText('Not running');
  await expect(emptyNote(app)).toContainText(/Nothing detected yet/);
});

test('a spoken reference with number words is detected', async ({ app }) => {
  await detect(app, 'turn with me to john chapter three verse sixteen');

  const first = detections(app).first();
  await expect(first).toBeVisible();
  await expect(first.locator('.result-ref')).toHaveText('John 3:16');
  await expect(first).toContainText('For God so loved the world');
});

test('an ordinal book name is understood', async ({ app }) => {
  await detect(app, 'second timothy chapter three verse sixteen');

  await expect(detections(app).first().locator('.result-ref')).toHaveText('2 Timothy 3:16');
});

test('a compound number is read correctly', async ({ app }) => {
  // "one hundred and nineteen" must become 119, not 100 and 19.
  await detect(app, 'let us read psalm one hundred and nineteen verse one hundred and five');

  await expect(detections(app).first().locator('.result-ref')).toHaveText('Psalm 119:105');
});

test('a verse range spoken aloud is captured', async ({ app }) => {
  await detect(app, 'romans chapter eight verses twenty eight through thirty');

  await expect(detections(app).first().locator('.result-ref')).toContainText('Romans 8:28');
});

test('a misheard book name is recovered phonetically', async ({ app }) => {
  // Whisper renders "Philippians" as "Filipians" often enough to matter.
  await detect(app, 'filipians chapter four verse thirteen');

  const first = detections(app).first();
  await expect(first.locator('.result-ref')).toHaveText('Philippians 4:13');
  // A phonetic recovery is a guess and the score must say so.
  const confidence = await first.locator('.chip').first().innerText();
  expect(Number(confidence.replace('%', ''))).toBeLessThan(90);
});

test('scripture quoted aloud is matched back to its reference', async ({ app }) => {
  // A single verse, quoted in full. The quotation path scores the tail of the
  // transcript against one verse at a time, so a quote spanning a verse
  // boundary matches neither — and "The Lord is my shepherd, I shall not want"
  // is mostly stopwords, leaving too few tokens to search on. This line is long
  // enough to be distinctive and sits inside one verse.
  await detect(app, 'he maketh me to lie down in green pastures he leadeth me beside the still waters');

  const first = detections(app).first();
  await expect(first.locator('.result-ref')).toContainText('Psalm 23:2');
  await expect(first.locator('.chip').nth(1)).toHaveText('quotation');
});

test('a cue phrase raises confidence over a bare mention', async ({ app }) => {
  await detect(app, 'turn with me to romans chapter eight verse twenty eight');
  const withCue = Number((await detections(app).first().locator('.chip').first().innerText()).replace('%', ''));

  expect(withCue).toBeGreaterThan(80);
  await expect(detections(app).first().locator('.chip').nth(1)).toHaveText('reference');
});

test('ordinary speech does not produce a cue', async ({ app }) => {
  // "read", "from" and "let us" reduce to consonant skeletons that sit next to
  // real book names. A preacher says them constantly, so a false cue here would
  // put the wrong verse on the screen several times a service.
  await detect(app, 'let us read from the word this morning and think about what that means');

  await expect(emptyNote(app)).toContainText(/Nothing detected yet/);
});

test('a detection cues to preview without touching the audience screen', async ({ app }) => {
  await detect(app, 'turn with me to john chapter three verse sixteen');

  await detections(app).first().getByRole('button', { name: 'Preview' }).click();

  const state = await app.live();
  expect(state.preview.title).toContain('John 3:16');
  expect(state.program.slides).toHaveLength(0);
});

test('a detection takes straight to the audience screen', async ({ app }) => {
  await detect(app, 'turn with me to john chapter three verse sixteen');

  await detections(app).first().getByRole('button', { name: 'Take' }).click();

  await expect.poll(async () => (await app.live()).program.title).toContain('John 3:16');
});

test('auto-take is off by default', async ({ app }) => {
  // A false positive reaching the screen unattended is worse than a slow cue,
  // so this must never quietly default to on.
  const toggle = app.console.getByLabel('Auto-take detections');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('raising sensitivity suppresses a weak detection', async ({ app }) => {
  // A bare book-and-number with no cue phrase is a weak signal by design.
  await detect(app, 'jude verse four');
  const before = await detections(app).count();

  await app.bp(() => window.bp.settings.patch({ ai: { detectionSensitivity: 0.95 } }));
  await app.console.reload();
  await app.gotoPanel('Detect');

  await detect(app, 'jude verse four');
  await expect(emptyNote(app)).toContainText(/Nothing detected yet/);
  expect(before).toBeGreaterThan(0);
});
