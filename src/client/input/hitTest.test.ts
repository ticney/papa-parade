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
  const entryA = {
    threatId: 1,
    xM: -3,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
  };
  const entryB = {
    threatId: 2,
    xM: -2.6,
    yM: 0.3,
    zM: 0.5,
    icon: 'bolt' as const,
    followsPapa: false,
  };
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
    const far = {
      threatId: 3,
      xM: -3,
      yM: 0.3,
      zM: 0.5,
      icon: 'bolt' as const,
      followsPapa: false,
    };
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

describe('pickObject (story 1.19)', () => {
  const RECT = { left: 100, top: 50, width: 800, height: 400 };
  const RADIUS = 64;
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, RECT.width / RECT.height);
  const tester = createHitTester(camera);
  const COFFEE = { id: 'coffee_machine', xM: -3.6, yM: 1.05, zM: -2 };
  const PHONE = { id: 'phone', xM: -1.3, yM: 0.65, zM: -1.2 };
  const pxOf = (object: { xM: number; yM: number; zM: number }) => {
    const v = new Vector3(object.xM, object.yM, object.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  it('picks the object whose icon point (at the height of its anchor) is within the radius, none outside', () => {
    const at = pxOf(COFFEE);
    expect(tester.pickObject(at.x, at.y, RECT, [COFFEE, PHONE], RADIUS)).toBe('coffee_machine');
    expect(tester.pickObject(at.x + RADIUS, at.y, RECT, [COFFEE, PHONE], RADIUS)).toBe(
      'coffee_machine',
    );
    expect(tester.pickObject(at.x + RADIUS + 1, at.y, RECT, [COFFEE], RADIUS)).toBeNull();
  });

  it('projects the height of the anchor: the floor point under the object is not its icon point', () => {
    const floor = pxOf({ ...PHONE, yM: 0 });
    const icon = pxOf(PHONE);
    expect(Math.hypot(floor.x - icon.x, floor.y - icon.y)).toBeGreaterThan(5);
    expect(tester.pickObject(icon.x, icon.y, RECT, [PHONE], 2)).toBe('phone');
    expect(tester.pickObject(floor.x, floor.y, RECT, [PHONE], 2)).toBeNull();
  });

  it('picks the nearest of two, the earlier on an exact tie, and none from an empty list', () => {
    const a = pxOf(COFFEE);
    const b = pxOf(PHONE);
    const midway = { x: (a.x + b.x) / 2 + 1, y: (a.y + b.y) / 2 };
    const wide = 10_000;
    const nearest =
      Math.hypot(midway.x - b.x, midway.y - b.y) < Math.hypot(midway.x - a.x, midway.y - a.y)
        ? 'phone'
        : 'coffee_machine';
    expect(tester.pickObject(midway.x, midway.y, RECT, [COFFEE, PHONE], wide)).toBe(nearest);
    const twin = { ...COFFEE, id: 'twin' };
    expect(tester.pickObject(a.x, a.y, RECT, [COFFEE, twin], RADIUS)).toBe('coffee_machine');
    expect(tester.pickObject(a.x, a.y, RECT, [], RADIUS)).toBeNull();
  });

  it('refuses a point that is not a number', () => {
    expect(tester.pickObject(Number.NaN, 10, RECT, [COFFEE], RADIUS)).toBeNull();
    expect(tester.pickObject(10, Number.POSITIVE_INFINITY, RECT, [COFFEE], RADIUS)).toBeNull();
  });
});

describe('pickBaby (story 1.21)', () => {
  const RECT = { left: 100, top: 50, width: 800, height: 400 };
  const RADIUS = 64;
  const BABY = { xM: -1, zM: 0.5 };
  const HEIGHT_M = 0.2;
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, RECT.width / RECT.height);
  const tester = createHitTester(camera);
  const pxAt = (yM: number) => {
    const v = new Vector3(BABY.xM, yM, BABY.zM).project(camera);
    return {
      x: RECT.left + ((v.x + 1) / 2) * RECT.width,
      y: RECT.top + ((1 - v.y) / 2) * RECT.height,
    };
  };

  it('gives the squared distance within the radius of his centre, inclusive, and null just outside', () => {
    const at = pxAt(HEIGHT_M);
    expect(tester.pickBaby(at.x, at.y, RECT, BABY, HEIGHT_M, RADIUS)).not.toBeNull();
    expect(tester.pickBaby(at.x, at.y, RECT, BABY, HEIGHT_M, RADIUS)).toBeCloseTo(0, 6);
    expect(tester.pickBaby(at.x + 10, at.y - 20, RECT, BABY, HEIGHT_M, RADIUS)).toBeCloseTo(500, 6);
    expect(tester.pickBaby(at.x + RADIUS, at.y, RECT, BABY, HEIGHT_M, RADIUS)).not.toBeNull();
    expect(tester.pickBaby(at.x + RADIUS + 1, at.y, RECT, BABY, HEIGHT_M, RADIUS)).toBeNull();
  });

  it('projects his centre at the given height, not his floor point', () => {
    const centre = pxAt(HEIGHT_M);
    const floor = pxAt(0);
    expect(Math.hypot(centre.x - floor.x, centre.y - floor.y)).toBeGreaterThan(3);
    expect(tester.pickBaby(centre.x, centre.y, RECT, BABY, HEIGHT_M, 1)).not.toBeNull();
    expect(tester.pickBaby(floor.x, floor.y, RECT, BABY, HEIGHT_M, 1)).toBeNull();
  });

  it('is null for a point that is not a number, a negative radius, or a baby behind the camera', () => {
    const at = pxAt(HEIGHT_M);
    expect(tester.pickBaby(Number.NaN, at.y, RECT, BABY, HEIGHT_M, RADIUS)).toBeNull();
    expect(
      tester.pickBaby(at.x, Number.POSITIVE_INFINITY, RECT, BABY, HEIGHT_M, RADIUS),
    ).toBeNull();
    expect(tester.pickBaby(at.x, at.y, RECT, BABY, HEIGHT_M, -1)).toBeNull();
    expect(tester.pickBaby(at.x, at.y, RECT, { xM: 1e6, zM: 1e6 }, HEIGHT_M, RADIUS)).toBeNull();
  });
});
