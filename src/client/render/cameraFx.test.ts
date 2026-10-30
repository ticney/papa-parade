import { readFileSync } from 'node:fs';
import type { Feel } from '@content/schemas/feel';
import { REDUCED_MOTION_ZOOM_CAP_PCT } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { World } from '@sim';
import { type OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createCameraFx,
  perfectCameraBlendAt,
  type SequenceFraming,
  sequenceFramingBlendAt,
} from './cameraFx.ts';
import { createIsoCamera, fitIsoCamera } from './isoCamera.ts';

const PERFECT_CAMERA: Feel['fx']['perfectCamera'] = {
  zoomPct: 20,
  yawDeg: 8,
  focusPct: 50,
  zoomInMs: 100,
  refocusMs: 100,
};
/** No sequence: the framing every pre-4.4 call passes. */
const NO_FRAMING: SequenceFraming = { blend: 0, zoomPct: 18, focusPct: 60, xM: 0, zM: 0 };
const ROOM = { widthM: 8, depthM: 6, heightM: 2.5 };

const slowMo = (startedAt: number, holdUntil: number, endsAt: number, source = 'perfect') => ({
  source: source as 'perfect',
  scale: 0.3,
  startedAt: asSimMs(startedAt),
  holdUntil: asSimMs(holdUntil),
  endsAt: asSimMs(endsAt),
});

const worldWith = (...slowMos: ReturnType<typeof slowMo>[]) =>
  ({ time: { sim: asSimMs(0), slowMos } }) as unknown as World;

function build() {
  const camera = createIsoCamera();
  fitIsoCamera(camera, ROOM, 16 / 9);
  const fx = createCameraFx(camera);
  fx.captureBase();
  return { camera, fx };
}

const snapshot = (camera: OrthographicCamera) => ({
  position: camera.position.toArray(),
  quaternion: camera.quaternion.toArray(),
  zoom: camera.zoom,
  projection: Array.from(camera.projectionMatrix.elements),
});

describe('perfectCameraBlendAt', () => {
  const perfect = slowMo(1000, 2200, 2500);

  it('is 0 with no perfect slow-mo, before it starts, and from its end on', () => {
    expect(perfectCameraBlendAt(undefined, 1500, 150)).toBe(0);
    expect(perfectCameraBlendAt(perfect, 999, 150)).toBe(0);
    expect(perfectCameraBlendAt(perfect, 2500, 150)).toBe(0);
    expect(perfectCameraBlendAt(perfect, 9000, 150)).toBe(0);
  });

  it('rises linearly over zoomInMs, then holds at 1 until holdUntil', () => {
    expect(perfectCameraBlendAt(perfect, 1000, 150)).toBe(0);
    expect(perfectCameraBlendAt(perfect, 1075, 150)).toBeCloseTo(0.5, 12);
    expect(perfectCameraBlendAt(perfect, 1150, 150)).toBe(1);
    expect(perfectCameraBlendAt(perfect, 2199, 150)).toBe(1);
  });

  it('follows the return of the slow-mo itself: 1 minus a smoothstep, down to 0', () => {
    expect(perfectCameraBlendAt(perfect, 2200, 150)).toBe(1);
    expect(perfectCameraBlendAt(perfect, 2350, 150)).toBeCloseTo(0.5, 12);
    const early = perfectCameraBlendAt(perfect, 2260, 150);
    const late = perfectCameraBlendAt(perfect, 2440, 150);
    expect(early).toBeGreaterThan(0.5);
    expect(late).toBeLessThan(0.5);
    expect(perfectCameraBlendAt(perfect, 2499.9, 150)).toBeGreaterThan(0);
  });

  it('takes no time to rise with zoomInMs 0, and has no return with returnMs 0', () => {
    expect(perfectCameraBlendAt(perfect, 1000, 0)).toBe(1);
    const abrupt = slowMo(1000, 2200, 2200);
    expect(perfectCameraBlendAt(abrupt, 2199, 0)).toBe(1);
    expect(perfectCameraBlendAt(abrupt, 2200, 0)).toBe(0);
  });
});

describe('createCameraFx', () => {
  it('leaves the camera untouched, bit for bit, at blend 0', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false, NO_FRAMING);
    fx.update(
      worldWith(slowMo(1000, 2200, 2500, 'lastThreat')),
      1500,
      PERFECT_CAMERA,
      false,
      NO_FRAMING,
    );
    expect(snapshot(camera)).toEqual(before);
  });

  it('zooms, pans toward the action and turns at the peak of a perfect', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
    expect(fx.zoom).toBeCloseTo(1.2, 12);
    expect(fx.yawDeg).toBeCloseTo(8, 12);
    expect(camera.position.toArray()).not.toEqual(before.position);
    // The yaw turned the camera: its orientation is no longer the base one.
    expect(camera.quaternion.toArray()).not.toEqual(before.quaternion);
  });

  it('shifts the view centre toward the focus by focusPct, whatever the turn', () => {
    const { camera, fx } = build();
    const baseDirection = camera.getWorldDirection(new Vector3());
    const basePosition = camera.position.clone();
    fx.focusOn(3, 2);
    fx.update(
      worldWith(slowMo(1000, 2200, 2500)),
      1500,
      { ...PERFECT_CAMERA, yawDeg: 0 },
      false,
      NO_FRAMING,
    );
    // Without a turn the camera only translates: same direction, moved along the view plane.
    expect(camera.getWorldDirection(new Vector3()).distanceTo(baseDirection)).toBeLessThan(1e-9);
    const moved = camera.position.clone().sub(basePosition);
    expect(moved.length()).toBeGreaterThan(0);
  });

  it('restores the base exactly at the end of the slow-mo, and writes nothing afterwards', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.focusOn(2, -1);
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.update(world, 1500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(snapshot(camera)).not.toEqual(before);
    fx.update(world, 2500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(snapshot(camera)).toEqual(before);
    expect(fx.yawDeg).toBe(0);
    // Idle: a later frame writes nothing. A mark on the matrix would be erased by a rewrite.
    camera.matrixWorld.elements[0] = 123;
    fx.update(world, 2600, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.matrixWorld.elements[0]).toBe(123);
    expect(snapshot(camera)).toEqual(before);
  });

  it('holds the move while the sim clock stands still (hitstop, pause)', () => {
    const { camera, fx } = build();
    fx.focusOn(1, 1);
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.update(world, 1600, PERFECT_CAMERA, false, NO_FRAMING);
    const held = snapshot(camera);
    for (let frame = 0; frame < 5; frame++)
      fx.update(world, 1600, PERFECT_CAMERA, false, NO_FRAMING);
    expect(snapshot(camera)).toEqual(held);
  });

  it('gives no turn and half the zoom and pan under reduced motion', () => {
    const full = build();
    full.fx.focusOn(3, 2);
    full.fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, NO_FRAMING);
    const reduced = build();
    reduced.fx.focusOn(3, 2);
    reduced.fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, true, NO_FRAMING);
    expect(reduced.fx.yawDeg).toBe(0);
    const cap = REDUCED_MOTION_ZOOM_CAP_PCT / 100;
    expect(reduced.camera.zoom).toBeCloseTo(1 + 0.2 * cap, 12);
    expect(reduced.camera.zoom).toBeLessThan(full.camera.zoom);
    // Without a turn, the pan alone is half as long as the full move would have been.
    const fullMove = full.camera.position.distanceTo(build().camera.position);
    const reducedMove = reduced.camera.position.distanceTo(build().camera.position);
    expect(reducedMove).toBeLessThan(fullMove);
  });

  it('does not pan when no focus was given (a perfect with no threat position)', () => {
    const { camera, fx } = build();
    const base = camera.position.clone();
    fx.update(
      worldWith(slowMo(1000, 2200, 2500)),
      1500,
      { ...PERFECT_CAMERA, yawDeg: 0 },
      false,
      NO_FRAMING,
    );
    expect(camera.position.distanceTo(base)).toBeLessThan(1e-9);
    expect(camera.zoom).toBeGreaterThan(1);
  });

  it('keeps the right base after a refit during a move (a resize mid-zoom)', () => {
    const { camera, fx } = build();
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.focusOn(2, -1);
    fx.update(world, 1500, PERFECT_CAMERA, false, NO_FRAMING);
    // A resize: the camera is fitted again to another aspect, then the base is captured again.
    fitIsoCamera(camera, ROOM, 1);
    fx.captureBase();
    // The expected base is a camera that never moved, fitted to the same aspect.
    const reference = createIsoCamera();
    fitIsoCamera(reference, ROOM, 1);
    const refit = snapshot(reference);
    expect(snapshot(camera)).toEqual(refit);
    fx.update(world, 2500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(snapshot(camera)).toEqual(refit);
    // And a new move starts from that new base.
    fx.update(world, 1500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
  });

  it('reset puts the base back at once', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, NO_FRAMING);
    fx.reset();
    expect(snapshot(camera)).toEqual(before);
  });

  it('glides to the point of a second perfect over refocusMs instead of cutting', () => {
    const { camera, fx } = build();
    const world = worldWith(slowMo(1000, 3000, 3300));
    fx.focusOn(2, -1);
    fx.update(world, 2000, PERFECT_CAMERA, false, NO_FRAMING);
    const first = camera.position.clone();
    fx.focusOn(-3, 2);
    // The frame of the second perfect: still where it was, no jump.
    fx.update(world, 2000, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.position.distanceTo(first)).toBeLessThan(1e-9);
    // Half way: between the two (not yet there, no longer here).
    fx.update(world, 2050, PERFECT_CAMERA, false, NO_FRAMING);
    const middle = camera.position.clone();
    expect(middle.distanceTo(first)).toBeGreaterThan(1e-6);
    // Done: the same pose as a camera that was leaning toward the second point from the start.
    fx.update(world, 2100, PERFECT_CAMERA, false, NO_FRAMING);
    const arrived = camera.position.clone();
    expect(arrived.distanceTo(middle)).toBeGreaterThan(1e-6);
    const direct = build();
    direct.fx.focusOn(-3, 2);
    direct.fx.update(world, 2100, PERFECT_CAMERA, false, NO_FRAMING);
    expect(arrived.distanceTo(direct.camera.position)).toBeLessThan(1e-9);
    // And it stays there: nothing moves any more.
    fx.update(world, 2400, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.position.distanceTo(arrived)).toBeLessThan(1e-9);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
  });

  it('cuts to the new point with refocusMs 0, and starts on it when no move is under way', () => {
    const { camera, fx } = build();
    const world = worldWith(slowMo(1000, 3000, 3300));
    const cut = { ...PERFECT_CAMERA, refocusMs: 0 };
    fx.focusOn(2, -1);
    fx.update(world, 2000, cut, false, NO_FRAMING);
    fx.focusOn(-3, 2);
    fx.update(world, 2000, cut, false, NO_FRAMING);
    const direct = build();
    direct.fx.focusOn(-3, 2);
    direct.fx.update(world, 2000, cut, false, NO_FRAMING);
    expect(camera.position.distanceTo(direct.camera.position)).toBeLessThan(1e-9);
    // A fresh move after the end of the last one does not glide from the old point.
    fx.update(world, 4000, cut, false, NO_FRAMING);
    fx.focusOn(1, 1);
    const later = worldWith(slowMo(5000, 7000, 7300));
    fx.update(later, 5500, PERFECT_CAMERA, false, NO_FRAMING);
    const fresh = build();
    fresh.fx.focusOn(1, 1);
    fresh.fx.update(later, 5500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.position.distanceTo(fresh.camera.position)).toBeLessThan(1e-9);
  });

  it('forgets the focus on reset: a perfect with no point does not pan toward the last level', () => {
    const { camera, fx } = build();
    const base = camera.position.clone();
    fx.focusOn(3, 2);
    fx.update(
      worldWith(slowMo(1000, 2200, 2500)),
      1500,
      { ...PERFECT_CAMERA, yawDeg: 0 },
      false,
      NO_FRAMING,
    );
    expect(camera.position.distanceTo(base)).toBeGreaterThan(1e-6);
    fx.reset();
    fx.update(
      worldWith(slowMo(1000, 2200, 2500)),
      1500,
      { ...PERFECT_CAMERA, yawDeg: 0 },
      false,
      NO_FRAMING,
    );
    expect(camera.position.distanceTo(base)).toBeLessThan(1e-9);
  });

  it('applies a live change of the tuning while the move is held', () => {
    const { camera, fx } = build();
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.update(world, 1500, PERFECT_CAMERA, false, NO_FRAMING);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
    fx.update(world, 1500, { ...PERFECT_CAMERA, zoomPct: 30 }, false, NO_FRAMING);
    expect(camera.zoom).toBeCloseTo(1.3, 12);
    fx.update(world, 1500, { ...PERFECT_CAMERA, zoomPct: 30, yawDeg: 0 }, false, NO_FRAMING);
    expect(fx.yawDeg).toBe(0);
  });

  it('allocates nothing per frame: update has no `new` and no clone', () => {
    const source = readFileSync(new URL('./cameraFx.ts', import.meta.url), 'utf8');
    const start = source.indexOf('    update(world, clockMs');
    const end = source.indexOf('    reset() {');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/\bnew \w/);
    expect(body).not.toMatch(/\.clone\(/);
    expect(body).not.toMatch(/\.\.\./);
  });
});

describe('sequenceFramingBlendAt (story 4.4)', () => {
  const IN = 900;
  const OUT = 700;

  it('is 0 before the start, rises linearly over inMs, and holds at 1 while the sequence runs', () => {
    expect(sequenceFramingBlendAt(1000, null, 999, IN, OUT)).toBe(0);
    expect(sequenceFramingBlendAt(1000, null, 1000, IN, OUT)).toBe(0);
    expect(sequenceFramingBlendAt(1000, null, 1450, IN, OUT)).toBeCloseTo(0.5, 12);
    expect(sequenceFramingBlendAt(1000, null, 1900, IN, OUT)).toBe(1);
    expect(sequenceFramingBlendAt(1000, null, 50_000, IN, OUT)).toBe(1);
  });

  it('from endedAt falls from the value it had along 1 - smoothstep over outMs, exactly 0 at the end', () => {
    expect(sequenceFramingBlendAt(1000, 5000, 5000, IN, OUT)).toBe(1);
    expect(sequenceFramingBlendAt(1000, 5000, 5350, IN, OUT)).toBeCloseTo(0.5, 12);
    expect(sequenceFramingBlendAt(1000, 5000, 5700, IN, OUT)).toBe(0);
    expect(sequenceFramingBlendAt(1000, 5000, 9000, IN, OUT)).toBe(0);
    // A sequence that ended before the framing was fully in: it leaves from where it was.
    expect(sequenceFramingBlendAt(1000, 1450, 1450, IN, OUT)).toBeCloseTo(0.5, 12);
    expect(sequenceFramingBlendAt(1000, 1450, 1800, IN, OUT)).toBeCloseTo(0.25, 12);
  });

  it('takes no time with inMs or outMs of 0', () => {
    expect(sequenceFramingBlendAt(1000, null, 1000, 0, OUT)).toBe(1);
    expect(sequenceFramingBlendAt(1000, 5000, 5000, IN, 0)).toBe(0);
  });
});

describe('the sequence framing in createCameraFx (story 4.4)', () => {
  const framing = (blend: number): SequenceFraming => ({
    blend,
    zoomPct: 18,
    focusPct: 60,
    xM: 1,
    zM: -1,
  });

  it('zooms and pans toward Papa while it holds, with no perfect', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false, framing(1));
    expect(camera.zoom).toBeCloseTo(1.18, 12);
    expect(fx.zoom).toBeCloseTo(1.18, 12);
    expect(fx.yawDeg).toBe(0);
    expect(camera.position.toArray()).not.toEqual(before.position);
  });

  it('goes back bit for bit when the framing returns to 0', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false, framing(1));
    fx.update(worldWith(), 1600, PERFECT_CAMERA, false, framing(0));
    expect(snapshot(camera)).toEqual(before);
    expect(fx.zoom).toBe(1);
  });

  it('writes nothing again while its inputs are the same', () => {
    const { camera, fx } = build();
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false, framing(0.6));
    camera.zoom = 7; // a write would put it back to the framing's value
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false, framing(0.6));
    expect(camera.zoom).toBe(7);
  });

  it('composes with a perfect: the zooms add, the pans add', () => {
    const { camera, fx } = build();
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, NO_FRAMING);
    const perfectOnly = snapshot(camera);
    const other = build();
    other.fx.focusOn(2, -1);
    other.fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, framing(1));
    expect(other.camera.zoom).toBeCloseTo(perfectOnly.zoom + 0.18, 12);
    expect(other.camera.position.toArray()).not.toEqual(perfectOnly.position);
    expect(other.fx.yawDeg).toBeCloseTo(8, 12);
  });

  it('caps the zoom under reduced motion', () => {
    const { camera, fx } = build();
    fx.update(worldWith(), 1500, PERFECT_CAMERA, true, framing(1));
    expect(camera.zoom).toBeCloseTo(1 + (18 / 100) * (REDUCED_MOTION_ZOOM_CAP_PCT / 100), 12);
    expect(camera.zoom).toBeLessThan(1.18);
  });

  it('a perfect that ends during the framing leaves the framing in place (no restore)', () => {
    const { camera, fx } = build();
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false, framing(1));
    fx.update(worldWith(), 3000, PERFECT_CAMERA, false, framing(1));
    expect(camera.zoom).toBeCloseTo(1.18, 12);
    expect(fx.yawDeg).toBe(0);
  });
});
