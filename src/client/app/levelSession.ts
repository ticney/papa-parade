import type { ContentBundle } from '@content/contentBundle';
import { log } from '@shared/log';
import { type CreateSimOptions, createSim, type Sim, type SimEvent } from '@sim';
import type { OrthographicCamera } from 'three';
import { createGameLoop, type FrameScheduler, type GameLoop } from '../loop.ts';
import type { ProvisionalScene } from '../render/provisionalScene.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { createTimeMap } from '../timeMap.ts';
import type { AppFsm } from './appFsm.ts';
import type { PauseController } from './pauseController.ts';

export interface LevelSessionDeps {
  content: ContentBundle;
  appFsm: AppFsm;
  pause: PauseController;
  renderer: GameRenderer;
  camera: OrthographicCamera;
  scene: ProvisionalScene;
  /** A fresh seed for each level. Randomness is the client's to use; the sim may not. */
  newSeed(): number;
  /** Told each level's seed (the debug build mirrors it for Playwright). */
  onSeed(seed: number): void;
  /** Once per rendered frame, paused or not (the UI follows the countdown there). */
  onLevelFrame(): void;
  onSimEvent(event: SimEvent): void;
  /**
   * False while the device is in portrait or the page is hidden: the level then starts paused and
   * waits for the player to resume it.
   */
  canResumeNow(): boolean;
  scheduler?: FrameScheduler;
  /** Default: the real `createSim`. */
  createSim?(options: CreateSimOptions): Promise<Sim>;
}

export interface LevelSession {
  /**
   * Loads and starts a level: `loading`, a new sim with a new seed, then `level`, which always
   * begins through the resume countdown. Called again, it restarts. Ignored while a start is in
   * flight (a second tap on « Recommencer » must not start two levels).
   */
  start(): Promise<void>;
  /** Stops the frame loop of the current level. */
  stop(): void;
}

/**
 * One level at a time. Sim, time map and loop belong to the level and are replaced at each start;
 * the pause controller, the renderer and the scene outlive it. The new level is paused with the
 * `levelStart` reason and resumed at once, so the only way into play is the countdown.
 */
export function createLevelSession(deps: LevelSessionDeps): LevelSession {
  const { appFsm, pause, renderer, camera, scene } = deps;
  const makeSim = deps.createSim ?? createSim;
  let loop: GameLoop | null = null;
  let isStarting = false;

  const stop = (): void => {
    loop?.stop();
    loop = null;
  };

  return {
    stop,
    async start() {
      if (isStarting) {
        log.debug('boot', 'level start ignored: one is already in flight');
        return;
      }
      isStarting = true;
      try {
        stop();
        appFsm.enter('loading');
        const seed = deps.newSeed();
        let sim: Sim;
        try {
          sim = await makeSim({ content: deps.content, seed });
        } catch (cause) {
          // The player-facing « Oups » screen is story 1.6; until then the state is reachable and
          // the error is logged.
          log.error('boot', 'cannot create the sim for the level', cause);
          appFsm.enter('oops');
          return;
        }
        log.info('boot', 'sim ready', { seed });
        deps.onSeed(seed);

        const render = (alpha: number): void => {
          scene.update(sim.world, alpha);
          renderer.render(scene.scene, camera);
          deps.onLevelFrame();
        };
        loop = createGameLoop({
          sim,
          timeMap: createTimeMap(),
          pause,
          scheduler: deps.scheduler,
          render,
          onSimEvent: deps.onSimEvent,
        });

        // Paused then resumed in the same tick, before the app enters `level`: the pause panel
        // never builds, the first thing the player sees is « 3 ».
        pause.requestPause('levelStart');
        if (deps.canResumeNow()) pause.requestResume();
        appFsm.enter('level');
        loop.start();
      } finally {
        isStarting = false;
      }
    },
  };
}
