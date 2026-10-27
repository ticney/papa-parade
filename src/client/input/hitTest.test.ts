import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import { createHitTester, type FloorPoint } from './hitTest.ts';

const ROOM = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};

describe('createHitTester', () => {
  it.each([0.5, 1, 16 / 9, 844 / 390, 2.4])(
    'gives back the floor points it was shown, to the millimetre, at aspect %f',
    (aspect) => {
      const camera = createIsoCamera();
      fitIsoCamera(camera, ROOM, aspect);
      const tester = createHitTester(camera);
      const out: FloorPoint = { xM: 0, zM: 0 };
      const probe = new Vector3();
      for (const [x, z] of [
        [0, 0],
        [2.5, 1.5],
        [-3.9, -2.9],
        [3.7, 2.6],
        [0.35, -0.1],
      ] as const) {
        probe.set(x, 0, z).project(camera);
        expect(tester.pickFloor(probe.x, probe.y, out)).toBe(true);
        expect(Math.abs(out.xM - x)).toBeLessThan(0.001);
        expect(Math.abs(out.zM - z)).toBeLessThan(0.001);
      }
    },
  );

  it('picks the floor even for a point that is on screen but off the room', () => {
    const camera = createIsoCamera();
    fitIsoCamera(camera, ROOM, 844 / 390);
    const out: FloorPoint = { xM: 0, zM: 0 };
    expect(createHitTester(camera).pickFloor(1, 1, out)).toBe(true);
    expect(Number.isFinite(out.xM) && Number.isFinite(out.zM)).toBe(true);
  });

  it('refuses a point that is not a number, and leaves `out` alone', () => {
    const camera = createIsoCamera();
    fitIsoCamera(camera, ROOM, 2);
    const out: FloorPoint = { xM: 7, zM: 8 };
    const tester = createHitTester(camera);
    expect(tester.pickFloor(Number.NaN, 0, out)).toBe(false);
    expect(tester.pickFloor(0, Number.POSITIVE_INFINITY, out)).toBe(false);
    expect(out).toEqual({ xM: 7, zM: 8 });
  });

  it('follows the camera when it is placed again', () => {
    const camera = createIsoCamera();
    const tester = createHitTester(camera);
    const out: FloorPoint = { xM: 0, zM: 0 };
    fitIsoCamera(camera, ROOM, 2);
    tester.pickFloor(0, 0, out);
    const first = { ...out };
    fitIsoCamera(camera, { ...ROOM, centerXM: 3 }, 2);
    tester.pickFloor(0, 0, out);
    expect(out.xM).not.toBeCloseTo(first.xM, 3);
  });
});
