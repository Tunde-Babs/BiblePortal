/**
 * Arranging state for a test.
 *
 * These go through the same preload bridge the UI uses, so nothing here reaches
 * past the app's own API. They exist to make the *arrange* step cheap — building
 * a four-song library by typing into the editor would add a minute to every
 * spec that needs one, and would test the editor over and over instead of the
 * thing actually under examination.
 *
 * The rule the suite follows: seed the preconditions, then drive the behaviour
 * under test through the interface. Never seed the thing being asserted.
 */

import type { AppHandle } from './app';

export interface SeededSong {
  id: string;
  title: string;
}

/** A song shaped the way the library expects, with sensible defaults. */
export function songInput(title: string, overrides: Record<string, unknown> = {}) {
  return {
    title,
    author: 'Traditional',
    key: 'G',
    sections: [
      { type: 'verse', number: 1, label: 'Verse 1', body: `${title} first line\n${title} second line` },
      { type: 'chorus', number: null, label: 'Chorus', body: `${title} chorus line` },
    ],
    tags: [],
    ...overrides,
  };
}

/** Add songs to the library. Returns them in the order given. */
export async function seedSongs(app: AppHandle, titles: string[]): Promise<SeededSong[]> {
  return app.bp(async (inputs) => {
    const made: { id: string; title: string }[] = [];
    for (const input of inputs) {
      const res = await window.bp.songs.upsert(input);
      made.push({ id: res.song.id, title: res.song.title });
    }
    return made;
  }, titles.map((t) => songInput(t)));
}

/** Create a service plan with the given items. */
export async function seedPlan(
  app: AppHandle,
  name: string,
  items: { kind: string; title: string; songId?: string }[] = [],
): Promise<{ id: string; name: string }> {
  return app.bp(async ({ planName, planItems }) => {
    const created = await window.bp.plans.create({ name: planName });
    for (const item of planItems) {
      await window.bp.plans.addItem(created.plan.id, {
        kind: item.kind,
        title: item.title,
        songId: item.songId ?? null,
      });
    }
    return { id: created.plan.id, name: created.plan.name };
  }, { planName: name, planItems: items });
}

/**
 * Create a sermon outline containing exactly the given points.
 *
 * The points are passed to `create` rather than appended afterwards. A new
 * sermon is seeded with a five-point starter outline — Introduction, First
 * point, Second point, Third point, Application — which is the right default
 * for a preacher and quietly wrong for a test: appending would leave the
 * intended points at index five onwards, so "take the second point" would take
 * "First point" instead.
 */
export async function seedSermon(
  app: AppHandle,
  title: string,
  points: string[],
): Promise<{ id: string }> {
  return app.bp(async ({ sermonTitle, sermonPoints }) => {
    const created = await window.bp.sermons.create({
      title: sermonTitle,
      points: sermonPoints.map((text, i) => ({
        id: `pt_seed_${i}`,
        text,
        subPoints: [],
        ref: '',
        note: '',
      })),
    });
    return { id: created.sermon.id };
  }, { sermonTitle: title, sermonPoints: points });
}

/**
 * Stage a scripture passage into preview, the way the Bible panel does.
 * Used by specs whose subject is the transport, not the lookup.
 */
export async function stageScripture(app: AppHandle, reference: string): Promise<number> {
  return app.bp(async (ref) => {
    const hit = await window.bp.bible.lookup(ref);
    const slides = hit.verses.map((v: any) => ({
      id: v.label,
      lines: [v.text],
      caption: v.label,
      verseNumbers: [v.verse],
    }));
    await window.bp.live.preview({
      kind: 'scripture',
      title: hit.label,
      slides,
      index: 0,
      meta: { translationAbbr: hit.translationAbbr },
    });
    return slides.length;
  }, reference);
}
