import {
  COMBO_BADGE_OFFSET_M,
  COMBO_BADGE_POP_MS,
  COMBO_BADGE_POP_SCALE_FROM,
} from '@shared/constants';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { formatString, type Translator } from '../strings.ts';

export interface ComboBadge {
  /** True while the badge is drawn: a multiplier above the minimum, or a cash-in showing its points. */
  readonly isVisible: boolean;
  /**
   * Once per frame, before `worldUi.render`: reads the combo and Papa's drawn pose. Visible iff
   * `multiplier > minMultiplier` (or while a cash-in shows its points), above Papa's head, moved
   * `aside` while a threat stands on Papa (its verb is in the same spot). The text and the classes
   * are written only when they change; a rise pops the badge unless motion is reduced.
   * `nowAtReal` is the real time of this frame, in ms.
   */
  update(
    multiplier: number,
    minMultiplier: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
    isAside: boolean,
    nowAtReal: number,
  ): void;
  /**
   * Shows « +N » (`points` rounded) for `holdMs` of real time from `nowAtReal`, even though the
   * multiplier is already back to its minimum. A new rise, or a new cash-in, replaces it.
   */
  showCashIn(points: number, holdMs: number, nowAtReal: number): void;
  /** Hides the badge and forgets the combo it showed (a restart). */
  hide(): void;
  dispose(): void;
}

export interface ComboBadgeOptions {
  /** `t(key)`: the badge writes `combo.multiplier` and `combo.cash_in`, filled in. */
  readonly translate: Translator;
  /** Reduced motion (story 2.10): no pop. Read when the badge pops, never per frame. */
  readonly isMotionReduced: () => boolean;
}

/** The two keyframes of the pop on a rise, built from the constants. */
export function comboBadgePopKeyframes(): Keyframe[] {
  return [{ transform: `scale(${COMBO_BADGE_POP_SCALE_FROM})` }, { transform: 'scale(1)' }];
}

const POP_KEYFRAMES = comboBadgePopKeyframes();

/**
 * The one pooled combo badge (UX-DR22, story 4.2), built like the tap marker: the outer element is
 * placed by the `CSS2DRenderer` (it writes its `transform`), the child holds the text and is the one
 * the Web Animations API pops. `doc` makes the elements (the browser's `document`; a double in
 * tests). The strings of each multiplier are made once, the first time it is shown, so that a frame
 * allocates nothing and writes nothing while nothing changes.
 */
export function createComboBadge(
  scene: Scene,
  doc: Pick<Document, 'createElement'>,
  { translate, isMotionReduced }: ComboBadgeOptions,
): ComboBadge {
  const element = doc.createElement('div');
  element.className = 'pp-combo-badge';
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  const text = doc.createElement('div');
  text.className = 'pp-combo-badge-text pp-type-combo';
  element.append(text);

  const object = new CSS2DObject(element);
  object.visible = false;
  object.position.set(0, PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M, 0);
  scene.add(object);

  const multiplierTexts: string[] = [];
  const multiplierTextOf = (multiplier: number): string => {
    let cached = multiplierTexts[multiplier];
    if (cached === undefined) {
      cached = formatString(translate('combo.multiplier'), { count: multiplier });
      multiplierTexts[multiplier] = cached;
    }
    return cached;
  };

  let shownText = '';
  let isAsideShown = false;
  let isCashInShown = false;
  let lastMultiplier = 0;
  let cashInUntilAtReal: number | null = null;
  let cashInText = '';
  let pop: Animation | null = null;

  const setText = (next: string): void => {
    if (next === shownText) return;
    shownText = next;
    text.textContent = next;
  };
  const setAside = (isAside: boolean): void => {
    if (isAside === isAsideShown) return;
    isAsideShown = isAside;
    element.classList.toggle('pp-combo-badge--aside', isAside);
  };
  const setCashIn = (isCashIn: boolean): void => {
    if (isCashIn === isCashInShown) return;
    isCashInShown = isCashIn;
    element.classList.toggle('pp-combo-badge--cash-in', isCashIn);
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
    update(multiplier, minMultiplier, papa, isAside, nowAtReal) {
      const isRise = multiplier > lastMultiplier && lastMultiplier >= minMultiplier;
      lastMultiplier = multiplier;
      if (cashInUntilAtReal !== null) {
        // A rise during the hold takes the badge back; so does the end of the hold.
        if (nowAtReal >= cashInUntilAtReal || multiplier > minMultiplier) {
          cashInUntilAtReal = null;
          setCashIn(false);
        }
      }
      if (cashInUntilAtReal !== null) {
        setText(cashInText);
        setVisible(true);
      } else if (multiplier > minMultiplier) {
        setText(multiplierTextOf(multiplier));
        setVisible(true);
        if (isRise && !isMotionReduced()) {
          pop?.cancel();
          pop = text.animate(POP_KEYFRAMES, { duration: COMBO_BADGE_POP_MS, easing: 'ease-out' });
        }
      } else {
        setVisible(false);
      }
      setAside(isAside);
      if (papa !== null && object.visible) {
        object.position.x = papa.xM;
        object.position.z = papa.zM;
      }
    },
    showCashIn(points, holdMs, nowAtReal) {
      cashInText = formatString(translate('combo.cash_in'), { points: Math.round(points) });
      cashInUntilAtReal = nowAtReal + holdMs;
      setCashIn(true);
      setText(cashInText);
      setVisible(true);
    },
    hide() {
      pop?.cancel();
      pop = null;
      cashInUntilAtReal = null;
      lastMultiplier = 0;
      setCashIn(false);
      setAside(false);
      setVisible(false);
    },
    dispose() {
      pop?.cancel();
      pop = null;
      object.visible = false;
      scene.remove(object);
    },
  };
}
