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

describe('pickThreat', () => {
  const RECT = { left: 100, top: 50, width: 800, height: 400 };
  const RADIUS = 48;
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, RECT.width / RECT.height);
  const tester = createHitTester(camera);
  const entryA = { threatId: 1, xM: -3, yM: 0.3, zM: 0.5 };
  const entryB = { threatId: 2, xM: -2.6, yM: 0.3, zM: 0.5 };
  const pxOf = (entry: { xM: number; yM: number; zM: number }) => {
    const v = new Vector3(entry.xM, entry.yM, entry.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };
  const threat = (id: number, state = 'telegraph') => ({ id, state }) as never;

  it('picks the threat whose icon is within the radius, and none outside it', () => {
    const targets = { threats: [threat(1)], entries: [entryA] };
    const at = pxOf(entryA);
    expect(tester.pickThreat(at.x, at.y, RECT, targets, RADIUS)).toBe(1);
    expect(tester.pickThreat(at.x + RADIUS - 1, at.y, RECT, targets, RADIUS)).toBe(1);
    expect(tester.pickThreat(at.x + RADIUS + 1, at.y, RECT, targets, RADIUS)).toBeNull();
  });

  it('includes the boundary of the radius', () => {
    const targets = { threats: [threat(1)], entries: [entryA] };
    const at = pxOf(entryA);
    expect(tester.pickThreat(at.x, at.y + 30, RECT, targets, 30)).toBe(1);
    expect(tester.pickThreat(at.x, at.y + 30.01, RECT, targets, 30)).toBeNull();
  });

  it('picks the nearest of two icons within the radius, whatever their order', () => {
    const a = pxOf(entryA);
    const b = pxOf(entryB);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(RADIUS * 2);
    const between = { x: b.x - 2, y: b.y };
    const forward = { threats: [threat(1), threat(2)], entries: [entryA, entryB] };
    const backward = { threats: [threat(2), threat(1)], entries: [entryB, entryA] };
    expect(tester.pickThreat(between.x, between.y, RECT, forward, RADIUS)).toBe(2);
    expect(tester.pickThreat(between.x, between.y, RECT, backward, RADIUS)).toBe(2);
    expect(tester.pickThreat(a.x - 2, a.y, RECT, forward, RADIUS)).toBe(1);
  });

  it('never aims at an icon that belongs to another threat (ids differ)', () => {
    const at = pxOf(entryA);
    const targets = { threats: [threat(9)], entries: [entryA] }; // entryA is the icon of threat 1
    expect(tester.pickThreat(at.x, at.y, RECT, targets, RADIUS)).toBeNull();
  });

  it('skips a threat that is not telegraphed or open', () => {
    const at = pxOf(entryA);
    for (const state of ['idle', 'resolved', 'gag']) {
      const targets = { threats: [threat(1, state)], entries: [entryA] };
      expect(tester.pickThreat(at.x, at.y, RECT, targets, RADIUS), state).toBeNull();
    }
    const open = { threats: [threat(1, 'windowOpen')], entries: [entryA] };
    expect(tester.pickThreat(at.x, at.y, RECT, open, RADIUS)).toBe(1);
  });

  it('ignores an icon outside the frustum, and a point that is not a number', () => {
    const far = { threatId: 3, xM: -3, yM: 0.3, zM: 0.5 };
    const farCamera = createIsoCamera();
    fitIsoCamera(farCamera, ROOM, 2);
    farCamera.position.set(0, 0, 1000);
    farCamera.lookAt(0, 0, 0);
    farCamera.updateMatrixWorld(true);
    const behind = createHitTester(farCamera);
    const targets = { threats: [threat(3)], entries: [far] };
    expect(behind.pickThreat(500, 250, RECT, targets, 10_000)).toBeNull();
    const at = pxOf(entryA);
    const ok = { threats: [threat(1)], entries: [entryA] };
    expect(tester.pickThreat(Number.NaN, at.y, RECT, ok, RADIUS)).toBeNull();
  });

  it('returns null for a level with no threat', () => {
    expect(tester.pickThreat(300, 200, RECT, { threats: [], entries: [] }, RADIUS)).toBeNull();
  });
});
