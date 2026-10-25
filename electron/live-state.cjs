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
      /** Mirrors settings.presentation.showSectionLabels for the output windows. */
      sectionLabels: false,
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

  /**
   * Refresh any deck staged from `songId` with newly built slides.
   *
   * A deck is a snapshot of the words as they stood when the operator staged
   * it, which is what keeps playback steady while the library is being worked
   * on. The one case where that snapshot is wrong is an edit to the song
   * already cued: the operator fixed the typo precisely so the congregation
   * would stop seeing it. Without this, saving looks like it did nothing — the
   * library is correct but preview and the screen still show the old words
   * until the song is staged again by hand.
   *
   * Only the song's own fields are refreshed. The background chosen for this
   * deck and the key it was staged in belong to the operator, not the library.
   *
   * @returns {boolean} whether anything was staged from that song
   */
  refreshSong(songId, { slides, title, style = null }) {
    const patch = {};
    for (const which of ['preview', 'program']) {
      const deck = this.state[which];
      if (deck?.kind !== 'song' || deck.meta?.songId !== songId) continue;
      patch[which] = {
        ...deck,
        title: title ?? deck.title,
        slides,
        index: carryIndex(deck, slides),
        meta: { ...deck.meta, style },
      };
    }
    if (!Object.keys(patch).length) return false;
    this.set(patch);
    return true;
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

  /** Jump preview to a specific slide, so the operator can cue any part. */
  goToPreview(index) {
    const deck = this.state.preview;
    if (index < 0 || index >= deck.slides.length) return false;
    this.set({ preview: { ...deck, index } });
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

/**
 * Map a deck position onto rebuilt slides, by stanza rather than slide number.
 *
 * Adding a line to the second verse renumbers every slide after it, so keeping
 * the raw index would silently move the operator. The stanza being sung is
 * still the stanza being sung, so that is what is carried across, along with
 * how far into it the operator had got.
 */
function carryIndex(deck, slides) {
  if (!slides.length) return 0;
  const current = deck.slides[deck.index];
  if (current?.sectionId) {
    const within = deck.slides
      .slice(0, deck.index)
      .filter((s) => s.sectionId === current.sectionId).length;
    const same = [];
    slides.forEach((s, i) => { if (s.sectionId === current.sectionId) same.push(i); });
    if (same.length) return same[Math.min(within, same.length - 1)];
  }
  // The stanza is gone entirely — hold the nearest position rather than
  // jumping the congregation back to the top of the song.
  return Math.min(Math.max(deck.index, 0), slides.length - 1);
}

module.exports = { LiveState, emptyDeck };
