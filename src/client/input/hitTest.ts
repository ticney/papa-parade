import type { ThreatInstance } from '@sim';
import { type OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { ThreatMarkerEntry } from '../ui/world/threatMarkers.ts';

/** A point of the floor plane (y = 0), in metres. */
export interface FloorPoint {
  xM: number;
  zM: number;
}

/** The canvas box on screen, in CSS px. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What a press can aim at: the threats of the level and their icon points (`entries[i]` is the
 * icon of `threats[i]`, same order). Passed as they are, never copied.
 */
export interface ThreatTargets {
  threats: readonly Readonly<ThreatInstance>[];
  entries: readonly ThreatMarkerEntry[];
}

/**
 * An interactive object a touch can aim at: its id and the point its icon is drawn at (the anchor's
 * x and z, at the anchor's height). The sim hands them over (`Sim.objects`, story 1.19).
 */
export interface ObjectTarget {
  readonly id: string;
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
}

export interface HitTester {
  /**
   * Projects a screen point (normalised device coordinates, x right and y up, both in `[-1, 1]`)
   * onto the floor plane y = 0 and writes where it lands into `out`. False when the point is not a
   * finite number or the ray never meets the plane. The threats are tried before it, then the
   * baby (story 1.21), then the objects (threat > baby / object, the nearer > floor; Space and A reach
   * objects through `TapObject` too, since 1.17, and the baby through `TapBaby`).
   */
  pickFloor(ndcX: number, ndcY: number, out: FloorPoint): boolean;
  /**
   * The id of the pressable threat (`telegraph` or `windowOpen`) whose icon is nearest to the
   * pointer, within `radiusPx` CSS px of it (inclusive), or null. The icon point is projected with
   * the camera and compared in screen space; an icon outside the view frustum never counts.
   */
  pickThreat(
    clientX: number,
    clientY: number,
    rect: ScreenRect,
    targets: ThreatTargets,
    radiusPx: number,
  ): number | null;
  /**
   * How far the pointer is from the baby, in CSS px squared, when within `radiusPx` CSS px
   * (inclusive) of him: his centre, `yM` metres above the floor point (`baby.xM`, `baby.zM`),
   * projected like an icon. Null when he is out of range, outside the view frustum or the point is
   * not a finite number. The distance lets the caller weigh him against an object. Allocation-free.
   */
  pickBaby(
    clientX: number,
    clientY: number,
    rect: ScreenRect,
    baby: Readonly<{ xM: number; zM: number }>,
    yM: number,
    radiusPx: number,
  ): number | null;
  /**
   * The id of the object whose icon point is nearest to the pointer, within `radiusPx` CSS px of it
   * (inclusive), or null; ties go to the earlier object. Projected like a threat's icon, with the
   * object's own height. Allocation-free.
   */
  pickObject(
    clientX: number,
    clientY: number,
    rect: ScreenRect,
    objects: readonly ObjectTarget[],
    radiusPx: number,
  ): string | null;
}

/**
 * Hit testing against what the camera sees. The camera must have been placed (`fitIsoCamera`)
 * before the first pick. Preallocated: a pick allocates nothing.
 */
export function createHitTester(camera: OrthographicCamera): HitTester {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  const icon = new Vector3();
  return {
    pickThreat(clientX, clientY, rect, targets, radiusPx) {
      if (!(Number.isFinite(clientX) && Number.isFinite(clientY) && radiusPx >= 0)) return null;
      let nearestId: number | null = null;
      let nearestSq = radiusPx * radiusPx;
      const count = Math.min(targets.threats.length, targets.entries.length);
      for (let i = 0; i < count; i++) {
        const threat = targets.threats[i] as Readonly<ThreatInstance>;
        if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
        const entry = targets.entries[i] as ThreatMarkerEntry;
        if (entry.threatId !== threat.id) continue; // not the icon of this threat: never aim at it
        icon.set(entry.xM, entry.yM, entry.zM).project(camera);
        if (!(icon.z >= -1 && icon.z <= 1)) continue; // behind the camera, or past the far plane
        const dx = rect.left + ((icon.x + 1) / 2) * rect.width - clientX;
        const dy = rect.top + ((1 - icon.y) / 2) * rect.height - clientY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= nearestSq) {
          nearestSq = distanceSq;
          nearestId = threat.id;
        }
      }
      return nearestId;
    },
    pickObject(clientX, clientY, rect, objects, radiusPx) {
      if (!(Number.isFinite(clientX) && Number.isFinite(clientY) && radiusPx >= 0)) return null;
      let nearestId: string | null = null;
      let nearestSq = radiusPx * radiusPx;
      for (let i = 0; i < objects.length; i++) {
        const object = objects[i] as ObjectTarget;
        icon.set(object.xM, object.yM, object.zM).project(camera);
        if (!(icon.z >= -1 && icon.z <= 1)) continue;
        const dx = rect.left + ((icon.x + 1) / 2) * rect.width - clientX;
        const dy = rect.top + ((1 - icon.y) / 2) * rect.height - clientY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestSq || (nearestId === null && distanceSq <= nearestSq)) {
          nearestSq = distanceSq;
          nearestId = object.id;
        }
      }
      return nearestId;
    },
    pickBaby(clientX, clientY, rect, baby, yM, radiusPx) {
      if (!(Number.isFinite(clientX) && Number.isFinite(clientY) && radiusPx >= 0)) return null;
      icon.set(baby.xM, yM, baby.zM).project(camera);
      if (!(icon.z >= -1 && icon.z <= 1)) return null;
      const dx = rect.left + ((icon.x + 1) / 2) * rect.width - clientX;
      const dy = rect.top + ((1 - icon.y) / 2) * rect.height - clientY;
      const distanceSq = dx * dx + dy * dy;
      return distanceSq <= radiusPx * radiusPx ? distanceSq : null;
    },
    pickFloor(ndcX, ndcY, out) {
      if (!(Number.isFinite(ndcX) && Number.isFinite(ndcY))) return false;
      pointer.set(ndcX, ndcY);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(floor, hit) === null) return false;
      out.xM = hit.x;
      out.zM = hit.z;
      return true;
    },
  };
}
