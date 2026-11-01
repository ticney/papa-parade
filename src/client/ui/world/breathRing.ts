import { HOLD_RING_OUTLINE_PX, HOLD_RING_STROKE_PX } from '@shared/constants';
import type { StealthSlice } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';

/** Nothing shown: the ring is hidden. */
const HIDDEN = -1;

/** The progress in whole percent, as the strings the CSS variable takes (built once: no per-frame concatenation). */
const PROGRESS_PCT: readonly string[] = Array.from({ length: 101 }, (_, pct) => String(pct));

export interface BreathRing {
  /** True while the ring is drawn: the breath is held, or it is refilling. */
  readonly isVisible: boolean;
  /** The whole percent of breath left that is drawn (`--pp-hold-progress`), or -1 when hidden. */
  readonly progressPct: number;
  /**
   * Once per frame, before `worldUi.render`, from the stealth slice and Papa's drawn pose: the ring
   * around him shows the breath left, so it **empties while the breath is held** (the epic's gauge
   * « se vide ») and fills back while it is not. Hidden when the breath is full and not held, outside a
   * stealth step, and with no pose. The DOM is written only when the whole percent changes. Allocation-free.
   */
  update(
    stealth: Readonly<StealthSlice> | null,
    capacityMs: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
  ): void;
  /** Hides the ring and forgets what it showed (a restart). */
  hide(): void;
  dispose(): void;
}

/**
 * The `breath-ring` (story 4.9; DESIGN.md › breath-ring, UX-DR22): the hold-ring's visual around
 * Papa during the infiltration. Paper over `ring-track` (a conic fill, `--pp-hold-progress`, whole
 * percent), a 5 px band and the 2 px ink outline, **with the same constants as the hold-ring**
 * (`HOLD_RING_STROKE_PX`, `HOLD_RING_OUTLINE_PX`; `holdRingSpec.test.ts` pins both to DESIGN.md).
 * It is a `CSS2DObject` on Papa's drawn pose, `aria-hidden`, taking no pointer events. It has no
 * animation (the ring moves only as the breath does), so it needs no reduced-motion rule.
 */
export function createBreathRing(scene: Scene, doc: Pick<Document, 'createElement'>): BreathRing {
  const element = doc.createElement('div');
  element.className = 'pp-breath-ring';
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  // The outline is the band's size plus the outline on every side; the band is the stroke wide.
  element.style.setProperty('--pp-breath-stroke', `${HOLD_RING_STROKE_PX}px`);
  element.style.setProperty('--pp-breath-outline', `${HOLD_RING_OUTLINE_PX}px`);
  const outline = doc.createElement('div');
  outline.className = 'pp-breath-ring-outline';
  const band = doc.createElement('div');
  band.className = 'pp-breath-ring-band';
  element.append(outline, band);

  const object = new CSS2DObject(element);
  object.visible = false;
  object.position.set(0, PAPA_HEIGHT_M / 2, 0);
  scene.add(object);

  let shownPct = HIDDEN;

  const hide = (): void => {
    if (object.visible) {
      object.visible = false;
      element.style.display = 'none';
    }
    shownPct = HIDDEN;
  };

  return {
    get isVisible() {
      return object.visible;
    },
    get progressPct() {
      return shownPct;
    },
    update(stealth, capacityMs, papa) {
      if (stealth === null || !stealth.isRunning || papa === null || !(capacityMs > 0)) {
        hide();
        return;
      }
      const isHeld = stealth.breathHeldAt !== null;
      if (!isHeld && stealth.breathLeftMs >= capacityMs) {
        hide();
        return;
      }
      object.position.x = papa.xM;
      object.position.z = papa.zM;
      if (!object.visible) {
        object.visible = true;
        element.style.display = '';
      }
      const pct = Math.min(100, Math.max(0, Math.floor((stealth.breathLeftMs / capacityMs) * 100)));
      if (pct !== shownPct) {
        shownPct = pct;
        element.style.setProperty('--pp-hold-progress', PROGRESS_PCT[pct] as string);
      }
    },
    hide,
    dispose() {
      hide();
      scene.remove(object);
    },
  };
}
