import { GAUGE_CHANGE_HOLD_MS } from '@shared/constants';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

/** Mama's four worry states (UX `catastrophe-face`): the expression, not the hue, carries the state. */
export type CatastropheFaceState = 'serene' | 'frowning' | 'worried' | 'alarmed';

/** Every state, calmest first: the tests walk it. */
export const CATASTROPHE_FACE_STATES = [
  'serene',
  'frowning',
  'worried',
  'alarmed',
] as const satisfies readonly CatastropheFaceState[];

/** Where the faces change, in % of the gauge: `feel.catastrophe.faceStepsPct` and `alertPct`. */
export interface CatastropheFaceThresholds {
  /** Frowning from the first, worried from the second. */
  readonly faceStepsPct: readonly number[];
  /** Alarmed strictly above this. */
  readonly alertPct: number;
}

export interface CatastropheFace {
  /** The round chip, for the timer: a paper disc with an ink outline holding the drawn face. */
  readonly element: HTMLElement;
  /** The state last drawn. */
  readonly state: CatastropheFaceState;
  /**
   * The gauge in % (0-100, not rounded: « alarmed » is strictly above `alertPct`). Called every
   * frame; the DOM is written only when the state or the idle dimming changes, and nothing is allocated.
   */
  setPercent(percent: number): void;
  /** The 36 px chip, while a sequence bar sits under the timer (UX-DR23); the DOM is written on a change only. */
  setCompact(isCompact: boolean): void;
  /** Once per frame: ends the « changing » hold. Allocation-free. */
  frame(nowAtReal: number): void;
}

export interface CatastropheFaceOptions {
  t: Translator;
  /** The thresholds, read live (`feel.catastrophe` can be retuned while the game runs); the same object each call. */
  thresholds(): CatastropheFaceThresholds;
  /** Real time now (ms): stamps the changes. */
  nowAtReal(): number;
}

/** Below this share, an idle face is dimmed (EXPERIENCE: « under 50 % and idle », like the gauges). */
const DIM_BELOW_PCT = 50;
/** A jump of at least this many points counts as a change, besides crossing a segment (the gauges' rule, D11). */
const JUMP_POINTS = 5;
/** A boundary is crossed every 10 points. */
const SEGMENT_POINTS = 10;

// Literal keys on purpose: the architecture test checks every key against the strings file.
const LABEL_KEYS: Readonly<Record<CatastropheFaceState, string>> = {
  serene: 'hud.catastrophe_serene',
  frowning: 'hud.catastrophe_frowning',
  worried: 'hud.catastrophe_worried',
  alarmed: 'hud.catastrophe_alarmed',
};

/**
 * The four faces as one path each (eyes, brows and mouth together, strokes in ink): the chip holds
 * one `svg` and one `path` whose `d` is swapped, so the face costs three nodes of the HUD's budget.
 * The 24 x 24 box is the chip's; round caps make the dots.
 */
const FACES: Readonly<Record<CatastropheFaceState, string>> = {
  // Two dots and a soft smile.
  serene: 'M8.5 10.5h.01M15.5 10.5h.01M8 15q4 3.6 8 0',
  // One brow lowered over the left eye, a flat mouth.
  frowning: 'M8.5 10.8h.01M15.5 10.8h.01M6.5 7.2l4 1.6M9 16.2h6',
  // Both brows raised in the middle, a wavy mouth.
  worried:
    'M8.5 11h.01M15.5 11h.01M6.2 8.6l4.2-2.2M17.8 8.6l-4.2-2.2M7.8 16.4q1.4-1.8 2.8 0t2.8 0t2.8 0',
  // Wide open eyes, brows high, an open mouth.
  alarmed:
    'M7.2 10.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M13.2 10.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M6.5 6.4l4-1.2M17.5 6.4l-4-1.2M10.2 16a1.8 2.4 0 1 0 3.6 0a1.8 2.4 0 1 0-3.6 0',
};

/**
 * The state a gauge value shows (pure): `serene` below the first face step, `frowning` from it,
 * `worried` from the second, `alarmed` strictly above `alertPct` (« above 70 % », the noise alert's rule).
 */
export function catastropheFaceStateOf(
  percent: number,
  thresholds: CatastropheFaceThresholds,
): CatastropheFaceState {
  if (percent > thresholds.alertPct) return 'alarmed';
  if (percent >= (thresholds.faceStepsPct[1] as number)) return 'worried';
  if (percent >= (thresholds.faceStepsPct[0] as number)) return 'frowning';
  return 'serene';
}

/**
 * Mama's face (UX `catastrophe-face`, UX-DR29, story 3.16): a round paper chip with an ink outline,
 * 44 px (36 px compact), attached to the timer. It shows how worried she is, never a number or the
 * score, and has the spoken name of its state (`role="img"`, `aria-label`). Above `alertPct` it
 * wears the alert ring (`pp-hud-catastrophe--alarmed`, a pulse under 3 Hz, slower under reduced
 * motion: CSS). Like a gauge it is dimmed (`pp-hud-catastrophe--idle`) below 50 % while it is not
 * changing; « changing » means it crossed a 10-point boundary or jumped by 5 points or more within
 * the last `GAUGE_CHANGE_HOLD_MS`. Class toggles and attribute writes happen only on a change.
 */
export function createCatastropheFace(doc: Doc, options: CatastropheFaceOptions): CatastropheFace {
  const { t, thresholds, nowAtReal } = options;
  const element = doc.createElement('div');
  element.className = 'pp-hud-catastrophe pp-hud-catastrophe--idle';
  element.setAttribute('role', 'img');
  const drawing = svgElement(
    'path',
    { class: 'pp-hud-catastrophe-line', d: FACES.serene },
    [],
    doc,
  );
  element.append(
    svgElement(
      'svg',
      { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
      [drawing],
      doc,
    ),
  );
  element.setAttribute('aria-label', t(LABEL_KEYS.serene));

  let state: CatastropheFaceState = 'serene';
  let wholePercent = 0;
  let isFirst = true;
  let isChanging = false;
  let changedAtReal = 0;
  let isIdle = true;
  let isCompact = false;

  const applyIdle = (percent: number): void => {
    const next = percent < DIM_BELOW_PCT && !isChanging;
    if (next === isIdle) return;
    isIdle = next;
    element.classList.toggle('pp-hud-catastrophe--idle', next);
  };

  return {
    element,
    get state() {
      return state;
    },
    setPercent(percent) {
      const next = catastropheFaceStateOf(percent, thresholds());
      if (next !== state) {
        state = next;
        drawing.setAttribute('d', FACES[next]);
        element.setAttribute('aria-label', t(LABEL_KEYS[next]));
        element.classList.toggle('pp-hud-catastrophe--alarmed', next === 'alarmed');
      }
      const whole = Math.round(percent);
      if (whole !== wholePercent || isFirst) {
        if (
          !isFirst &&
          (Math.floor(wholePercent / SEGMENT_POINTS) !== Math.floor(whole / SEGMENT_POINTS) ||
            Math.abs(whole - wholePercent) >= JUMP_POINTS)
        ) {
          isChanging = true;
          changedAtReal = nowAtReal();
        }
        wholePercent = whole;
        isFirst = false;
      }
      applyIdle(percent);
    },
    setCompact(next) {
      if (next === isCompact) return;
      isCompact = next;
      element.classList.toggle('pp-hud-catastrophe--compact', next);
    },
    frame(now) {
      if (!isChanging || now - changedAtReal < GAUGE_CHANGE_HOLD_MS) return;
      isChanging = false;
      applyIdle(wholePercent);
    },
  };
}
