'use strict';
/**
 * Sermon notes.
 *
 * An outline the operator follows live: the congregation sees the point being
 * preached, and — in outline mode — where it sits in the whole message, with
 * the current point emphasised. That context is the reason to project an
 * outline at all rather than isolated sentences.
 */

const DOC = 'sermons';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.sermons/1', sermons: [] });

const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Starting outline for a new set of notes — the shape most sermons take. */
function starterPoints() {
  return [
    { id: newId('pt'), text: 'Introduction', subPoints: [], ref: '', note: '' },
    { id: newId('pt'), text: 'First point', subPoints: [], ref: '', note: '' },
    { id: newId('pt'), text: 'Second point', subPoints: [], ref: '', note: '' },
    { id: newId('pt'), text: 'Third point', subPoints: [], ref: '', note: '' },
    { id: newId('pt'), text: 'Application', subPoints: [], ref: '', note: '' },
  ];
}

class SermonService {
  /** @param {import('./store.cjs').Store} store */
  constructor(store) { this.store = store; }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.sermons ?? [];
  }

  async get(id) { return (await this.all()).find((s) => s.id === id) ?? null; }

  async saveAll(sermons) {
    await this.store.write(DOC, { ...empty(), sermons, updatedAt: new Date().toISOString() });
    return sermons;
  }

  async create(input = {}) {
    const sermons = await this.all();
    const now = new Date().toISOString();
    const sermon = {
      id: newId('sermon'),
      title: input.title ?? 'New Sermon',
      speaker: input.speaker ?? '',
      date: input.date ?? now.slice(0, 10),
      passage: input.passage ?? '',
      bigIdea: input.bigIdea ?? '',
      points: input.points ?? starterPoints(),
      createdAt: now,
      updatedAt: now,
    };
    sermons.unshift(sermon);
    await this.saveAll(sermons);
    return sermon;
  }

  async update(id, patch) {
    const sermons = await this.all();
    const i = sermons.findIndex((s) => s.id === id);
    if (i < 0) throw new Error('Sermon not found');
    sermons[i] = { ...sermons[i], ...patch, id, updatedAt: new Date().toISOString() };
    await this.saveAll(sermons);
    return sermons[i];
  }

  async remove(id) {
    const sermons = await this.all();
    await this.saveAll(sermons.filter((s) => s.id !== id));
    return { ok: true };
  }

  async duplicate(id) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    return this.create({
      title: `${sermon.title} (copy)`,
      speaker: sermon.speaker,
      passage: sermon.passage,
      bigIdea: sermon.bigIdea,
      // Fresh point ids so editing the copy never touches the original.
      points: sermon.points.map((p) => ({ ...p, id: newId('pt') })),
    });
  }

  // ------------------------------------------------------------------ points

  async addPoint(id, text = 'New point', at = null) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    const point = { id: newId('pt'), text, subPoints: [], ref: '', note: '' };
    const points = [...sermon.points];
    if (at == null || at < 0 || at >= points.length) points.push(point);
    else points.splice(at + 1, 0, point);
    await this.update(id, { points });
    return point;
  }

  async updatePoint(id, pointId, patch) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    const points = sermon.points.map((p) => (p.id === pointId ? { ...p, ...patch, id: pointId } : p));
    await this.update(id, { points });
    return points.find((p) => p.id === pointId);
  }

  async removePoint(id, pointId) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    await this.update(id, { points: sermon.points.filter((p) => p.id !== pointId) });
    return { ok: true };
  }

  async movePoint(id, from, to) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    const points = [...sermon.points];
    if (from < 0 || from >= points.length) throw new Error('Index out of range');
    const target = Math.max(0, Math.min(to, points.length - 1));
    const [moved] = points.splice(from, 1);
    points.splice(target, 0, moved);
    await this.update(id, { points });
    return points;
  }

  /**
   * Build presentation slides from an outline.
   *
   * `outline` mode shows the whole message with the current point emphasised,
   * so the congregation can see where they are. `point` mode shows one point
   * large, which reads better from the back of a big room.
   *
   * @param {string} id
   * @param {{mode?:'outline'|'point', includeSubPoints?:boolean}} opts
   */
  async slides(id, opts = {}) {
    const sermon = await this.get(id);
    if (!sermon) throw new Error('Sermon not found');
    const mode = opts.mode ?? 'outline';
    const withSubs = opts.includeSubPoints !== false;

    const points = sermon.points.filter((p) => p.text.trim());
    if (!points.length) return [];

    return points.map((p, i) => {
      const subs = withSubs ? (p.subPoints ?? []).filter((t) => String(t).trim()) : [];
      const caption = [sermon.title, p.ref].filter(Boolean).join(' · ');

      if (mode === 'point') {
        return {
          id: `${p.id}_pt`,
          lines: [p.text, ...subs],
          caption,
          pointIndex: i,
        };
      }

      return {
        id: `${p.id}_ol`,
        // Body lines are the fallback for any surface that cannot draw an outline.
        lines: [p.text, ...subs],
        caption,
        pointIndex: i,
        // The whole outline, with this point marked active.
        outline: points.map((q, j) => ({
          text: q.text,
          active: j === i,
          subPoints: j === i ? subs : [],
        })),
      };
    });
  }
}

module.exports = { SermonService, starterPoints };
