import type { Feel } from '@content/schemas/feel';
import { asSimMs } from '@shared/time';
import type { SimEvent, World } from '@sim';
import { describe, expect, it } from 'vitest';
import { createCameraFx, type SequenceFraming } from './cameraFx.ts';
import { createFollowRig, type LevelCameraSetup } from './followRig.ts';
import { createIsoCamera, fitIsoCamera, type RoomSize } from './isoCamera.ts';

const PARAMS: Feel['camera'] = {
  frameWidthM: 9.1,
  frameDepthM: 6.2,
  deadZoneWidthPct: 30,
  deadZoneHeightPct: 30,
  edgeMarginPct: 15,
  catchUpMs: 400,
  dampingRatio: 0.8,
  reducedCatchUpMs: 800,
};
/** The big room of 9.1 (its bounds). */
const KITCHEN: RoomSize = {
  widthM: 14.6,
  depthM: 7.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};
const ASPECT = 4 / 3;
const NO_FRAMING: SequenceFraming = { blend: 0, zoomPct: 0, focusPct: 0, xM: 0, zM: 0 };
const FOLLOW: LevelCameraSetup = {
  mode: 'follow',
  follow: PARAMS,
  papaStartXM: 5.25,
  papaStartZM: 1,
};
/** A threat far from Papa's start, at the kitchen end. */
const THREAT = { id: 7, xM: -6.4, zM: -2 };

interface WorldBits {
  slowMos?: { source: string; startedAt: number; holdUntil: number; endsAt: number }[];
  sequenceStartedAt?: number;
  camera?: Feel['camera'];
}

const worldOf = ({ slowMos = [], sequenceStartedAt = 0, camera = PARAMS }: WorldBits = {}) =>
  ({
    time: {
      sim: asSimMs(0),
      slowMos: slowMos.map((slowMo) => ({
        ...slowMo,
        scale: 0.3,
        startedAt: asSimMs(slowMo.startedAt),
        holdUntil: asSimMs(slowMo.holdUntil),
        endsAt: asSimMs(slowMo.endsAt),
      })),
    },
    threats: [THREAT],
    sequence: { startedAt: asSimMs(sequenceStartedAt) },
    feel: { camera },
  }) as unknown as World;

const resolved = (t: number): SimEvent =>
  ({
    type: 'ResponseResolved',
    t: asSimMs(t),
    threatId: THREAT.id,
    quality: 'perfect',
  }) as SimEvent;
const gag = (t: number): SimEvent =>
  ({ type: 'GagTriggered', t: asSimMs(t), threatId: THREAT.id }) as SimEvent;

function build(setup: LevelCameraSetup = FOLLOW) {
  const camera = createIsoCamera();
  const fx = createCameraFx(camera);
  const rig = createFollowRig(camera, fx);
  rig.setLevel(KITCHEN, setup);
  rig.fit(ASPECT);
  return { camera, fx, rig };
}

/** Plays frames every 10 ms from `fromMs` to `toMs`, Papa standing at `(xM, zM)`. */
function play(
  built: ReturnType<typeof build>,
  world: World,
  fromMs: number,
  toMs: number,
  xM: number,
  zM: number,
  isReduced = false,
  framing = NO_FRAMING,
): void {
  for (let atMs = fromMs; atMs <= toMs; atMs += 10) {
    built.rig.update(world, atMs, xM, zM, framing, isReduced);
    built.fx.update(
      world,
      atMs,
      { zoomPct: 0, yawDeg: 0, focusPct: 0, zoomInMs: 0, refocusMs: 0 },
      isReduced,
      framing,
    );
  }
}

const centreOf = ({ fx }: ReturnType<typeof build>) => ({
  xM: fx.baseCentreXM,
  zM: fx.baseCentreZM,
});

describe('createFollowRig (story 9.2)', () => {
  it('leaves a fixed level on the whole room: fitIsoCamera, and no follow', () => {
    const built = build({ ...FOLLOW, mode: 'fixed' });
    const expected = createIsoCamera();
    fitIsoCamera(expected, KITCHEN, ASPECT);
    expect(built.camera.position.toArray()).toEqual(expected.position.toArray());
    expect(built.camera.projectionMatrix.toArray()).toEqual(expected.projectionMatrix.toArray());
    const before = built.camera.position.toArray();
    play(built, worldOf(), 0, 2000, -6, -3);
    expect(built.camera.position.toArray()).toEqual(before);
    expect(built.rig.mode).toBe('fixed');
  });

  it('frames Papa at his start behind the loading screen, and snaps on the first frame', () => {
    const built = build();
    const fitted = centreOf(built);
    // Not the room's centre: the frame stands on Papa's side of the room.
    expect(fitted.xM).toBeGreaterThan(1);
    built.rig.update(worldOf(), 5000, 5.25, 1, NO_FRAMING, false);
    expect(centreOf(built).xM).toBeCloseTo(fitted.xM, 9);
    expect(centreOf(built).zM).toBeCloseTo(fitted.zM, 9);
    expect(built.rig.mode).toBe('follow');
  });

  it('follows Papa to the kitchen end, and catches up more slowly under reduced motion', () => {
    const normal = build();
    const reduced = build();
    for (const built of [normal, reduced])
      built.rig.update(worldOf(), 0, 5.25, 1, NO_FRAMING, false);
    const start = centreOf(normal);
    play(normal, worldOf(), 10, 200, -6, -2.5, false);
    play(reduced, worldOf(), 10, 200, -6, -2.5, true);
    const normalMovedM = Math.hypot(centreOf(normal).xM - start.xM, centreOf(normal).zM - start.zM);
    const reducedMovedM = Math.hypot(
      centreOf(reduced).xM - start.xM,
      centreOf(reduced).zM - start.zM,
    );
    expect(normalMovedM).toBeGreaterThan(1);
    expect(reducedMovedM).toBeGreaterThan(0);
    expect(reducedMovedM).toBeLessThan(normalMovedM);
    // Both get there in the end (the normal one a little further: its slight overshoot stays in the
    // dead zone).
    play(normal, worldOf(), 210, 5000, -6, -2.5, false);
    play(reduced, worldOf(), 210, 5000, -6, -2.5, true);
    expect(centreOf(reduced).xM).toBeCloseTo(centreOf(normal).xM, 1);
    expect(centreOf(reduced).zM).toBeCloseTo(centreOf(normal).zM, 1);
  });

  it('frames the threat judged by a perfect until its slow-mo ends, then goes back to Papa', () => {
    const built = build();
    const perfect = { source: 'perfect', startedAt: 1000, holdUntil: 1600, endsAt: 1900 };
    const world = worldOf({ slowMos: [perfect] });
    play(built, worldOf(), 0, 990, 0, 0);
    const onPapa = centreOf(built);
    built.rig.onSimEvent(resolved(1000), world);
    play(built, world, 1000, 1890, 0, 0);
    expect(built.rig.aim).toBe('threat');
    const onThreat = centreOf(built);
    // It leaned toward the threat (−x), Papa's edge margin holding it back.
    expect(onThreat.xM).toBeLessThan(onPapa.xM - 0.3);
    play(built, worldOf(), 1900, 4000, 0, 0);
    expect(built.rig.aim).toBe('papa');
    expect(centreOf(built).xM).toBeGreaterThan(onThreat.xM + 0.3);
  });

  it('frames a gag judged inside an instinct slow-mo that had already started', () => {
    const built = build();
    const instinct = { source: 'instinct', startedAt: 500, holdUntil: 2500, endsAt: 3000 };
    const world = worldOf({ slowMos: [instinct] });
    play(built, world, 0, 1190, 0, 0);
    expect(built.rig.aim).toBe('papa');
    built.rig.onSimEvent(gag(1200), world);
    play(built, world, 1200, 1500, 0, 0);
    expect(built.rig.aim).toBe('threat');
    play(built, worldOf(), 3000, 3100, 0, 0);
    expect(built.rig.aim).toBe('papa');
  });

  it('frames a threat judged during a sequence framing', () => {
    const built = build();
    const framing: SequenceFraming = { blend: 0.6, zoomPct: 10, focusPct: 20, xM: 0, zM: 0 };
    const world = worldOf({ sequenceStartedAt: 800 });
    built.rig.onSimEvent(resolved(1000), world);
    play(built, world, 1000, 1200, 0, 0, false, framing);
    expect(built.rig.aim).toBe('threat');
    play(built, world, 1210, 1300, 0, 0);
    expect(built.rig.aim).toBe('papa');
  });

  it('changes nothing for a judgement with no slow-mo and no framing', () => {
    const judged = build();
    const plain = build();
    for (const built of [judged, plain]) play(built, worldOf(), 0, 990, 0, 0);
    judged.rig.onSimEvent(resolved(1000), worldOf());
    for (const built of [judged, plain]) play(built, worldOf(), 1000, 3000, 0, 0);
    expect(judged.rig.aim).toBe('papa');
    expect(centreOf(judged)).toEqual(centreOf(plain));
  });

  it('does not frame a judgement older than the slow-mo under way', () => {
    const built = build();
    built.rig.onSimEvent(resolved(400), worldOf());
    const later = { source: 'comboCashIn', startedAt: 1000, holdUntil: 1500, endsAt: 1800 };
    play(built, worldOf({ slowMos: [later] }), 1000, 1500, 0, 0);
    expect(built.rig.aim).toBe('papa');
  });

  it('records nothing in a fixed level', () => {
    const built = build({ ...FOLLOW, mode: 'fixed' });
    const perfect = { source: 'perfect', startedAt: 1000, holdUntil: 1600, endsAt: 1900 };
    built.rig.onSimEvent(resolved(1000), worldOf({ slowMos: [perfect] }));
    play(built, worldOf({ slowMos: [perfect] }), 1000, 1500, 0, 0);
    expect(built.rig.aim).toBe('papa');
  });

  it('refits a resize at the new aspect at once, re-clamped, with no catch-up', () => {
    const built = build();
    play(built, worldOf(), 0, 3000, -6, -2.5);
    const before = centreOf(built);
    const widthBefore = built.camera.right - built.camera.left;
    const heightBefore = built.camera.top - built.camera.bottom;
    built.rig.fit(844 / 390, PARAMS);
    // The same scale (the height binds at both aspects), a wider view.
    expect(built.camera.top - built.camera.bottom).toBeCloseTo(heightBefore, 9);
    expect(built.camera.right - built.camera.left).toBeGreaterThan(widthBefore);
    // A landscape phone sees the whole width of the kitchen: the view is centred across at once...
    const resized = centreOf(built);
    expect(resized).not.toEqual(before);
    // ...and the next frames do not move it (no catch-up: Papa has not moved).
    play(built, worldOf(), 3010, 3500, -6, -2.5);
    expect(centreOf(built).xM).toBeCloseTo(resized.xM, 9);
    expect(centreOf(built).zM).toBeCloseTo(resized.zM, 9);
  });

  it('refits at once when the frame size of the live feel changes (the feel panel)', () => {
    const built = build();
    play(built, worldOf(), 0, 100, 5.25, 1);
    const heightBefore = built.camera.top - built.camera.bottom;
    const tighter = { ...PARAMS, frameWidthM: 6, frameDepthM: 4 };
    built.rig.update(worldOf({ camera: tighter }), 110, 5.25, 1, NO_FRAMING, false);
    expect(built.camera.top - built.camera.bottom).toBeLessThan(heightBefore);
  });

  it('fits a new level on its own tuning, not on the feel of the level still running', () => {
    const tighter = { ...PARAMS, frameWidthM: 6, frameDepthM: 4 };
    const built = build({ ...FOLLOW, follow: tighter });
    const height = built.camera.top - built.camera.bottom;
    // The previous level's live feel, passed by a resize before the new level's first frame.
    built.rig.fit(ASPECT, PARAMS);
    expect(built.camera.top - built.camera.bottom).toBeCloseTo(height, 9);
    built.rig.update(worldOf({ camera: tighter }), 0, 5.25, 1, NO_FRAMING, false);
    // Once it runs, the live feel is its own.
    built.rig.fit(ASPECT, PARAMS);
    expect(built.camera.top - built.camera.bottom).toBeGreaterThan(height);
  });

  it('starts over on a new level: snaps to the new start', () => {
    const built = build();
    play(built, worldOf(), 0, 3000, -6, -2.5);
    built.rig.setLevel(KITCHEN, FOLLOW);
    built.rig.fit(ASPECT);
    const again = build();
    expect(centreOf(built).xM).toBeCloseTo(centreOf(again).xM, 9);
    expect(centreOf(built).zM).toBeCloseTo(centreOf(again).zM, 9);
  });
});
