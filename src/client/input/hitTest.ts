import { type OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

/** A point of the floor plane (y = 0), in metres. */
export interface FloorPoint {
  xM: number;
  zM: number;
}

export interface HitTester {
  /**
   * Projects a screen point (normalised device coordinates, x right and y up, both in `[-1, 1]`)
   * onto the floor plane y = 0 and writes where it lands into `out`. False when the point is not a
   * finite number or the ray never meets the plane. Today the floor is the only thing that can be
   * hit; the threats, the baby and the objects will be tried before it (threat > baby > object >
   * floor, stories 1.11 and 1.17).
   */
  pickFloor(ndcX: number, ndcY: number, out: FloorPoint): boolean;
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
  return {
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
