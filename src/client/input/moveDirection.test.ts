import { ISO_YAW_DEG } from '@shared/constants';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import {
  type FloorDir,
  keysToScreenDir,
  type ScreenDir,
  type StickMemory,
  screenToWorldDir,
  stickToScreenDir,
} from './moveDirection.ts';

const ROOM = {
  widthM: 9.1,
  depthM: 6.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};

function fittedCamera(aspect = 844 / 390) {
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, aspect);
  return camera;
}

/** Where a point of the floor lands on the screen, in NDC. */
function ndcOf(camera: ReturnType<typeof createIsoCamera>, x: number, z: number) {
  return new Vector3(x, 0, z).project(camera);
}

describe('screenToWorldDir', () => {
  it('maps screen up to the far side of the room and screen right to its right, from the camera basis', () => {
    const camera = fittedCamera();
    const out: FloorDir = { x: 0, z: 0 };
    expect(screenToWorldDir(camera, 0, 1, out)).toBe(true);
    // The yaw is ISO_YAW_DEG: the camera sits at +x/+z, so "up" goes to -x/-z.
    const yaw = (ISO_YAW_DEG * Math.PI) / 180;
    expect(out.x).toBeCloseTo(-Math.sin(yaw), 9);
    expect(out.z).toBeCloseTo(-Math.cos(yaw), 9);
    expect(screenToWorldDir(camera, 1, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(Math.cos(yaw), 9);
    expect(out.z).toBeCloseTo(-Math.sin(yaw), 9);
  });

  it.each([
    ['up', 0, 1],
    ['down', 0, -1],
    ['right', 1, 0],
    ['left', -1, 0],
  ])('a step toward screen %s really moves up/right/down/left on the screen', (_name, sx, sy) => {
    const camera = fittedCamera();
    const out: FloorDir = { x: 0, z: 0 };
    screenToWorldDir(camera, sx, sy, out);
    const before = ndcOf(camera, 1, 1);
    const after = ndcOf(camera, 1 + out.x, 1 + out.z);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    // Moving along the direction goes the asked way on the screen, and not sideways of it.
    if (sx !== 0) {
      expect(Math.sign(dx)).toBe(sx);
      expect(Math.abs(dy)).toBeLessThan(1e-9);
    } else {
      expect(Math.sign(dy)).toBe(sy);
      expect(Math.abs(dx)).toBeLessThan(1e-9);
    }
  });

  it('gives unit length on a diagonal and for any size of input', () => {
    const camera = fittedCamera();
    const out: FloorDir = { x: 0, z: 0 };
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [0.3, 0.1],
      [5, 0],
    ] as const) {
      expect(screenToWorldDir(camera, sx, sy, out)).toBe(true);
      expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 12);
    }
  });

  it('is no direction for (0, 0), and zeroes `out`', () => {
    const out: FloorDir = { x: 5, z: 5 };
    expect(screenToWorldDir(fittedCamera(), 0, 0, out)).toBe(false);
    expect(out).toEqual({ x: 0, z: 0 });
  });

  it('opposite screen directions give opposite world directions', () => {
    const camera = fittedCamera();
    const a: FloorDir = { x: 0, z: 0 };
    const b: FloorDir = { x: 0, z: 0 };
    screenToWorldDir(camera, 1, 1, a);
    screenToWorldDir(camera, -1, -1, b);
    expect(a.x + b.x).toBeCloseTo(0, 12);
    expect(a.z + b.z).toBeCloseTo(0, 12);
  });

  it('does not depend on the aspect or the window size', () => {
    const wide = fittedCamera(2.4);
    const tall = fittedCamera(0.6);
    const a: FloorDir = { x: 0, z: 0 };
    const b: FloorDir = { x: 0, z: 0 };
    screenToWorldDir(wide, 1, 1, a);
    screenToWorldDir(tall, 1, 1, b);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });
});

describe('keysToScreenDir', () => {
  const dir = (...codes: string[]) => {
    const out: ScreenDir = { x: 9, up: 9 };
    const has = keysToScreenDir(new Set(codes), out);
    return { has, ...out };
  };

  it('reads each of the eight keys', () => {
    expect(dir('KeyW')).toEqual({ has: true, x: 0, up: 1 });
    expect(dir('ArrowUp')).toEqual({ has: true, x: 0, up: 1 });
    expect(dir('KeyS')).toEqual({ has: true, x: 0, up: -1 });
    expect(dir('ArrowDown')).toEqual({ has: true, x: 0, up: -1 });
    expect(dir('KeyA')).toEqual({ has: true, x: -1, up: 0 });
    expect(dir('ArrowLeft')).toEqual({ has: true, x: -1, up: 0 });
    expect(dir('KeyD')).toEqual({ has: true, x: 1, up: 0 });
    expect(dir('ArrowRight')).toEqual({ has: true, x: 1, up: 0 });
  });

  it('cancels opposite keys, including a letter against an arrow', () => {
    expect(dir('KeyA', 'KeyD')).toEqual({ has: false, x: 0, up: 0 });
    expect(dir('KeyW', 'ArrowDown')).toEqual({ has: false, x: 0, up: 0 });
    expect(dir('KeyW', 'ArrowUp')).toEqual({ has: true, x: 0, up: 1 }); // the same direction twice is one
  });

  it('combines a diagonal, and nothing held is no direction', () => {
    expect(dir('KeyW', 'KeyD')).toEqual({ has: true, x: 1, up: 1 });
    expect(dir()).toEqual({ has: false, x: 0, up: 0 });
    expect(dir('Space')).toEqual({ has: false, x: 0, up: 0 });
  });
});

describe('stickToScreenDir', () => {
  const stick = (x: number, y: number, deadzonePct = 20, stepDeg = 5) => {
    const out: ScreenDir = { x: 9, up: 9 };
    const has = stickToScreenDir(x, y, deadzonePct, stepDeg, out);
    return { has, ...out };
  };

  it('is no direction inside the deadzone, and at rest', () => {
    expect(stick(0, 0)).toEqual({ has: false, x: 0, up: 0 });
    expect(stick(0.19, 0)).toEqual({ has: false, x: 0, up: 0 });
    expect(stick(0.1, 0.1)).toEqual({ has: false, x: 0, up: 0 });
    expect(stick(0.2, 0).has).toBe(true);
  });

  it('turns the stick into a screen direction, with +y of the pad meaning down', () => {
    expect(stick(0.9, 0)).toEqual({ has: true, x: 1, up: 0 });
    expect(stick(-0.9, 0)).toEqual({ has: true, x: -1, up: 0 });
    expect(stick(0, -0.9)).toEqual({ has: true, x: 0, up: 1 }); // pushed up
    expect(stick(0, 0.9)).toEqual({ has: true, x: 0, up: -1 }); // pushed down
    const diagonal = stick(0.7, -0.7);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(diagonal.up).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('always has unit length, whatever the push', () => {
    for (const [x, y] of [
      [0.3, 0.2],
      [1, 1],
      [-0.5, 0.9],
      [0.21, -0.01],
    ] as const) {
      const out = stick(x, y);
      expect(Math.hypot(out.x, out.up)).toBeCloseTo(1, 12);
    }
  });

  it('rounds the angle to the step, so close angles give the same direction', () => {
    const a = stick(0.8, -0.09); // about 6.4°, rounds to 5°
    const b = stick(0.8, -0.1); // about 7.1°, rounds to 5°
    expect(a).toEqual(b);
    const c = stick(0.8, -0.3); // about 20.6°, rounds to 20°
    expect(c).not.toEqual(a);
    const coarse = stick(0.8, -0.3, 20, 90);
    expect(coarse).toEqual({ has: true, x: 1, up: 0 });
  });

  it('applies the deadzone from the feel, in percent', () => {
    expect(stick(0.4, 0, 50).has).toBe(false);
    expect(stick(0.6, 0, 50).has).toBe(true);
    expect(stick(0.01, 0, 0).has).toBe(true);
  });
});

describe('stickToScreenDir with a memory (hysteresis)', () => {
  it('stays pushed on the edge of the deadzone, and releases only well inside it', () => {
    const out = { x: 0, up: 0 };
    const memory: StickMemory = { isActive: false, turns: 0 };
    expect(stickToScreenDir(0.21, 0, 20, 5, out, memory)).toBe(true);
    // 0.19 is under the 0.2 deadzone but over its release threshold (0.16).
    expect(stickToScreenDir(0.19, 0, 20, 5, out, memory)).toBe(true);
    expect(stickToScreenDir(0.17, 0, 20, 5, out, memory)).toBe(true);
    expect(stickToScreenDir(0.15, 0, 20, 5, out, memory)).toBe(false);
    // Released: it takes the full deadzone to push it again.
    expect(stickToScreenDir(0.19, 0, 20, 5, out, memory)).toBe(false);
    expect(stickToScreenDir(0.21, 0, 20, 5, out, memory)).toBe(true);
  });

  it('keeps its rounded angle while the raw one wobbles on a boundary between two steps', () => {
    const out = { x: 0, up: 0 };
    const memory: StickMemory = { isActive: false, turns: 0 };
    const at = (turns: number): [number, number] => [
      Math.cos((turns * 5 * Math.PI) / 180),
      -Math.sin((turns * 5 * Math.PI) / 180),
    ];
    // 0.49 steps: rounds to 0. 0.51 steps would round to 1, but is not 0.25 steps past the boundary.
    const [x0, y0] = at(0.49);
    stickToScreenDir(x0, y0, 20, 5, out, memory);
    expect(memory.turns).toBe(0);
    const [x1, y1] = at(0.6);
    stickToScreenDir(x1, y1, 20, 5, out, memory);
    expect(memory.turns).toBe(0);
    const [x2, y2] = at(0.8);
    stickToScreenDir(x2, y2, 20, 5, out, memory);
    expect(memory.turns).toBe(1);
  });

  it('wraps the circle: -180° and +180° are the same angle', () => {
    const out = { x: 0, up: 0 };
    const memory: StickMemory = { isActive: false, turns: 0 };
    stickToScreenDir(-1, 0.001, 20, 5, out, memory);
    const first = memory.turns;
    stickToScreenDir(-1, -0.001, 20, 5, out, memory);
    expect(memory.turns).toBe(first);
  });
});
