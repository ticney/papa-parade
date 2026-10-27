import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { createSim } from '@sim';
import { Group, Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeScheduler } from '../../../tests/support/fakeScheduler.ts';
import { createTestContent, createTestGeometry } from '../../../tests/support/testContent.ts';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import { createIsoCamera } from '../render/isoCamera.ts';
import type { LevelFx, LevelScene } from '../render/levelScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { type AppState, createAppFsm } from './appFsm.ts';
import type { ClientEvents } from './clientEvents.ts';
import { createLevelSession, type LevelSessionDeps } from './levelSession.ts';
import { createPauseController } from './pauseController.ts';

beforeAll(() => {
  log.setLevel('error');
});

const NO_FX: LevelFx = { soundWave: () => {}, shake: () => {} };

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
  const scenes: { id: string; scene: Scene; updates: number; disposed: boolean }[] = [];
  const ready: LevelScene[] = [];
  const deps: LevelSessionDeps = {
    content: createTestContent(),
    appFsm,
    pause,
    renderer,
    camera: createIsoCamera(),
    scheduler,
    newSeed: () => seeds.shift() ?? 999,
    onSeed: (seed) => reportedSeeds.push(seed),
    onLevelReady: (level) => {
      trace.push('ready');
      ready.push(level);
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
    createScene: (assets) => {
      const record = { id: assets.id, scene: new Scene(), updates: 0, disposed: false };
      scenes.push(record);
      return {
        id: assets.id,
        scene: record.scene,
        room: { widthM: 8, depthM: 6, heightM: 2.5 },
        fx: NO_FX,
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

  describe('the level sounds', () => {
    it('loads them once per start, in parallel with the assets', async () => {
      const gate = deferred<void>();
      const calls: string[] = [];
      const { session } = setup({
        loadAudio: () => {
          calls.push('audio');
          return gate.promise;
        },
        loadAssets: async (id) => {
          calls.push('assets');
          return ok(assetsOf(id));
        },
      });
      const starting = session.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Both have begun while the audio is still pending.
      expect(calls).toEqual(['audio', 'assets']);
      gate.resolve();
      await starting;
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

    it('starts the level when the sounds are done first, and when a load that rejects is not expected', async () => {
      const before = log.buffer().length;
      const { session, appFsm } = setup({
        loadAudio: () => Promise.reject(new Error('bad decoder')),
      });
      await session.start();
      expect(appFsm.state).toBe('level');
      expect(
        log
          .buffer()
          .slice(before)
          .some((entry) => entry.level === 'warn' && entry.channel === 'audio'),
      ).toBe(true);
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
