import type { LevelContent } from '@content/contentBundle';
import { createContentError } from '@content/contentError';
import { STEP_MS } from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { type CreateSimOptions, createSim } from '@sim';
import { Group, Scene } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeScheduler } from '../../../tests/support/fakeScheduler.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from '../../../tests/support/testContent.ts';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import { createIsoCamera } from '../render/isoCamera.ts';
import type { LevelFx, LevelScene } from '../render/levelScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { ThreatMarkerEntry } from '../ui/world/threatMarkers.ts';
import { type AppState, createAppFsm } from './appFsm.ts';
import type { ClientEvents } from './clientEvents.ts';
import { createLevelSession, type LevelSessionDeps, type StartedLevel } from './levelSession.ts';
import { createPauseController } from './pauseController.ts';

beforeAll(() => {
  log.setLevel('error');
});

const NO_FX: LevelFx = { soundWave: () => {}, shake: () => {}, gag: () => {}, liftBaby: () => {} };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const assetsOf = (id: string): LevelAssets => ({
  id,
  // The frozen living room: the sim needs a room where Papa has room to stand.
  geometry: { ...createTestGeometry(), id },
  model: new Group(),
});

/** The frozen living room's level, under the id the session asked for (its geometry carries the same). */
const levelOf = (id: string, content: LevelContent = createTestLevel()): LevelContent => ({
  ...content,
  level: { ...content.level, id },
});

function setup(overrides: Partial<LevelSessionDeps> = {}) {
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  appFsm.enter('start');
  const pause = createPauseController({ events });
  const scheduler = createFakeScheduler();
  const trace: string[] = [];
  events.on('AppStateChanged', ({ to }) => trace.push(`app:${to}`));
  events.on('PauseRequested', ({ reason }) => trace.push(`pause:${reason}`));
  events.on('ResumeRequested', () => trace.push('resume'));
  const seeds = [111, 222, 333];
  const reportedSeeds: number[] = [];
  const drawn = { renders: 0, frames: 0, scenes: [] as Scene[] };
  const renderer: GameRenderer = {
    resize: () => 1,
    render: (scene) => {
      drawn.renders++;
      drawn.scenes.push(scene);
    },
    stats: () => ({ drawCalls: 0, triangles: 0, geometries: 0, textures: 0 }),
    dispose: () => {},
  };
  let simsCreated = 0;
  const scenes: {
    id: string;
    scene: Scene;
    updates: number;
    resets: number;
    disposed: boolean;
  }[] = [];
  const ready: LevelScene[] = [];
  const readyEntries: (readonly ThreatMarkerEntry[])[] = [];
  const deps: LevelSessionDeps = {
    content: createTestContent(),
    appFsm,
    pause,
    renderer,
    camera: createIsoCamera(),
    scheduler,
    newSeed: () => seeds.shift() ?? 999,
    onSeed: (seed) => reportedSeeds.push(seed),
    onLevelReady: (level, threatEntries) => {
      trace.push('ready');
      ready.push(level);
      readyEntries.push(threatEntries);
    },
    onLevelFrame: () => {
      drawn.frames++;
    },
    onSimEvent: () => {},
    canResumeNow: () => true,
    waitForForeground: () => Promise.resolve(),
    createSim: (options) => {
      simsCreated++;
      return createSim(options);
    },
    loadAssets: async (id) => ok(assetsOf(id)),
    loadLevelContent: async (id) => ok(levelOf(id)),
    createScene: (assets) => {
      const record = { id: assets.id, scene: new Scene(), updates: 0, resets: 0, disposed: false };
      scenes.push(record);
      return {
        id: assets.id,
        scene: record.scene,
        room: { widthM: 8, depthM: 6, heightM: 2.5 },
        fx: NO_FX,
        resetFx: () => {
          record.resets++;
        },
        update: () => {
          record.updates++;
        },
        dispose: () => {
          record.disposed = true;
          trace.push(`dispose:${scenes.indexOf(record)}`);
        },
      };
    },
    ...overrides,
  };
  return {
    session: createLevelSession(deps),
    appFsm,
    pause,
    scheduler,
    trace,
    reportedSeeds,
    drawn,
    scenes,
    ready,
    readyEntries,
    sims: () => simsCreated,
  };
}

describe('createLevelSession', () => {
  it('goes start → loading → level, the scene is up before, and the level begins through the countdown', async () => {
    const { session, appFsm, pause, trace } = setup();
    await session.start();
    expect(appFsm.state).toBe('level');
    expect(pause.state).toBe('resuming');
    expect(trace).toEqual(['app:loading', 'ready', 'pause:levelStart', 'resume', 'app:level']);
  });

  it('creates the sim after the assets, from the geometry they carry', async () => {
    const order: string[] = [];
    let simGeometryId = '';
    const { session } = setup({
      loadAssets: async (id) => {
        order.push('assets');
        return ok(assetsOf(id));
      },
      createSim: (options) => {
        order.push('sim');
        simGeometryId = options.geometry.id;
        return createSim(options);
      },
    });
    await session.start();
    expect(order).toEqual(['assets', 'sim']);
    expect(simGeometryId).toBe('salon_crawler');
  });

  it('loads the level in parallel with the assets and gives it to the sim', async () => {
    const order: string[] = [];
    let simLevel: LevelContent | undefined;
    const loaded = levelOf('salon_crawler', createTestLevel([outletEntry(2000)]));
    const levelGate = deferred<void>();
    const { session, appFsm } = setup({
      loadAssets: async (id) => {
        order.push('assets');
        return ok(assetsOf(id));
      },
      loadLevelContent: async () => {
        order.push('level');
        await levelGate.promise;
        return ok(loaded);
      },
      createSim: (options) => {
        order.push('sim');
        simLevel = options.level;
        return createSim(options);
      },
    });
    const starting = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The assets began while the level is still pending: a serial load would deadlock here.
    expect(order).toEqual(['level', 'assets']);
    levelGate.resolve();
    await starting;
    expect(order).toEqual(['level', 'assets', 'sim']);
    expect(simLevel).toBe(loaded);
    expect(appFsm.state).toBe('level');
  });

  it('builds the scene with the body sizes of the feel', async () => {
    const bodies: unknown[] = [];
    const content = createTestContent();
    const { session } = setup({
      content,
      createScene: (assets, sceneBodies) => {
        bodies.push(sceneBodies);
        return {
          id: assets.id,
          scene: new Scene(),
          room: { widthM: 8, depthM: 6, heightM: 2.5 },
          fx: NO_FX,
          resetFx: () => {},
          update: () => {},
          dispose: () => {},
        };
      },
    });
    await session.start();
    expect(bodies).toEqual([
      {
        papaRadiusM: content.feel.movement.papaRadiusM,
        babyRadiusM: content.feel.baby.bodyRadiusM,
      },
    ]);
  });

  it('exposes the active sim and time map once the level is entered, and nothing before or after', async () => {
    const { session, appFsm } = setup();
    expect(session.active).toBeNull();
    let seenWhenEntering: unknown = 'unset';
    const original = appFsm.enter.bind(appFsm);
    appFsm.enter = (next) => {
      if (next === 'level') seenWhenEntering = session.active;
      original(next);
    };
    await session.start();
    expect(session.active).not.toBeNull();
    expect(session.active?.sim.world.papa.state).toBe('idle');
    expect(session.active?.timeMap.realToSim).toBeTypeOf('function');
    expect(seenWhenEntering).toBe(session.active); // already set when the app enters `level`
    session.stop();
    expect(session.active).toBeNull();
  });

  it('has no active level while the next one loads, and a new one after it', async () => {
    const gate = deferred<void>();
    let calls = 0;
    const { session } = setup({
      loadAssets: async (id) => {
        if (++calls === 2) await gate.promise;
        return ok(assetsOf(id));
      },
    });
    await session.start();
    const first = session.active;
    expect(first).not.toBeNull();
    const restarting = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.active).toBeNull();
    gate.resolve();
    await restarting;
    expect(session.active).not.toBeNull();
    expect(session.active?.sim).not.toBe(first?.sim);
  });

  it('loads the level by its id and hands its scene to onLevelReady', async () => {
    const asked: string[] = [];
    const { session, ready } = setup({
      levelId: 'other_room',
      loadAssets: async (id) => {
        asked.push(id);
        return ok(assetsOf(id));
      },
    });
    await session.start();
    expect(asked).toEqual(['other_room']);
    expect(ready.map((level) => level.id)).toEqual(['other_room']);
  });

  it('hands onLevelReady the icon points of the planned threats, from the anchors of the geometry', async () => {
    const { session, readyEntries } = setup({
      loadLevelContent: async (id) => ok(levelOf(id, createTestLevel([outletEntry(2000)]))),
    });
    await session.start();
    const anchor = createTestGeometry().anchors.find((a) => a.id === 'outlet_01');
    const [xM, yM, zM] = anchor?.positionM ?? [Number.NaN, 0, 0];
    expect(readyEntries).toHaveLength(1);
    expect(readyEntries[0]).toEqual([
      { threatId: session.active?.sim.world.threats[0]?.id, xM, yM, zM },
    ]);
  });

  it('hands none for a level that plans no threat, and keeps the level content in the active level', async () => {
    const { session, readyEntries } = setup();
    await session.start();
    expect(readyEntries[0]).toEqual([]);
    expect(session.active?.level.level.id).toBe('salon_crawler');
    expect(session.active?.level.threats).toEqual({});
  });

  it('draws the level scene every frame, paused or not, updates it, and reports the seed', async () => {
    const { session, scheduler, drawn, reportedSeeds, scenes } = setup();
    await session.start();
    expect(reportedSeeds).toEqual([111]);
    expect(scheduler.pending).toBe(true);
    scheduler.tick(0);
    scheduler.tick(16);
    expect(drawn.renders).toBe(2);
    expect(drawn.frames).toBe(2);
    expect(drawn.scenes.every((scene) => scene === scenes[0]?.scene)).toBe(true);
    expect(scenes[0]?.updates).toBe(2);
  });

  it('restarts from a level with a new seed, through loading, and stops the old loop', async () => {
    const { session, appFsm, scheduler, trace, reportedSeeds, drawn } = setup();
    await session.start();
    scheduler.tick(0);
    trace.length = 0;
    await session.start();
    expect(reportedSeeds).toEqual([111, 222]);
    expect(trace[0]).toBe('app:loading');
    expect(trace.at(-1)).toBe('app:level');
    expect(appFsm.state).toBe('level');
    // One chain of frames: each tick requests exactly one next frame and renders exactly once.
    expect(scheduler.pending).toBe(true);
    for (const at of [32, 48, 64]) {
      const requested = scheduler.requested;
      const renders = drawn.renders;
      scheduler.tick(at);
      expect(scheduler.requested - requested).toBe(1);
      expect(drawn.renders - renders).toBe(1);
    }
  });

  it('disposes the previous scene only after the new one is up, and draws the new one', async () => {
    const { session, trace, scenes, scheduler, drawn } = setup();
    await session.start();
    trace.length = 0;
    await session.start();
    expect(trace).toEqual([
      'app:loading',
      'ready',
      'dispose:0',
      'pause:levelStart',
      'resume',
      'app:level',
    ]);
    expect(scenes.map((s) => s.disposed)).toEqual([true, false]);
    scheduler.tick(0);
    expect(drawn.scenes.at(-1)).toBe(scenes[1]?.scene);
  });

  it('leaves a paused game behind: the restarted level counts down instead of staying paused', async () => {
    const { session, pause, scheduler } = setup();
    await session.start();
    scheduler.tick(0);
    pause.requestPause('user');
    expect(pause.state).toBe('paused');
    await session.start();
    expect(pause.state).toBe('resuming');
  });

  it('stays paused when the level may not resume yet (portrait, page hidden)', async () => {
    const { session, appFsm, pause } = setup({ canResumeNow: () => false });
    await session.start();
    expect(appFsm.state).toBe('level');
    expect(pause.state).toBe('paused');
  });

  it('starts one level when asked twice before the first is ready', async () => {
    const { session, trace, sims } = setup();
    await Promise.all([session.start(), session.start()]);
    expect(sims()).toBe(1);
    expect(trace.filter((entry) => entry === 'app:level')).toHaveLength(1);
  });

  it('can start again once the previous start is over', async () => {
    const { session, sims } = setup();
    await session.start();
    await session.start();
    expect(sims()).toBe(2);
  });

  it('stop() cancels the pending frame, and is harmless without a level', async () => {
    const { session, scheduler } = setup();
    session.stop();
    await session.start();
    expect(scheduler.pending).toBe(true);
    session.stop();
    expect(scheduler.pending).toBe(false);
  });

  it('only ever walks the allowed app transitions', async () => {
    const { session, trace } = setup();
    const states: AppState[] = [];
    await session.start();
    await session.start();
    for (const entry of trace)
      if (entry.startsWith('app:')) states.push(entry.slice(4) as AppState);
    expect(states).toEqual(['loading', 'level', 'loading', 'level']);
  });

  describe('effects of a level that is over', () => {
    it('ends the rings and the shake when the loop stops, so nothing stays frozen mid-effect', async () => {
      const { session, scenes } = setup();
      await session.start();
      expect(scenes[0]?.resets).toBe(0);
      session.stop();
      expect(scenes[0]?.resets).toBe(1);
    });

    it('ends them when a restart begins, and on a restart that fails (the old scene stays up)', async () => {
      let attempt = 0;
      const { session, scenes, appFsm } = setup({
        loadAssets: async (id) =>
          ++attempt === 1 ? ok(assetsOf(id)) : err({ kind: 'assets', message: 'no glb' }),
      });
      await session.start();
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scenes).toHaveLength(1);
      expect(scenes[0]?.resets).toBe(1);
    });
  });

  describe('the level sounds', () => {
    it('loads them once per start, in parallel with the assets', async () => {
      const audioGate = deferred<void>();
      const assetsGate = deferred<void>();
      const calls: string[] = [];
      const { session, appFsm, sims } = setup({
        loadAudio: () => {
          calls.push('audio');
          return calls.filter((call) => call === 'audio').length === 1
            ? audioGate.promise
            : Promise.resolve();
        },
        loadAssets: async (id) => {
          calls.push('assets');
          if (calls.filter((call) => call === 'assets').length === 1) await assetsGate.promise;
          return ok(assetsOf(id));
        },
      });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Both have begun while both are still pending: the audio did not wait for the assets.
      expect(calls).toEqual(['audio', 'assets']);
      // The assets alone are not enough: the sim waits for the sounds too.
      assetsGate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sims()).toBe(0);
      expect(appFsm.state).toBe('loading');
      audioGate.resolve();
      await starting;
      expect(appFsm.state).toBe('level');
      await session.start();
      expect(calls.filter((call) => call === 'audio')).toHaveLength(2);
    });

    it('holds the sim back until the sounds are loaded, so the level waits for them', async () => {
      const gate = deferred<void>();
      const { session, appFsm, sims } = setup({ loadAudio: () => gate.promise });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(appFsm.state).toBe('loading');
      expect(sims()).toBe(0);
      gate.resolve();
      await starting;
      expect(appFsm.state).toBe('level');
      expect(sims()).toBe(1);
    });

    it('starts the level, with an audio warning, when the sound load rejects', async () => {
      // A spy, not `log.buffer()`: an offset into the capped ring buffer stops being valid once it is full.
      const warnSpy = vi.spyOn(log, 'warn');
      const before = warnSpy.mock.calls.length;
      const { session, appFsm } = setup({
        loadAudio: () => Promise.reject(new Error('bad decoder')),
      });
      await session.start();
      expect(appFsm.state).toBe('level');
      expect(warnSpy.mock.calls.slice(before).some(([channel]) => channel === 'audio')).toBe(true);
      warnSpy.mockRestore();
    });

    it('does not wait for the sounds when the assets failed: « Oups »', async () => {
      const gate = deferred<void>();
      const { session, appFsm } = setup({
        loadAudio: () => gate.promise,
        loadAssets: async () => err({ kind: 'assets', message: 'no glb' }),
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      gate.resolve();
    });

    it('drops a stale start after the sounds, creating nothing', async () => {
      const gate = deferred<void>();
      const { session, sims, appFsm } = setup({ loadAudio: () => gate.promise });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      session.stop();
      gate.resolve();
      await starting;
      expect(sims()).toBe(0);
      expect(appFsm.state).toBe('loading');
    });

    it('is optional', async () => {
      const { session, appFsm } = setup();
      await session.start();
      expect(appFsm.state).toBe('level');
    });
  });

  describe('failures', () => {
    it('goes to oops, logs an error and starts no loop when the sim cannot be created', async () => {
      const before = log.buffer().length;
      const { session, appFsm, scheduler } = setup({
        createSim: () => Promise.reject(new Error('no sim today')),
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scheduler.requested).toBe(0);
      const errors = log
        .buffer()
        .slice(before)
        .filter((entry) => entry.level === 'error');
      expect(errors.map((entry) => entry.message)).toEqual(['cannot create the sim for the level']);
    });

    it('goes to oops with a warning that names the level and its problems when the level file is broken', async () => {
      const warnSpy = vi.spyOn(log, 'warn');
      const before = warnSpy.mock.calls.length;
      const problems = [
        { file: 'content/levels/salon_crawler.json', jsonPath: 'threats[0].def', message: 'no' },
      ];
      const { session, appFsm, scheduler, ready, sims } = setup({
        loadLevelContent: async () => err(createContentError(problems)),
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scheduler.requested).toBe(0);
      expect(ready).toEqual([]);
      expect(sims()).toBe(0);
      const warns = warnSpy.mock.calls.slice(before);
      expect(warns).toEqual([
        ['content', 'cannot load the level', { id: 'salon_crawler', problems }],
      ]);
      warnSpy.mockRestore();
    });

    it('a throwing loadLevelContent goes to oops with an error, and a retry works', async () => {
      let first = true;
      const { session, appFsm } = setup({
        loadLevelContent: async (id) => {
          if (first) {
            first = false;
            throw new Error('boom');
          }
          return ok(levelOf(id));
        },
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      await session.start();
      expect(appFsm.state).toBe('level');
    });

    it('goes to oops and starts no loop when the assets cannot be loaded', async () => {
      const failure: AppError = {
        kind: 'assets',
        message: 'cannot fetch salon_crawler.glb: offline',
      };
      const { session, appFsm, scheduler, ready, pause } = setup({
        loadAssets: async () => err(failure),
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scheduler.requested).toBe(0);
      expect(ready).toEqual([]);
      expect(pause.state).toBe('running'); // never paused for a level that did not start
    });

    it('retries from oops: loading again, then the level, with the old scene kept until then', async () => {
      let attempts = 0;
      const { session, appFsm, scenes } = setup({
        loadAssets: async (id) =>
          ++attempts === 1 ? err({ kind: 'assets', message: 'x' }) : ok(assetsOf(id)),
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      await session.start();
      expect(appFsm.state).toBe('level');
      expect(scenes).toHaveLength(1);
    });

    it('a throwing loadAssets goes to oops, logs an error, and a retry works', async () => {
      let first = true;
      const { session, appFsm } = setup({
        loadAssets: async (id) => {
          if (first) {
            first = false;
            throw new Error('boom');
          }
          return ok(assetsOf(id));
        },
      });
      const before = log.buffer().length;
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(
        log
          .buffer()
          .slice(before)
          .some((entry) => entry.level === 'error' && entry.message.includes('assets threw')),
      ).toBe(true);
      await session.start();
      expect(appFsm.state).toBe('level');
    });

    it('a scene that cannot be built goes to oops and a retry works', async () => {
      let first = true;
      const { session, appFsm, scenes } = setup({
        createScene: (assets) => {
          if (first) {
            first = false;
            throw new Error('out of GPU memory');
          }
          return {
            id: assets.id,
            scene: new Scene(),
            room: { widthM: 8, depthM: 6, heightM: 2.5 },
            fx: NO_FX,
            resetFx: () => {},
            update: () => {},
            dispose: () => {},
          };
        },
      });
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scenes).toHaveLength(0);
      await session.start();
      expect(appFsm.state).toBe('level');
    });

    it('when onLevelReady throws, the new scene is freed and the previous one stays current', async () => {
      let ready = 0;
      const { session, appFsm, scenes, trace } = setup({
        onLevelReady: () => {
          if (++ready === 2) throw new Error('bad room');
        },
      });
      await session.start();
      expect(appFsm.state).toBe('level');
      await session.start();
      expect(appFsm.state).toBe('oops');
      expect(scenes).toHaveLength(2);
      expect(scenes[0]?.disposed).toBe(false); // still the one on screen
      expect(scenes[1]?.disposed).toBe(true);
      expect(trace).toContain('dispose:1');
      await session.start();
      expect(appFsm.state).toBe('level');
      expect(scenes[0]?.disposed).toBe(true); // replaced by the third
    });
  });

  describe('the foreground', () => {
    it('keeps loading until the page is in the foreground, then counts down', async () => {
      const foreground = deferred<void>();
      const { session, appFsm, pause, scheduler } = setup({
        waitForForeground: () => foreground.promise,
      });
      const starting = session.start();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(appFsm.state).toBe('loading');
      expect(pause.state).toBe('running');
      expect(scheduler.requested).toBe(0);
      foreground.resolve();
      await starting;
      expect(appFsm.state).toBe('level');
      expect(pause.state).toBe('resuming');
    });

    it('has loaded the scene by then (the load went on in the background)', async () => {
      const foreground = deferred<void>();
      const { session, ready } = setup({ waitForForeground: () => foreground.promise });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ready).toHaveLength(1);
      foreground.resolve();
      await starting;
    });
  });

  describe('stop() and the generation token', () => {
    it('a start that resumes after stop() does nothing more and leaves no loop behind', async () => {
      const assets = deferred<Result<LevelAssets, AppError>>();
      const { session, appFsm, scheduler, trace, ready, reportedSeeds } = setup({
        loadAssets: () => assets.promise,
      });
      const starting = session.start();
      expect(appFsm.state).toBe('loading');
      session.stop();
      appFsm.enter('oops'); // what the global error handler does
      assets.resolve(ok(assetsOf('salon_crawler')));
      await starting;
      expect(appFsm.state).toBe('oops');
      expect(scheduler.requested).toBe(0);
      expect(ready).toEqual([]);
      expect(reportedSeeds).toEqual([]);
      expect(trace).toEqual(['app:loading', 'app:oops']);
    });

    it('a stale start that fails does not move the app to oops again', async () => {
      const first = deferred<Result<LevelAssets, AppError>>();
      let calls = 0;
      const { session, appFsm } = setup({
        loadAssets: (id) => (++calls === 1 ? first.promise : Promise.resolve(ok(assetsOf(id)))),
      });
      const stale = session.start();
      session.stop();
      appFsm.enter('oops');
      await session.start(); // the retry runs while the first is still loading
      expect(appFsm.state).toBe('level');
      first.resolve(err({ kind: 'assets', message: 'late failure' }));
      await stale;
      expect(appFsm.state).toBe('level');
    });

    it('stop() frees the single-flight guard: a retry right after is not ignored', async () => {
      const first = deferred<Result<LevelAssets, AppError>>();
      let calls = 0;
      const { session, appFsm, sims } = setup({
        loadAssets: (id) => (++calls === 1 ? first.promise : Promise.resolve(ok(assetsOf(id)))),
      });
      const stale = session.start();
      session.stop();
      appFsm.enter('oops');
      await session.start();
      expect(appFsm.state).toBe('level');
      expect(sims()).toBe(1); // the stale start was still loading: it never made a sim
      first.resolve(ok(assetsOf('salon_crawler')));
      await stale;
      expect(appFsm.state).toBe('level'); // the late one changed nothing
    });

    it('a start stopped while waiting for the foreground never enters the level', async () => {
      const foreground = deferred<void>();
      const { session, appFsm, scheduler } = setup({ waitForForeground: () => foreground.promise });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      session.stop();
      appFsm.enter('oops');
      foreground.resolve();
      await starting;
      expect(appFsm.state).toBe('oops');
      expect(scheduler.requested).toBe(0);
    });
  });
});

describe('createLevelSession › start options and outcomes', () => {
  const patchedFeel = () => {
    const feel = createTestContent().feel;
    return { ...feel, movement: { ...feel.movement, papaRadiusM: 0.42 } };
  };

  it('starts the level that start() names, with its seed and feel, and builds the scene from that feel', async () => {
    const simOptions: CreateSimOptions[] = [];
    const assetIds: string[] = [];
    const contentIds: string[] = [];
    const bodies: unknown[] = [];
    const content = createTestContent();
    const feel = patchedFeel();
    const { session } = setup({
      content,
      loadAssets: async (id) => {
        assetIds.push(id);
        return ok(assetsOf(id));
      },
      loadLevelContent: async (id) => {
        contentIds.push(id);
        return ok(levelOf(id));
      },
      createSim: (options) => {
        simOptions.push(options);
        return createSim(options);
      },
      createScene: (assets, sceneBodies) => {
        bodies.push(sceneBodies);
        return {
          id: assets.id,
          scene: new Scene(),
          room: { widthM: 8, depthM: 6, heightM: 2.5 },
          fx: NO_FX,
          resetFx: () => {},
          update: () => {},
          dispose: () => {},
        };
      },
    });
    const outcome = await session.start({ levelId: 'other_room', seed: 7, feel });
    expect(outcome).toBe('started');
    expect(assetIds).toEqual(['other_room']);
    expect(contentIds).toEqual(['other_room']);
    expect(simOptions[0]?.seed).toBe(7);
    expect(simOptions[0]?.content).toEqual({ ...content, feel });
    expect(bodies).toEqual([{ papaRadiusM: 0.42, babyRadiusM: content.feel.baby.bodyRadiusM }]);
  });

  it("keeps today's behaviour for a plain start(): the default level, the fresh seed, the content as is", async () => {
    const simOptions: CreateSimOptions[] = [];
    const content = createTestContent();
    const { session } = setup({
      content,
      createSim: (options) => {
        simOptions.push(options);
        return createSim(options);
      },
    });
    expect(await session.start()).toBe('started');
    expect(simOptions[0]?.seed).toBe(111);
    expect(simOptions[0]?.content).toBe(content);
  });

  it('reports `current`: the level, feel and seed of the level that last started', async () => {
    const content = createTestContent();
    const { session } = setup({ content });
    expect(session.current).toEqual({
      levelId: 'salon_crawler',
      seed: null,
      feel: content.feel,
    });
    const feel = patchedFeel();
    await session.start({ levelId: 'other_room', seed: 9, feel });
    expect(session.current).toEqual({ levelId: 'other_room', seed: 9, feel });
  });

  it('keeps `current` on the last level that started when a later start fails (the retry reloads it)', async () => {
    const loaded: string[] = [];
    const { session, appFsm } = setup({
      loadAssets: async (id) => {
        loaded.push(id);
        return id === 'nowhere' ? err({ kind: 'assets', message: 'no glb' }) : ok(assetsOf(id));
      },
    });
    await session.start({ levelId: 'other_room', seed: 9 });
    expect(await session.start({ levelId: 'nowhere', seed: 10 })).toBe('failed');
    expect(appFsm.state).toBe('oops');
    expect(session.current).toMatchObject({ levelId: 'other_room', seed: 9 });
    // « Recommencer » / the Oops retry starts with no options: back to the level that played.
    expect(await session.start()).toBe('started');
    expect(loaded.at(-1)).toBe('other_room');
  });

  it('goes to « Oups » when an onLevelStarted listener throws, and keeps `current` as it was', async () => {
    const { session, appFsm } = setup({
      onLevelStarted: () => {
        throw new Error('listener bug');
      },
    });
    expect(await session.start({ levelId: 'other_room', seed: 9 })).toBe('failed');
    expect(appFsm.state).toBe('oops');
    expect(session.active).toBeNull();
    expect(session.current).toMatchObject({ levelId: 'salon_crawler', seed: null });
  });

  it('restarts the same level and feel override with a fresh seed when start() has no options', async () => {
    const simOptions: CreateSimOptions[] = [];
    const feel = patchedFeel();
    const { session } = setup({
      createSim: (options) => {
        simOptions.push(options);
        return createSim(options);
      },
    });
    await session.start({ levelId: 'other_room', seed: 9, feel });
    await session.start();
    expect(simOptions.map((options) => options.seed)).toEqual([9, 111]);
    expect(simOptions[1]?.level.level.id).toBe('other_room');
    expect(simOptions[1]?.content.feel).toEqual(feel);
    expect(session.current.seed).toBe(111);
  });

  it('resolves `ignored` while a start is in flight, `stale` after stop(), `failed` in « Oups »', async () => {
    const gate = deferred<void>();
    const first = setup({ loadAudio: () => gate.promise });
    const starting = first.session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await first.session.start()).toBe('ignored');
    first.session.stop();
    gate.resolve();
    expect(await starting).toBe('stale');

    const failing = setup({ loadAssets: async () => err({ kind: 'assets', message: 'no glb' }) });
    expect(await failing.session.start()).toBe('failed');
    expect(failing.appFsm.state).toBe('oops');

    const noSim = setup({ createSim: () => Promise.reject(new Error('bad level')) });
    expect(await noSim.session.start()).toBe('failed');
  });

  it('calls onLevelStarted once per started level, before the app enters `level` and before any step', async () => {
    const started: StartedLevel[] = [];
    const order: string[] = [];
    const { session, appFsm, trace } = setup({
      onLevelStarted: (level) => {
        started.push(level);
        order.push(`started:${appFsm.state}:${level.sim.world.time.sim}`);
      },
    });
    await session.start({ seed: 5 });
    expect(order).toEqual(['started:loading:0']);
    expect(trace.at(-1)).toBe('app:level');
    expect(started).toHaveLength(1);
    expect(started[0]?.seed).toBe(5);
    expect(started[0]?.levelId).toBe('salon_crawler');
    expect(started[0]?.level.level.id).toBe('salon_crawler');
    expect(started[0]?.sim).toBe(session.active?.sim);
    expect(started[0]?.feel).toBe(session.current.feel);
    await session.start();
    expect(started).toHaveLength(2);
    expect(started[1]?.seed).toBe(111);
  });

  it('does not call onLevelStarted for a level that fails or goes stale', async () => {
    const onLevelStarted = vi.fn();
    const failing = setup({
      onLevelStarted,
      loadAssets: async () => err({ kind: 'assets', message: 'no glb' }),
    });
    await failing.session.start();
    const gate = deferred<void>();
    const stale = setup({ onLevelStarted, loadAudio: () => gate.promise });
    const starting = stale.session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stale.session.stop();
    gate.resolve();
    await starting;
    expect(onLevelStarted).not.toHaveBeenCalled();
  });
});

describe('createLevelSession › freeze, advance, speed and the step hook', () => {
  it('advance() throws with no level running', () => {
    const { session } = setup();
    expect(() => session.advance(3)).toThrow('no level is running');
  });

  it('advance() with a bad step count throws and leaves the level unfrozen', async () => {
    const { session } = setup();
    await session.start();
    expect(() => session.advance(1.5)).toThrow();
    expect(session.isFrozen).toBe(false);
  });

  it('freeze(true) before a start gives a frozen loop: frames render, the sim does not move', async () => {
    const { session, scheduler, drawn } = setup();
    session.freeze(true);
    expect(session.isFrozen).toBe(true);
    await session.start();
    scheduler.tick(0);
    scheduler.tick(5000);
    scheduler.tick(10_000);
    expect(session.active?.sim.world.time.sim).toBe(0);
    expect(drawn.renders).toBe(3);
  });

  it('keeps the freeze across levels, and freeze(false) lets the sim run', async () => {
    const { session, scheduler } = setup();
    session.freeze(true);
    await session.start();
    await session.start();
    // The countdown of the second level, then frames that would owe steps if the loop were running.
    scheduler.tick(0);
    scheduler.tick(10_000);
    scheduler.tick(10_100);
    expect(session.active?.sim.world.time.sim).toBe(0);
    session.freeze(false);
    expect(session.isFrozen).toBe(false);
    scheduler.tick(10_200); // unfreezing measures no time
    scheduler.tick(10_200 + STEP_MS);
    expect(session.active?.sim.world.time.sim).toBe(STEP_MS);
  });

  it('advance(n) runs n steps now and leaves the level frozen', async () => {
    const { session } = setup();
    await session.start();
    session.advance(7);
    expect(session.active?.sim.world.time.sim).toBe(7 * STEP_MS);
    expect(session.isFrozen).toBe(true);
  });

  it('passes the speed to the loop of each level', async () => {
    const { session, scheduler, pause } = setup({ speed: 4 });
    await session.start();
    // The countdown first (it is real time), then a frame of 10 ms at speed 4 is 4 steps.
    scheduler.tick(0);
    scheduler.tick(10_000);
    expect(pause.state).toBe('running');
    scheduler.tick(10_010);
    expect(session.active?.sim.world.time.sim).toBe(4 * STEP_MS);
  });

  it("calls the step hook before every step of the loop, with the level's sim", async () => {
    const seen: number[] = [];
    const { session, scheduler } = setup({
      beforeStep: (sim) => seen.push(sim.world.time.sim),
    });
    await session.start();
    session.advance(3);
    scheduler.tick(0);
    expect(seen).toEqual([0, STEP_MS, 2 * STEP_MS]);
  });
});
