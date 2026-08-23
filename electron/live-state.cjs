'use strict';
/**
 * The live presentation state — the single source of truth for what the
 * congregation sees right now.
 *
 * The console edits `preview`; taking it to air copies preview into `program`,
 * which is what the output and stage windows render. That preview/program split
 * is the core safety property of a live console: nothing reaches the screen
 * until the operator commits it.
 */

const { EventEmitter } = require('node:events');

/** @typedef {{kind:'scripture'|'song'|'slide'|'media'|'blank', title:string, slides:object[], index:number, meta:object}} Deck */

const emptyDeck = () => ({ kind: 'blank', title: '', slides: [], index: 0, meta: {} });

class LiveState extends EventEmitter {
  constructor() {
    super();
    this.state = {
      preview: emptyDeck(),
      program: emptyDeck(),
      /** Black is the panic button: output goes dark, everything else is retained. */
      blackout: false,
      /** Clear hides content but keeps the background — used between items. */
      cleared: false,
      theme: null,
      logo: false,
      alert: null,
      countdown: null,
      stage: { notes: '', nextLabel: '' },
      updatedAt: Date.now(),
    };
  }

  get() { return this.state; }

  /** Apply a patch and notify every window. */
  set(patch) {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.emit('change', this.state);
    return this.state;
  }

  /** Load a deck into preview without touching what is on air. */
  loadPreview(deck) {
    return this.set({ preview: { ...emptyDeck(), ...deck, index: deck.index ?? 0 } });
  }

  /** Commit preview to program — the "take" action. */
  take() {
    return this.set({ program: { ...this.state.preview }, cleared: false, blackout: false });
  }

  /** Move within the program deck. Returns false at the end of the deck. */
  step(delta) {
    const deck = this.state.program;
    if (!deck.slides.length) return false;
    const next = deck.index + delta;
    if (next < 0 || next >= deck.slides.length) return false;
    this.set({ program: { ...deck, index: next } });
    return true;
  }

  goTo(index) {
    const deck = this.state.program;
    if (index < 0 || index >= deck.slides.length) return false;
    this.set({ program: { ...deck, index } });
    return true;
  }

  /** Step preview instead of program — lets the operator read ahead. */
  stepPreview(delta) {
    const deck = this.state.preview;
    if (!deck.slides.length) return false;
    const next = deck.index + delta;
    if (next < 0 || next >= deck.slides.length) return false;
    this.set({ preview: { ...deck, index: next } });
    return true;
  }

  toggleBlackout() { return this.set({ blackout: !this.state.blackout }); }
  clear() { return this.set({ cleared: true }); }
  restore() { return this.set({ cleared: false, blackout: false }); }
  toggleLogo() { return this.set({ logo: !this.state.logo, cleared: false }); }

  showAlert(text, style = 'notice') {
    return this.set({ alert: text ? { text, style, at: Date.now() } : null });
  }

  /** The slide the congregation is seeing, or null when nothing is live. */
  currentSlide() {
    const { program, blackout, cleared } = this.state;
    if (blackout || cleared) return null;
    return program.slides[program.index] ?? null;
  }

  nextSlide() {
    const { program } = this.state;
    return program.slides[program.index + 1] ?? null;
  }
}

module.exports = { LiveState, emptyDeck };
