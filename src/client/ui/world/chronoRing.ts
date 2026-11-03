import type { ThreatResponse } from '@content/schemas/threat';
import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  CHRONO_RING_NOTCH_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  TARGET_HIGHLIGHT_OUTLINE_PX,
  TARGET_HIGHLIGHT_STROKE_PX,
} from '@shared/constants';
import { log } from '@shared/log';

// The chrono-ring (story 2.11; DESIGN.md › chrono-ring, GDD mechanic 12): the pure part. Everything
// here is a function of the world's sim time and of the window frozen at the telegraph, never of real
// time and never of an event (AC 9), so the ring slows, freezes and stops with the game for free. The
// threat marker draws it (`threatMarkers.ts`), the silence bubble borrows its look (`silenceBubble.ts`),
// and story 9.3 (offscreen bubble) and 9.4 (chores) will reuse these helpers: nothing here knows the marker.

/** The ring is drawn in whole per-mille: 0 is the start, 1000 the end of the window. */
export const CHRONO_FULL_PERMILLE = 1000;

/**
 * Which responses carry a ring (AC 1, D1): one table typed on `ThreatResponse`, so that a new response
 * cannot compile without saying whether it has one. `dodge` (story 5.1) will be `true`. A `wait` is
 * `false` because showing its timing would hand the player the signal (the GDD's pillar 1), and a
 * `nothing` has no moment to hit.
 */
const HAS_CHRONO_RING: Readonly<Record<ThreatResponse, boolean>> = {
  parry: true,
  firm: true,
  wait: false,
  nothing: false,
};

/** The response names the table did not know, warned about once each (a content bug, not a per-frame cost). */
const warnedResponses = new Set<string>();

/**
 * True when a threat of this response draws a chrono-ring, whatever it stands on. Takes a plain string
 * because a marker def's `response` is one (a test double may name a response the schema cannot yet
 * hold, like `dodge`): a name the table does not know has no ring, and says so with a `warn`, once.
 */
export function hasChronoRing(response: string): boolean {
  const hasRing = (HAS_CHRONO_RING as Readonly<Record<string, boolean | undefined>>)[response];
  if (hasRing === undefined) {
    if (!warnedResponses.has(response)) {
      warnedResponses.add(response);
      log.warn('render', `the response ${response} is not in the chrono-ring table: no ring`);
    }
    return false;
  }
  return hasRing;
}

/** Forgets the responses already warned about: for the tests. */
export function resetChronoRingWarnings(): void {
  warnedResponses.clear();
}

/**
 * The instant the ring starts to fill (D3), in sim ms: the telegraph. `ThreatInstance` has no
 * `telegraphedAt` (and must not get one: a world field moves every golden). In `telegraph`,
 * `enteredAt` is exactly it. In `windowOpen`, `enteredAt` is the opening step, so the marker's memory
 * of the start it saw (valid only for the `windowOpenAt` it saw it with) is used, and failing that, the
 * opening minus the def's telegraph delay: exact for every def with a ring (`telegraphThreat` adds a
 * signal delay only to a `wait`, which has none).
 */
export function chronoRingStartAt(
  isTelegraph: boolean,
  enteredAt: number,
  windowOpenAt: number,
  rememberedStartAt: number,
  rememberedWindowOpenAt: number,
  telegraphDelayMs: number,
): number {
  if (isTelegraph) return enteredAt;
  if (rememberedWindowOpenAt === windowOpenAt && !Number.isNaN(rememberedStartAt)) {
    return rememberedStartAt;
  }
  return windowOpenAt - telegraphDelayMs;
}

/** The slice of a frozen `EffectiveWindow` the ring reads. */
export interface ChronoWindow {
  readonly windowMs: number;
  readonly perfectMs: number;
}

/**
 * One telegraph's ring, in sim ms and whole per-mille of its span (`startAt` → `closeAt`): where the
 * final arc starts, where the perfect notch sits and how wide the perfect zone is. Fixed for the whole
 * telegraph (the window is frozen, AC 5).
 */
export interface ChronoRing {
  /** The telegraph instant: the ring is empty here. */
  startAt: number;
  /** The end of the shown window, `windowOpenAt + windowMs`: the ring is full here. */
  closeAt: number;
  /** When the window opens, in sim ms: the final arc lights from here. */
  windowOpenAt: number;
  /** The final arc runs from here to 1000. */
  arcFromPermille: number;
  /** The perfect zone's centre. */
  notchPermille: number;
  /** The perfect zone, `± perfectMs / 2` around the centre (`judgePress`). */
  notchFromPermille: number;
  notchToPermille: number;
}

/** A fresh, empty ring: the value a marker holds before its first telegraph. */
export function createChronoRing(): ChronoRing {
  return {
    startAt: 0,
    closeAt: 0,
    windowOpenAt: 0,
    arcFromPermille: 0,
    notchPermille: 0,
    notchFromPermille: 0,
    notchToPermille: 0,
  };
}

function clampPermille(value: number): number {
  return Math.min(CHRONO_FULL_PERMILLE, Math.max(0, Math.round(value)));
}

/**
 * Fills `out` with the ring of a threat telegraphed at `startAt`, whose window opens at `windowOpenAt`
 * and is `window.windowMs` long as frozen at the telegraph (tier, fatigue and instinct already in it).
 * The hidden tolerance, the buffer and the input lag are not drawn (D2): the ring ends with the window.
 * Writes into `out` rather than allocating: a marker keeps one for its whole life.
 */
export function chronoRingOf(
  out: ChronoRing,
  startAt: number,
  windowOpenAt: number,
  window: ChronoWindow,
): ChronoRing {
  const closeAt = windowOpenAt + window.windowMs;
  // A degenerate span (no delay and no window) is one ms, so that nothing divides by zero.
  const spanMs = closeAt > startAt ? closeAt - startAt : 1;
  const permilleOf = (atMs: number): number =>
    clampPermille(((atMs - startAt) / spanMs) * CHRONO_FULL_PERMILLE);
  const centreAt = windowOpenAt + window.windowMs / 2;
  out.startAt = startAt;
  out.closeAt = closeAt;
  out.windowOpenAt = windowOpenAt;
  out.arcFromPermille = permilleOf(windowOpenAt);
  out.notchPermille = permilleOf(centreAt);
  out.notchFromPermille = permilleOf(centreAt - window.perfectMs / 2);
  out.notchToPermille = permilleOf(centreAt + window.perfectMs / 2);
  return out;
}

/**
 * How full the ring is at `simMs`, whole per-mille from 0 (the telegraph) to 1000 (the end of the
 * window), clamped on both sides: it stays full from the close until the threat leaves `telegraph` /
 * `windowOpen` (D2). The one function that draws the ring every frame and that the judged mirror reads
 * at the press instant (AC 15, D7).
 */
export function chronoProgressPermille(ring: Readonly<ChronoRing>, simMs: number): number {
  const spanMs = ring.closeAt > ring.startAt ? ring.closeAt - ring.startAt : 1;
  return clampPermille(((simMs - ring.startAt) / spanMs) * CHRONO_FULL_PERMILLE);
}

/**
 * How full the ring is while a Firmness is held (AC 11, D5): full at the press, empty at the end of the
 * attack (`holdEndAt`), whole per-mille, clamped.
 */
export function chronoDrainPermille(pressT: number, endAt: number, simMs: number): number {
  if (endAt <= pressT) return 0;
  return clampPermille(((endAt - simMs) / (endAt - pressT)) * CHRONO_FULL_PERMILLE);
}

/**
 * The debug mirror `data-pp-chrono-judged` of one judged press (AC 15, D7), `<t>:<threatId>:<press>:
 * <arcFrom>:<notchFrom>:<notchTo>`, all per-mille of the ring. The press instant is `windowOpenAt +
 * windowMs / 2 + offsetMs` (the centre of the window plus the press's offset, as `judgePress` measured it),
 * and its per-mille is `chronoProgressPermille`'s: the very function that draws the ring every frame, on the
 * geometry the marker holds. At speed 4 a drawn frame can miss a 100 ms notch by more than half of it, so
 * the e2e checks what the ring *would* draw at the press instant instead of reading a frame. `t` keeps two
 * identical judgements distinct.
 */
export function chronoJudgedMirror(
  t: number,
  threatId: number,
  ring: Readonly<ChronoRing>,
  windowMs: number,
  offsetMs: number,
): string {
  const pressAt = ring.windowOpenAt + windowMs / 2 + offsetMs;
  return [
    t,
    threatId,
    chronoProgressPermille(ring, pressAt),
    ring.arcFromPermille,
    ring.notchFromPermille,
    ring.notchToPermille,
  ].join(':');
}

/** The final arc is lit from the window's opening on, by the drawn sim time (not by a step count: `windowOpenAt` may sit off the step grid). */
export function isChronoArcLit(ring: Readonly<ChronoRing>, simMs: number): boolean {
  return simMs >= ring.windowOpenAt;
}

/** The progress strings the SVG takes, built once (no per-frame concatenation). */
export const CHRONO_PERMILLE_STRINGS: readonly string[] = Array.from(
  { length: CHRONO_FULL_PERMILLE + 1 },
  (_, permille) => String(permille),
);

/** The `stroke-dashoffset` of a ring path of `pathLength` 1000 that shows its first `permille` (the progress). */
export const CHRONO_DASH_OFFSET_STRINGS: readonly string[] = Array.from(
  { length: CHRONO_FULL_PERMILLE + 1 },
  (_, permille) => String(CHRONO_FULL_PERMILLE - permille),
);

// ---------------------------------------------------------------------------------------------
// Geometry in CSS px. Every radius is counted from the icon's centre; `half` is half the icon's size.
// ---------------------------------------------------------------------------------------------

/** What the hold-ring takes, counted from the icon's edge: its band and its ink outline. */
const HOLD_REACH_PX = HOLD_RING_STROKE_PX + HOLD_RING_OUTLINE_PX;
/** The chrono band starts a gap outside the hold-ring's outline (DESIGN: `gapFromHoldRing`). */
const BAND_FROM_PX = HOLD_REACH_PX + CHRONO_RING_GAP_PX;
const BAND_TO_PX = BAND_FROM_PX + HOLD_RING_STROKE_PX;
/** The lit arc grows outward from the band's inner edge, so it never reaches the hold-ring. */
const ARC_TO_PX = BAND_FROM_PX + CHRONO_RING_FINAL_ARC_STROKE_PX;
/** The outermost ink of the ring, counted from the icon's edge: the lit arc and its outline. */
export const CHRONO_RING_REACH_PX = ARC_TO_PX + HOLD_RING_OUTLINE_PX;
/** The target-highlight's ink, inside and outside its ring, and the ring's own thickness. */
const HIGHLIGHT_REACH_PX = TARGET_HIGHLIGHT_STROKE_PX + TARGET_HIGHLIGHT_OUTLINE_PX;

/** One circle of the ring, as the SVG draws it: a stroke of `strokePx` centred on `radiusPx`. */
export interface ChronoStroke {
  readonly radiusPx: number;
  readonly strokePx: number;
}

/** The ring's strokes at one icon size, from the icon's centre (D10). */
export interface ChronoRingRadii {
  /** The ink under the band: its outer half-stroke is the band's outer outline. */
  readonly outline: ChronoStroke;
  /** The ring-track, and the paper progress over it. */
  readonly band: ChronoStroke;
  /** The ink under the lit arc, wider than it by the outline on its outer side. */
  readonly arcOutline: ChronoStroke;
  /** The lit final arc. */
  readonly arc: ChronoStroke;
  /** The notch's two ends, across the arc: from the band's inner edge to the arc's outer edge. */
  readonly notchInnerPx: number;
  readonly notchOuterPx: number;
  readonly notchStrokePx: number;
}

function strokeBetween(fromPx: number, toPx: number): ChronoStroke {
  return { radiusPx: (fromPx + toPx) / 2, strokePx: toPx - fromPx };
}

/** The ring's strokes for an icon of `sizePx` (56 or 64 by surface). */
export function chronoRingRadii(sizePx: number): ChronoRingRadii {
  const half = sizePx / 2;
  return {
    outline: strokeBetween(half + BAND_FROM_PX, half + BAND_TO_PX + HOLD_RING_OUTLINE_PX),
    band: strokeBetween(half + BAND_FROM_PX, half + BAND_TO_PX),
    arcOutline: strokeBetween(half + BAND_FROM_PX, half + CHRONO_RING_REACH_PX),
    arc: strokeBetween(half + BAND_FROM_PX, half + ARC_TO_PX),
    notchInnerPx: half + BAND_FROM_PX,
    notchOuterPx: half + ARC_TO_PX,
    notchStrokePx: CHRONO_RING_NOTCH_PX,
  };
}

/**
 * What a marker takes around its icon, as radii from the icon's centre, for an icon of `sizePx` (D9):
 * the hold-ring, the chrono-ring, the target-highlight and where the verb stack's bottom edge sits. The
 * CSS computes the same from the same constants (`applyChronoRingMetrics`); this is the pinned copy
 * (`chronoRing.test.ts`: none of them overlap, at both surfaces).
 */
export interface ThreatFootprint {
  readonly holdOuterPx: number;
  readonly ringInnerPx: number;
  readonly ringOuterPx: number;
  readonly highlightInnerPx: number;
  readonly highlightOuterPx: number;
  readonly verbBottomPx: number;
}

export function threatFootprint(sizePx: number): ThreatFootprint {
  const half = sizePx / 2;
  // The highlight sits a gap outside the ring's outermost ink; its inner ink is `HIGHLIGHT_REACH_PX` thick.
  const highlightInnerPx = half + CHRONO_RING_REACH_PX + CHRONO_RING_GAP_PX;
  const highlightOuterPx = highlightInnerPx + HIGHLIGHT_REACH_PX + TARGET_HIGHLIGHT_OUTLINE_PX;
  return {
    holdOuterPx: half + HOLD_REACH_PX,
    ringInnerPx: half + BAND_FROM_PX,
    ringOuterPx: half + CHRONO_RING_REACH_PX,
    highlightInnerPx,
    highlightOuterPx,
    // The verb stack's bottom edge touches the highlight's outer edge, as it did before the ring.
    verbBottomPx: highlightOuterPx,
  };
}

/**
 * Writes the custom properties `ui.css` computes the highlight's reach and the verbs' gap from, so that
 * no pixel size of the ring lives in a CSS literal (`holdRingSpec.test.ts` pins the constants to
 * DESIGN.md). Written once on the page root, because the glyph chip reads `--pp-verb-gap` off it too.
 */
export function applyChronoRingMetrics(root: { readonly style: CSSStyleDeclaration }): void {
  root.style.setProperty('--pp-chrono-reach', `${CHRONO_RING_REACH_PX}px`);
  root.style.setProperty('--pp-chrono-gap', `${CHRONO_RING_GAP_PX}px`);
  root.style.setProperty('--pp-highlight-stroke', `${TARGET_HIGHLIGHT_STROKE_PX}px`);
  root.style.setProperty('--pp-highlight-outline', `${TARGET_HIGHLIGHT_OUTLINE_PX}px`);
}
