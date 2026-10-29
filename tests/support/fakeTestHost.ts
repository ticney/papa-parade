import type { LevelSession, StartedLevel } from '../../src/client/app/levelSession.ts';
import type { PauseState } from '../../src/client/app/pauseController.ts';
import type { TestHost } from '../../src/client/app/testHost.ts';
import type { RenderStats } from '../../src/client/render/renderer.ts';
import type { ContentBundle } from '../../src/content/contentBundle.ts';
import type { Sim, SimEvent } from '../../src/sim/index.ts';
import { createTestContent } from './testContent.ts';

/** A `TestHost` for the debug modules' tests, with handles to fire what the app would. */
export interface FakeTestHost extends TestHost {
  /** The hook the module installed, or `null`. */
  readonly stepHook: ((sim: Sim) => void) | null;
  readonly isGameInputBlocked: boolean;
  /** Everything the module did to the app, in order. */
  readonly calls: string[];
  fireLevelStarted(started: StartedLevel): void;
  fireSimEvent(event: SimEvent): void;
  fireGameResumed(): void;
  /** One drawn level frame; the stats default to a small quiet scene at pixel ratio 2. */
  fireRenderedFrame(frameAtReal: number, stats?: Partial<RenderStats>): void;
  setPause(state: PauseState): void;
}

export interface FakeTestHostOptions {
  content?: ContentBundle;
  /** The session the host exposes, whole. Default: one that does nothing. */
  levelSession?: LevelSession;
  /** What `auditionCue` answers: whether the audio context is running. Default: true. */
  isAudioRunning?: boolean;
}

export function createFakeTestHost(options: FakeTestHostOptions = {}): FakeTestHost {
  const levelListeners = new Set<(started: StartedLevel) => void>();
  const eventListeners = new Set<(event: SimEvent) => void>();
  const resumedListeners = new Set<() => void>();
  const frameListeners = new Set<(frameAtReal: number, stats: Readonly<RenderStats>) => void>();
  const calls: string[] = [];
  let stepHook: ((sim: Sim) => void) | null = null;
  let isBlocked = false;
  let pause: PauseState = 'running';

  const subscribe = <T>(listeners: Set<T>, listener: T): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const content = options.content ?? createTestContent();
  // A test that cares about the session passes its own, whole; otherwise a session that does nothing.
  const levelSession = (options.levelSession ?? {
    active: null,
    current: { levelId: 'salon_crawler', seed: null, feel: content.feel },
    isFrozen: false,
    start: async () => 'started',
    stop: () => {},
    rememberFeel: () => {},
    freeze: () => {},
    advance: () => {},
  }) as LevelSession;

  return {
    content,
    levelSession,
    pauseState: () => pause,
    setStepHook(hook) {
      calls.push(hook === null ? 'hook:off' : 'hook:on');
      stepHook = hook;
    },
    onLevelStarted: (listener) => subscribe(levelListeners, listener),
    onSimEvent: (listener) => subscribe(eventListeners, listener),
    onGameResumed: (listener) => subscribe(resumedListeners, listener),
    onRenderedFrame: (listener) => subscribe(frameListeners, listener),
    debugGroup: () => null,
    threatScreenPoints: () => [],
    auditionCue(cueId) {
      calls.push(`audition:${cueId}`);
      return options.isAudioRunning ?? true;
    },
    setGameInputBlocked(next) {
      calls.push(`blocked:${next}`);
      isBlocked = next;
    },
    get stepHook() {
      return stepHook;
    },
    get isGameInputBlocked() {
      return isBlocked;
    },
    calls,
    fireLevelStarted: (started) => {
      for (const listener of [...levelListeners]) listener(started);
    },
    fireSimEvent: (event) => {
      for (const listener of [...eventListeners]) listener(event);
    },
    fireGameResumed: () => {
      for (const listener of [...resumedListeners]) listener();
    },
    fireRenderedFrame: (frameAtReal, stats = {}) => {
      const full: RenderStats = {
        drawCalls: 10,
        triangles: 1000,
        geometries: 5,
        textures: 1,
        pixelRatio: 2,
        ...stats,
      };
      for (const listener of [...frameListeners]) listener(frameAtReal, full);
    },
    setPause: (state) => {
      pause = state;
    },
  };
}
