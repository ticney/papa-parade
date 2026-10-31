import { PAPA_HINT_OFFSET_M, VERB_MAX_WIDTH_PCT, VERB_STROKE_PX } from '@shared/constants';
import { type Camera, type Scene, Vector3 } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import type { Translator } from '../strings.ts';
import { clampVerbShiftPx, fitVerbFontPx } from './verbLayout.ts';
import type { VerbMetrics } from './verbMetrics.ts';

export interface PapaHint {
  /** True from `show` until the hold is over. */
  readonly isVisible: boolean;
  /**
   * Shows « POSE-LE D'ABORD ! » above Papa for `holdMs` of real time from `nowAtReal`. A second call
   * restarts the hold: it never stacks. It is drawn by the next `worldUi.render`.
   */
  show(holdMs: number, nowAtReal: number): void;
  /**
   * Once per frame, before `worldUi.render`: follows Papa's drawn pose and ends the hold. With no pose
   * (a restart, a level not live) the hint hides at once. Allocation-free.
   */
  update(papa: Readonly<{ xM: number; zM: number }> | null, nowAtReal: number): void;
  /**
   * Fits the hint's font to `layerWidthPx` like a threat verb (`fitVerbFontPx`, `VERB_MAX_WIDTH_PCT`)
   * and measures its box. Runs when the layer is sized and when the verbs refit (« Grands verbes »,
   * the fonts). Without metrics the CSS size shows and the hint is not kept on screen.
   */
  refit(layerWidthPx: number): void;
  /**
   * Once per frame, before the DOM renderer: shifts the hint sideways, in whole px, so that its box
   * stays inside the layer when Papa is near an edge (story 2.10 review). Allocation-free.
   */
  layout(camera: Camera): void;
  /** Hides the hint and forgets the hold (a restart). */
  hide(): void;
  dispose(): void;
}

/**
 * The one pooled hint above Papa (story 4.3, AC 15), built like the tap marker and the combo
 * badge: one `CSS2DObject`, the `.pp-threat-verb` look, `aria-hidden`, no pointer events. The text
 * is `t('verb.put_down_first')`, written once here. It sits `PAPA_HINT_OFFSET_M` above his head,
 * higher than the combo badge, which is usually up in that spot when he carries the baby. `doc`
 * makes the elements (the browser's `document`; a double in tests). `getMetrics` reads the verb
 * typography for the fit (story 2.10 review: « Grands verbes » enlarges this text like any verb).
 */
export function createPapaHint(
  scene: Scene,
  doc: Pick<Document, 'createElement'>,
  translate: Translator,
  getMetrics?: () => VerbMetrics,
): PapaHint {
  const element = doc.createElement('div');
  element.className = 'pp-papa-hint pp-threat-verb';
  element.setAttribute('aria-hidden', 'true');
  element.textContent = translate('verb.put_down_first');
  element.style.display = 'none';

  const object = new CSS2DObject(element);
  object.visible = false;
  object.position.set(0, PAPA_HEIGHT_M + PAPA_HINT_OFFSET_M, 0);
  scene.add(object);

  let untilAtReal: number | null = null;
  const projected = new Vector3();
  let layerWidthPx = 0;
  /** The hint's box with its outline, in px; 0 until it is measured. */
  let boxWidthPx = 0;
  let fontPx = 0;
  /** The sideways shift as drawn, in whole px. */
  let shiftPx = 0;
  /** The layer or the typography changed since the last `measure`. */
  let isStale = true;

  /** Fits the font to the layer like a threat verb, and measures the box with its outline. */
  const measure = (): void => {
    isStale = false;
    if (getMetrics === undefined || layerWidthPx <= 0) return;
    const metrics = getMetrics();
    const basePx = metrics.basePx();
    const scale = metrics.scale();
    const scaledBasePx = basePx * scale;
    const advancePx = metrics.widthPx(element.textContent.toUpperCase(), scaledBasePx);
    const maxWidthPx = (layerWidthPx * VERB_MAX_WIDTH_PCT) / 100;
    // The outline adds `VERB_STROKE_PX` on each side and does not shrink with the font.
    const nextFontPx = fitVerbFontPx(advancePx, basePx, maxWidthPx - 2 * VERB_STROKE_PX, scale);
    if (nextFontPx !== fontPx) {
      fontPx = nextFontPx;
      element.style.fontSize = `${nextFontPx}px`;
    }
    boxWidthPx = (advancePx * nextFontPx) / scaledBasePx + 2 * VERB_STROKE_PX;
  };

  const setVisible = (isVisible: boolean): void => {
    if (isVisible === object.visible) return;
    object.visible = isVisible;
    element.style.display = isVisible ? '' : 'none';
  };

  return {
    get isVisible() {
      return object.visible;
    },
    show(holdMs, nowAtReal) {
      untilAtReal = nowAtReal + holdMs;
      setVisible(true);
      if (isStale) measure();
    },
    update(papa, nowAtReal) {
      if (untilAtReal === null) return;
      if (papa === null || nowAtReal >= untilAtReal) {
        untilAtReal = null;
        setVisible(false);
        return;
      }
      object.position.x = papa.xM;
      object.position.z = papa.zM;
    },
    refit(nextLayerWidthPx) {
      layerWidthPx = nextLayerWidthPx;
      // Measured when the hint is next shown, or at once if it is up: the page's typography is read
      // only for a hint that is really drawn.
      isStale = true;
      if (object.visible) measure();
    },
    layout(camera) {
      if (!object.visible || boxWidthPx <= 0 || layerWidthPx <= 0) return;
      camera.updateMatrixWorld();
      projected.copy(object.position).project(camera);
      const nextShiftPx = clampVerbShiftPx(
        (projected.x * 0.5 + 0.5) * layerWidthPx,
        boxWidthPx,
        layerWidthPx,
      );
      if (nextShiftPx === shiftPx) return;
      shiftPx = nextShiftPx;
      // The renderer owns `transform`, so the shift goes through the margin.
      element.style.marginLeft = nextShiftPx === 0 ? '' : `${nextShiftPx}px`;
    },
    hide() {
      untilAtReal = null;
      setVisible(false);
    },
    dispose() {
      untilAtReal = null;
      object.visible = false;
      scene.remove(object);
    },
  };
}
