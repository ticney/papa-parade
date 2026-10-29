import { EPIC_STAMP_MAX_MS } from '@shared/constants';

type Doc = Pick<Document, 'createElement'>;

export interface EpicStampOptions {
  /** What the stamp says (`t('stamp.perfect_parry')`); a later story shows another string (REPLAY). */
  text: string;
}

export interface EpicStamp {
  /** The `div.pp-epic-stamp`, created once, for the HUD root. */
  readonly element: HTMLElement;
  /**
   * Stamps the text over the scene for `min(durationMs, EPIC_STAMP_MAX_MS)` **real** ms, restarting
   * any stamp under way: a quick scale-in with a slight tilt, a hold, a fade out over the last
   * quarter. With `isMotionReduced` it is a plain fade (no scale, no tilt). Returns true: the stamp
   * is always shown (the cue's author decides how often).
   */
  show(durationMs: number, isMotionReduced: boolean): boolean;
}

export const EPIC_STAMP_CLASS = 'pp-epic-stamp';

/** The scale-in takes this share of the stamp's time. */
const STAMP_IN_SHARE = 0.15;
/** The fade out takes the last quarter. */
const STAMP_OUT_FROM = 0.75;
const RESTING_TILT_DEG = -2;
const STAMP_IN_SCALE = 1.35;
const STAMP_IN_TILT_DEG = -5;

const REST = `scale(1) rotate(${RESTING_TILT_DEG}deg)`;

/**
 * The « PARADE PARFAITE » stamp (UX-DR15): a screen overlay in the Epic register, like the flash
 * (story 2.4) on real time. The perfect starts a hitstop then a slow-mo, which would freeze and
 * stretch a sim-clocked stamp to several seconds. It never takes a tap or focus
 * (`pointer-events: none`, no `inert` on anything). An event, not a frame: the only allocation is
 * the `Animation` of each stamp.
 */
export function createEpicStamp(doc: Doc, options: EpicStampOptions): EpicStamp {
  const element = doc.createElement('div');
  element.className = `${EPIC_STAMP_CLASS} pp-type-epic pp-stroked`;
  element.textContent = options.text;
  element.setAttribute('aria-hidden', 'true');
  let running: Animation | null = null;

  return {
    element,
    show(durationMs, isMotionReduced) {
      running?.cancel();
      const keyframes: Keyframe[] = isMotionReduced
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: STAMP_IN_SHARE },
            { opacity: 1, offset: STAMP_OUT_FROM },
            { opacity: 0, offset: 1 },
          ]
        : [
            {
              opacity: 0,
              transform: `scale(${STAMP_IN_SCALE}) rotate(${STAMP_IN_TILT_DEG}deg)`,
              offset: 0,
            },
            { opacity: 1, transform: REST, offset: STAMP_IN_SHARE },
            { opacity: 1, transform: REST, offset: STAMP_OUT_FROM },
            { opacity: 0, transform: REST, offset: 1 },
          ];
      running = element.animate(keyframes, {
        duration: Math.min(durationMs, EPIC_STAMP_MAX_MS),
        easing: 'ease-out',
      });
      return true;
    },
  };
}
