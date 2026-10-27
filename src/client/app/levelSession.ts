import type { ContentBundle } from '@content/contentBundle';
import { DEFAULT_LEVEL_ID } from '@shared/constants';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { type CreateSimOptions, createSim, type Sim, type SimEvent } from '@sim';
import type { OrthographicCamera } from 'three';
import { type LevelAssets, loadLevelAssets } from '../assets/loadLevelAssets.ts';
import { createGameLoop, type FrameScheduler, type GameLoop } from '../loop.ts';
import { createLevelScene, type LevelScene, type SceneBodies } from '../render/levelScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { createTimeMap, type TimeMap } from '../timeMap.ts';
import type { AppFsm } from './appFsm.ts';
import type { PauseController } from './pauseController.ts';

export interface LevelSessionDeps {
  content: ContentBundle;
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
   * Called before the previous level's scene is disposed.
   */
  onLevelReady(level: LevelScene): void;
  /** Once per rendered frame, paused or not (the UI follows the countdown there). */
  onLevelFrame(): void;
  onSimEvent(event: SimEvent): void;
  /**
   * False while the device is in portrait or the page is hidden: the level then starts paused and
   * waits for the player to resume it.
   */
  canResumeNow(): boolean;
  /** Resolves once the page is in the foreground (at once if it is). The countdown starts after it. */
  waitForForeground(): Promise<void>;
  scheduler?: FrameScheduler;
  /** Default: `DEFAULT_LEVEL_ID`. */
  levelId?: string;
  /** Default: the real `createSim`. */
  createSim?(options: CreateSimOptions): Promise<Sim>;
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

/** What the input needs of the running level: the sim to send commands to and its real → sim clock. */
export interface ActiveLevel {
  readonly sim: Sim;
  readonly timeMap: TimeMap;
}

export interface LevelSession {
  /**
   * The level being played: set when the app enters `level`, `null` while a level loads and after
   * `stop()`. The input mapper reads it for each input, so it never holds a stale sim.
   */
  readonly active: ActiveLevel | null;
  /**
   * Loads and starts a level: `loading` (the assets first, then the sim, which needs the level's
   * geometry), the level's scene, then the wait for the foreground, then `level`, which always
   * begins through the resume countdown. A failed load goes to `oops`. Called again, it restarts.
   * Ignored while a start is in flight (a second tap on « Recommencer » must not start two levels).
   */
  start(): Promise<void>;
  /**
   * Stops the frame loop of the current level and cancels any start in flight: a start that
   * resumes after `stop()` (or after a newer start) does nothing more and leaves nothing behind.
   */
  stop(): void;
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
  const levelId = deps.levelId ?? DEFAULT_LEVEL_ID;
  let loop: GameLoop | null = null;
  let current: LevelScene | null = null;
  let isStarting = false;
  let generation = 0;
  let active: ActiveLevel | null = null;

  const stopLoop = (): void => {
    loop?.stop();
    loop = null;
    // Effects advance only with the loop: end the ring and shake it froze mid-way, or `drawStatic`
    // shows them behind the loading and error screens (a failed restart keeps this scene for good).
    current?.resetFx();
  };

  return {
    get active() {
      return active;
    },
    stop() {
      generation++;
      isStarting = false;
      active = null;
      stopLoop();
    },
    async start() {
      if (isStarting) {
        log.debug('boot', 'level start ignored: one is already in flight');
        return;
      }
      isStarting = true;
      const mine = ++generation;
      const isStale = (): boolean => mine !== generation;
      try {
        stopLoop();
        active = null;
        appFsm.enter('loading');
        // Both start now and are awaited below: the sound loads while the `.glb` does.
        const audioLoad = settle(() => deps.loadAudio?.() ?? Promise.resolve());
        const assets = await settle(() => loadAssets(levelId));
        if (isStale()) return;
        if (!assets.ok) {
          // `loadLevelAssets` never throws; a replacement that does is a bug, not a failed load.
          log.error('boot', 'loading the level assets threw', { id: levelId, error: assets.error });
          appFsm.enter('oops');
          return;
        }
        if (!assets.value.ok) {
          // `loadLevelAssets` has logged the warn with the level id.
          appFsm.enter('oops');
          return;
        }
        const audio = await audioLoad;
        if (isStale()) return;
        if (!audio.ok)
          log.warn('audio', 'loading the level sounds threw: starting without them', audio.error);
        // The sim needs the level's geometry (Papa's navigation grid), so it comes after the assets.
        const levelAssets = assets.value.value;
        const seed = deps.newSeed();
        const simResult = await settle(() =>
          makeSim({ content: deps.content, geometry: levelAssets.geometry, seed }),
        );
        if (isStale()) return;
        if (!simResult.ok) {
          log.error('boot', 'cannot create the sim for the level', simResult.error);
          appFsm.enter('oops');
          return;
        }
        const sim = simResult.value;
        log.info('boot', 'sim ready', { seed });
        deps.onSeed(seed);

        let level: LevelScene;
        try {
          level = makeScene(levelAssets, {
            papaRadiusM: deps.content.feel.movement.papaRadiusM,
            babyRadiusM: deps.content.feel.baby.bodyRadiusM,
          });
        } catch (cause) {
          log.error('render', 'cannot build the level scene', { id: levelId, error: cause });
          appFsm.enter('oops');
          return;
        }
        try {
          deps.onLevelReady(level);
        } catch (cause) {
          // The new scene never became current: free it, and keep the previous one as it was.
          level.dispose();
          log.error('render', 'cannot show the level scene', { id: levelId, error: cause });
          appFsm.enter('oops');
          return;
        }
        const previous = current;
        current = level;
        previous?.dispose();

        // Loaded in the background: the app stays in `loading` until the player is back, then the
        // countdown starts (D8).
        await deps.waitForForeground();
        if (isStale()) return;

        const render = (alpha: number): void => {
          level.update(sim.world, alpha);
          renderer.render(level.scene, camera);
          deps.onLevelFrame();
        };
        const timeMap = createTimeMap();
        loop = createGameLoop({
          sim,
          timeMap,
          pause,
          scheduler: deps.scheduler,
          render,
          onSimEvent: deps.onSimEvent,
        });

        // Paused then resumed in the same tick, before the app enters `level`: the pause screen is
        // then built straight as the countdown (no panel, no focus), and the first thing the player
        // sees is « 3 ».
        pause.requestPause('levelStart');
        if (deps.canResumeNow()) pause.requestResume();
        active = { sim, timeMap };
        appFsm.enter('level');
        loop.start();
      } finally {
        if (!isStale()) isStarting = false;
      }
    },
  };
}
