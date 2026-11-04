import { describe, expect, it } from 'vitest';
import { FOLLOW_SNAP_AFTER_MS, ISO_FIT_MARGIN_PCT, STEP_MS } from './constants.ts';
import {
  clampFollowAxis,
  createFollowFrame,
  createFollowState,
  type FollowBox,
  type FollowFrame,
  type FollowParams,
  type FollowState,
  fitFollowFrame,
  settleFollow,
  snapFollow,
  stepFollow,
  viewUM,
  viewVM,
  worldOfView,
} from './followCamera.ts';

const PARAMS: FollowParams = {
  frameWidthM: 9.1,
  frameDepthM: 6.2,
  deadZoneWidthPct: 30,
  deadZoneHeightPct: 30,
  edgeMarginPct: 15,
  catchUpMs: 400,
  dampingRatio: 0.8,
  reducedCatchUpMs: 800,
};
/** No dead zone, no margin: the spring alone. */
const SPRING: FollowParams = {
  ...PARAMS,
  deadZoneWidthPct: 0,
  deadZoneHeightPct: 0,
  edgeMarginPct: 0,
};
/** A room much bigger than the frame: the clamp never bites. */
const HUGE: FollowBox = { widthM: 200, depthM: 200, heightM: 3.3, floorYM: -0.8 };
/** The big room of 9.1 (its bounds). */
const KITCHEN: FollowBox = {
  widthM: 14.6,
  depthM: 7.2,
  heightM: 3.3,
  floorYM: -0.8,
  centerXM: 0.35,
  centerZM: -0.1,
};
const ASPECT = 16 / 9;

function frameOf(room: FollowBox, params = PARAMS, aspect = ASPECT): FollowFrame {
  const frame = createFollowFrame();
  fitFollowFrame(frame, room, params.frameWidthM, params.frameDepthM, aspect);
  return frame;
}

/** A started state at rest on `(uM, vM)`, at sim time 0. */
function restingAt(uM: number, vM: number): FollowState {
  const state = createFollowState();
  state.centreUM = uM;
  state.centreVM = vM;
  state.lastAtMs = 0;
  return state;
}

/** Steps every `STEP_MS` from `fromMs` for `forMs`, the aim given per time; returns what `each` collects. */
function run<T>(
  state: FollowState,
  frame: FollowFrame,
  params: FollowParams,
  isReduced: boolean,
  fromMs: number,
  forMs: number,
  aimAt: (atMs: number) => [uM: number, vM: number],
  each: (atMs: number) => T,
): T[] {
  const out: T[] = [];
  for (let atMs = fromMs + STEP_MS; atMs <= fromMs + forMs + 1e-9; atMs += STEP_MS) {
    const [uM, vM] = aimAt(atMs);
    stepFollow(state, frame, params, isReduced, uM, vM, uM, vM, atMs);
    out.push(each(atMs));
  }
  return out;
}

/** The sim time a jump of `jumpM` along u takes to be covered to 95 %, from rest. */
function reachMs(params: FollowParams, isReduced: boolean, jumpM = 3): number {
  const frame = frameOf(HUGE, params);
  const state = restingAt(0, 0);
  for (let atMs = STEP_MS; atMs < 10_000; atMs += 1) {
    stepFollow(state, frame, params, isReduced, jumpM, 0, jumpM, 0, atMs);
    if (state.centreUM >= jumpM * 0.95) return atMs;
  }
  throw new Error('never reached');
}

describe('the view plane (story 9.2, D3)', () => {
  // The checks against the game's own `three` camera are in `client/render/isoCamera.test.ts`
  // (`shared` tests may not import it).
  it('turns a view point back into the world point at a given height', () => {
    const out = { xM: 0, zM: 0 };
    for (const [x, y, z] of [
      [1.2, 0.85, -3.1],
      [-6.4, 1.05, -2],
      [0, -0.8, 0],
    ] as const) {
      worldOfView(viewUM(x, z), viewVM(x, y, z), y, out);
      expect(out.xM).toBeCloseTo(x, 9);
      expect(out.zM).toBeCloseTo(z, 9);
    }
  });

  it("widens the frame on one axis to the aspect, and grows the room's extent by the fit's margin", () => {
    for (const aspect of [844 / 390, 667 / 375, 4 / 3, 0.5]) {
      const frame = frameOf(KITCHEN, PARAMS, aspect);
      expect(frame.halfWidthM / frame.halfHeightM).toBeCloseTo(aspect, 9);
    }
    const frame = frameOf(KITCHEN);
    const lookYM = -0.8 + 3.3 / 2;
    expect(frame.lookYM).toBeCloseTo(lookYM, 12);
    expect((frame.minUM + frame.maxUM) / 2).toBeCloseTo(viewUM(0.35, -0.1), 9);
    expect((frame.minVM + frame.maxVM) / 2).toBeCloseTo(viewVM(0.35, lookYM, -0.1), 9);
    // Each of the 8 corners of the room box is inside the extent, by the fit's margin.
    let farthestUM = 0;
    for (const x of [0.35 - 7.3, 0.35 + 7.3]) {
      for (const z of [-0.1 - 3.6, -0.1 + 3.6]) {
        for (const y of [-0.8, 2.5]) {
          farthestUM = Math.max(farthestUM, Math.abs(viewUM(x, z) - viewUM(0.35, -0.1)));
          expect(viewVM(x, y, z)).toBeGreaterThan(frame.minVM);
          expect(viewVM(x, y, z)).toBeLessThan(frame.maxVM);
        }
      }
    }
    expect((frame.maxUM - frame.minUM) / 2).toBeCloseTo(
      farthestUM * (1 + ISO_FIT_MARGIN_PCT / 100),
      9,
    );
  });
});

describe('the follow (story 9.2, AC 3, 4, 8)', () => {
  it('leaves the centre still while Papa moves inside the dead zone', () => {
    const frame = frameOf(HUGE);
    const state = restingAt(0, 0);
    const inside = frame.halfWidthM * 0.29;
    run(
      state,
      frame,
      PARAMS,
      false,
      0,
      600,
      (atMs) => [inside * Math.sin(atMs / 90), 0],
      () => 0,
    );
    expect(state.centreUM).toBe(0);
    expect(state.centreVM).toBe(0);
  });

  it('starts moving once Papa crosses the dead zone, toward the nearest centre that keeps him on its edge', () => {
    const frame = frameOf(HUGE);
    const state = restingAt(0, 0);
    const edge = (frame.halfWidthM * PARAMS.deadZoneWidthPct) / 100;
    run(
      state,
      frame,
      PARAMS,
      false,
      0,
      3000,
      () => [edge + 1, 0],
      () => 0,
    );
    // The slight overshoot of a 0.8 damping ends inside the dead zone, where nothing pulls it back.
    expect(state.centreUM).toBeGreaterThanOrEqual(1);
    expect(state.centreUM).toBeLessThan(1.03);
    const exact = restingAt(0, 0);
    run(
      exact,
      frame,
      { ...PARAMS, dampingRatio: 1 },
      false,
      0,
      5000,
      () => [edge + 1, 0],
      () => 0,
    );
    expect(exact.centreUM).toBeCloseTo(1, 6);
  });

  it('covers 95 % of a jump in catchUpMs (± 10 %)', () => {
    const atMs = reachMs(SPRING, false);
    expect(atMs).toBeGreaterThanOrEqual(SPRING.catchUpMs * 0.9);
    expect(atMs).toBeLessThanOrEqual(SPRING.catchUpMs * 1.1);
    const slow = { ...SPRING, catchUpMs: 1200, reducedCatchUpMs: 1200 };
    expect(reachMs(slow, false)).toBeGreaterThanOrEqual(1200 * 0.9);
    expect(reachMs(slow, false)).toBeLessThanOrEqual(1200 * 1.1);
  });

  it('has a continuous velocity when Papa sets off: no jump, no jolt', () => {
    const frame = frameOf(HUGE);
    const state = restingAt(0, 0);
    const speedMps = 3;
    const speeds = run(
      state,
      frame,
      SPRING,
      false,
      0,
      1500,
      (atMs) => [(speedMps * atMs) / 1000, 0],
      () => state.velocityUMps,
    );
    let previous = 0;
    for (const speed of speeds) {
      expect(Math.abs(speed - previous)).toBeLessThan(speedMps * 0.15);
      previous = speed;
    }
    // It does catch up with Papa's speed.
    expect(speeds.at(-1)).toBeCloseTo(speedMps, 1);
  });

  it('overshoots a little at a damping of 0.8: above 0, under 3 %', () => {
    const frame = frameOf(HUGE);
    const state = restingAt(0, 0);
    const positions = run(
      state,
      frame,
      SPRING,
      false,
      0,
      3000,
      () => [4, 0],
      () => state.centreUM,
    );
    const overshootPct = ((Math.max(...positions) - 4) / 4) * 100;
    expect(overshootPct).toBeGreaterThan(0);
    expect(overshootPct).toBeLessThan(3);
  });

  it.each<[string, FollowParams, boolean]>([
    ['a damping of 1', { ...SPRING, dampingRatio: 1 }, false],
    ['reduced motion', SPRING, true],
  ])(
    'never overshoots with %s: the distance to the goal never grows nor changes sign',
    (_name, params, isReduced) => {
      const frame = frameOf(HUGE, params);
      const state = restingAt(0, 0);
      const errors = run(
        state,
        frame,
        params,
        isReduced,
        0,
        5000,
        () => [4, -2],
        () => [4 - state.centreUM, -2 - state.centreVM] as const,
      );
      let [previousU, previousV] = [4, -2];
      for (const [errorU, errorV] of errors) {
        expect(errorU).toBeGreaterThanOrEqual(0);
        expect(errorV).toBeLessThanOrEqual(0);
        expect(errorU).toBeLessThanOrEqual(previousU);
        expect(errorV).toBeGreaterThanOrEqual(previousV);
        [previousU, previousV] = [errorU, errorV];
      }
    },
  );

  it('catches up more slowly under reduced motion', () => {
    expect(reachMs(SPRING, true)).toBeGreaterThan(reachMs(SPRING, false));
    expect(reachMs(SPRING, true)).toBeGreaterThanOrEqual(SPRING.reducedCatchUpMs * 0.9);
  });

  it.each([false, true])(
    'keeps Papa at least the edge margin from every edge through a 13 m glide in 900 ms (reduced: %s)',
    (isReduced) => {
      const frame = frameOf(HUGE);
      const marginUM = (2 * frame.halfWidthM * PARAMS.edgeMarginPct) / 100;
      const marginVM = (2 * frame.halfHeightM * PARAMS.edgeMarginPct) / 100;
      // Along the floor diagonal that crosses the screen fastest, then along the other one.
      for (const [dx, dz] of [
        [Math.SQRT1_2, -Math.SQRT1_2],
        [-Math.SQRT1_2, -Math.SQRT1_2],
      ] as const) {
        const state = createFollowState();
        stepFollow(state, frame, PARAMS, isReduced, 0, 0, 0, 0, 0);
        for (let atMs = 1; atMs <= 1400; atMs += 1) {
          const travelM = 13 * Math.min(1, atMs / 900);
          const papaUM = viewUM(dx * travelM, dz * travelM);
          const papaVM = viewVM(dx * travelM, 0, dz * travelM);
          stepFollow(state, frame, PARAMS, isReduced, papaUM, papaVM, papaUM, papaVM, atMs);
          expect(frame.halfWidthM - Math.abs(papaUM - state.centreUM)).toBeGreaterThanOrEqual(
            marginUM - 1e-9,
          );
          expect(frame.halfHeightM - Math.abs(papaVM - state.centreVM)).toBeGreaterThanOrEqual(
            marginVM - 1e-9,
          );
        }
      }
    },
  );

  it("never takes the view out of the room's extent", () => {
    const frame = frameOf(KITCHEN, PARAMS, 4 / 3);
    const state = createFollowState();
    // A walk along the room's walls, both ways.
    const corners = [
      [-6.75, 3.5],
      [6.75, 3.5],
      [6.75, -3.5],
      [-6.75, -3.5],
    ] as const;
    for (let atMs = 0; atMs <= 16_000; atMs += 16) {
      const leg = Math.floor(atMs / 2000) % 4;
      const u = (atMs % 2000) / 2000;
      const [ax, az] = corners[leg] as readonly [number, number];
      const [bx, bz] = corners[(leg + 1) % 4] as readonly [number, number];
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      stepFollow(
        state,
        frame,
        PARAMS,
        false,
        viewUM(x, z),
        viewVM(x, 0, z),
        viewUM(x, z),
        viewVM(x, 0, z),
        atMs,
      );
      expect(state.centreUM - frame.halfWidthM).toBeGreaterThanOrEqual(frame.minUM - 1e-9);
      expect(state.centreUM + frame.halfWidthM).toBeLessThanOrEqual(frame.maxUM + 1e-9);
      expect(state.centreVM - frame.halfHeightM).toBeGreaterThanOrEqual(frame.minVM - 1e-9);
      expect(state.centreVM + frame.halfHeightM).toBeLessThanOrEqual(frame.maxVM + 1e-9);
    }
  });

  it("centres the view on the room on an axis where the frame is wider than the room's extent", () => {
    // A landscape phone sees the whole width of the kitchen at the salon's scale.
    const frame = frameOf(KITCHEN, PARAMS, 844 / 390);
    expect(2 * frame.halfWidthM).toBeGreaterThan(frame.maxUM - frame.minUM);
    const state = createFollowState();
    for (let atMs = 0; atMs <= 3000; atMs += 10) {
      const x = -6.4 + (12.8 * atMs) / 3000;
      stepFollow(
        state,
        frame,
        PARAMS,
        false,
        viewUM(x, 0),
        viewVM(x, 0, 0),
        viewUM(x, 0),
        viewVM(x, 0, 0),
        atMs,
      );
      expect(state.centreUM).toBe((frame.minUM + frame.maxUM) / 2);
      expect(state.velocityUMps).toBe(0);
    }
    expect(clampFollowAxis(3, 5, -4, 4)).toBe(0);
    expect(clampFollowAxis(3, 1, -4, 4)).toBe(3);
    expect(clampFollowAxis(-3.5, 1, -4, 4)).toBe(-3);
  });

  it('snaps onto the aim on its first step, and onto the dead zone goal after more than FOLLOW_SNAP_AFTER_MS', () => {
    const frame = frameOf(HUGE);
    const state = createFollowState();
    stepFollow(state, frame, PARAMS, false, 2, -1, 2, -1, 5000);
    expect([state.centreUM, state.centreVM, state.velocityUMps, state.lastAtMs]).toEqual([
      2, -1, 0, 5000,
    ]);
    stepFollow(state, frame, PARAMS, false, 9, -1, 9, -1, 5010);
    expect(state.velocityUMps).not.toBe(0);
    const { centreUM, centreVM } = state;
    const deadHalfUM = (frame.halfWidthM * PARAMS.deadZoneWidthPct) / 100;
    const deadHalfVM = (frame.halfHeightM * PARAMS.deadZoneHeightPct) / 100;
    // Out of the dead zone on both axes: the nearest centre that puts the aim back on its edge.
    const farUM = centreUM - deadHalfUM - 3;
    const farVM = centreVM + deadHalfVM + 2;
    let atMs = 5010 + FOLLOW_SNAP_AFTER_MS + 1;
    stepFollow(state, frame, PARAMS, false, farUM, farVM, farUM, farVM, atMs);
    expect(state.centreUM).toBeCloseTo(farUM + deadHalfUM, 9);
    expect(state.centreVM).toBeCloseTo(farVM - deadHalfVM, 9);
    expect([state.velocityUMps, state.velocityVMps, state.lastAtMs]).toEqual([0, 0, atMs]);
    // Inside the dead zone: a long jump of the clock does not re-centre the view.
    const before = [state.centreUM, state.centreVM];
    atMs += FOLLOW_SNAP_AFTER_MS + 1;
    stepFollow(state, frame, PARAMS, false, farUM + 0.5, farVM, farUM + 0.5, farVM, atMs);
    expect([state.centreUM, state.centreVM]).toEqual(before);
  });

  it('snaps under the edge margin and the room’s bounds too', () => {
    const frame = frameOf(KITCHEN, PARAMS, 4 / 3);
    const state = createFollowState();
    // Aim at a threat far from Papa: the margin keeps Papa in the frame, the clamp in the room.
    snapFollow(
      state,
      frame,
      PARAMS,
      viewUM(5, 1),
      viewVM(5, 0, 1),
      viewUM(-6, -3),
      viewVM(-6, 0, -3),
      0,
    );
    const limitUM = frame.halfWidthM * (1 - (2 * PARAMS.edgeMarginPct) / 100);
    expect(Math.abs(viewUM(5, 1) - state.centreUM)).toBeLessThanOrEqual(limitUM + 1e-9);
    expect(state.centreUM - frame.halfWidthM).toBeGreaterThanOrEqual(frame.minUM - 1e-9);
  });

  it('does nothing when the sim clock did not move forward', () => {
    const frame = frameOf(HUGE);
    const state = restingAt(0, 0);
    stepFollow(state, frame, PARAMS, false, 5, 0, 5, 0, 100);
    const before = { ...state };
    stepFollow(state, frame, PARAMS, false, 9, 3, 9, 3, 100);
    expect(state).toEqual(before);
    stepFollow(state, frame, PARAMS, false, 9, 3, 9, 3, 90);
    expect(state).toEqual(before);
  });

  it('settles a refitted frame without moving the clock or catching up', () => {
    const wide = frameOf(KITCHEN, PARAMS, 4 / 3);
    const state = restingAt(viewUM(-6, 0), viewVM(-6, 0, 0));
    state.lastAtMs = 700;
    const narrow = frameOf(KITCHEN, { ...PARAMS, frameWidthM: 4, frameDepthM: 3 }, 4 / 3);
    settleFollow(state, narrow, PARAMS, viewUM(4, 2), viewVM(4, 0, 2));
    expect(state.lastAtMs).toBe(700);
    const limitUM = narrow.halfWidthM * (1 - (2 * PARAMS.edgeMarginPct) / 100);
    expect(Math.abs(viewUM(4, 2) - state.centreUM)).toBeLessThanOrEqual(limitUM + 1e-9);
    expect(wide.halfWidthM).toBeGreaterThan(narrow.halfWidthM);
  });

  it('gives the same outputs for the same inputs (no hidden state, no clock, no randomness)', () => {
    const play = (): FollowState => {
      const frame = frameOf(KITCHEN);
      const state = createFollowState();
      for (let atMs = 0; atMs <= 4000; atMs += 13) {
        const x = 6 * Math.sin(atMs / 700);
        const z = 3 * Math.cos(atMs / 500);
        stepFollow(
          state,
          frame,
          PARAMS,
          atMs > 2000,
          viewUM(x, z),
          viewVM(x, 0, z),
          viewUM(x, z),
          viewVM(x, 0, z),
          atMs,
        );
      }
      return state;
    };
    expect(play()).toEqual(play());
  });

  it('barely depends on the frame rate', () => {
    const at = (frameMs: number): number => {
      const frame = frameOf(HUGE);
      const state = restingAt(0, 0);
      for (let atMs = frameMs; atMs <= 600; atMs += frameMs) {
        stepFollow(state, frame, SPRING, false, 4, 0, 4, 0, atMs);
      }
      return state.centreUM;
    };
    expect(at(10)).toBeCloseTo(at(20), 6);
  });

  it('barely depends on the frame rate with Papa walking, the dead zone and the margin', () => {
    // Papa walks along u at 3 m/s for a second, then stands; the aim is sampled once per frame.
    const papaUMAt = (atMs: number): number => (3 * Math.min(atMs, 1000)) / 1000;
    const at = (framesPerS: number): number => {
      const frame = frameOf(HUGE);
      const state = restingAt(0, 0);
      for (let i = 1; i <= (1500 * framesPerS) / 1000; i++) {
        const atMs = (i * 1000) / framesPerS;
        const papaUM = papaUMAt(atMs);
        stepFollow(state, frame, PARAMS, false, papaUM, 0, papaUM, 0, atMs);
      }
      return state.centreUM;
    };
    expect(at(30)).not.toBe(0);
    expect(Math.abs(at(30) - at(100))).toBeLessThan(0.05);
    expect(Math.abs(at(60) - at(100))).toBeLessThan(0.02);
  });
});
