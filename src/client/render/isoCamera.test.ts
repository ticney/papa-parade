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

// Square, 4:3, 16:9, a landscape phone, ultra-wide, and a portrait phone.
const ASPECTS = [1, 4 / 3, 16 / 9, 844 / 390, 21 / 9, 0.46];
const MARGIN = ISO_FIT_MARGIN_PCT / 100;
const EPSILON = 1e-9;

/** The 8 corners of the room box: footprint centred on `centerXM`/`centerZM`, floor at y = 0. */
function cornersOf(room: RoomSize): Vector3[] {
  const corners: Vector3[] = [];
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  for (const x of [centerX - room.widthM / 2, centerX + room.widthM / 2]) {
    for (const y of [0, room.heightM]) {
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
  describe.each([ROOM, BIG_ROOM, OFF_CENTRE_ROOM])(
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
        const centre = new Vector3(room.centerXM ?? 0, room.heightM / 2, room.centerZM ?? 0);
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
