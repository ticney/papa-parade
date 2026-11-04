import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import { LevelGeometrySchema } from '@content/schemas/levelGeometry';
import {
  ISO_CAMERA_DISTANCE_M,
  ISO_FIT_MARGIN_PCT,
  ISO_PITCH_DEG,
  ISO_YAW_DEG,
} from '@shared/constants';
import {
  createFollowFrame,
  createFollowState,
  fitFollowFrame,
  snapFollow,
  viewUM,
  viewVM,
} from '@shared/followCamera';
import { type OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createIsoCamera, fitFollowCamera, fitIsoCamera, type RoomSize } from './isoCamera.ts';
import { roomOf } from './levelScene.ts';

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

describe('fitFollowCamera (story 9.2)', () => {
  const FRAME = { frameWidthM: 9.1, frameDepthM: 6.2 };

  it('is a translation of one fit: same orientation and view size, the centre moved', () => {
    const atCentre = createIsoCamera();
    fitFollowCamera(atCentre, SUNKEN_ROOM, FRAME, 0, 0, 16 / 9);
    const moved = createIsoCamera();
    fitFollowCamera(moved, SUNKEN_ROOM, FRAME, -4.5, 2.25, 16 / 9);
    expect(moved.quaternion.toArray()).toEqual(atCentre.quaternion.toArray());
    expect(moved.right - moved.left).toBeCloseTo(atCentre.right - atCentre.left, 12);
    expect(moved.top - moved.bottom).toBeCloseTo(atCentre.top - atCentre.bottom, 12);
    const shift = moved.position.clone().sub(atCentre.position);
    expect(shift.x).toBeCloseTo(-4.5, 9);
    expect(shift.y).toBeCloseTo(0, 9);
    expect(shift.z).toBeCloseTo(2.25, 9);
    // The floor point it is centred on, at the box's middle height, is the middle of the screen.
    const middle = new Vector3(-4.5, -0.8 + 3.3 / 2, 2.25).project(moved);
    expect(Math.abs(middle.x)).toBeLessThan(EPSILON);
    expect(Math.abs(middle.y)).toBeLessThan(EPSILON);
  });

  it("matches the follow maths: the view basis and the frame's half size are the camera's", () => {
    for (const aspect of ASPECTS) {
      const camera = createIsoCamera();
      fitFollowCamera(camera, SUNKEN_ROOM, FRAME, 1.5, -0.5, aspect);
      const frame = createFollowFrame();
      fitFollowFrame(frame, SUNKEN_ROOM, FRAME.frameWidthM, FRAME.frameDepthM, aspect);
      expect(frame.halfWidthM).toBeCloseTo((camera.right - camera.left) / 2, 9);
      expect(frame.halfHeightM).toBeCloseTo((camera.top - camera.bottom) / 2, 9);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      // Relative to the look-at point, which `fitFollowCamera` put at the screen's middle.
      const look = new Vector3(1.5, frame.lookYM, -0.5);
      for (const point of [
        new Vector3(0, 0, 0),
        new Vector3(3.2, 1.1, -1.5),
        new Vector3(-6.4, 2.5, 3),
      ]) {
        const offset = point.clone().sub(look);
        expect(viewUM(point.x, point.z) - viewUM(look.x, look.z)).toBeCloseTo(offset.dot(right), 9);
        expect(viewVM(point.x, point.y, point.z) - viewVM(look.x, look.y, look.z)).toBeCloseTo(
          offset.dot(up),
          9,
        );
      }
    }
  });

  it("gives the room's extent the fixed camera's breathing room", () => {
    const frame = createFollowFrame();
    fitFollowFrame(frame, SUNKEN_ROOM, FRAME.frameWidthM, FRAME.frameDepthM, 16 / 9);
    // At the extent's own aspect, the fixed camera shows exactly the extent.
    const camera = fitted(SUNKEN_ROOM, (frame.maxUM - frame.minUM) / (frame.maxVM - frame.minVM));
    expect((frame.maxUM - frame.minUM) / 2).toBeCloseTo((camera.right - camera.left) / 2, 9);
    expect((frame.maxVM - frame.minVM) / 2).toBeCloseTo((camera.top - camera.bottom) / 2, 9);
  });

  it('never clips the room behind the far plane, however small the frame', () => {
    const big = {
      widthM: 14.6,
      depthM: 7.2,
      heightM: 3.3,
      floorYM: -0.8,
      centerXM: 0.35,
      centerZM: -0.1,
    };
    for (const aspect of [0.46, 1, 16 / 9]) {
      const camera = createIsoCamera();
      // The smallest frame `feel.camera` allows: the room reaches far deeper than its box.
      fitFollowCamera(camera, big, { frameWidthM: 3, frameDepthM: 3 }, -4, 2, aspect);
      for (const xM of [big.centerXM - big.widthM / 2, big.centerXM + big.widthM / 2]) {
        for (const yM of [big.floorYM, big.floorYM + big.heightM]) {
          for (const zM of [big.centerZM - big.depthM / 2, big.centerZM + big.depthM / 2]) {
            const depth = new Vector3(xM, yM, zM).project(camera).z;
            expect(depth).toBeGreaterThanOrEqual(-1);
            expect(depth).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('is the fixed camera when the frame is the room: the same picture', () => {
    const viaFollow = createIsoCamera();
    fitFollowCamera(viaFollow, SUNKEN_ROOM, FRAME, 0.35, -0.1, 16 / 9);
    const viaFixed = fitted(SUNKEN_ROOM, 16 / 9);
    expect(viaFollow.position.toArray()).toEqual(viaFixed.position.toArray());
    expect(Array.from(viaFollow.projectionMatrix.elements)).toEqual(
      Array.from(viaFixed.projectionMatrix.elements),
    );
  });
});

describe('the characters keep their size in the big room (story 9.2, AC 5)', () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const roomOfLevel = (id: string): RoomSize => {
    const path = `content/levels/${id}.geometry.json`;
    const parsed = parseContentFile(path, read(path), LevelGeometrySchema);
    if (!parsed.ok) throw new Error(`${path} is invalid`);
    return roomOf(parsed.value);
  };
  const feel = parseContentFile('content/feel.json', read('content/feel.json'), FeelSchema);

  it.each([
    ['844 × 390', 844 / 390],
    ['667 × 375', 667 / 375],
  ])(
    'draws a metre of floor at the salon fixed camera scale at %s (within 1 %)',
    (_name, aspect) => {
      if (!feel.ok) throw new Error('the live feel is invalid');
      const salon = fitted(roomOfLevel('salon_crawler'), aspect);
      const kitchen = roomOfLevel('salon_kitchen');
      const follow = createIsoCamera();
      fitFollowCamera(follow, kitchen, feel.value.camera, 5.25, 1, aspect);
      // The same canvas: the pixels per metre are the inverse of the view's height in metres.
      const salonHeightM = (salon.top - salon.bottom) / salon.zoom;
      const followHeightM = (follow.top - follow.bottom) / follow.zoom;
      expect(Math.abs(followHeightM / salonHeightM - 1)).toBeLessThanOrEqual(0.01);
      // The fixed camera on the big room would shrink them (story 9.1: about three quarters).
      const fixedKitchen = fitted(kitchen, aspect);
      expect((fixedKitchen.top - fixedKitchen.bottom) / salonHeightM).toBeGreaterThan(1.2);
    },
  );

  // Geo's call at the review of 9.2: where the edge margin and the room's bounds disagree, the walls
  // win. Papa may then come nearer an edge than `edgeMarginPct`, but never off the frame, and only on
  // an axis where the view stands against the room's extent.
  it.each([
    ['844 × 390', 844 / 390],
    ['667 × 375', 667 / 375],
    ['4:3', 4 / 3],
  ])(
    'keeps Papa in the frame at the kitchen walkable corners at %s: the walls win over the margin',
    (_name, aspect) => {
      if (!feel.ok) throw new Error('the live feel is invalid');
      const params = feel.value.camera;
      const frame = createFollowFrame();
      fitFollowFrame(
        frame,
        roomOfLevel('salon_kitchen'),
        params.frameWidthM,
        params.frameDepthM,
        aspect,
      );
      const marginPct = params.edgeMarginPct;
      // The walkable floor of 9.1: 13.5 × 7 m, x in [-6.75, 6.75], z in [-3.5, 3.5].
      for (const [xM, zM] of [
        [-6.75, -3.5],
        [-6.75, 3.5],
        [6.75, -3.5],
        [6.75, 3.5],
        [5.25, 1],
      ] as const) {
        const state = createFollowState();
        const papaUM = viewUM(xM, zM);
        const papaVM = viewVM(xM, 0, zM);
        snapFollow(state, frame, params, papaUM, papaVM, papaUM, papaVM, 0);
        const axes = [
          [papaUM - state.centreUM, frame.halfWidthM, state.centreUM, frame.minUM, frame.maxUM],
          [papaVM - state.centreVM, frame.halfHeightM, state.centreVM, frame.minVM, frame.maxVM],
        ] as const;
        for (const [offsetM, halfM, centreM, minM, maxM] of axes) {
          const edgePct = ((halfM - Math.abs(offsetM)) / (2 * halfM)) * 100;
          expect(edgePct).toBeGreaterThan(0);
          if (edgePct < marginPct - 1e-9) {
            // The margin gave way: the view stands against the room's extent (or on its middle).
            const isAgainstWall =
              Math.abs(centreM - (minM + halfM)) < 1e-9 ||
              Math.abs(centreM - (maxM - halfM)) < 1e-9 ||
              Math.abs(centreM - (minM + maxM) / 2) < 1e-9;
            expect(isAgainstWall).toBe(true);
          }
        }
      }
    },
  );
});
