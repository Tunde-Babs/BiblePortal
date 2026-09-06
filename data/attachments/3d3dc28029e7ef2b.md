# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-detect.spec.ts >> raising sensitivity suppresses a weak detection
- Location: e2e/specs/05-detect.spec.ts:141:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Test source

```ts
  52  |   await expect(first.locator('.result-ref')).toHaveText('John 3:16');
  53  |   await expect(first).toContainText('For God so loved the world');
  54  | });
  55  | 
  56  | test('an ordinal book name is understood', async ({ app }) => {
  57  |   await detect(app, 'second timothy chapter three verse sixteen');
  58  | 
  59  |   await expect(detections(app).first().locator('.result-ref')).toHaveText('2 Timothy 3:16');
  60  | });
  61  | 
  62  | test('a compound number is read correctly', async ({ app }) => {
  63  |   // "one hundred and nineteen" must become 119, not 100 and 19.
  64  |   await detect(app, 'let us read psalm one hundred and nineteen verse one hundred and five');
  65  | 
  66  |   await expect(detections(app).first().locator('.result-ref')).toHaveText('Psalm 119:105');
  67  | });
  68  | 
  69  | test('a verse range spoken aloud is captured', async ({ app }) => {
  70  |   await detect(app, 'romans chapter eight verses twenty eight through thirty');
  71  | 
  72  |   await expect(detections(app).first().locator('.result-ref')).toContainText('Romans 8:28');
  73  | });
  74  | 
  75  | test('a misheard book name is recovered phonetically', async ({ app }) => {
  76  |   // Whisper renders "Philippians" as "Filipians" often enough to matter.
  77  |   await detect(app, 'filipians chapter four verse thirteen');
  78  | 
  79  |   const first = detections(app).first();
  80  |   await expect(first.locator('.result-ref')).toHaveText('Philippians 4:13');
  81  |   // A phonetic recovery is a guess and the score must say so.
  82  |   const confidence = await first.locator('.chip').first().innerText();
  83  |   expect(Number(confidence.replace('%', ''))).toBeLessThan(90);
  84  | });
  85  | 
  86  | test('scripture quoted aloud is matched back to its reference', async ({ app }) => {
  87  |   // A single verse, quoted in full. The quotation path scores the tail of the
  88  |   // transcript against one verse at a time, so a quote spanning a verse
  89  |   // boundary matches neither — and "The Lord is my shepherd, I shall not want"
  90  |   // is mostly stopwords, leaving too few tokens to search on. This line is long
  91  |   // enough to be distinctive and sits inside one verse.
  92  |   await detect(app, 'he maketh me to lie down in green pastures he leadeth me beside the still waters');
  93  | 
  94  |   const first = detections(app).first();
  95  |   await expect(first.locator('.result-ref')).toContainText('Psalm 23:2');
  96  |   await expect(first.locator('.chip').nth(1)).toHaveText('quotation');
  97  | });
  98  | 
  99  | test('a cue phrase raises confidence over a bare mention', async ({ app }) => {
  100 |   await detect(app, 'turn with me to romans chapter eight verse twenty eight');
  101 |   const withCue = Number((await detections(app).first().locator('.chip').first().innerText()).replace('%', ''));
  102 | 
  103 |   expect(withCue).toBeGreaterThan(80);
  104 |   await expect(detections(app).first().locator('.chip').nth(1)).toHaveText('reference');
  105 | });
  106 | 
  107 | test('ordinary speech does not produce a cue', async ({ app }) => {
  108 |   // "read", "from" and "let us" reduce to consonant skeletons that sit next to
  109 |   // real book names. A preacher says them constantly, so a false cue here would
  110 |   // put the wrong verse on the screen several times a service.
  111 |   await detect(app, 'let us read from the word this morning and think about what that means');
  112 | 
  113 |   await expect(emptyNote(app)).toContainText(/Nothing detected yet/);
  114 | });
  115 | 
  116 | test('a detection cues to preview without touching the audience screen', async ({ app }) => {
  117 |   await detect(app, 'turn with me to john chapter three verse sixteen');
  118 | 
  119 |   await detections(app).first().getByRole('button', { name: 'Preview' }).click();
  120 | 
  121 |   const state = await app.live();
  122 |   expect(state.preview.title).toContain('John 3:16');
  123 |   expect(state.program.slides).toHaveLength(0);
  124 | });
  125 | 
  126 | test('a detection takes straight to the audience screen', async ({ app }) => {
  127 |   await detect(app, 'turn with me to john chapter three verse sixteen');
  128 | 
  129 |   await detections(app).first().getByRole('button', { name: 'Take' }).click();
  130 | 
  131 |   await expect.poll(async () => (await app.live()).program.title).toContain('John 3:16');
  132 | });
  133 | 
  134 | test('auto-take is off by default', async ({ app }) => {
  135 |   // A false positive reaching the screen unattended is worse than a slow cue,
  136 |   // so this must never quietly default to on.
  137 |   const toggle = app.console.getByLabel('Auto-take detections');
  138 |   await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  139 | });
  140 | 
  141 | test('raising sensitivity suppresses a weak detection', async ({ app }) => {
  142 |   // A bare book-and-number with no cue phrase is a weak signal by design.
  143 |   await detect(app, 'jude verse four');
  144 |   const before = await detections(app).count();
  145 | 
  146 |   await app.bp(() => window.bp.settings.patch({ ai: { detectionSensitivity: 0.95 } }));
  147 |   await app.console.reload();
  148 |   await app.gotoPanel('Detect');
  149 | 
  150 |   await detect(app, 'jude verse four');
  151 |   await expect(emptyNote(app)).toContainText(/Nothing detected yet/);
> 152 |   expect(before).toBeGreaterThan(0);
      |                  ^ Error: expect(received).toBeGreaterThan(expected)
  153 | });
  154 | 
```