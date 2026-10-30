import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { ContentError } from '@content/contentError';
import { mergeFeel } from '@content/feelMerge';
import type { Feel } from '@content/schemas/feel';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { DEFAULT_LEVEL_ID } from '@shared/constants';
import { canonicalJson, cloneJson } from '@shared/hash';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { asRealMs, asSimMs } from '@shared/time';
import { type CreateSimOptions, createSim, type FeelPatch, type Sim, type SimEvent } from '@sim';
import type { OrthographicCamera } from 'three';
import { type LevelAssets, loadLevelAssets } from '../assets/loadLevelAssets.ts';
import { createGameLoop, type FrameScheduler, type GameLoop, type LoopStats } from '../loop.ts';
import { createLevelScene, type LevelScene, type SceneBodies } from '../render/levelScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { createTimeMap, type TimeMap } from '../timeMap.ts';
import type { Translator } from '../ui/strings.ts';
import { type ThreatMarkerEntry, threatMarkerEntries } from '../ui/world/threatMarkers.ts';
import type { AppFsm } from './appFsm.ts';
import type { PauseController } from './pauseController.ts';

export interface LevelSessionDeps {
  content: ContentBundle;
  /** Translates the verb of each threat's marker, once per level (story 2.2). */
  t: Translator;
  appFsm: AppFsm;
  pause: PauseController;
  renderer: GameRenderer;
  camera: OrthographicCamera;
  /** A fresh seed for each level. Randomness is the client's to use; the sim may not. */
  newSeed(): number;
  /** Told each level's seed (the debug build mirrors it for Playwright). */
  onSeed(seed: number): void;
  /**
   * The level's scene is up (its room is known): fit the camera, show it behind the loading screen.
   * Called before the previous level's scene is disposed. `threatEntries` are the icon points of the
   * level's threats (one per `world.threats` entry, same order), for the world UI and the hit test.
   * The level's objects are `sim.objects`.
   */
  onLevelReady(level: LevelScene, threatEntries: readonly ThreatMarkerEntry[]): void;
  /**
   * Once per rendered frame, paused or not (the UI follows the countdown there). `alpha` is the
   * loop's, in `[0, 1]`: how far the next step is under way, which the drawn sim time follows.
   * `frameAtReal` is the display frame's timestamp (the loop's), the clock of the frame meters.
   */
  onLevelFrame(alpha: number, frameAtReal: number): void;
  /**
   * Once per rendered frame like `onLevelFrame`, but **before** the draw (paused, frozen or not):
   * what must show in this frame, such as the perfect's camera move, is written here.
   */
  beforeRender?(alpha: number, frameAtReal: number): void;
  /**
   * The effects were ended at once (the loop stopped: level end, restart, loading, error): put back
   * what lives outside the scene, such as the camera's framing. Called right after the scene's `resetFx`.
   */
  onFxReset?(): void;
  onSimEvent(event: SimEvent): void;
  /**
   * False while the device is in portrait or the page is hidden: the level then starts paused and
   * waits for the player to resume it.
   */
  canResumeNow(): boolean;
  /** Resolves once the page is in the foreground (at once if it is). The countdown starts after it. */
  waitForForeground(): Promise<void>;
  scheduler?: FrameScheduler;
  /** The level the first `start()` loads, and what a restart reloads until a start names another. Default: `DEFAULT_LEVEL_ID`. */
  levelId?: string;
  /** Real-time multiplier of every level's loop (`?speed`). Default 1. */
  speed?: number;
  /** Called before every step of every level's loop (the autoplay bot hangs here). Given to each new loop as is. */
  beforeStep?(sim: Sim): void;
  /**
   * A level is about to begin: its sim exists, no step has run, the app has not entered `level`
   * yet. Once per started level (not for one that fails or goes stale).
   */
  onLevelStarted?(started: StartedLevel): void;
  /** Default: the real `createSim`. */
  createSim?(options: CreateSimOptions): Promise<Sim>;
  /**
   * Reads and validates the level's JSON (`loadLevelContent` on the browser's content source). Runs
   * in parallel with the assets and the sounds; it never logs, so the session logs a failure.
   */
  loadLevelContent(id: string): Promise<Result<LevelContent, ContentError>>;
  /** Default: the real `loadLevelAssets`. It logs its own failures. */
  loadAssets?(id: string): Promise<Result<LevelAssets, AppError>>;
  /** Default: the real `createLevelScene`. */
  createScene?(assets: LevelAssets, bodies: SceneBodies): LevelScene;
  /**
   * Fetches and decodes the level's sounds. Runs in parallel with `loadAssets` and is awaited
   * before the sim is created, so the countdown never starts on a level that is still loading
   * sound. Never rejects by contract (the engine logs what fails: a missing sound is a `warn`, not
   * « Oups »); one that does is logged and the level starts anyway.
   */
  loadAudio?(): Promise<void>;
}

/**
 * What the client needs of the running level: the sim to send commands to, its real → sim clock,
 * the level's content (the threat defs the feedback director plays the cues of) and the feel it
 * plays with: the one asked for with the level's `feelOverrides` merged over it.
 */
export interface ActiveLevel {
  readonly sim: Sim;
  readonly timeMap: TimeMap;
  readonly level: LevelContent;
  /** The level's geometry (grid, colliders, anchors, zones): what the debug views draw. */
  readonly geometry: LevelGeometry;
  /**
   * The effective feel at the start: feel.json, the level's `feelOverrides` over it, then the
   * remembered tweaks (`rememberFeel`) over those. The sim itself is created with feel.json and the
   * overrides only and gets the tweaks as a `SetFeel` at its first step, so until then (the
   * countdown) its `world.feel` lacks them. A later `SetFeel` changes the sim's feel and not this:
   * read the live one from `sim.world.feel`.
   */
  readonly feel: Feel;
}

/** What `start()` may be told; every field that is absent keeps its rule. */
export interface LevelStartOptions {
  /** Default: the level last asked for (initially `levelId` of the deps). */
  levelId?: string;
  /** An integer in `[0, 2**32)`. Default: `deps.newSeed()`. */
  seed?: number;
  /**
   * The tuned feel to play (a whole feel, as `rememberFeel` takes): what differs from `content.feel`
   * is laid over the level's feel as a `SetFeel` at the first step. Default: the one last asked for
   * (initially `content.feel`, so nothing to lay).
   */
  feel?: Feel;
}

/**
 * How a `start()` ended. `started`: the app is in `level`. `ignored`: a start was in flight.
 * `stale`: `stop()` came first. `failed`: the app is in `oops`.
 */
export type LevelStartOutcome = 'started' | 'ignored' | 'stale' | 'failed';

/** A level that is about to begin, as `onLevelStarted` is told. */
export interface StartedLevel {
  readonly sim: Sim;
  readonly levelId: string;
  readonly seed: number;
  readonly level: LevelContent;
  /** The effective feel at the start (see `ActiveLevel.feel`): `feelOverrides` merged over feel.json, the remembered tweaks over those. */
  readonly feel: Feel;
}

export interface LevelSession {
  /**
   * The level being played: set when the app enters `level`, `null` while a level loads and after
   * `stop()`. The input mapper reads it for each input, so it never holds a stale sim.
   */
  readonly active: ActiveLevel | null;
  /**
   * Loads and starts a level: `loading` (the assets and the level's JSON first, then the sim, which needs the level's
   * geometry and threats), the level's scene, then the wait for the foreground, then `level`, which always
   * begins through the resume countdown. A failed load goes to `oops`. Called again, it restarts.
   * Ignored while a start is in flight (a second tap on « Recommencer » must not start two levels).
   * Without options it restarts the level that last began, with its feel and a fresh seed.
   */
  start(options?: LevelStartOptions): Promise<LevelStartOutcome>;
  /**
   * What a start without options would load: the level, the feel and the seed of the level that
   * last began (`null` before the first). A failed or stale start leaves it as it was. `feel` is
   * the tuned base feel (`rememberFeel`), without the level's `feelOverrides`.
   */
  readonly current: { readonly levelId: string; readonly seed: number | null; readonly feel: Feel };
  /**
   * Remembers `feel` (a copy of it) as the tuned feel the next start without a `feel` option plays
   * (story 2.1), so values tuned while playing survive « Recommencer ». It does not touch the level
   * being played (that is `SetFeel`'s job).
   *
   * The next sim is created with feel.json and the level's `feelOverrides` merged over it, so that
   * its journal replays against the content (`feelHash`); what `feel` changes from feel.json
   * (the tweaks) is then enqueued as one `SetFeel` at t = 0, which wins over an override of the
   * same key. Keys the sim reads only when it is created (nav radii, `baby.babbleMinMs`,
   * `fatigue.startPoints`, the physics world) therefore keep feel.json's value after a restart: to
   * change those for good, save them to feel.json.
   */
  rememberFeel(feel: Feel): void;
  /** The timings of the running level's last frame (story 2.1), or `null` without a loop. Zeros unless a measure clock is on. */
  readonly loopStats: Readonly<LoopStats> | null;
  /**
   * Times the frames of the current and of every later level with this real-time clock, or stops
   * with `null`. The debug overlay turns it on while it is open: with none, the loop reads no clock.
   */
  setLoopMeasure(measure: (() => number) | null): void;
  /** Whether the loop of the current and of every later level is frozen (the wish is kept across levels). */
  readonly isFrozen: boolean;
  /** Freezes or unfreezes the loop: it renders on but runs no step. Applies to every later level too. */
  freeze(isFrozen: boolean): void;
  /** Freezes the level and runs exactly `steps` steps now. Throws `no level is running` without one. */
  advance(steps: number): void;
  /**
   * Stops the frame loop of the current level and cancels any start in flight: a start that
   * resumes after `stop()` (or after a newer start) does nothing more and leaves nothing behind.
   */
  stop(): void;
  /**
   * The level is over (story 1.22): stops its frame loop and nothing else. `active` and its sim stay,
   * so the frozen world can still be read (`__PP__.state()`, the Result screen); the next `start()`
   * disposes them as usual. A no-op with no active level.
   */
  finish(): void;
}

/**
 * The feel a level plays with: `feel` with the level's `feelOverrides` merged over it, or `feel`
 * itself when the level overrides nothing. An override that breaks the feel is a content error.
 */
function effectiveFeel(
  feel: Feel,
  plan: LevelContent,
  levelId: string,
): Result<Feel, ContentError> {
  if (Object.keys(plan.level.feelOverrides).length === 0) return ok(feel);
  return mergeFeel(
    feel,
    plan.level.feelOverrides,
    `content/levels/${levelId}.json › feelOverrides`,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What `next` changes in `base` (two feels of the same shape), as a `SetFeel` patch: the leaves that
 * differ, an array whole, nothing for what is equal. `undefined` when they are equal.
 */
function diffFeel(base: unknown, next: unknown): unknown {
  if (isRecord(base) && isRecord(next)) {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const part = Object.hasOwn(base, key) ? diffFeel(base[key], next[key]) : cloneJson(next[key]);
      if (part !== undefined) patch[key] = part;
    }
    return Object.keys(patch).length === 0 ? undefined : patch;
  }
  return canonicalJson(base) === canonicalJson(next) ? undefined : cloneJson(next);
}

async function settle<T>(work: () => Promise<T>): Promise<Result<T, unknown>> {
  try {
    return ok(await work());
  } catch (cause) {
    return err(cause);
  }
}

/**
 * One level at a time. Sim, time map, loop and scene belong to the level and are replaced at each
 * start; the pause controller and the renderer outlive it. The new level is paused with the
 * `levelStart` reason and resumed at once, so the only way into play is the countdown.
 *
 * Every start carries a generation number that `stop()` and each newer start bump; after each
 * `await`, a start of an older generation drops what it made and returns.
 */
export function createLevelSession(deps: LevelSessionDeps): LevelSession {
  const { appFsm, pause, renderer, camera } = deps;
  const makeSim = deps.createSim ?? createSim;
  const loadAssets = deps.loadAssets ?? loadLevelAssets;
  const makeScene = deps.createScene ?? createLevelScene;
  const requested: { levelId: string; seed: number | null; feel: Feel } = {
    levelId: deps.levelId ?? DEFAULT_LEVEL_ID,
    seed: null,
    feel: deps.content.feel,
  };
  let isFrozenWish = false;
  let measureWish: (() => number) | null = null;
  let loop: GameLoop | null = null;
  let current: LevelScene | null = null;
  let isStarting = false;
  let generation = 0;
  let active: ActiveLevel | null = null;
  /** The sim of the level being played or about to be: its physics world is freed when the level ends (WASM memory is not collected). */
  let liveSim: Sim | null = null;

  const stopLoop = (): void => {
    loop?.stop();
    loop = null;
    // Effects advance only with the loop: end the ring and shake it froze mid-way, or `drawStatic`
    // shows them behind the loading and error screens (a failed restart keeps this scene for good).
    current?.resetFx();
    // The camera too: a perfect's move must not stay on the frozen room (story 2.5).
    deps.onFxReset?.();
  };

  const releaseSim = (): void => {
    liveSim?.dispose();
    liveSim = null;
  };

  return {
    get active() {
      return active;
    },
    get current() {
      return { levelId: requested.levelId, seed: requested.seed, feel: requested.feel };
    },
    rememberFeel(feel) {
      // A copy: the caller (the debug panel) goes on using its own object.
      requested.feel = cloneJson(feel);
    },
    get loopStats() {
      return loop?.stats ?? null;
    },
    setLoopMeasure(measure) {
      measureWish = measure;
      loop?.setMeasure(measure);
    },
    get isFrozen() {
      return isFrozenWish;
    },
    freeze(next) {
      isFrozenWish = next;
      loop?.setFrozen(next);
    },
    advance(steps) {
      if (loop === null) throw new Error('no level is running');
      // The loop validates `steps` first and stays as it was when it throws.
      loop.advance(steps);
      isFrozenWish = true;
    },
    finish() {
      if (active === null) return;
      stopLoop();
    },
    stop() {
      generation++;
      isStarting = false;
      active = null;
      stopLoop();
      releaseSim();
    },
    async start(options = {}) {
      if (isStarting) {
        log.debug('boot', 'level start ignored: one is already in flight');
        return 'ignored';
      }
      const levelId = options.levelId ?? requested.levelId;
      const feel = options.feel ?? requested.feel;
      isStarting = true;
      const mine = ++generation;
      const isStale = (): boolean => mine !== generation;
      try {
        stopLoop();
        active = null;
        releaseSim();
        appFsm.enter('loading');
        // Both start now and are awaited below: the sound loads while the `.glb` does.
        const audioLoad = settle(() => deps.loadAudio?.() ?? Promise.resolve());
        const levelLoad = settle(() => deps.loadLevelContent(levelId));
        const assets = await settle(() => loadAssets(levelId));
        if (isStale()) return 'stale';
        if (!assets.ok) {
          // `loadLevelAssets` never throws; a replacement that does is a bug, not a failed load.
          log.error('boot', 'loading the level assets threw', { id: levelId, error: assets.error });
          appFsm.enter('oops');
          return 'failed';
        }
        if (!assets.value.ok) {
          // `loadLevelAssets` has logged the warn with the level id.
          appFsm.enter('oops');
          return 'failed';
        }
        const levelContent = await levelLoad;
        if (isStale()) return 'stale';
        if (!levelContent.ok) {
          log.error('boot', 'loading the level content threw', {
            id: levelId,
            error: levelContent.error,
          });
          appFsm.enter('oops');
          return 'failed';
        }
        if (!levelContent.value.ok) {
          log.warn('content', 'cannot load the level', {
            id: levelId,
            problems: levelContent.value.error.problems,
          });
          appFsm.enter('oops');
          return 'failed';
        }
        const audio = await audioLoad;
        if (isStale()) return 'stale';
        if (!audio.ok)
          log.warn('audio', 'loading the level sounds threw: starting without them', audio.error);
        // The sim needs the level's geometry (Papa's navigation grid), so it comes after the assets.
        const levelAssets = assets.value.value;
        const levelPlan = levelContent.value.value;
        // The sim gets feel.json with the level's overrides (what a journal replays against); the
        // tuned feel is laid over that as a `SetFeel` once the sim exists.
        const merged = effectiveFeel(deps.content.feel, levelPlan, levelId);
        if (!merged.ok) {
          log.warn('content', 'cannot merge the level feel overrides', {
            id: levelId,
            problems: merged.error.problems,
          });
          appFsm.enter('oops');
          return 'failed';
        }
        const simFeel = merged.value;
        let effective = simFeel;
        let tweaks: FeelPatch | null = null;
        const tuning = diffFeel(deps.content.feel, feel) as FeelPatch | undefined;
        if (tuning !== undefined) {
          const tuned = mergeFeel(simFeel, tuning, 'the remembered feel tweaks');
          if (tuned.ok) {
            effective = tuned.value;
            tweaks = tuning;
          } else {
            // E.g. a tweak that breaks a cross-field rule against this level's overrides.
            log.warn('content', 'the remembered feel tweaks do not fit this level: not applied', {
              id: levelId,
              problems: tuned.error.problems,
            });
          }
        }
        const content: ContentBundle =
          simFeel === deps.content.feel ? deps.content : { ...deps.content, feel: simFeel };
        const seed = options.seed ?? deps.newSeed();
        const simResult = await settle(() =>
          makeSim({
            content,
            geometry: levelAssets.geometry,
            level: levelPlan,
            seed,
          }),
        );
        if (isStale()) {
          if (simResult.ok) simResult.value.dispose();
          return 'stale';
        }
        if (!simResult.ok) {
          log.error('boot', 'cannot create the sim for the level', simResult.error);
          appFsm.enter('oops');
          return 'failed';
        }
        const sim = simResult.value;
        liveSim = sim;
        if (tweaks !== null) {
          try {
            // Journaled like any command, at t = 0: it applies at the head of the first step.
            sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: tweaks });
          } catch (cause) {
            effective = simFeel;
            log.warn('boot', 'the sim refused the remembered feel tweaks: not applied', {
              id: levelId,
              error: cause,
            });
          }
        }
        log.info('boot', 'sim ready', { seed });
        deps.onSeed(seed);

        let level: LevelScene;
        try {
          level = makeScene(levelAssets, {
            papaRadiusM: effective.movement.papaRadiusM,
            babyRadiusM: effective.baby.bodyRadiusM,
          });
        } catch (cause) {
          log.error('render', 'cannot build the level scene', { id: levelId, error: cause });
          releaseSim();
          appFsm.enter('oops');
          return 'failed';
        }
        try {
          deps.onLevelReady(
            level,
            threatMarkerEntries(
              sim.world.threats,
              levelAssets.geometry.anchors,
              levelPlan.threats,
              effective.baby.bodyRadiusM,
              deps.t,
            ),
          );
        } catch (cause) {
          // The new scene never became current: free it, and keep the previous one as it was.
          level.dispose();
          log.error('render', 'cannot show the level scene', { id: levelId, error: cause });
          releaseSim();
          appFsm.enter('oops');
          return 'failed';
        }
        const previous = current;
        current = level;
        previous?.dispose();

        // Loaded in the background: the app stays in `loading` until the player is back, then the
        // countdown starts (D8).
        await deps.waitForForeground();
        if (isStale()) return 'stale';

        const render = (alpha: number, frameAtReal: number): void => {
          level.update(sim.world, alpha, asRealMs(frameAtReal));
          // Whatever moves the camera (story 2.5) goes here: `onLevelFrame` runs after the draw. Not
          // once the loop is gone: a level that ended inside this very frame has just reset the
          // camera, and the perfect slow-mo is still in its world.
          if (loop !== null) deps.beforeRender?.(alpha, frameAtReal);
          renderer.render(level.scene, camera);
          deps.onLevelFrame(alpha, frameAtReal);
        };
        const timeMap = createTimeMap();
        loop = createGameLoop({
          sim,
          timeMap,
          pause,
          scheduler: deps.scheduler,
          render,
          onSimEvent: deps.onSimEvent,
          speed: deps.speed,
          beforeStep: deps.beforeStep,
        });
        loop.setFrozen(isFrozenWish);
        loop.setMeasure(measureWish);
        try {
          deps.onLevelStarted?.({ sim, levelId, seed, level: levelPlan, feel: effective });
        } catch (cause) {
          stopLoop();
          releaseSim();
          log.error('boot', 'a level-started listener threw', { id: levelId, error: cause });
          appFsm.enter('oops');
          return 'failed';
        }
        // Remembered only now that the level is going to play: a failed or stale start must leave
        // « Recommencer » and the Oops retry on the last level that did start.
        requested.levelId = levelId;
        requested.seed = seed;
        if (options.feel !== undefined) requested.feel = cloneJson(options.feel);

        // Paused then resumed in the same tick, before the app enters `level`: the pause screen is
        // then built straight as the countdown (no panel, no focus), and the first thing the player
        // sees is « 3 ».
        pause.requestPause('levelStart');
        if (deps.canResumeNow()) pause.requestResume();
        active = {
          sim,
          timeMap,
          level: levelPlan,
          geometry: levelAssets.geometry,
          feel: effective,
        };
        appFsm.enter('level');
        loop.start();
        return 'started';
      } finally {
        if (!isStale()) isStarting = false;
      }
    },
  };
}
