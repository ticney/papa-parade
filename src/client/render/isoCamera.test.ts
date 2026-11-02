import {
  ISO_CAMERA_DISTANCE_M,
  ISO_FIT_MARGIN_PCT,
  ISO_PITCH_DEG,
  ISO_YAW_DEG,
} from '@shared/constants';
import { type OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './isoCamera.ts';

const ROOM: RoomSize = { widthM: 8, depthM: 6, heightM: 2.5 };
// The real living room: off-centre because its stairs stick out of the +x edge.
const OFF_CENTRE_ROOM: RoomSize = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 2.5,
  centerXM: 0.35,
  centerZM: -0.1,
};
const BIG_ROOM: RoomSize = { widthM: 14, depthM: 5, heightM: 3.2 };
// Stairs going down: the box starts 0.8 m below the floor (y = 0).
const SUNKEN_ROOM: RoomSize = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};

// Square, 4:3, 16:9, a landscape phone, ultra-wide, and a portrait phone.
const ASPECTS = [1, 4 / 3, 16 / 9, 844 / 390, 21 / 9, 0.46];
const MARGIN = ISO_FIT_MARGIN_PCT / 100;
const EPSILON = 1e-9;

/** The 8 corners of the room box: footprint centred on `centerXM`/`centerZM`, from `floorYM`. */
function cornersOf(room: RoomSize): Vector3[] {
  const corners: Vector3[] = [];
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  const floorY = room.floorYM ?? 0;
  for (const x of [centerX - room.widthM / 2, centerX + room.widthM / 2]) {
    for (const y of [floorY, floorY + room.heightM]) {
      for (const z of [centerZ - room.depthM / 2, centerZ + room.depthM / 2])
        corners.push(new Vector3(x, y, z));
    }
  }
  return corners;
}

function fitted(room: RoomSize, aspect: number): OrthographicCamera {
  const camera = createIsoCamera();
  fitIsoCamera(camera, room, aspect);
  return camera;
}

function ndcOf(camera: OrthographicCamera, point: Vector3): Vector3 {
  return point.clone().project(camera);
}

const degrees = (radians: number): number => (radians * 180) / Math.PI;

describe('fitIsoCamera', () => {
  describe.each([ROOM, BIG_ROOM, OFF_CENTRE_ROOM, SUNKEN_ROOM])(
    'room $widthM × $depthM × $heightM m',
    (room) => {
      it.each(ASPECTS)('keeps the whole room inside the view at aspect %f', (aspect) => {
        const camera = fitted(room, aspect);
        for (const corner of cornersOf(room)) {
          const ndc = ndcOf(camera, corner);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + EPSILON);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + EPSILON);
          // And between the near and far planes.
          expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
        }
      });

      it.each(ASPECTS)('is tight at aspect %f: the room is not needlessly small', (aspect) => {
        const camera = fitted(room, aspect);
        let largestX = 0;
        let largestY = 0;
        for (const corner of cornersOf(room)) {
          const ndc = ndcOf(camera, corner);
          largestX = Math.max(largestX, Math.abs(ndc.x));
          largestY = Math.max(largestY, Math.abs(ndc.y));
        }
        const target = 1 - MARGIN;
        const tightest = Math.max(largestX, largestY);
        expect(Math.abs(tightest - target)).toBeLessThanOrEqual(0.01 * target);
      });

      it.each(ASPECTS)('has a frustum of aspect %f', (aspect) => {
        const camera = fitted(room, aspect);
        expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(aspect, 9);
      });

      it('looks at the room centre, which projects to the middle of the screen', () => {
        const camera = fitted(room, 16 / 9);
        const centre = new Vector3(
          room.centerXM ?? 0,
          (room.floorYM ?? 0) + room.heightM / 2,
          room.centerZM ?? 0,
        );
        const toCentre = centre.clone().sub(camera.position).normalize();
        expect(camera.getWorldDirection(new Vector3()).dot(toCentre)).toBeCloseTo(1, 9);
        const ndc = ndcOf(camera, centre);
        expect(ndc.x).toBeCloseTo(0, 9);
        expect(ndc.y).toBeCloseTo(0, 9);
      });
    },
  );

  it('puts the camera on the isometric direction at ISO_CAMERA_DISTANCE_M from the room centre', () => {
    const camera = fitted(ROOM, 16 / 9);
    const fromCentre = camera.position.clone().sub(new Vector3(0, ROOM.heightM / 2, 0));
    expect(fromCentre.length()).toBeCloseTo(ISO_CAMERA_DISTANCE_M, 9);
    expect(degrees(Math.asin(fromCentre.y / fromCentre.length()))).toBeCloseTo(ISO_PITCH_DEG, 6);
    expect(degrees(Math.atan2(fromCentre.x, fromCentre.z))).toBeCloseTo(ISO_YAW_DEG, 6);
  });

  it('gives the same view when fitted twice at the same aspect, and a new one at another', () => {
    const camera = createIsoCamera();
    fitIsoCamera(camera, ROOM, 16 / 9);
    const first = {
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
    };
    fitIsoCamera(camera, ROOM, 16 / 9);
    expect({
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
    }).toEqual(first);
    fitIsoCamera(camera, ROOM, 0.46);
    expect(camera.right - camera.left).not.toBeCloseTo(first.right - first.left, 3);
  });

  it.each([
    ['zero', 0],
    ['negative', -1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('throws on an aspect that is %s', (_name, aspect) => {
    expect(() => fitIsoCamera(createIsoCamera(), ROOM, aspect)).toThrow(/aspect/i);
  });

  it('throws on a room centre that is not finite', () => {
    expect(() =>
      fitIsoCamera(createIsoCamera(), { ...ROOM, centerXM: Number.NaN }, 16 / 9),
    ).toThrow(/centre/i);
  });

  it('ignores the centre when it is left out (the origin)', () => {
    const plain = fitted(ROOM, 16 / 9);
    const explicit = fitted({ ...ROOM, centerXM: 0, centerZM: 0 }, 16 / 9);
    expect(explicit.position.toArray()).toEqual(plain.position.toArray());
    expect([explicit.left, explicit.right]).toEqual([plain.left, plain.right]);
  });

  it.each([
    ['a zero width', { ...ROOM, widthM: 0 }],
    ['a negative depth', { ...ROOM, depthM: -2 }],
    ['a NaN height', { ...ROOM, heightM: Number.NaN }],
  ])('throws on a room with %s', (_name, room) => {
    expect(() => fitIsoCamera(createIsoCamera(), room, 16 / 9)).toThrow(/room/i);
  });
});

describe('fitIsoCamera with a view (the end photo, story 3.6)', () => {
  /** Everything fitIsoCamera writes that a game camera test would notice. */
  const stateOf = (camera: OrthographicCamera) => ({
    position: camera.position.toArray(),
    left: camera.left,
    right: camera.right,
    top: camera.top,
    bottom: camera.bottom,
    near: camera.near,
    far: camera.far,
    projection: camera.projectionMatrix.toArray(),
    view: camera.matrixWorldInverse.toArray(),
  });

  it('leaves the game camera exactly as it was when the view is left out', () => {
    const plain = fitted(OFF_CENTRE_ROOM, 844 / 390);
    const withDefaults = createIsoCamera();
    fitIsoCamera(withDefaults, OFF_CENTRE_ROOM, 844 / 390, {
      yawDeg: ISO_YAW_DEG,
      pitchDeg: ISO_PITCH_DEG,
    });
    // Bit for bit: the view's defaults are the constants the game camera always used.
    expect(stateOf(withDefaults)).toEqual(stateOf(plain));
  });

  it('places the camera at the yaw and the pitch it is given', () => {
    const camera = createIsoCamera();
    fitIsoCamera(camera, ROOM, 16 / 9, { yawDeg: 38, pitchDeg: 30 });
    const fromCentre = camera.position.clone().sub(new Vector3(0, ROOM.heightM / 2, 0));
    expect(fromCentre.length()).toBeCloseTo(ISO_CAMERA_DISTANCE_M, 9);
    expect(degrees(Math.asin(fromCentre.y / fromCentre.length()))).toBeCloseTo(30, 6);
    expect(degrees(Math.atan2(fromCentre.x, fromCentre.z))).toBeCloseTo(38, 6);
  });

  it.each([
    [15, 20],
    [38, 30],
    [75, 60],
  ])('keeps the whole room in view at a yaw of %f and a pitch of %f', (yawDeg, pitchDeg) => {
    for (const room of [ROOM, OFF_CENTRE_ROOM, SUNKEN_ROOM]) {
      for (const aspect of [1, 4 / 3, 844 / 390]) {
        const camera = createIsoCamera();
        fitIsoCamera(camera, room, aspect, { yawDeg, pitchDeg });
        for (const corner of cornersOf(room)) {
          const ndc = ndcOf(camera, corner);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + EPSILON);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + EPSILON);
          expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
        }
        expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(aspect, 9);
      }
    }
  });

  it('really moves the camera: another view gives another picture', () => {
    const game = fitted(ROOM, 4 / 3);
    const photo = createIsoCamera();
    fitIsoCamera(photo, ROOM, 4 / 3, { yawDeg: 38, pitchDeg: 30 });
    expect(photo.position.toArray()).not.toEqual(game.position.toArray());
    expect(photo.projectionMatrix.toArray()).not.toEqual(game.projectionMatrix.toArray());
  });

  it('throws on a view that is not finite', () => {
    expect(() =>
      fitIsoCamera(createIsoCamera(), ROOM, 16 / 9, { yawDeg: Number.NaN, pitchDeg: 30 }),
    ).toThrow(/view/i);
  });
});
