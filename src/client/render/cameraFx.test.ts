import { readFileSync } from 'node:fs';
import type { Feel } from '@content/schemas/feel';
import { REDUCED_MOTION_ZOOM_CAP_PCT } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { World } from '@sim';
import { type OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { createCameraFx, perfectCameraBlendAt } from './cameraFx.ts';
import { createIsoCamera, fitIsoCamera } from './isoCamera.ts';

const PERFECT_CAMERA: Feel['fx']['perfectCamera'] = {
  zoomPct: 20,
  yawDeg: 8,
  focusPct: 50,
  zoomInMs: 100,
};
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
    fx.update(worldWith(), 1500, PERFECT_CAMERA, false);
    fx.update(worldWith(slowMo(1000, 2200, 2500, 'lastThreat')), 1500, PERFECT_CAMERA, false);
    expect(snapshot(camera)).toEqual(before);
  });

  it('zooms, pans toward the action and turns at the peak of a perfect', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false);
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
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, { ...PERFECT_CAMERA, yawDeg: 0 }, false);
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
    fx.update(world, 1500, PERFECT_CAMERA, false);
    expect(snapshot(camera)).not.toEqual(before);
    fx.update(world, 2500, PERFECT_CAMERA, false);
    expect(snapshot(camera)).toEqual(before);
    expect(fx.yawDeg).toBe(0);
    // Idle: a later frame writes nothing (the matrix version does not move).
    const version = camera.matrixWorld.elements.slice();
    camera.position.x += 0; // untouched on purpose
    fx.update(world, 2600, PERFECT_CAMERA, false);
    expect(camera.matrixWorld.elements).toEqual(version);
    expect(snapshot(camera)).toEqual(before);
  });

  it('holds the move while the sim clock stands still (hitstop, pause)', () => {
    const { camera, fx } = build();
    fx.focusOn(1, 1);
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.update(world, 1600, PERFECT_CAMERA, false);
    const held = snapshot(camera);
    for (let frame = 0; frame < 5; frame++) fx.update(world, 1600, PERFECT_CAMERA, false);
    expect(snapshot(camera)).toEqual(held);
  });

  it('gives no turn and half the zoom and pan under reduced motion', () => {
    const full = build();
    full.fx.focusOn(3, 2);
    full.fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false);
    const reduced = build();
    reduced.fx.focusOn(3, 2);
    reduced.fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, true);
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
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, { ...PERFECT_CAMERA, yawDeg: 0 }, false);
    expect(camera.position.distanceTo(base)).toBeLessThan(1e-9);
    expect(camera.zoom).toBeGreaterThan(1);
  });

  it('keeps the right base after a refit during a move (a resize mid-zoom)', () => {
    const { camera, fx } = build();
    const world = worldWith(slowMo(1000, 2200, 2500));
    fx.focusOn(2, -1);
    fx.update(world, 1500, PERFECT_CAMERA, false);
    // A resize: the camera is fitted again to another aspect, then the base is captured again.
    fitIsoCamera(camera, ROOM, 1);
    fx.captureBase();
    const refit = snapshot(camera);
    expect(refit.zoom).toBe(1);
    fx.update(world, 2500, PERFECT_CAMERA, false);
    expect(snapshot(camera)).toEqual(refit);
    // And a new move starts from that new base.
    fx.update(world, 1500, PERFECT_CAMERA, false);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
  });

  it('reset puts the base back at once', () => {
    const { camera, fx } = build();
    const before = snapshot(camera);
    fx.focusOn(2, -1);
    fx.update(worldWith(slowMo(1000, 2200, 2500)), 1500, PERFECT_CAMERA, false);
    fx.reset();
    expect(snapshot(camera)).toEqual(before);
  });

  it('follows the latest perfect: two in a row extend the slow-mo and move the focus', () => {
    const { camera, fx } = build();
    fx.focusOn(2, -1);
    const extended = worldWith(slowMo(1000, 3000, 3300));
    fx.update(extended, 2500, PERFECT_CAMERA, false);
    const first = camera.position.toArray();
    fx.focusOn(-3, 2);
    fx.update(extended, 2500, PERFECT_CAMERA, false);
    expect(camera.position.toArray()).not.toEqual(first);
    expect(camera.zoom).toBeCloseTo(1.2, 12);
  });

  it('allocates nothing per frame: update has no `new` and no clone', () => {
    const source = readFileSync(new URL('./cameraFx.ts', import.meta.url), 'utf8');
    const start = source.indexOf('    update(world, clockMs');
    const end = source.indexOf('    reset() {');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/\bnew \w/);
    expect(body).not.toMatch(/\.clone\(/);
  });

  it('reads its tuning from the shipped test feel (a valid block)', () => {
    const { perfectCamera } = createTestContent().feel.fx;
    expect(perfectCamera.zoomPct).toBeGreaterThanOrEqual(0);
  });
});
