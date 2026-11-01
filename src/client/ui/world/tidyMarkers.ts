import { VERB_STROKE_PX } from '@shared/constants';
import type { World } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Translator } from '../strings.ts';

/** A tidy marker floats this far above the prop's centre, in metres. */
export const TIDY_MARKER_HEIGHT_M = 0.35;

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

export interface TidyMarkers {
  /** One marker per prop of the level (`world.props` order), replacing the previous level's; all hidden. */
  mount(propCount: number): void;
  /** Removes the markers of the current level. */
  unmount(): void;
  /**
   * Once per frame, before `worldUi.render`: shows « RANGE ! » above each prop that is a mess while
   * the flow is `finalRush`, and hides it as soon as the prop is tidied (or broken), and in `photo`.
   * The marker follows the prop while it still slides. Reads the world's state, never the events,
   * and writes the DOM only when a marker appears or goes. Allocation-free.
   */
  update(world: Readonly<World>): void;
  /** True while at least one marker is drawn: the layer must be rendered. */
  readonly isAnyVisible: boolean;
  dispose(): void;
}

interface Marker {
  readonly object: CSS2DObject;
  readonly element: HTMLElement;
}

/**
 * The tidy markers of the final rush (story 3.5, AC 16): the verb `verb.tidy` over every prop that
 * is a mess, in the look of the threats' verbs (paper letters, ink outline). `CSS2DObject`s,
 * `aria-hidden` and **taking no pointer events**: a tap near one is the hit test's (the prop is a
 * target at `objectTouchRadiusPx`), and the marker must never swallow the finger. The text is the
 * same for every marker and every frame, so it is written once, when the marker is made.
 */
export function createTidyMarkers(scene: Scene, doc: Doc, t: Translator): TidyMarkers {
  let markers: Marker[] = [];
  let visibleCount = 0;

  const unmount = (): void => {
    for (const marker of markers) scene.remove(marker.object);
    markers = [];
    visibleCount = 0;
  };

  const create = (): Marker => {
    const element = doc.createElement('div');
    element.className = 'pp-tidy-marker';
    element.setAttribute('aria-hidden', 'true');
    element.style.display = 'none';
    const verb = doc.createElement('span');
    verb.className = 'pp-threat-verb pp-tidy-marker-verb';
    verb.textContent = t('verb.tidy');
    verb.style.setProperty('-webkit-text-stroke', `${VERB_STROKE_PX * 2}px var(--pp-color-ink)`);
    element.append(verb);
    const object = new CSS2DObject(element);
    object.visible = false;
    scene.add(object);
    return { object, element };
  };

  return {
    mount(propCount) {
      unmount();
      for (let i = 0; i < propCount; i++) markers.push(create());
    },
    unmount,
    update(world) {
      const isRush = world.flow.state === 'finalRush';
      let shown = 0;
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i] as Marker;
        const prop = isRush ? world.props[i] : undefined;
        if (prop === undefined || !prop.isMess) {
          if (marker.object.visible) {
            marker.object.visible = false;
            marker.element.style.display = 'none';
          }
          continue;
        }
        shown++;
        const yM = prop.yM + TIDY_MARKER_HEIGHT_M;
        const { position } = marker.object;
        if (position.x !== prop.xM || position.y !== yM || position.z !== prop.zM) {
          position.set(prop.xM, yM, prop.zM);
        }
        if (!marker.object.visible) {
          marker.object.visible = true;
          marker.element.style.display = '';
        }
      }
      visibleCount = shown;
    },
    get isAnyVisible() {
      return visibleCount > 0;
    },
    dispose: unmount,
  };
}
