import { VERB_STROKE_PX } from '@shared/constants';
import type { StealthSlice } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

/** A door seen from the front, with its knob (24 × 24 view box): the way out of the room. */
export const EXIT_DOOR_PATH =
  'M5.5 2.5h13v19h-13z M14.8 12.4m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0';

/** The marker floats this far above the floor at the exit anchor, in metres. */
const EXIT_MARKER_HEIGHT_M = 1.1;

export interface StealthExitMarker {
  /** True while the marker is drawn: a stealth step is running. */
  readonly isVisible: boolean;
  /**
   * Once per frame, before `worldUi.render`: shows « SORS ! » and a door at the exit of the running
   * stealth step (`exitXM`, `exitZM`), nothing otherwise. The point is written only when it changes.
   * Allocation-free.
   */
  update(stealth: Readonly<StealthSlice> | null): void;
  hide(): void;
  dispose(): void;
}

/**
 * The exit marker of a stealth step (story 4.9, AC 17): the verb `verb.exit` and a door glyph at the
 * exit anchor, so that the player knows where the infiltration goes. A `CSS2DObject`, `aria-hidden`,
 * **taking no pointer events**: a tap on it is a tap on the floor under it, a walk there (the marker
 * must never swallow the finger that walks). The boards have no marker on purpose: they are to be
 * memorised (GDD L307).
 */
export function createStealthExitMarker(
  scene: Scene,
  doc: Pick<Document, 'createElement' | 'createElementNS'>,
  t: Translator,
): StealthExitMarker {
  const element = doc.createElement('div');
  element.className = 'pp-exit-marker';
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  const verb = doc.createElement('span');
  // The verb look of the threats: paper letters with the ink outline of DESIGN's `verb-label`.
  verb.className = 'pp-threat-verb pp-exit-marker-verb';
  verb.textContent = t('verb.exit');
  verb.style.setProperty('-webkit-text-stroke', `${VERB_STROKE_PX * 2}px var(--pp-color-ink)`);
  const glyph = svgElement(
    'svg',
    { class: 'pp-exit-marker-glyph', viewBox: '0 0 24 24' },
    [
      svgElement(
        'path',
        {
          d: EXIT_DOOR_PATH,
          fill: 'var(--pp-color-paper)',
          stroke: 'var(--pp-color-ink)',
          'stroke-width': '2',
          'stroke-linejoin': 'round',
          'fill-rule': 'evenodd',
        },
        [],
        doc,
      ),
    ],
    doc,
  );
  element.append(verb, glyph);

  const object = new CSS2DObject(element);
  object.visible = false;
  scene.add(object);

  const hide = (): void => {
    if (!object.visible) return;
    object.visible = false;
    element.style.display = 'none';
  };

  return {
    get isVisible() {
      return object.visible;
    },
    update(stealth) {
      if (stealth === null || !stealth.isRunning) {
        hide();
        return;
      }
      if (object.position.x !== stealth.exitXM || object.position.z !== stealth.exitZM) {
        object.position.set(stealth.exitXM, EXIT_MARKER_HEIGHT_M, stealth.exitZM);
      }
      if (!object.visible) {
        object.visible = true;
        element.style.display = '';
      }
    },
    hide,
    dispose() {
      hide();
      scene.remove(object);
    },
  };
}
