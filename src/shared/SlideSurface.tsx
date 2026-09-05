/**
 * The rendering surface for one slide.
 *
 * Always drawn at 1920×1080 and CSS-scaled to fit its container, so a 320px
 * console preview and a 4K projector run identical layout code. Any difference
 * between them would be a lie to the operator.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Deck, Slide, Theme } from './types';
import { fileUrl } from './file-url';
import {
  STAGE_W, STAGE_H, FALLBACK_THEME, backgroundStyle, backdropStyle, resolveBackdrop, bodyStyle,
  captionStyle, frameStyle, captionOf,
} from './slide-render';

interface Props {
  slide: Slide | null;
  deck?: Deck | null;
  theme?: Theme | null;
  /** Black the surface entirely (the panic state). */
  blackout?: boolean;
  /** Hide content but keep the background. */
  cleared?: boolean;
  logo?: boolean;
  showTranslation?: boolean;
  /**
   * Show a song's section label on screen. Scripture references ignore this —
   * they are governed by the theme, and a licensed translation's abbreviation
   * must always appear.
   */
  showSectionLabel?: boolean;
  /** Render verse numbers as superscripts before each line. */
  showVerseNumbers?: boolean;
  className?: string;
  /** Fill the parent instead of measuring it (used inside fixed-size frames). */
  fill?: boolean;
  /**
   * Freeze motion. A running order shows a thumbnail per item, and starting a
   * video decoder for each one costs more than the thumbnails are worth.
   */
  still?: boolean;
}

/**
 * Shrink the words until they fit the frame.
 *
 * Sizing scripture by character count cannot work: how a passage wraps depends
 * on the typeface, the width it is given and where the spaces fall, so a count
 * shrinks readings that would have fit and still lets others run off the
 * bottom. This measures the block that was actually laid out and reduces only
 * as far as it must — which is what makes it safe to set a large base size and
 * let long passages come down to meet the screen.
 *
 * It runs in a layout effect and writes `fontSize` directly, so the correction
 * lands before the browser paints and the congregation never sees a resize.
 *
 * @param minPx floor in stage pixels, before the surface's own scale
 */
function useFitToFrame(
  frameRef: React.RefObject<HTMLDivElement | null>,
  bodyRef: React.RefObject<HTMLDivElement | null>,
  { enabled, startPx, minPx, scale, key }:
  { enabled: boolean; startPx: number; minPx: number; scale: number; key: string },
) {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const body = bodyRef.current;
    if (!frame || !body || startPx <= 0) return;

    let size = startPx;
    body.style.fontSize = `${size}px`;
    if (!enabled) return;

    const floor = Math.max(minPx * scale, 1);

    /** Height left for the body once padding and the reference line are taken. */
    const roomFor = () => {
      const cs = getComputedStyle(frame);
      const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
      let room = frame.clientHeight
        - (parseFloat(cs.paddingTop) || 0)
        - (parseFloat(cs.paddingBottom) || 0);
      for (const child of Array.from(frame.children)) {
        if (child === body) continue;
        room -= (child as HTMLElement).offsetHeight + gap;
      }
      return room;
    };

    // Wrapping changes as the size changes, so one ratio is an estimate rather
    // than an answer. A few passes converge; the cap stops any pathological loop.
    for (let pass = 0; pass < 8; pass += 1) {
      const room = roomFor();
      if (room <= 0) break;

      const tooTall = body.scrollHeight > room + 1;
      const tooWide = body.scrollWidth > body.clientWidth + 1;
      if (!tooTall && !tooWide) break;

      const ratio = tooTall ? room / body.scrollHeight : 0.94;
      // Always take a real step, and never overshoot the floor.
      const next = Math.max(floor, Math.floor(size * Math.min(ratio, 0.97)));
      if (next >= size) break;
      size = next;
      body.style.fontSize = `${size}px`;
    }
  }, [frameRef, bodyRef, enabled, startPx, minPx, scale, key]);
}

export function SlideSurface({
  slide, deck, theme, blackout = false, cleared = false, logo = false,
  showTranslation = true, showSectionLabel = true, showVerseNumbers = false,
  className = '', fill = true, still = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const active = theme ?? FALLBACK_THEME;

  // Track the container so the 1920×1080 surface always fits exactly.
  //
  // A ResizeObserver alone is not enough: if the host is measured while it has
  // no layout yet — a hidden panel, a tab that has not been shown, a window
  // still settling — the first measurement is zero and no resize follows to
  // correct it. The surface then renders at scale 0, which is invisible, and
  // looks exactly like a broken preview. So we re-measure on animation frames
  // until a real size appears.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let attempts = 0;
    let settled = false;

    const measure = () => {
      const r = host.getBoundingClientRect();
      // Ratio of rendered width to the 1920px design width.
      const next = r.width > 0 && r.height > 0 ? Math.min(r.width / STAGE_W, r.height / STAGE_H) : 0;
      if (next > 0) {
        settled = true;
        setScale((prev) => (Math.abs(prev - next) > 0.0001 ? next : prev));
      }
      return next;
    };

    // Poll briefly until the host has a size; ~2s at 60fps is ample.
    const pump = () => {
      if (measure() > 0 || attempts++ > 120) return;
      raf = requestAnimationFrame(pump);
    };
    pump();

    const ro = new ResizeObserver(() => {
      const next = measure();
      // A host collapsing to zero (panel hidden) should keep the last good
      // scale rather than blanking the surface.
      if (next === 0 && settled) return;
    });
    ro.observe(host);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const rawCaption = captionOf(slide, deck, showTranslation);
  // Song decks copy the section label into `caption`, so the label cannot be
  // told from a scripture reference by inspecting the slide — the deck kind is
  // the reliable discriminator.
  const isSectionLabel = deck?.kind === 'song';
  const caption = isSectionLabel && !showSectionLabel ? '' : rawCaption;
  const hasContent = !!slide && !cleared && !blackout;

  // Media belongs to the surface, not to one window. Rendering it only in the
  // audience output made the console's preview show black for every media item,
  // which is exactly the disagreement this component exists to prevent.
  const mediaFile = deck?.meta?.mediaFile as string | undefined;
  const mediaKind = deck?.meta?.mediaKind as 'image' | 'video' | undefined;
  const showMedia = !!mediaFile && !blackout && !cleared;

  // The theme's standing background for this kind of content. Media sent for
  // one specific item wins over it, so a chosen clip is never fighting the
  // scripture backdrop underneath.
  const backdrop = resolveBackdrop(deck ?? null, active);
  const showBackdrop = !!backdrop && !showMedia && !blackout && !cleared;

  // The size the theme asks for, before measurement trims it to the frame.
  const startPx = Number.parseFloat(
    String(bodyStyle(slide, active, scale, deck?.meta?.style).fontSize ?? '0'),
  );
  useFitToFrame(frameRef, bodyRef, {
    enabled: active.text.autoFit !== false,
    startPx,
    minPx: active.text.minSize ?? 24,
    scale,
    // Re-fit whenever the words, the theme or the frame change.
    key: `${slide?.id ?? ''}|${slide?.lines.join('\u0001') ?? ''}|${active.id}|${active.text.size}|${active.text.maxWidth}`,
  });

  return (
    <div
      ref={hostRef}
      className={`slide-host ${className}`}
      style={fill ? { width: '100%', height: '100%' } : undefined}
    >
      {scale === 0 && (
        <div className="slide-unmeasured">
          Preview could not measure its container
        </div>
      )}

      {/* Slides exist and nothing is suppressing them, yet the body has no
          lines — report it rather than showing an unexplained black pane. */}
      {scale > 0 && hasContent && !logo && slide.lines.length === 0 && !mediaFile && (
        <div className="slide-unmeasured">This slide has no content</div>
      )}

      <div
        className="slide-surface"
        style={{
          // Native size. Previously this was a 1920x1080 element shrunk with a
          // transform, which on a HiDPI display asks the compositor for a
          // 3840x2160 texture per surface; when that fails the layer never
          // paints even though every DOM measurement still looks correct.
          width: '100%',
          height: '100%',
          opacity: scale ? 1 : 0,
          ...backgroundStyle(active),
        }}
      >
        {/* The theme's own background for scripture / songs, underneath any
            media the operator sent for this particular item. */}
        {showBackdrop && backdrop!.kind === 'video' && (
          <video
            className="slide-backdrop"
            key={backdrop!.file}
            src={fileUrl(backdrop!.file)}
            style={backdropStyle(backdrop!)}
            autoPlay={!still}
            loop={!still}
            muted
            playsInline
            preload={still ? 'metadata' : 'auto'}
          />
        )}
        {showBackdrop && backdrop!.kind === 'image' && (
          <img
            className="slide-backdrop"
            src={fileUrl(backdrop!.file)}
            style={backdropStyle(backdrop!)}
            alt=""
          />
        )}
        {showBackdrop && backdrop!.dim > 0 && (
          <div className="slide-scrim" style={{ opacity: backdrop!.dim }} />
        )}

        {/* Behind the text layer, above the theme background. */}
        {showMedia && mediaKind === 'video' && (
          <video
            className="slide-media"
            src={fileUrl(mediaFile!)}
            autoPlay={!still}
            loop={!still}
            muted
            playsInline
            preload={still ? 'metadata' : 'auto'}
          />
        )}
        {showMedia && mediaKind === 'image' && (
          <img className="slide-media" src={fileUrl(mediaFile!)} alt="" />
        )}

        {/* Blackout paints over everything, including the background. */}
        {blackout && <div className="slide-blackout" />}

        {logo && !blackout && (
          <div className="slide-logo">
            <div className="slide-logo-mark" style={{ fontSize: `${Math.max(220 * scale, 8)}px` }}>✝</div>
          </div>
        )}

        {/* An imported presentation slide's picture sits behind its text. */}
        {hasContent && !logo && slide.image && (
          <img className="slide-media" src={fileUrl(slide.image)} alt="" />
        )}

        {hasContent && !logo && (
          <div className="slide-frame" ref={frameRef} style={frameStyle(active, scale)}>
            {slide.outline ? (
              /* Sermon outline: the whole message with the live point emphasised,
                 so the room can see where they are rather than one loose line. */
              <div
                className="slide-outline"
                ref={bodyRef}
                style={{ ...bodyStyle(slide, active, scale, deck?.meta?.style), textAlign: 'left', maxWidth: '80%' }}
                key={slide.id}
              >
                {slide.outline.map((entry, i) => (
                  <div key={i} className={`outline-entry ${entry.active ? 'active' : ''}`}>
                    <span className="outline-marker">{i + 1}.</span>
                    <span className="outline-text">{entry.text}</span>
                    {entry.active && !!entry.subPoints?.length && (
                      <div className="outline-subs">
                        {entry.subPoints.map((sub, j) => (
                          <div className="outline-sub" key={j}>{sub}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="slide-body"
                ref={bodyRef}
                style={bodyStyle(slide, active, scale, deck?.meta?.style)}
                key={slide.id /* re-key so the transition replays per slide */}
              >
                {slide.lines.map((line, i) => (
                  <div className="slide-line" key={i}>
                    {showVerseNumbers && slide.verseNumbers?.[i] != null && (
                      <sup className="slide-versenum">{slide.verseNumbers[i]}</sup>
                    )}
                    {line}
                  </div>
                ))}
              </div>
            )}

            {active.reference.show && caption && (
              <div className="slide-caption" style={captionStyle(active, scale)}>{caption}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
