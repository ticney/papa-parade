import type { TestHost } from '@client/app/testHost';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import type { Object3D } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
} from 'three';

/** The debug views the overlay can switch on; all off at the start, and again at each level. */
export const DEBUG_VIEWS = ['grid', 'path', 'colliders', 'anchors', 'zones', 'touchRadii'] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/** Raised a hair above the floor / drawn last, so a debug mark is not buried in the scene. */
const GRID_Y_M = 0.02;
const PATH_Y_M = 0.05;
const RENDER_ORDER = 999;
const GRID_COLOR = 0x33cc66;
const PATH_COLOR = 0xffd400;
const COLLIDER_COLOR = 0xff3355;
const ANCHOR_COLOR = 0x3399ff;
const ANCHOR_SIZE_PX = 8;
const ZONE_COLORS: Readonly<Record<string, number>> = {
  hidden: 0xaa44ff,
  safe: 0x00ccaa,
  creak: 0xff8800,
};
const ZONE_FALLBACK_COLOR = 0xffffff;

/** Two triangles per walkable cell of the geometry's grid, flat at height `y`: `[x, y, z, …]`. */
export function walkableCellTriangles(
  nav: LevelGeometry['nav'],
  cellM: number,
  y: number,
): number[] {
  const vertices: number[] = [];
  const [originX, originZ] = nav.originM;
  for (let row = 0; row < nav.rows.length; row++) {
    const line = nav.rows[row] as string;
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== '1') continue;
      const x0 = originX + col * cellM;
      const z0 = originZ + row * cellM;
      const x1 = x0 + cellM;
      const z1 = z0 + cellM;
      vertices.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
    }
  }
  return vertices;
}

/** The 12 edges of a box as line-segment endpoints: `[x, y, z, …]`, 24 points. */
export function boxEdgeSegments(
  centerM: readonly [number, number, number],
  halfExtentsM: readonly [number, number, number],
): number[] {
  const [cx, cy, cz] = centerM;
  const [hx, hy, hz] = halfExtentsM;
  const corner = (i: number): [number, number, number] => [
    cx + (i & 1 ? hx : -hx),
    cy + (i & 2 ? hy : -hy),
    cz + (i & 4 ? hz : -hz),
  ];
  const segments: number[] = [];
  // Two corners are joined when they differ in exactly one bit.
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      const b = a | bit;
      if (b === a) continue;
      segments.push(...corner(a), ...corner(b));
    }
  }
  return segments;
}

/**
 * Papa's path as line segments at `y`: from his position through the waypoints not yet reached
 * (`path` is the flat `[x, z, …]` of the world, `pathIndex` counts points).
 */
export function pathSegments(
  from: { xM: number; zM: number },
  path: readonly number[],
  pathIndex: number,
  y: number,
): number[] {
  const segments: number[] = [];
  let previousX = from.xM;
  let previousZ = from.zM;
  for (let i = pathIndex * 2; i + 1 < path.length; i += 2) {
    const x = path[i] as number;
    const z = path[i + 1] as number;
    segments.push(previousX, y, previousZ, x, y, z);
    previousX = x;
    previousZ = z;
  }
  return segments;
}

const lineGeometry = (positions: number[]): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
};

const lines = (positions: number[], color: number): LineSegments => {
  const material = new LineBasicMaterial({ color, depthTest: false, transparent: true });
  const object = new LineSegments(lineGeometry(positions), material);
  object.renderOrder = RENDER_ORDER;
  return object;
};

function disposeTree(object: Object3D): void {
  object.traverse((node) => {
    const drawable = node as Partial<Mesh>;
    drawable.geometry?.dispose();
    const material = drawable.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
}

export interface DebugViews {
  isOn(view: DebugView): boolean;
  setView(view: DebugView, isOn: boolean): void;
  /** The overlay is shown or hidden: hiding removes everything drawn (and the DOM layer), showing redraws what is on. */
  setShown(isShown: boolean): void;
  /** Redraws what moves (Papa’s path, the touch radii); called at the panel rate. */
  refresh(): void;
  /** The views drawn in the scene now (a debug aid: the overlay mirrors it for the e2e specs). */
  drawn(): DebugView[];
  dispose(): void;
}

/**
 * The debug views of the level: the navigation grid, Papa's path, the colliders, the anchors and
 * the zones (coloured by kind) in the 3D scene, inside the one debug group the host provides, and
 * each threat's touch radius (`feel.input.touchRadiusPx`, live) as a DOM circle around its icon
 * point. Everything is off by default, cleared at each level start, and removed when the overlay
 * hides. It only reads the sim and the geometry.
 */
export function createDebugViews(host: TestHost, doc: Document): DebugViews {
  const on: Record<DebugView, boolean> = {
    grid: false,
    path: false,
    colliders: false,
    anchors: false,
    zones: false,
    touchRadii: false,
  };
  /** What is built now, by view, so it can be removed. */
  const built: Partial<Record<DebugView, Object3D>> = {};
  let isShown = false;
  let group: Group | null = null;
  const radiusLayer = doc.createElement('div');
  radiusLayer.className = 'pp-debug-radii';
  radiusLayer.hidden = true;
  doc.body.append(radiusLayer);

  const remove = (view: DebugView): void => {
    const object = built[view];
    if (object === undefined) return;
    object.removeFromParent();
    disposeTree(object);
    delete built[view];
  };

  const build = (view: DebugView): Object3D | null => {
    const geometry = host.levelSession.active?.geometry;
    if (geometry === undefined) return null;
    switch (view) {
      case 'grid': {
        const positions = walkableCellTriangles(geometry.nav, geometry.cellM, GRID_Y_M);
        const mesh = new Mesh(
          lineGeometry(positions),
          new MeshBasicMaterial({
            color: GRID_COLOR,
            opacity: 0.25,
            transparent: true,
            depthTest: false,
            side: DoubleSide,
          }),
        );
        mesh.renderOrder = RENDER_ORDER;
        return mesh;
      }
      case 'colliders': {
        const positions = geometry.colliders.flatMap((c) =>
          boxEdgeSegments(c.centerM, c.halfExtentsM),
        );
        return lines(positions, COLLIDER_COLOR);
      }
      case 'zones': {
        const holder = new Group();
        const kinds = new Set(geometry.zones.map((zone) => zone.kind));
        for (const kind of kinds) {
          const positions = geometry.zones
            .filter((zone) => zone.kind === kind)
            .flatMap((zone) => boxEdgeSegments(zone.centerM, zone.halfExtentsM));
          holder.add(lines(positions, ZONE_COLORS[kind] ?? ZONE_FALLBACK_COLOR));
        }
        return holder;
      }
      case 'anchors': {
        const positions = geometry.anchors.flatMap((anchor) => [...anchor.positionM]);
        const points = new Points(
          lineGeometry(positions),
          new PointsMaterial({
            color: ANCHOR_COLOR,
            size: ANCHOR_SIZE_PX,
            sizeAttenuation: false,
            depthTest: false,
          }),
        );
        points.renderOrder = RENDER_ORDER;
        return points;
      }
      default:
        return null;
    }
  };

  /** Makes the scene and the layer match the switches and `isShown`. */
  const sync = (): void => {
    const target = isShown ? host.debugGroup() : null;
    if (target !== group) {
      for (const view of DEBUG_VIEWS) remove(view);
      group = target;
    }
    for (const view of DEBUG_VIEWS) {
      if (view === 'path' || view === 'touchRadii') continue;
      const wanted = isShown && on[view];
      if (!wanted) remove(view);
      else if (built[view] === undefined && group !== null) {
        const object = build(view);
        if (object !== null) {
          built[view] = object;
          group.add(object);
        }
      }
    }
    radiusLayer.hidden = !(isShown && on.touchRadii);
    if (!(isShown && on.path)) remove('path');
    refresh();
  };

  const refresh = (): void => {
    const world = host.levelSession.active?.sim.world;
    if (isShown && on.path && group !== null && world !== undefined) {
      remove('path');
      const segments = pathSegments(world.papa, world.papa.path, world.papa.pathIndex, PATH_Y_M);
      if (segments.length > 0) {
        const object = lines(segments, PATH_COLOR);
        built.path = object;
        group.add(object);
      }
    }
    if (isShown && on.touchRadii && world !== undefined) {
      const points = host.threatScreenPoints();
      const diameterPx = 2 * world.feel.input.touchRadiusPx;
      while (radiusLayer.children.length > points.length) radiusLayer.lastElementChild?.remove();
      while (radiusLayer.children.length < points.length) {
        const circle = doc.createElement('div');
        circle.className = 'pp-debug-radius';
        radiusLayer.append(circle);
      }
      points.forEach((point, index) => {
        const circle = radiusLayer.children[index] as HTMLElement;
        circle.style.width = `${diameterPx}px`;
        circle.style.height = `${diameterPx}px`;
        circle.style.left = `${point.xPx - diameterPx / 2}px`;
        circle.style.top = `${point.yPx - diameterPx / 2}px`;
        circle.dataset.threatId = String(point.threatId);
      });
    }
  };

  // A new level has a new scene and group: what was drawn is gone with the old scene.
  const offStarted = host.onLevelStarted(() => {
    for (const view of DEBUG_VIEWS) {
      const object = built[view];
      if (object !== undefined) disposeTree(object);
      delete built[view];
    }
    group = null;
    for (const view of DEBUG_VIEWS) on[view] = false;
    radiusLayer.replaceChildren();
    sync();
  });

  return {
    isOn: (view) => on[view],
    setView(view, isOn) {
      on[view] = isOn;
      sync();
    },
    setShown(next) {
      isShown = next;
      sync();
    },
    refresh,
    drawn: () => DEBUG_VIEWS.filter((view) => built[view] !== undefined),
    dispose() {
      offStarted();
      for (const view of DEBUG_VIEWS) remove(view);
      radiusLayer.remove();
    },
  };
}
