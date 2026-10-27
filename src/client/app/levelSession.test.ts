import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { createSim } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeScheduler } from '../../../tests/support/fakeScheduler.ts';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { createIsoCamera } from '../render/isoCamera.ts';
import { createProvisionalScene } from '../render/provisionalScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { type AppState, createAppFsm } from './appFsm.ts';
import type { ClientEvents } from './clientEvents.ts';
import { createLevelSession, type LevelSessionDeps } from './levelSession.ts';
import { createPauseController } from './pauseController.ts';

beforeAll(() => {
  log.setLevel('error');
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
  const drawn = { renders: 0, frames: 0 };
  const renderer: GameRenderer = {
    resize: () => 1,
    render: () => {
      drawn.renders++;
    },
    dispose: () => {},
  };
  let simsCreated = 0;
  const deps: LevelSessionDeps = {
    content: createTestContent(),
    appFsm,
    pause,
    renderer,
    camera: createIsoCamera(),
    scene: createProvisionalScene(),
    scheduler,
    newSeed: () => seeds.shift() ?? 999,
    onSeed: (seed) => reportedSeeds.push(seed),
    onLevelFrame: () => {
      drawn.frames++;
    },
    onSimEvent: () => {},
    canResumeNow: () => true,
    createSim: (options) => {
      simsCreated++;
      return createSim(options);
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
    sims: () => simsCreated,
  };
}

describe('createLevelSession', () => {
  it('goes start → loading → level, and the level begins through the countdown', async () => {
    const { session, appFsm, pause, trace } = setup();
    await session.start();
    expect(appFsm.state).toBe('level');
    expect(pause.state).toBe('resuming');
    expect(trace).toEqual(['app:loading', 'pause:levelStart', 'resume', 'app:level']);
  });

  it('draws every frame of the level, paused or not, and reports the seed', async () => {
    const { session, scheduler, drawn, reportedSeeds } = setup();
    await session.start();
    expect(reportedSeeds).toEqual([111]);
    expect(scheduler.pending).toBe(true);
    scheduler.tick(0);
    scheduler.tick(16);
    expect(drawn.renders).toBe(2);
    expect(drawn.frames).toBe(2);
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
});
