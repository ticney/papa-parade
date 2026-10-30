import { PAPA_HINT_OFFSET_M } from '@shared/constants';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import type { Translator } from '../strings.ts';

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
  /** Hides the hint and forgets the hold (a restart). */
  hide(): void;
  dispose(): void;
}

/**
 * The one pooled hint above Papa (story 4.3, AC 15), built like the tap marker and the combo
 * badge: one `CSS2DObject`, the `.pp-threat-verb` look, `aria-hidden`, no pointer events. The text
 * is `t('verb.put_down_first')`, written once here. It sits `PAPA_HINT_OFFSET_M` above his head,
 * higher than the combo badge, which is usually up in that spot when he carries the baby. `doc`
 * makes the elements (the browser's `document`; a double in tests).
 */
export function createPapaHint(
  scene: Scene,
  doc: Pick<Document, 'createElement'>,
  translate: Translator,
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
