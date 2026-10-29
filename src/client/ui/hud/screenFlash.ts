import { SCREEN_FLASH_MIN_INTERVAL_MS } from '@shared/constants';

type Doc = Pick<Document, 'createElement'>;

export interface ScreenFlashOptions {
  /** Real time, in ms (boot passes `performance.now`): the 3 Hz rule is measured on it. */
  nowReal(): number;
}

export interface ScreenFlash {
  /** The `div.pp-screen-flash`, created once, for the HUD root. */
  readonly element: HTMLElement;
  /**
   * Fades the screen from `peakOpacityPct` to nothing over `durationMs` real ms, restarting any fade
   * under way. With `isMotionReduced` it shows a border glow instead (same peak, same duration).
   * Returns false, and shows nothing, when the previous flash started less than
   * `SCREEN_FLASH_MIN_INTERVAL_MS` ago: nothing flashes faster than 3 Hz.
   */
  flash(peakOpacityPct: number, durationMs: number, isMotionReduced: boolean): boolean;
}

export const SCREEN_FLASH_CLASSES = {
  root: 'pp-screen-flash',
  glow: 'pp-screen-flash--glow',
} as const;

/**
 * The full-screen flash of a perfect response (story 2.4, pillar 3): the visual twin of the heavy
 * hit for a player with the sound off. A screen overlay on real time, not a world effect: the
 * perfect starts a hitstop then a slow-mo, which would freeze and stretch a sim-clocked flash. It
 * is an event, not a frame: the only allocation is the `Animation` of each flash.
 */
export function createScreenFlash(doc: Doc, options: ScreenFlashOptions): ScreenFlash {
  const element = doc.createElement('div');
  element.className = SCREEN_FLASH_CLASSES.root;
  element.setAttribute('aria-hidden', 'true');
  let running: Animation | null = null;
  let lastStartedAtReal = Number.NEGATIVE_INFINITY;

  return {
    element,
    flash(peakOpacityPct, durationMs, isMotionReduced) {
      const startedAtReal = options.nowReal();
      if (startedAtReal - lastStartedAtReal < SCREEN_FLASH_MIN_INTERVAL_MS) return false;
      lastStartedAtReal = startedAtReal;
      element.classList.toggle(SCREEN_FLASH_CLASSES.glow, isMotionReduced);
      running?.cancel();
      running = element.animate([{ opacity: peakOpacityPct / 100 }, { opacity: 0 }], {
        duration: durationMs,
        easing: 'ease-out',
      });
      return true;
    },
  };
}
