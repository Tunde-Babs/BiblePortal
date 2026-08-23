'use strict';
/**
 * Service plans (the cue list).
 *
 * A plan is an ordered list of items — scripture passages, songs, media, custom
 * slides and announcements — that the operator walks through during a service.
 */

const DOC = 'plans';
/** A factory, not a constant — a shared empty document would be mutated in place. */
const empty = () => ({ format: 'bibleportal.plans/1', plans: [] });

const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Item kinds a plan can hold. */
const ITEM_KINDS = ['scripture', 'song', 'media', 'slide', 'announcement', 'header'];

class PlanService {
  /** @param {import('./store.cjs').Store} store */
  constructor(store) { this.store = store; }

  async all() {
    const doc = await this.store.read(DOC, empty());
    return doc?.plans ?? [];
  }

  async get(id) { return (await this.all()).find((p) => p.id === id) ?? null; }

  async saveAll(plans) {
    await this.store.write(DOC, { ...empty(), plans, updatedAt: new Date().toISOString() });
    return plans;
  }

  async create(input = {}) {
    const plans = await this.all();
    const now = new Date().toISOString();
    const plan = {
      id: newId('plan'),
      name: input.name ?? 'Untitled Service',
      date: input.date ?? now.slice(0, 10),
      notes: input.notes ?? '',
      items: input.items ?? [],
      createdAt: now,
      updatedAt: now,
    };
    plans.unshift(plan);
    await this.saveAll(plans);
    return plan;
  }

  async update(id, patch) {
    const plans = await this.all();
    const i = plans.findIndex((p) => p.id === id);
    if (i < 0) throw new Error('Plan not found');
    plans[i] = { ...plans[i], ...patch, id, updatedAt: new Date().toISOString() };
    await this.saveAll(plans);
    return plans[i];
  }

  async remove(id) {
    const plans = await this.all();
    await this.saveAll(plans.filter((p) => p.id !== id));
    return { ok: true };
  }

  async duplicate(id) {
    const plan = await this.get(id);
    if (!plan) throw new Error('Plan not found');
    return this.create({
      name: `${plan.name} (copy)`,
      notes: plan.notes,
      // Fresh item ids so editing the copy never mutates the original.
      items: plan.items.map((item) => ({ ...item, id: newId('item') })),
    });
  }

  /** Append an item to a plan. */
  async addItem(planId, item) {
    const plan = await this.get(planId);
    if (!plan) throw new Error('Plan not found');
    if (!ITEM_KINDS.includes(item.kind)) throw new Error(`Unknown item kind: ${item.kind}`);
    const record = {
      id: newId('item'),
      kind: item.kind,
      title: item.title ?? '',
      ref: item.ref ?? null,          // scripture: parsed reference
      songId: item.songId ?? null,
      mediaId: item.mediaId ?? null,
      body: item.body ?? '',
      key: item.key ?? null,          // song: performance key
      arrangement: item.arrangement ?? null,
      duration: item.duration ?? null,
      notes: item.notes ?? '',
    };
    plan.items.push(record);
    await this.update(planId, { items: plan.items });
    return record;
  }

  async updateItem(planId, itemId, patch) {
    const plan = await this.get(planId);
    if (!plan) throw new Error('Plan not found');
    const i = plan.items.findIndex((x) => x.id === itemId);
    if (i < 0) throw new Error('Item not found');
    plan.items[i] = { ...plan.items[i], ...patch, id: itemId };
    await this.update(planId, { items: plan.items });
    return plan.items[i];
  }

  async removeItem(planId, itemId) {
    const plan = await this.get(planId);
    if (!plan) throw new Error('Plan not found');
    await this.update(planId, { items: plan.items.filter((x) => x.id !== itemId) });
    return { ok: true };
  }

  /** Move an item to a new position (drag-and-drop reorder). */
  async reorder(planId, fromIndex, toIndex) {
    const plan = await this.get(planId);
    if (!plan) throw new Error('Plan not found');
    const items = [...plan.items];
    if (fromIndex < 0 || fromIndex >= items.length) throw new Error('Index out of range');
    const target = Math.max(0, Math.min(toIndex, items.length - 1));
    const [moved] = items.splice(fromIndex, 1);
    items.splice(target, 0, moved);
    await this.update(planId, { items });
    return items;
  }
}

module.exports = { PlanService, ITEM_KINDS };
