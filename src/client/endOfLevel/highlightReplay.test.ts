import { STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { Sim, SimEvent } from '@sim';
import { Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeScheduler } from '../../../tests/support/fakeScheduler.ts';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import { createIsoCamera, fitFollowCamera } from '../render/isoCamera.ts';
import type { LevelScene } from '../render/levelScene.ts';
import { createHighlightReplay } from './highlightReplay.ts';
import type { Highlight } from './highlights.ts';
import type { MomentSim, ReplaySource } from './momentSim.ts';

beforeAll(() => {
  log.setLevel('error');
});

const RULES = { ...createTestFeedback().replay, endHoldMs: 300 };
const ROOM = { widthM: 9.1, depthM: 6.2, heightM: 2.5, centerXM: 0.35, centerZM: -0.1 };

const highlightAt = (t: number, anchorId: string | null = null): Highlight => ({
  t,
  threatId: t,
  points: 3,
  kinds: ['perfect'],
  anchorId,
});

interface FakeMoment {
  readonly built: MomentSim;
  readonly sim: Sim;
  readonly stats: { disposed: number; steps: number };
}

/** A sim double that runs from `fromMs` to `untilMs` and emits `scripted` events (by `t`) as it steps. */
function fakeMoment(
  fromMs: number,
  untilMs: number,
  scripted: readonly SimEvent[] = [],
  papa = { xM: 1.5, zM: -0.5 },
): FakeMoment {
  const stats = { disposed: 0, steps: 0 };
  const state = { simMs: fromMs, pending: [] as SimEvent[] };
  const sim = {
    world: {
      get time() {
        return { sim: state.simMs };
      },
      papa,
      threats: [],
    },
    timeScale: 1,
    freezeRealMs: 0,
    consumeFreeze: () => {},
    chores: [],
    step() {
      stats.steps++;
      state.simMs += STEP_MS;
      state.pending = scripted.filter((event) => event.t === state.simMs);
    },
    drainEvents() {
      const events = state.pending;
      state.pending = [];
      return events;
    },
    dispose() {
      stats.disposed++;
    },
  } as unknown as Sim;
  return { built: { sim, fromMs, untilMs }, sim, stats };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    moments?: (FakeMoment | 'fail')[];
    anchors?: { id: string; positionM: number[] }[];
    hasLevel?: boolean;
  } = {},
) {
  const scheduler = createFakeScheduler();
  const calls: string[] = [];
  const handled: string[] = [];
  const characterEvents: string[] = [];
  const updates: { atReal: number; simMs: number }[] = [];
  const renders: unknown[] = [];
  const moments = options.moments ?? [fakeMoment(0, 100), fakeMoment(0, 100)];
  const built: Highlight[] = [];
  const scene = new Scene();
  const level = {
    id: 'salon_crawler',
    scene,
    room: ROOM,
    fx: {
      playCharacterEvent: (event: SimEvent) => characterEvents.push(event.type),
    },
    update: (world: { time: { sim: number } }, _alpha: number, atReal: number) =>
      updates.push({ atReal, simMs: world.time.sim }),
    resetFx: () => calls.push('resetFx'),
  } as unknown as LevelScene;
  const replayCamera = createIsoCamera();
  const onMomentTrace: (number | null)[] = [];
  const onDone: string[] = [];
  const replay = createHighlightReplay({
    getLevel: () => (options.hasLevel === false ? null : level),
    renderer: {
      render: (_scene, camera) => {
        renders.push(camera);
        calls.push('render');
      },
    },
    replayCamera,
    getAspect: () => 2,
    director: {
      handle: (name) => {
        handled.push(name);
      },
      playCue: () => {},
    },
    isMotionReduced: () => false,
    drawLive: () => calls.push('drawLive'),
    scheduler,
    createMomentSim: async (_source, highlight) => {
      built.push(highlight);
      const next = moments.shift();
      if (next === undefined || next === 'fail') {
        return { ok: false, error: { kind: 'replay', message: 'refused' } };
      }
      return { ok: true, value: next.built };
    },
    onMoment: (index) => onMomentTrace.push(index),
  });
  const source = {
    geometry: { anchors: options.anchors ?? [] },
    level: { threats: {}, level: {}, disruptions: {}, sequences: {} },
  } as unknown as ReplaySource;
  const play = (highlights: readonly Highlight[]) =>
    replay.play(highlights, source, RULES, () => onDone.push('done'));
  return {
    replay,
    scheduler,
    calls,
    handled,
    characterEvents,
    updates,
    renders,
    built,
    replayCamera,
    onMomentTrace,
    onDone,
    play,
  };
}

/** Frames 0, 50 and 100 ms: ten steps, the last one reaching `untilMs = 100`. */
function playToEnd(scheduler: ReturnType<typeof createFakeScheduler>, atReal = 0): number {
  scheduler.tick(atReal);
  scheduler.tick(atReal + 50);
  scheduler.tick(atReal + 100);
  return atReal + 100;
}

describe('createHighlightReplay', () => {
  it('plays the moments in order, one sim at a time, and then calls onDone once', async () => {
    const first = fakeMoment(0, 100);
    const second = fakeMoment(0, 100);
    const { play, scheduler, onMomentTrace, onDone, replay } = setup({ moments: [first, second] });
    play([highlightAt(2000), highlightAt(9000)]);
    expect(replay.isPlaying).toBe(true);
    await flush();
    expect(onMomentTrace).toEqual([0]);
    let nowMs = playToEnd(scheduler);
    // The hold: 300 ms of real time on the last frame.
    expect(first.stats.disposed).toBe(0);
    scheduler.tick(nowMs + 150);
    expect(first.stats.disposed).toBe(0);
    scheduler.tick(nowMs + 320);
    expect(first.stats.disposed).toBe(1);
    expect(second.stats.disposed).toBe(0);
    await flush();
    expect(onMomentTrace).toEqual([0, 1]);
    nowMs = playToEnd(scheduler, 1000);
    scheduler.tick(nowMs + 320);
    expect(second.stats.disposed).toBe(1);
    expect(onDone).toEqual(['done']);
    expect(onMomentTrace).toEqual([0, 1, null]);
    expect(replay.isPlaying).toBe(false);
  });

  it('stops at the first step that reaches untilMs, not before and not after', async () => {
    const moment = fakeMoment(0, 100);
    const { play, scheduler } = setup({ moments: [moment] });
    play([highlightAt(2000)]);
    await flush();
    scheduler.tick(0);
    scheduler.tick(50);
    expect(moment.sim.world.time.sim).toBe(50);
    // A frame owing far more than the moment has left: the sim still stops at untilMs.
    scheduler.tick(5000);
    expect(moment.sim.world.time.sim).toBe(100);
    expect(moment.stats.steps).toBe(10);
  });

  it('keeps drawing the last frame during the hold', async () => {
    const moment = fakeMoment(0, 100);
    const { play, scheduler, updates } = setup({ moments: [moment] });
    play([highlightAt(2000)]);
    await flush();
    playToEnd(scheduler);
    const drawnAtEnd = updates.length;
    scheduler.tick(250);
    expect(updates.length).toBe(drawnAtEnd + 1);
    expect(updates.at(-1)?.simMs).toBe(100);
  });

  it('draws the end of the live world with the game camera after the last moment', async () => {
    const { play, scheduler, calls } = setup({ moments: [fakeMoment(0, 100)] });
    play([highlightAt(2000)]);
    await flush();
    const nowMs = playToEnd(scheduler);
    scheduler.tick(nowMs + 400);
    // resetFx before the moment, then at the end: the scene is cleaned, then the live world is drawn.
    expect(calls[0]).toBe('resetFx');
    expect(calls.slice(-2)).toEqual(['resetFx', 'drawLive']);
  });

  it('frames the anchor of the threat when it has one', async () => {
    const { play, replayCamera } = setup({
      moments: [fakeMoment(0, 100)],
      anchors: [{ id: 'stairs', positionM: [3.2, 0, -1.4] }],
    });
    play([highlightAt(2000, 'stairs')]);
    await flush();
    const expected = createIsoCamera();
    fitFollowCamera(expected, ROOM, RULES.camera, 3.2, -1.4, 2);
    expect(replayCamera.position.toArray()).toEqual(expected.position.toArray());
    expect([replayCamera.left, replayCamera.right]).toEqual([expected.left, expected.right]);
  });

  it('frames Papa when the threat has no anchor in the geometry', async () => {
    const { play, replayCamera } = setup({
      moments: [fakeMoment(0, 100, [], { xM: 1.5, zM: -0.5 })],
      anchors: [{ id: 'stairs', positionM: [3.2, 0, -1.4] }],
    });
    play([highlightAt(2000, 'under_bed'), highlightAt(9000)]);
    await flush();
    const expected = createIsoCamera();
    fitFollowCamera(expected, ROOM, RULES.camera, 1.5, -0.5, 2);
    expect(replayCamera.position.toArray()).toEqual(expected.position.toArray());
  });

  it('does not route the end bookkeeping events, and routes the others', async () => {
    const t = asSimMs(30);
    const events = [
      { type: 'LevelEnded', t, reason: 'timer' },
      { type: 'LevelScored', t },
      { type: 'NearMissFrozen', t, threatId: 1, gag: 'spill' },
      { type: 'PapaBlocked', t },
    ] as unknown as SimEvent[];
    const { play, scheduler, handled, characterEvents } = setup({
      moments: [fakeMoment(0, 100, events)],
    });
    play([highlightAt(2000)]);
    await flush();
    playToEnd(scheduler);
    expect(handled).toEqual(['PapaBlocked']);
    expect(characterEvents).toEqual(['PapaBlocked']);
  });

  describe('skipping', () => {
    it('skipMoment cuts the moment, disposes its sim and starts the next', async () => {
      const first = fakeMoment(0, 100);
      const second = fakeMoment(0, 100);
      const { play, scheduler, replay, onMomentTrace, onDone } = setup({
        moments: [first, second],
      });
      play([highlightAt(2000), highlightAt(9000)]);
      await flush();
      scheduler.tick(0);
      scheduler.tick(30);
      replay.skipMoment();
      expect(first.stats.disposed).toBe(1);
      expect(scheduler.pending).toBe(false);
      await flush();
      expect(onMomentTrace).toEqual([0, 1]);
      expect(onDone).toEqual([]);
      expect(second.stats.disposed).toBe(0);
    });

    it('skipMoment on the last moment ends the replay', async () => {
      const only = fakeMoment(0, 100);
      const { play, replay, onDone, calls } = setup({ moments: [only] });
      play([highlightAt(2000)]);
      await flush();
      replay.skipMoment();
      expect(only.stats.disposed).toBe(1);
      expect(onDone).toEqual(['done']);
      expect(calls.slice(-2)).toEqual(['resetFx', 'drawLive']);
    });

    it('skipAll ends the replay at once with onDone, and disposes the moment', async () => {
      const first = fakeMoment(0, 100);
      const { play, replay, onDone, scheduler, onMomentTrace } = setup({
        moments: [first, fakeMoment(0, 100)],
      });
      play([highlightAt(2000), highlightAt(9000)]);
      await flush();
      scheduler.tick(0);
      replay.skipAll();
      expect(first.stats.disposed).toBe(1);
      expect(onDone).toEqual(['done']);
      expect(onMomentTrace).toEqual([0, null]);
      expect(replay.isPlaying).toBe(false);
      await flush();
      expect(scheduler.pending).toBe(false);
    });

    it('a skip while the next moment is being built frees that sim when it arrives', async () => {
      const first = fakeMoment(0, 100);
      const second = fakeMoment(0, 100);
      const { play, replay } = setup({ moments: [first, second] });
      play([highlightAt(2000), highlightAt(9000)]);
      await flush();
      replay.skipMoment(); // the second is now being built
      replay.skipAll(); // and nobody wants it
      await flush();
      expect(first.stats.disposed).toBe(1);
      expect(second.stats.disposed).toBe(1);
    });

    it('does nothing when no replay is playing', () => {
      const { replay, onDone } = setup();
      expect(() => {
        replay.skipMoment();
        replay.skipAll();
        replay.cancel();
      }).not.toThrow();
      expect(onDone).toEqual([]);
    });
  });

  describe('cancel', () => {
    it('stops the loop, disposes the sim, redraws the live world and never calls onDone', async () => {
      const moment = fakeMoment(0, 100);
      const { play, replay, scheduler, onDone, calls } = setup({ moments: [moment] });
      play([highlightAt(2000)]);
      await flush();
      scheduler.tick(0);
      replay.cancel();
      expect(moment.stats.disposed).toBe(1);
      expect(scheduler.pending).toBe(false);
      expect(calls.slice(-2)).toEqual(['resetFx', 'drawLive']);
      expect(onDone).toEqual([]);
      expect(replay.isPlaying).toBe(false);
    });

    it('is idempotent', async () => {
      const moment = fakeMoment(0, 100);
      const { play, replay, calls } = setup({ moments: [moment] });
      play([highlightAt(2000)]);
      await flush();
      replay.cancel();
      const callsAfterFirst = calls.length;
      replay.cancel();
      expect(moment.stats.disposed).toBe(1);
      expect(calls.length).toBe(callsAfterFirst);
    });

    it('cancels during the hold', async () => {
      const moment = fakeMoment(0, 100);
      const { play, replay, scheduler, onDone } = setup({ moments: [moment] });
      play([highlightAt(2000)]);
      await flush();
      playToEnd(scheduler);
      expect(scheduler.pending).toBe(true);
      replay.cancel();
      expect(scheduler.pending).toBe(false);
      expect(moment.stats.disposed).toBe(1);
      expect(onDone).toEqual([]);
    });

    it('frees a sim that was still being built', async () => {
      const moment = fakeMoment(0, 100);
      const { play, replay, onDone } = setup({ moments: [moment] });
      play([highlightAt(2000)]);
      replay.cancel();
      await flush();
      expect(moment.stats.disposed).toBe(1);
      expect(onDone).toEqual([]);
    });
  });

  it('skips a moment that failed to build and plays the next', async () => {
    const second = fakeMoment(0, 100);
    const { play, onMomentTrace, built } = setup({ moments: ['fail', second] });
    play([highlightAt(2000), highlightAt(9000)]);
    await flush();
    await flush();
    expect(built.map((highlight) => highlight.t)).toEqual([2000, 9000]);
    expect(onMomentTrace).toEqual([0, 1]);
  });

  it('ends when every moment failed', async () => {
    const { play, onDone, calls } = setup({ moments: ['fail', 'fail'] });
    play([highlightAt(2000), highlightAt(9000)]);
    await flush();
    await flush();
    expect(onDone).toEqual(['done']);
    expect(calls.at(-1)).toBe('drawLive');
  });

  it('frees the sim and ends when the level scene is gone', async () => {
    const moment = fakeMoment(0, 100);
    const { play, onDone } = setup({ moments: [moment], hasLevel: false });
    play([highlightAt(2000)]);
    await flush();
    expect(moment.stats.disposed).toBe(1);
    expect(onDone).toEqual(['done']);
  });

  it('a second play() cancels the first without onDone', async () => {
    const first = fakeMoment(0, 100);
    const second = fakeMoment(0, 100);
    const { play, onDone, replay } = setup({ moments: [first, second] });
    play([highlightAt(2000)]);
    await flush();
    play([highlightAt(9000)]);
    expect(first.stats.disposed).toBe(1);
    await flush();
    expect(replay.isPlaying).toBe(true);
    expect(onDone).toEqual([]);
  });

  it('creates one sim per moment and disposes each exactly once over a whole replay', async () => {
    const all = [fakeMoment(0, 100), fakeMoment(0, 100), fakeMoment(0, 100)];
    const { play, replay, scheduler } = setup({ moments: [...all] });
    play([highlightAt(2000), highlightAt(9000), highlightAt(20_000)]);
    await flush();
    let nowMs = playToEnd(scheduler);
    scheduler.tick(nowMs + 400); // moment 0 plays out
    await flush();
    replay.skipMoment(); // moment 1 is cut
    await flush();
    nowMs = playToEnd(scheduler, 2000);
    scheduler.tick(nowMs + 400); // moment 2 plays out
    expect(all.map((moment) => moment.stats.disposed)).toEqual([1, 1, 1]);
  });
});
