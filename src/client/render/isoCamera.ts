import {
  ISO_CAMERA_DISTANCE_M,
  ISO_CAMERA_NEAR_M,
  ISO_FIT_MARGIN_PCT,
  ISO_PITCH_DEG,
  ISO_YAW_DEG,
} from '@shared/constants';
import { invariant } from '@shared/invariant';
import { OrthographicCamera, Vector3 } from 'three';

/**
 * Size of the room box. The footprint is centred on `(centerXM, centerZM)` (the origin when they
 * are left out); the box runs from `floorYM` (y = 0 when left out, lower when something such as a
 * stairwell goes below the floor) up by `heightM`.
 */
export interface RoomSize {
  readonly widthM: number;
  readonly depthM: number;
  /** From the bottom of the box (`floorYM`) to its top. */
  readonly heightM: number;
  /** The bottom of the box, in metres. Default: 0. */
  readonly floorYM?: number;
  readonly centerXM?: number;
  readonly centerZM?: number;
}

const centre = new Vector3();
const corner = new Vector3();

/**
 * Where a camera looks from, in degrees: `yawDeg` around the vertical (45 = the game camera, looking
 * from `+x +z`) and `pitchDeg` above the floor. Left out, {@link fitIsoCamera} uses the game camera's
 * (`ISO_YAW_DEG`, `ISO_PITCH_DEG`); the end photo (story 3.6) passes its own.
 */
export interface IsoView {
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

/** Pure maths on a `three` camera (no DOM, no WebGL): call {@link fitIsoCamera} to place it. */
export function createIsoCamera(): OrthographicCamera {
  return new OrthographicCamera(-1, 1, 1, -1, ISO_CAMERA_NEAR_M, ISO_CAMERA_DISTANCE_M * 2);
}

/**
 * Places `camera` on the isometric direction at `ISO_CAMERA_DISTANCE_M` from the room centre,
 * looking at it, and sizes its view so that the whole room box is visible at `aspect`
 * (width / height) with `ISO_FIT_MARGIN_PCT` of breathing room, as tight as that allows.
 *
 * The 8 corners of the box are projected into the camera's view space; their bounding rectangle
 * is grown by the margin, then widened on one axis to match the aspect. This is what keeps the
 * room visible at every aspect, portrait included. `view` moves the camera around the room (the
 * end photo's own angle, story 3.6); left out, the game camera is placed exactly as it always was.
 */
export function fitIsoCamera(
  camera: OrthographicCamera,
  room: RoomSize,
  aspect: number,
  view?: IsoView,
): void {
  invariant(
    Number.isFinite(aspect) && aspect > 0,
    `fitIsoCamera: aspect must be a finite number > 0 (${aspect})`,
  );
  for (const size of [room.widthM, room.depthM, room.heightM]) {
    invariant(
      Number.isFinite(size) && size > 0,
      `fitIsoCamera: room sizes must be finite numbers > 0 (${room.widthM} x ${room.depthM} x ${room.heightM})`,
    );
  }

  const yaw = ((view?.yawDeg ?? ISO_YAW_DEG) * Math.PI) / 180;
  const pitch = ((view?.pitchDeg ?? ISO_PITCH_DEG) * Math.PI) / 180;
  invariant(
    Number.isFinite(yaw) && Number.isFinite(pitch),
    `fitIsoCamera: the view must be finite (${view?.yawDeg}, ${view?.pitchDeg})`,
  );
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  invariant(
    Number.isFinite(centerX) && Number.isFinite(centerZ),
    `fitIsoCamera: the room centre must be finite (${centerX}, ${centerZ})`,
  );
  const floorY = room.floorYM ?? 0;
  invariant(Number.isFinite(floorY), `fitIsoCamera: the room floor must be finite (${floorY})`);
  centre.set(centerX, floorY + room.heightM / 2, centerZ);
  camera.position
    .set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw))
    .multiplyScalar(ISO_CAMERA_DISTANCE_M)
    .add(centre);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre);
  camera.near = ISO_CAMERA_NEAR_M;
  camera.far = ISO_CAMERA_DISTANCE_M + Math.hypot(room.widthM, room.depthM, room.heightM);
  camera.updateMatrixWorld(true); // refreshes matrixWorldInverse

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const x of [centerX - room.widthM / 2, centerX + room.widthM / 2]) {
    for (const y of [floorY, floorY + room.heightM]) {
      for (const z of [centerZ - room.depthM / 2, centerZ + room.depthM / 2]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y);
        maxY = Math.max(maxY, corner.y);
      }
    }
  }

  const grow = 1 + ISO_FIT_MARGIN_PCT / 100;
  let halfWidth = ((maxX - minX) / 2) * grow;
  let halfHeight = ((maxY - minY) / 2) * grow;
  if (halfWidth / halfHeight < aspect) halfWidth = halfHeight * aspect;
  else halfHeight = halfWidth / aspect;

  const middleX = (minX + maxX) / 2;
  const middleY = (minY + maxY) / 2;
  camera.left = middleX - halfWidth;
  camera.right = middleX + halfWidth;
  camera.top = middleY + halfHeight;
  camera.bottom = middleY - halfHeight;
  camera.updateProjectionMatrix();
}

/** The size of the follow camera's frame (`feel.camera`, story 9.2): a floor box of this size is fitted. */
export interface FollowFrameSize {
  readonly frameWidthM: number;
  readonly frameDepthM: number;
}

/**
 * The follow camera's framing (story 9.2): {@link fitIsoCamera} on a `frameWidthM × frameDepthM` box
 * of the room's height and floor, centred on the floor point `(centreXM, centreZM)`. The characters
 * are then drawn at the scale of a room of the frame's size, whatever the room's own size; moving
 * the centre is a translation of this fit (orthographic camera). The far plane is the larger of the
 * frame's and the room's, so a narrow aspect never clips the back of the room.
 */
export function fitFollowCamera(
  camera: OrthographicCamera,
  room: RoomSize,
  frame: FollowFrameSize,
  centreXM: number,
  centreZM: number,
  aspect: number,
): void {
  fitIsoCamera(
    camera,
    {
      widthM: frame.frameWidthM,
      depthM: frame.frameDepthM,
      heightM: room.heightM,
      floorYM: room.floorYM ?? 0,
      centerXM: centreXM,
      centerZM: centreZM,
    },
    aspect,
  );
  // The follow frame is smaller than the room; at a narrow aspect the view reaches deeper than it.
  const roomFarM = ISO_CAMERA_DISTANCE_M + Math.hypot(room.widthM, room.depthM, room.heightM);
  if (roomFarM > camera.far) {
    camera.far = roomFarM;
    camera.updateProjectionMatrix();
  }
}
