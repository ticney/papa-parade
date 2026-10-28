import type { World } from '@sim';
import type { Translator } from '../strings.ts';

type Doc = Pick<Document, 'createElement'>;

/** A point of the screen, in CSS px, written by {@link SilenceBubbleOptions.project}. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface SilenceBubbleOptions {
  t: Translator;
  /**
   * Projects a point of the room (metres) to the screen (CSS px of the viewport) into `out`; false
   * when it cannot be (no camera yet). Called when the bubble shows and on a resize, never per frame.
   */
  project(xM: number, yM: number, zM: number, out: ScreenPoint): boolean;
  /** The size of the HUD root, in CSS px. */
  viewport(): { width: number; height: number };
  /** The bottom of the HUD row, in CSS px from the top: the bubble stays below it. */
  hudBottomPx(): number;
}

export interface SilenceBubble {
  /** The `silence-bubble`, for the HUD root. Hidden until a silence starts. */
  readonly element: HTMLElement;
  /**
   * Once per frame: `isSilent` is whether a silence has started (`world.silence.startedAt` while the
   * level plays and runs; `world` is undefined outside a level, when `isSilent` is false). Writes the DOM only when it changes, and then places the bubble on the side of the
   * silent zone.
   */
  update(isSilent: boolean, world: Readonly<Pick<World, 'silence' | 'threats'>> | undefined): void;
  /** The viewport changed: places the bubble again if it is shown. */
  relayout(): void;
}

/** The height the bubble points at above the floor, in metres: the baby's centre. */
const BUBBLE_TARGET_HEIGHT_M = 0.25;
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

  const point: ScreenPoint = { x: 0, y: 0 };
  let isShown = false;
  let zoneXM = 0;
  let zoneZM = 0;
  let side: 'left' | 'right' | null = null;
  let topPx = Number.NaN;

  const place = (): void => {
    const { width, height } = options.viewport();
    if (!options.project(zoneXM, BUBBLE_TARGET_HEIGHT_M, zoneZM, point)) return;
    const nextSide = point.x < width / 2 ? 'left' : 'right';
    if (nextSide !== side) {
      side = nextSide;
      element.className = `${SILENCE_BUBBLE_CLASSES.root} ${
        nextSide === 'left' ? SILENCE_BUBBLE_CLASSES.left : SILENCE_BUBBLE_CLASSES.right
      }`;
    }
    const minTopPx = options.hudBottomPx() + BUBBLE_GAP_PX;
    const maxTopPx = Math.max(minTopPx, (height * BUBBLE_LOWEST_PCT) / 100 - BUBBLE_HEIGHT_PX);
    const nextTopPx = Math.round(
      Math.min(Math.max(point.y - BUBBLE_HEIGHT_PX / 2, minTopPx), maxTopPx),
    );
    if (nextTopPx !== topPx) {
      topPx = nextTopPx;
      element.style.top = `${nextTopPx}px`;
    }
  };

  return {
    element,
    update(isSilent, world) {
      if (isSilent === isShown) return;
      isShown = isSilent;
      if (isSilent && world !== undefined) {
        const threatId = world.silence.threatId;
        const threat = world.threats.find((candidate) => candidate.id === threatId);
        if (threat !== undefined) {
          zoneXM = threat.xM;
          zoneZM = threat.zM;
          place();
        }
      }
      element.hidden = !isSilent;
    },
    relayout() {
      if (isShown) place();
    },
  };
}
