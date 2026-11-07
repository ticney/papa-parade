import { readFileSync } from 'node:fs';
import type { BotView, VisibilityCounters } from '@bots/bot';
import { createSight } from '@bots/botSight';
import { botViewOf, createVisibilityCounters } from '@bots/botView';
import { OFFSCREEN_BUBBLE_MAX_COUNT, STEP_MS } from '@shared/constants';
import {
  createFollowFrame,
  createFollowState,
  type FollowParams,
  fitFollowFrame,
  snapFollow,
  stepFollow,
  viewUM,
  viewVM,
} from '@shared/followCamera';
import { asSimMs } from '@shared/time';
import type { ThreatInstance, World } from '@sim';
import { describe, expect, it } from 'vitest';

// The `human` bot's sight (story 9.8) on the live big room: the real geometry, `feel.camera` and
// `bots.json` screen, read here and never copied, with hand-made worlds that hold only what the sight reads.

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const geometry = readJson<{
  boundsMinM: [number, number, number];
  boundsMaxM: [number, number, number];
  anchors: { id: string; positionM: [number, number, number] }[];
}>('content/levels/salon_kitchen.geometry.json');
const camera = readJson<{ camera: FollowParams }>('content/feel.json').camera;
const screen = readJson<{ human: { view: Parameters<typeof botViewOf>[0]['screen'] } }>(
  'content/bots.json',
).human.view;

/** Each threat def the tests use, anchored. */
const TARGETS = { mischief: { target: 'anchor' }, silence: { target: 'hiddenZone' } } as const;
const view = (overrides: Partial<Parameters<typeof botViewOf>[0]['screen']> = {}): BotView => {
  const made = botViewOf({
    camera: 'follow',
    geometry,
    threats: TARGETS,
    babyBodyRadiusM: 0.2,
    screen: { ...screen, ...overrides },
  });
  if (made === null) throw new Error('a follow level must give a view');
  return made;
};

const anchor = (id: string): readonly [number, number, number] => {
  const found = geometry.anchors.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no anchor ${id}`);
  return found.positionM;
};
/** Papa at the sofa end (where the game starts) and the anchors at the opposite end of the room. */
const SOFA_END = { xM: 5.25, zM: 1 };
const FAR_ANCHORS = ['dishwasher', 'stove', 'low_cabinet', 'bin', 'coffee_machine'] as const;

let nextId = 1;
const threat = (
  anchorId: string,
  enteredAt: number,
  windowMs: number,
  overrides: Partial<ThreatInstance> = {},
): ThreatInstance => {
  const [xM, , zM] = anchor(anchorId);
  return {
    id: nextId++,
    defId: 'mischief',
    anchorId,
    xM,
    zM,
    state: 'telegraph',
    enteredAt: asSimMs(enteredAt),
    windowOpenAt: asSimMs(enteredAt + 1000),
    feintAt: null,
    isFeintGiven: false,
    responseWindow: { windowMs, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
    press: null,
    waveIndex: 0,
    ...overrides,
  } as ThreatInstance;
};

/** A world with only what the sight reads. */
const worldOf = (
  nowMs: number,
  papa: { xM: number; zM: number },
  threats: ThreatInstance[],
): Readonly<World> =>
  ({
    time: { sim: asSimMs(nowMs) },
    feel: { camera },
    papa,
    threats,
  }) as unknown as Readonly<World>;

const newSight = (
  botView: BotView = view(),
): { sight: ReturnType<typeof createSight>; counters: VisibilityCounters } => {
  const counters = createVisibilityCounters();
  return { sight: createSight(botView, counters), counters };
};

describe('the sight of the human bot', () => {
  it('sees at its telegraph a threat that is in the frame, with no bubble to read', () => {
    const { sight, counters } = newSight();
    const near = threat('papa_mug', 1000, 600);
    sight.update(worldOf(1000, { xM: 4.6, zM: -1.6 }, [near]));
    expect(sight.seenAt(near)).toBe(1000);
    expect(counters).toMatchObject({ telegraphs: 1, seenOffscreen: 0, seenLate: 0, neverSeen: 0 });
  });

  it('sees a threat outside the frame through its bubble, a bubble reading later', () => {
    const { sight, counters } = newSight(view({ bubbleReadMs: 120 }));
    const far = threat('stove', 1000, 600);
    sight.update(worldOf(1000, SOFA_END, [far]));
    expect(sight.seenAt(far)).toBe(1120);
    expect(counters).toMatchObject({
      telegraphs: 1,
      seenOffscreen: 1,
      seenLate: 1,
      seenLateDelayMs: 120,
      cappedMs: 0,
    });
  });

  it('knows nothing of a threat that the world does not list as active', () => {
    const { sight } = newSight();
    const idle = threat('stove', 1000, 600, { state: 'idle' });
    sight.update(worldOf(1000, SOFA_END, [idle]));
    expect(sight.seenAt(idle)).toBeNull();
  });

  it('gives a bubble to the three most urgent threats outside the frame only: a fourth waits for one', () => {
    const { sight, counters } = newSight();
    // Four threats outside the frame; the first closes last (the longest window), so it is the one left out.
    const windows = [900, 500, 600, 700];
    const far = FAR_ANCHORS.slice(0, 4).map((id, i) => threat(id, 1000, windows[i] as number));
    sight.update(worldOf(1000, SOFA_END, far));
    const seen = far.map((candidate) => sight.seenAt(candidate));
    expect(seen.filter((at) => at !== null)).toHaveLength(OFFSCREEN_BUBBLE_MAX_COUNT);
    expect(seen[0]).toBeNull();
    expect(counters.seenOffscreen).toBe(OFFSCREEN_BUBBLE_MAX_COUNT);
    expect(counters.cappedMs).toBe(STEP_MS);

    // The next step it still waits, and the wait adds up.
    sight.update(worldOf(1000 + STEP_MS, SOFA_END, far));
    expect(sight.seenAt(far[0] as ThreatInstance)).toBeNull();
    expect(counters.cappedMs).toBe(2 * STEP_MS);

    // A bubble frees up (the most urgent threat is answered): the fourth gets it, and reads it.
    (far[1] as ThreatInstance).state = 'resolved';
    sight.update(worldOf(1000 + 2 * STEP_MS, SOFA_END, far));
    expect(sight.seenAt(far[0] as ThreatInstance)).toBe(1000 + 2 * STEP_MS + view().bubbleReadMs);
  });

  it('counts a threat whose window closed before it was ever seen, and never gives it a sighting', () => {
    const { sight, counters } = newSight();
    const far = FAR_ANCHORS.slice(0, 4).map((id, i) =>
      threat(id, 1000, [900, 500, 600, 700][i] as number),
    );
    sight.update(worldOf(1000, SOFA_END, far));
    const left = far[0] as ThreatInstance;
    left.state = 'gag';
    sight.update(worldOf(1000 + STEP_MS, SOFA_END, far));
    expect(counters.neverSeen).toBe(1);
    expect(sight.seenAt(left)).toBeNull();
    // Counted once, not at every later step.
    sight.update(worldOf(1000 + 2 * STEP_MS, SOFA_END, far));
    expect(counters.neverSeen).toBe(1);
  });

  it('sees a waiting threat the moment it comes into the frame, with no bubble to read', () => {
    const { sight, counters } = newSight();
    const far = FAR_ANCHORS.slice(0, 4).map((id, i) =>
      threat(id, 1000, [900, 500, 600, 700][i] as number),
    );
    sight.update(worldOf(1000, SOFA_END, far));
    expect(sight.seenAt(far[0] as ThreatInstance)).toBeNull();
    // Papa runs to the kitchen end: more than a second later the camera has caught up with him.
    const [dishwasherX, , dishwasherZ] = anchor('dishwasher');
    const atMs = 3500;
    sight.update(worldOf(atMs, { xM: dishwasherX + 0.6, zM: dishwasherZ + 0.8 }, far));
    expect(sight.seenAt(far[0] as ThreatInstance)).toBe(atMs);
    expect(counters.seenOffscreen).toBe(OFFSCREEN_BUBBLE_MAX_COUNT);
  });

  it('puts a threat under the HUD row in the same case as one outside the frame', () => {
    // Same world, a screen whose HUD row is taller than the room is high: nothing is below it.
    const { sight, counters } = newSight(view({ hudBottomPx: 380 }));
    const near = threat('papa_mug', 1000, 600);
    sight.update(worldOf(1000, { xM: 4.6, zM: -1.6 }, [near]));
    expect(sight.seenAt(near)).toBe(1000 + view().bubbleReadMs);
    expect(counters.seenOffscreen).toBe(1);
  });

  it('puts the marker of a threat on the baby at its own point, not at an anchor', () => {
    const { sight } = newSight();
    const [mugX, , mugZ] = anchor('papa_mug');
    const nearBy = threat('papa_mug', 1000, 600, { defId: 'silence', xM: mugX, zM: mugZ });
    const farAway = threat('papa_mug', 1000, 600, { defId: 'silence', xM: -6.5, zM: -3 });
    sight.update(worldOf(1000, { xM: mugX, zM: mugZ + 0.5 }, [nearBy, farAway]));
    expect(sight.seenAt(nearBy)).toBe(1000);
    expect(sight.seenAt(farAway)).toBe(1000 + view().bubbleReadMs);
  });

  it('keeps the frame of the client: the same centre as followCamera on the same path of Papa', () => {
    const botView = view();
    const { sight } = newSight(botView);
    const aspect = botView.screen.widthPx / botView.screen.heightPx;
    // The client's own sequence (followRig.fit, then update at each frame), in the pure maths.
    const frame = createFollowFrame();
    const state = createFollowState();
    fitFollowFrame(frame, botView.room, camera.frameWidthM, camera.frameDepthM, aspect);
    const start = { xM: SOFA_END.xM, zM: SOFA_END.zM };
    snapFollow(
      state,
      frame,
      camera,
      viewUM(start.xM, start.zM),
      viewVM(start.xM, 0, start.zM),
      viewUM(start.xM, start.zM),
      viewVM(start.xM, 0, start.zM),
      0,
    );
    state.lastAtMs = null;
    let worstGapM = 0;
    for (let step = 0; step < 150; step++) {
      const nowMs = step * STEP_MS;
      // Papa walks from the sofa end to the kitchen end at 2 m/s.
      const xM = Math.max(-5.5, SOFA_END.xM - (2 * nowMs) / 1000);
      const papaUM = viewUM(xM, SOFA_END.zM);
      const papaVM = viewVM(xM, 0, SOFA_END.zM);
      stepFollow(state, frame, camera, false, papaUM, papaVM, papaUM, papaVM, nowMs);
      sight.update(worldOf(nowMs, { xM, zM: SOFA_END.zM }, []));
      worstGapM = Math.max(
        worstGapM,
        Math.abs(sight.centreUM - state.centreUM),
        Math.abs(sight.centreVM - state.centreVM),
      );
    }
    expect(worstGapM).toBeLessThan(1e-9);
    // And the camera really moved: the walk is not a test of a frame that stands still.
    expect(Math.abs(state.centreUM - viewUM(SOFA_END.xM, SOFA_END.zM))).toBeGreaterThan(1);
  });

  it('follows a retuned frame size (a SetFeel), refitting on its own', () => {
    const { sight } = newSight();
    const far = threat('stove', 1000, 600);
    const wide = {
      ...camera,
      frameWidthM: camera.frameWidthM * 3,
      frameDepthM: camera.frameDepthM * 3,
    };
    const world = worldOf(1000, SOFA_END, [far]);
    (world as { feel: { camera: FollowParams } }).feel.camera = wide;
    sight.update(world);
    // A frame three times wider holds the whole room: the stove is in it.
    expect(sight.seenAt(far)).toBe(1000);
  });
});
