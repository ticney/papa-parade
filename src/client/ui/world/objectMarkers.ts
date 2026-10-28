import type { ObjectKind } from '@content/schemas/level';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { svgElement } from '../svg.ts';
import { THREAT_ICON_PATHS } from './threatMarkers.ts';

/** The part of an interactive object a marker needs: the sim's `SimObjectSpec`, as `Sim.objects` hands it over. */
export interface ObjectMarkerSpec {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
}

export interface ObjectMarkers {
  /** One marker per object that has a glyph, replacing the previous level's. */
  mount(objects: readonly ObjectMarkerSpec[]): void;
  /** Removes the markers of the current level. */
  unmount(): void;
  /**
   * Once per frame: `isUrgent` is the fatigue being above its threshold (the coffee is wanted):
   * the markers turn warm and their halo pulses. Writes the DOM only when it changes.
   */
  update(isUrgent: boolean): void;
  /** True while at least one marker is mounted: the layer must be rendered. */
  readonly isAnyVisible: boolean;
  dispose(): void;
}

/**
 * The glyph of each `ObjectKind` (24 × 24 view box), or null for an object that draws none yet.
 * A `Record`, so that a new kind is a type error until it is decided. The coffee machine draws the
 * mug of the threat glyphs; the phone gets its glyph with story 1.20 (it rings, so it shows then).
 * Provisional placeholders (E7 draws the final ones).
 */
export const OBJECT_ICON_PATHS: Readonly<Record<ObjectKind, string | null>> = {
  coffee_machine: THREAT_ICON_PATHS.mug,
  phone: null,
};

/** The classes the CSS styles (`ui.css` owns the look). */
export const OBJECT_CLASSES = {
  root: 'pp-object',
  halo: 'pp-object-halo',
  icon: 'pp-object-icon',
  urgent: 'pp-object-urgent',
} as const;

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

interface Marker {
  readonly object: CSS2DObject;
  readonly element: HTMLElement;
}

function createMarker(spec: ObjectMarkerSpec, path: string, doc: Doc): Marker {
  const element = doc.createElement('div');
  element.className = OBJECT_CLASSES.root;
  element.setAttribute('data-pp-object', spec.id);
  element.setAttribute('aria-hidden', 'true');
  const halo = doc.createElement('div');
  halo.className = OBJECT_CLASSES.halo;
  const icon = doc.createElement('div');
  icon.className = OBJECT_CLASSES.icon;
  icon.append(
    svgElement(
      'svg',
      { viewBox: '0 0 24 24' },
      [
        svgElement(
          'path',
          {
            d: path,
            fill: 'var(--pp-color-paper)',
            stroke: 'var(--pp-color-ink)',
            'stroke-width': '2',
            'stroke-linejoin': 'round',
          },
          [],
          doc,
        ),
      ],
      doc,
    ),
  );
  element.append(halo, icon);
  const object = new CSS2DObject(element);
  object.position.set(spec.xM, spec.yM, spec.zM);
  return { object, element };
}

/**
 * The icons of the interactive objects of a level, world-anchored in the `CSS2DRenderer` layer, at
 * the point the touch hit test aims at (`Sim.objects`): without them nothing says where the coffee
 * machine is. Always shown while the level is mounted; warm and pulsing while Papa is tired enough
 * for the coffee to matter. Allocates nothing per frame. `doc` makes the elements (the browser's
 * `document`; a double in tests).
 */
export function createObjectMarkers(scene: Scene, doc: Doc = document): ObjectMarkers {
  let markers: Marker[] = [];
  let isUrgent = false;

  const unmount = (): void => {
    for (const marker of markers) scene.remove(marker.object);
    markers = [];
    isUrgent = false;
  };

  return {
    mount(objects) {
      unmount();
      for (const spec of objects) {
        const path = OBJECT_ICON_PATHS[spec.kind];
        if (path === null) continue;
        const marker = createMarker(spec, path, doc);
        markers.push(marker);
        scene.add(marker.object);
      }
    },
    unmount,
    update(next) {
      if (next === isUrgent) return;
      isUrgent = next;
      for (const marker of markers) {
        marker.element.className = next
          ? `${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`
          : OBJECT_CLASSES.root;
      }
    },
    get isAnyVisible() {
      return markers.length > 0;
    },
    dispose: unmount,
  };
}
