import { CHORE_STATION_KINDS } from '@content/schemas/chore';
import type { ObjectKind } from '@content/schemas/level';
import type { ChoreInstance } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { svgElement } from '../svg.ts';
import {
  type ChronoRing,
  chronoProgressPermille,
  chronoRingOf,
  createChronoRing,
  isChronoArcLit,
} from './chronoRing.ts';
import {
  CHRONO_HIDDEN,
  type ChronoRingElement,
  createChronoRingElement,
} from './chronoRingElement.ts';
import { THREAT_ICON_PATHS } from './threatMarkers.ts';
import type { VerbMetrics } from './verbMetrics.ts';

/** An object's icon is this share of the threat icon (`.pp-object` in `ui.css`): the station's ring hangs from it. */
const OBJECT_SIZE_SHARE = 0.7;

/** The part of an interactive object a marker needs: the sim's `SimObjectSpec`, as `Sim.objects` hands it over. */
export interface ObjectMarkerSpec {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
}

export interface ObjectMarkers {
  /**
   * One marker per object that has a glyph, replacing the previous level's. `stationIds` are the object ids
   * of the level's chores (`Sim.chores`, index-aligned with `world.chores`): their markers carry the beat's
   * chrono-ring and a done look (story 9.4).
   */
  mount(objects: readonly ObjectMarkerSpec[], stationIds?: readonly string[]): void;
  /** Removes the markers of the current level. */
  unmount(): void;
  /**
   * Once per frame, one state per marker by its kind (story 4.3): `isCoffeeUrgent` is the fatigue
   * being above its threshold (the coffee is wanted), `isToiletUrgent` the need being at its warm
   * point (the door is wanted) and `isToiletOccupied` Papa being on the toilet. An urgent marker
   * turns warm and its halo pulses; an occupied door is dimmed, with no pulse. Writes the DOM only
   * when a marker's class changes.
   */
  update(isCoffeeUrgent: boolean, isToiletUrgent: boolean, isToiletOccupied: boolean): void;
  /**
   * Once per frame, in a level with chores (story 9.4): each station's marker shows the chrono-ring of its
   * chore's announced beat, from the world and the sim time as drawn only (frozen in pause and hitstop, slowed
   * in slow-mo), and its done look. Writes the DOM only on change; allocates nothing. Returns true when
   * some arc lit in this frame (the caller plays `ChronoArcLit`).
   */
  updateChores(chores: readonly Readonly<ChoreInstance>[], renderSimMs: number): boolean;
  /**
   * What the ring of the station of chore `choreIndex` drew in the last `updateChores`: its per-mille
   * (`CHRONO_HIDDEN` while not drawn) and whether the arc is lit; null for an unknown chore. Read by the
   * tests, never per frame by the game.
   */
  choreRingDrawOf(choreIndex: number): Readonly<{ permille: number; isLit: boolean }> | null;
  /** True while at least one marker is mounted: the layer must be rendered. */
  readonly isAnyVisible: boolean;
  dispose(): void;
}

/**
 * The glyph of each `ObjectKind` (24 × 24 view box), or null for an object that draws none yet.
 * A `Record`, so that a new kind is a type error until it is decided. The coffee machine draws the
 * mug of the threat glyphs; the phone gets its glyph with story 1.20 (it rings, so it shows then);
 * the toilet's is a plain door with a knob (story 4.3; the knob runs the other way round, so that the nonzero fill leaves it a hole). Provisional placeholders (E7 draws the final ones).
 */
export const OBJECT_ICON_PATHS: Readonly<Record<ObjectKind, string | null>> = {
  coffee_machine: THREAT_ICON_PATHS.mug,
  phone: null,
  toilet: 'M7 3h10v18H7z M13.6 11v2h1.8v-2z',
  // A saucepan on the stove (story 9.4): the pot, its handle and the lid's knob. Provisional, like the others.
  stove: 'M4 9.5h13V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z M17 11h4v2.4h-4z M8.5 5.5h4v2.5h-4z',
};

/** The classes the CSS styles (`ui.css` owns the look). */
export const OBJECT_CLASSES = {
  root: 'pp-object',
  halo: 'pp-object-halo',
  icon: 'pp-object-icon',
  urgent: 'pp-object-urgent',
  occupied: 'pp-object-occupied',
  /** A chore's station whose chore is done (story 9.4): dimmed, like a toilet in use, and inert. */
  done: 'pp-object-done',
} as const;

const CLASS_CALM = OBJECT_CLASSES.root;
const CLASS_URGENT = `${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`;
const CLASS_OCCUPIED = `${OBJECT_CLASSES.root} ${OBJECT_CLASSES.occupied}`;
const CLASS_DONE = `${OBJECT_CLASSES.root} ${OBJECT_CLASSES.done}`;

/** The object kinds that are a chore's station: their marker carries a ring. */
const STATION_KINDS: readonly ObjectKind[] = CHORE_STATION_KINDS;

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

interface Marker {
  readonly object: CSS2DObject;
  readonly element: HTMLElement;
  readonly kind: ObjectKind;
  /** The class last written, so that a frame writes the DOM only when it changes. */
  className: string;
  /** The index of its chore in `world.chores` (story 9.4), or -1 for an object that is no station. */
  readonly choreIndex: number;
  /** The beat's chrono-ring, for a station; null otherwise. */
  readonly chrono: ChronoRingElement | null;
  readonly ring: ChronoRing;
  /** The ring's geometry was written for this announcement (`ring.startAt` / `ring.windowOpenAt` say which). */
  isRingSet: boolean;
  chronoPermille: number;
  isChronoLit: boolean;
}

function createMarker(spec: ObjectMarkerSpec, path: string, choreIndex: number, doc: Doc): Marker {
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
  // The beat's ring of a chore's station (story 9.4), between the halo and the icon like a threat's.
  const chrono = choreIndex >= 0 ? createChronoRingElement(doc) : null;
  if (chrono === null) element.append(halo, icon);
  else element.append(halo, chrono.root, icon);
  const object = new CSS2DObject(element);
  object.position.set(spec.xM, spec.yM, spec.zM);
  return {
    object,
    element,
    kind: spec.kind,
    className: CLASS_CALM,
    choreIndex,
    chrono,
    ring: createChronoRing(),
    isRingSet: false,
    chronoPermille: CHRONO_HIDDEN,
    isChronoLit: false,
  };
}

/**
 * The icons of the interactive objects of a level, world-anchored in the `CSS2DRenderer` layer, at
 * the point the touch hit test aims at (`Sim.objects`): without them nothing says where the coffee
 * machine is. Always shown while the level is mounted; warm and pulsing while Papa is tired enough
 * for the coffee to matter (or needy enough for the door to), and the door dimmed while he is in
 * there. Allocates nothing per frame. `doc` makes the elements (the browser's
 * `document`; a double in tests).
 */
export function createObjectMarkers(
  scene: Scene,
  doc: Doc = document,
  getMetrics?: () => VerbMetrics,
): ObjectMarkers {
  let markers: Marker[] = [];
  /** Some marker is a station: its ring's radii hang from the icon's size, which changes with the surface. */
  let hasRings = false;
  let ringSurface = '';

  const fitRings = (): void => {
    if (!hasRings || getMetrics === undefined) return;
    const metrics = getMetrics();
    ringSurface = metrics.surfaceKey();
    const sizePx = metrics.threatSizePx() * OBJECT_SIZE_SHARE;
    for (const marker of markers) marker.chrono?.setSize(sizePx);
  };

  const unmount = (): void => {
    for (const marker of markers) scene.remove(marker.object);
    markers = [];
    hasRings = false;
    ringSurface = '';
  };

  /** The class a marker of `kind` wears for this frame's three states. */
  const classOf = (
    kind: ObjectKind,
    isCoffeeUrgent: boolean,
    isToiletUrgent: boolean,
    isToiletOccupied: boolean,
  ): string => {
    if (kind === 'coffee_machine') return isCoffeeUrgent ? CLASS_URGENT : CLASS_CALM;
    if (kind === 'toilet') {
      if (isToiletOccupied) return CLASS_OCCUPIED;
      return isToiletUrgent ? CLASS_URGENT : CLASS_CALM;
    }
    return CLASS_CALM;
  };

  return {
    mount(objects, stationIds = []) {
      unmount();
      for (const spec of objects) {
        const path = OBJECT_ICON_PATHS[spec.kind];
        if (path === null) continue;
        const choreIndex = STATION_KINDS.includes(spec.kind) ? stationIds.indexOf(spec.id) : -1;
        const marker = createMarker(spec, path, choreIndex, doc);
        markers.push(marker);
        scene.add(marker.object);
      }
      hasRings = markers.some((marker) => marker.chrono !== null);
      fitRings();
    },
    unmount,
    update(isCoffeeUrgent, isToiletUrgent, isToiletOccupied) {
      for (const marker of markers) {
        // A station's look is its chore's (`updateChores`).
        if (marker.choreIndex >= 0) continue;
        const next = classOf(marker.kind, isCoffeeUrgent, isToiletUrgent, isToiletOccupied);
        if (next === marker.className) continue;
        marker.className = next;
        marker.element.className = next;
      }
    },
    updateChores(chores, renderSimMs) {
      if (!hasRings) return false;
      if (getMetrics !== undefined && getMetrics().surfaceKey() !== ringSurface) fitRings();
      let hasLit = false;
      for (const marker of markers) {
        const chrono = marker.chrono;
        const chore = marker.choreIndex >= 0 ? chores[marker.choreIndex] : undefined;
        if (chrono === null || chore === undefined) continue;
        const next = chore.state === 'done' ? CLASS_DONE : CLASS_CALM;
        if (next !== marker.className) {
          marker.className = next;
          marker.element.className = next;
        }
        let permille = CHRONO_HIDDEN;
        let isLit = false;
        if (chore.state === 'working' && chore.beatState === 'telegraph') {
          const { ring } = marker;
          const closeAt = chore.beatWindowOpenAt + chore.responseWindow.windowMs;
          if (
            !marker.isRingSet ||
            ring.startAt !== chore.beatTelegraphAt ||
            ring.windowOpenAt !== chore.beatWindowOpenAt ||
            ring.closeAt !== closeAt
          ) {
            chronoRingOf(ring, chore.beatTelegraphAt, chore.beatWindowOpenAt, chore.responseWindow);
            marker.isRingSet = true;
            chrono.setGeometry(ring);
          }
          permille = chronoProgressPermille(ring, renderSimMs);
          isLit = isChronoArcLit(ring, renderSimMs);
        } else {
          marker.isRingSet = false;
        }
        if (isLit && !marker.isChronoLit) hasLit = true;
        marker.chronoPermille = permille;
        marker.isChronoLit = isLit;
        chrono.draw(permille, isLit, false);
      }
      return hasLit;
    },
    choreRingDrawOf(choreIndex) {
      const marker = markers.find((candidate) => candidate.choreIndex === choreIndex);
      if (marker === undefined) return null;
      return { permille: marker.chronoPermille, isLit: marker.isChronoLit };
    },
    get isAnyVisible() {
      return markers.length > 0;
    },
    dispose: unmount,
  };
}
