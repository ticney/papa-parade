import { HOLD_RING_OUTLINE_PX, HOLD_RING_STROKE_PX } from '@shared/constants';
import { log } from '@shared/log';
import type { World } from '@sim';
import type { Translator } from '../strings.ts';
import {
  CHRONO_PERMILLE_STRINGS,
  chronoProgressPermille,
  createChronoRing,
} from '../world/chronoRing.ts';

type Doc = Pick<Document, 'createElement'>;

/** A point of the screen, in CSS px, written by {@link SilenceBubbleOptions.project}. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface SilenceBubbleOptions {
  t: Translator;
  /**
   * Projects a point of the room (metres) to the screen (CSS px from the top left of the HUD root) into `out`; false
   * when it cannot be (no camera yet). Called when the bubble shows and on a resize, never per frame.
   */
  project(xM: number, yM: number, zM: number, out: ScreenPoint): boolean;
  /** The size of the HUD root, in CSS px. `project` writes into the same box. */
  viewport(): { width: number; height: number };
  /** The height the bubble points at above the floor, in metres: the baby's centre. Tuning data (`feel.baby.bodyRadiusM`). */
  targetHeightM(): number;
  /** The bottom of the HUD row, in CSS px from the top: the bubble stays below it. */
  hudBottomPx(): number;
  /**
   * The `findMaxMs` of the threat def named `defId` (the silence's, story 1.21), or null for a def that has
   * none: the time the player has to find the baby, which the ring beside the bubble counts down in
   * (story 2.11). Called when the bubble shows, never per frame. With no answer the ring stays hidden.
   */
  findMaxMs?(defId: string): number | null;
}

export interface SilenceBubble {
  /** The `silence-bubble`, for the HUD root. Hidden until a silence starts. */
  readonly element: HTMLElement;
  /**
   * The ring beside the bubble (story 2.11, AC 12): a sibling of the bubble, not a child, so it does not
   * blink with it. The bubble itself mounts it right after the bubble's own element, in the same parent,
   * while the ring shows, and takes it away when it hides: it is 3 DOM nodes (the ring, its outline and
   * its band), which count against `HUD_MAX_DOM_NODES` only then.
   */
  readonly ring: HTMLElement;
  /**
   * Once per frame: `isSilent` is whether a silence has started (`world.silence.startedAt` while the
   * level plays and runs; `world` is undefined outside a level, when `isSilent` is false). Writes the DOM only when it changes, and then places the bubble on the side of the
   * silent zone. `renderSimMs` is the sim time as drawn (`world.time.sim − STEP_MS × (1 − alpha)`): the ring
   * beside the bubble fills from `world.silence.startedAt` to `startedAt + findMaxMs` over it, in game time
   * only, so it slows and freezes with the sim and stops in the pause (the bubble hides then). With
   * `renderSimMs` null the ring is not drawn.
   */
  update(
    isSilent: boolean,
    world: Readonly<Pick<World, 'silence' | 'threats'>> | undefined,
    renderSimMs?: number | null,
  ): void;
  /** The viewport changed: places the bubble again if it is shown. */
  relayout(): void;
}

/** The bubble's own height, in CSS px (the mockup's 58 px). */
const BUBBLE_HEIGHT_PX = 58;
/** The gap under the HUD row, in CSS px. */
const BUBBLE_GAP_PX = 8;
/** The lowest the bubble goes, as a share of the viewport height: the bottom third stays free. */
const BUBBLE_LOWEST_PCT = 66.6;

export const SILENCE_BUBBLE_CLASSES = {
  root: 'pp-silence-bubble',
  left: 'pp-silence-bubble-left',
  right: 'pp-silence-bubble-right',
} as const;

/** The classes of the ring beside the bubble (`ui.css`). It sits on the centre side of the bubble. */
export const SILENCE_RING_CLASSES = {
  root: 'pp-silence-ring',
  left: 'pp-silence-ring-left',
  right: 'pp-silence-ring-right',
  outline: 'pp-silence-ring-outline',
  band: 'pp-silence-ring-band',
} as const;

/** The ring's fill is not drawn. */
const RING_HIDDEN = -1;

/**
 * The « … » bubble of the suspicious silence (story 1.21, UX `silence-bubble`): screen-anchored and
 * non-diegetic, at the left or right edge on the side of the zone the baby hides in, at that
 * zone's height clamped under the HUD row and above the bottom third. The blink and the reduced
 * motion pulse are CSS (`ui.css`); nothing here animates. It takes no input.
 */
export function createSilenceBubble(doc: Doc, options: SilenceBubbleOptions): SilenceBubble {
  const element = doc.createElement('div');
  element.className = SILENCE_BUBBLE_CLASSES.root;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', options.t('hud.silence_bubble_label'));
  element.textContent = options.t('hud.silence_bubble');
  element.hidden = true;

  // The ring (story 2.11, D8): the chrono-ring's look, paper over `ring-track`, a 5 px band and a 2 px ink
  // outline, whose sizes are the hold-ring's constants. No lit arc, no notch (finding the baby has no
  // window, only a deadline) and no vibration (`SilenceStarted` already vibrates).
  const ring = doc.createElement('div');
  ring.className = SILENCE_RING_CLASSES.root;
  ring.setAttribute('aria-hidden', 'true');
  ring.hidden = true;
  ring.style.setProperty('--pp-silence-ring-stroke', `${HOLD_RING_STROKE_PX}px`);
  ring.style.setProperty('--pp-silence-ring-outline', `${HOLD_RING_OUTLINE_PX}px`);
  const ringOutline = doc.createElement('div');
  ringOutline.className = SILENCE_RING_CLASSES.outline;
  const ringBand = doc.createElement('div');
  ringBand.className = SILENCE_RING_CLASSES.band;
  ring.append(ringOutline, ringBand);
  /** The silence's span as a ring (`startAt` to `closeAt`), set when the bubble shows. */
  const span = createChronoRing();
  let hasSpan = false;
  let ringPermille = RING_HIDDEN;
  /** The drawn sim time of the last frame: a resize redraws the ring at it, never blank for a frame. */
  let lastRenderSimMs: number | null = null;

  const point: ScreenPoint = { x: 0, y: 0 };
  let isShown = false;
  let isPlaced = false;
  let hasZone = false;
  let zoneXM = 0;
  let zoneZM = 0;
  let side: 'left' | 'right' | null = null;
  let topPx = Number.NaN;

  const setSide = (nextSide: 'left' | 'right'): void => {
    if (nextSide === side) return;
    side = nextSide;
    element.className = `${SILENCE_BUBBLE_CLASSES.root} ${
      nextSide === 'left' ? SILENCE_BUBBLE_CLASSES.left : SILENCE_BUBBLE_CLASSES.right
    }`;
    ring.className = `${SILENCE_RING_CLASSES.root} ${
      nextSide === 'left' ? SILENCE_RING_CLASSES.left : SILENCE_RING_CLASSES.right
    }`;
  };
  const setTop = (nextTopPx: number): void => {
    if (nextTopPx === topPx) return;
    topPx = nextTopPx;
    element.style.top = `${nextTopPx}px`;
    ring.style.top = `${nextTopPx}px`;
  };

  // Puts the bubble on the side of the zone, at its height; false when the zone cannot be projected
  // yet (no camera), and the bubble stays hidden until it can.
  const place = (): boolean => {
    const { width, height } = options.viewport();
    const minTopPx = options.hudBottomPx() + BUBBLE_GAP_PX;
    if (!hasZone) {
      // The silence names no threat the HUD knows: never leave the player without the cue.
      setSide('right');
      setTop(minTopPx);
      return true;
    }
    if (!options.project(zoneXM, options.targetHeightM(), zoneZM, point)) return false;
    setSide(point.x < width / 2 ? 'left' : 'right');
    const maxTopPx = Math.max(minTopPx, (height * BUBBLE_LOWEST_PCT) / 100 - BUBBLE_HEIGHT_PX);
    setTop(Math.round(Math.min(Math.max(point.y - BUBBLE_HEIGHT_PX / 2, minTopPx), maxTopPx)));
    return true;
  };

  // The ring is visible with the bubble, from the first drawn frame, and only while it has something to count.
  const drawRing = (renderSimMs: number | null): void => {
    const isVisible = isShown && isPlaced && hasSpan && renderSimMs !== null;
    const permille = isVisible ? chronoProgressPermille(span, renderSimMs) : RING_HIDDEN;
    if (permille === ringPermille) return;
    if (permille === RING_HIDDEN) {
      ring.hidden = true;
      ring.remove();
    } else {
      if (ringPermille === RING_HIDDEN) {
        ring.hidden = false;
        // Mounted beside the bubble only while it shows: hidden, it would cost 3 of the HUD's nodes.
        if (element.parentNode !== null) element.after(ring);
      }
      ring.style.setProperty('--pp-silence-progress', CHRONO_PERMILLE_STRINGS[permille] as string);
    }
    ringPermille = permille;
  };

  return {
    element,
    ring,
    update(isSilent, world, renderSimMs = null) {
      if (isSilent !== isShown) {
        isShown = isSilent;
        isPlaced = false;
        hasZone = false;
        hasSpan = false;
        if (isSilent && world !== undefined) {
          const threatId = world.silence.threatId;
          const threat = world.threats.find((candidate) => candidate.id === threatId);
          if (threat !== undefined) {
            hasZone = true;
            zoneXM = threat.xM;
            zoneZM = threat.zM;
            // The ring runs from the instant `SilenceStarted` was emitted to the one `runSilence` times out on.
            const startedAt = world.silence.startedAt;
            const findMaxMs = options.findMaxMs?.(threat.defId) ?? null;
            if (startedAt !== null && findMaxMs !== null && findMaxMs > 0) {
              hasSpan = true;
              span.startAt = startedAt;
              span.closeAt = startedAt + findMaxMs;
            } else {
              log.warn('feedback', 'the silence has no find deadline: its ring stays hidden', {
                defId: threat.defId,
                startedAt,
                findMaxMs,
              });
            }
          }
        }
      }
      if (isShown && !isPlaced) isPlaced = place();
      element.hidden = !(isShown && isPlaced);
      lastRenderSimMs = renderSimMs;
      drawRing(renderSimMs);
    },
    relayout() {
      if (isShown) isPlaced = place();
      element.hidden = !(isShown && isPlaced);
      drawRing(lastRenderSimMs);
    },
  };
}
