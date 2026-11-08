import type { ReplaySettings } from '@content/schemas/feedback';
import { STEP_MS } from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { asRealMs } from '@shared/time';
import type { SimEvent } from '@sim';
import type { OrthographicCamera, Scene } from 'three';
import type { ClientEvents } from '../app/clientEvents.ts';
import { createPauseController } from '../app/pauseController.ts';
import type { FeedbackDirector } from '../feedback/feedbackDirector.ts';
import { playSimEventFeedback } from '../feedback/simEventFeedback.ts';
import { createGameLoop, type FrameScheduler, type GameLoop } from '../loop.ts';
import { fitFollowCamera } from '../render/isoCamera.ts';
import type { LevelScene } from '../render/levelScene.ts';
import { createTimeMap } from '../timeMap.ts';
import type { Highlight } from './highlights.ts';
import { createMomentSim, type MomentSim, type ReplaySource } from './momentSim.ts';

/**
 * The events of a moment sim that are end bookkeeping, not play: they are never routed to the
 * feedback (story 3.9, AC 9). `NearMissFrozen` is the level's end, and the replay is not the end.
 */
const UNROUTED_EVENT_TYPES: ReadonlySet<SimEvent['type']> = new Set([
  'LevelEnded',
  'LevelScored',
  'NearMissFrozen',
]);

export interface HighlightReplayDeps {
  /** The level scene the live game drew: the replay draws the moment worlds through it. `null` with none. */
  getLevel(): LevelScene | null;
  readonly renderer: { render(scene: Scene, camera: OrthographicCamera): void };
  /** The replay's own camera (beside the photo's): the game camera is never touched. */
  readonly replayCamera: OrthographicCamera;
  /** The canvas aspect (width over height), for the frame fit. Read each frame: a resize refits the frame. */
  getAspect(): number;
  /** The second director (no haptics, no flash, no stamp, no count): the live one is not disturbed. */
  readonly director: FeedbackDirector;
  isMotionReduced(): boolean;
  /**
   * Draws the frozen live world through the game camera: the end of the game, as the actions see it.
   * Called after the last moment, a skip and a cancel.
   */
  drawLive(): void;
  /** Default: `requestAnimationFrame`. */
  readonly scheduler?: FrameScheduler;
  /** Real-time multiplier of the level (`?speed`). Default 1. */
  readonly speed?: number;
  /** Default: `createMomentSim`. */
  readonly createMomentSim?: typeof createMomentSim;
  /** Told the index of the moment playing, `null` when none is (the `data-pp-replay-moment` mirror). */
  onMoment?(index: number | null): void;
}

export interface HighlightReplay {
  /** Whether a replay is under way (from `play` to its end, a skip or a cancel). */
  readonly isPlaying: boolean;
  /**
   * Plays the moments in order, each in its own sim. `onDone` is called once, when the last moment
   * ends or after `skipAll`, even if putting the scene back failed (that is logged); never after
   * `cancel`. A replay under way is cancelled first.
   */
  play(
    highlights: readonly Highlight[],
    source: ReplaySource,
    rules: ReplaySettings,
    onDone: () => void,
  ): void;
  /** Cuts the moment playing and starts the next, or ends the replay after the last. */
  skipMoment(): void;
  /** Ends the replay now: `onDone` is called. */
  skipAll(): void;
  /** Stops without `onDone`, disposes the moment sim and redraws the live world. Idempotent. */
  cancel(): void;
}

const rafScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

interface Run {
  readonly highlights: readonly Highlight[];
  readonly source: ReplaySource;
  readonly rules: ReplaySettings;
  readonly onDone: () => void;
  index: number;
}

/** The moment sim being played and what runs it: the loop, or the hold's frame once the loop stopped. */
interface ActiveMoment {
  readonly built: MomentSim;
  loop: GameLoop | null;
  holdHandle: number | null;
}

/**
 * The player of the highlight replay (story 3.9, D6 and D7). One moment sim at a time, run by the
 * game's own `createGameLoop` with a time map and a pause controller of its own (so the perfect's
 * slow-mo and the hitstops play as in the game, and the live loop is never touched), drawn through
 * a tight camera. The caller (`Result` screen) decides when it plays and when it is skipped.
 *
 * It is an optional end-of-level feature: nothing it does may leave the Result screen waiting. A
 * moment that cannot be built, framed, played or drawn is logged and skipped, and `onDone` is called
 * whatever happens when putting the scene back.
 */
export function createHighlightReplay(deps: HighlightReplayDeps): HighlightReplay {
  const scheduler = deps.scheduler ?? rafScheduler;
  const makeMomentSim = deps.createMomentSim ?? createMomentSim;
  let run: Run | null = null;
  let moment: ActiveMoment | null = null;
  /** Bumped by everything that makes a pending build or frame stale: a skip, a cancel, a new play. */
  let token = 0;

  /** Stops what runs the moment and frees its sim. Never throws: each step is tried on its own. */
  const disposeMoment = (): void => {
    if (moment === null) return;
    const finished = moment;
    moment = null;
    try {
      finished.loop?.stop();
      if (finished.holdHandle !== null) scheduler.cancel(finished.holdHandle);
    } catch (cause) {
      log.warn('render', 'cannot stop a moment of the replay', cause);
    }
    try {
      finished.built.sim.dispose();
    } catch (cause) {
      log.warn('render', 'cannot dispose the sim of a moment of the replay', cause);
    }
  };

  /** The scene back to the end of the live game: no effect of the replay is left on it. Never throws. */
  const restoreLive = (): void => {
    try {
      deps.getLevel()?.resetFx();
      deps.drawLive();
    } catch (cause) {
      log.warn('render', 'cannot put the live scene back after the replay', cause);
    }
  };

  const finish = (): void => {
    const current = run;
    if (current === null) return;
    run = null;
    token++;
    try {
      disposeMoment();
      restoreLive();
      deps.onMoment?.(null);
    } finally {
      // The screen waits for this: it comes whatever the clean-up did.
      current.onDone();
    }
  };

  const startMoment = (index: number): void => {
    const current = run;
    if (current === null) return;
    const highlight = current.highlights[index];
    if (highlight === undefined) {
      finish();
      return;
    }
    current.index = index;
    const mine = ++token;
    deps.onMoment?.(index);
    const onBuilt = (built: MomentSim | null): void => {
      if (mine !== token) {
        // Skipped or cancelled while it was being built: nobody plays it, so it is freed here.
        built?.sim.dispose();
        return;
      }
      // A failed build has logged its warn: the moment is skipped.
      if (built === null) {
        startMoment(index + 1);
        return;
      }
      try {
        playMoment(current, built, mine);
      } catch (cause) {
        log.warn('render', 'cannot play a moment of the replay: it is skipped', cause);
        if (moment !== null && moment.built === built) disposeMoment();
        if (mine === token) startMoment(index + 1);
      }
    };
    makeMomentSim(current.source, highlight, current.rules)
      .then(
        (result) => (result.ok ? result.value : null),
        (cause: unknown) => {
          log.warn('render', 'cannot build a moment of the replay', cause);
          return null;
        },
      )
      .then(onBuilt)
      .catch((cause: unknown) => {
        // The last net: `onBuilt` has its own, so this is a failure of the recovery itself.
        log.warn('render', 'the replay lost track of a moment', cause);
      });
  };

  const playMoment = (current: Run, built: MomentSim, mine: number): void => {
    // Tracked first: from here on every way out frees the sim through `disposeMoment`.
    const active: ActiveMoment = { built, loop: null, holdHandle: null };
    moment = active;
    const level = deps.getLevel();
    if (level === null) {
      disposeMoment();
      log.warn('render', 'no level scene to replay a moment on');
      finish();
      return;
    }
    const { sim } = built;
    const highlight = current.highlights[current.index] as Highlight;
    // The focus: the threat's anchor, else Papa (a threat on Papa: the micro-sleep, the duel). The
    // frame is placed here and again whenever the canvas aspect changed (a resize, a mobile URL bar).
    let focusXM = 0;
    let focusZM = 0;
    let fittedAspect = Number.NaN;
    const placeFrame = (): void => {
      const aspect = deps.getAspect();
      fitFollowCamera(
        deps.replayCamera,
        level.room,
        current.rules.camera,
        focusXM,
        focusZM,
        aspect,
      );
      fittedAspect = aspect;
    };
    try {
      level.resetFx();
      const [anchorXM, , anchorZM] =
        (highlight.anchorId === null
          ? undefined
          : current.source.geometry.anchors.find((anchor) => anchor.id === highlight.anchorId)
              ?.positionM) ?? [];
      focusXM = anchorXM ?? sim.world.papa.xM;
      focusZM = anchorZM ?? sim.world.papa.zM;
      placeFrame();
    } catch (cause) {
      disposeMoment();
      log.warn('render', 'cannot frame a moment of the replay', cause);
      startMoment(current.index + 1);
      return;
    }

    let hasReachedEnd = false;
    let holdStartedAtReal: number | null = null;

    const draw = (alpha: number, atReal: number): void => {
      if (deps.getAspect() !== fittedAspect) placeFrame();
      level.update(sim.world, alpha, asRealMs(atReal));
      deps.renderer.render(level.scene, deps.replayCamera);
    };
    const endMoment = (): void => {
      if (mine !== token) return;
      startMomentAfter(current.index);
    };
    const holdFrame = (atReal: number): void => {
      if (mine !== token) return;
      active.holdHandle = null;
      try {
        draw(1, atReal);
      } catch (cause) {
        log.warn('render', 'cannot draw the end of a moment of the replay: it is cut', cause);
        endMoment();
        return;
      }
      if (atReal - (holdStartedAtReal ?? atReal) >= current.rules.endHoldMs) endMoment();
      else active.holdHandle = scheduler.request(holdFrame);
    };

    const loop = createGameLoop({
      sim,
      timeMap: createTimeMap(),
      pause: createPauseController({ events: createEmitter<ClientEvents>() }),
      scheduler,
      speed: deps.speed,
      beforeStep: (stepped) => {
        // The step about to run is the first to reach `untilMs`: it is the last one.
        if (!hasReachedEnd && stepped.world.time.sim + STEP_MS >= built.untilMs) {
          hasReachedEnd = true;
          loop.stop();
        }
      },
      onSimEvent: (event) => {
        if (UNROUTED_EVENT_TYPES.has(event.type)) return;
        try {
          playSimEventFeedback(event, { sim, level: current.source.level }, deps.director);
          level.fx.playCharacterEvent(event, sim.world, deps.isMotionReduced());
        } catch (cause) {
          // A sound or a puff that fails does not stop the moment.
          log.warn('render', 'a feedback of the replay failed', { type: event.type, cause });
        }
      },
      render: (alpha, atReal) => {
        try {
          draw(alpha, atReal);
        } catch (cause) {
          // The same error would come back every frame: the moment is cut, the next one starts.
          log.warn('render', 'cannot draw a moment of the replay: it is cut', cause);
          endMoment();
          return;
        }
        if (!hasReachedEnd || holdStartedAtReal !== null) return;
        holdStartedAtReal = atReal;
        if (current.rules.endHoldMs <= 0) endMoment();
        else active.holdHandle = scheduler.request(holdFrame);
      },
    });
    active.loop = loop;
    loop.start();
  };

  /** Disposes the moment that just ended and goes on to the next (or ends the replay). */
  const startMomentAfter = (index: number): void => {
    disposeMoment();
    startMoment(index + 1);
  };

  const cancel = (): void => {
    if (run === null) return;
    run = null;
    token++;
    disposeMoment();
    restoreLive();
    deps.onMoment?.(null);
  };

  return {
    get isPlaying() {
      return run !== null;
    },
    play(highlights, source, rules, onDone) {
      cancel();
      run = { highlights, source, rules, onDone, index: 0 };
      startMoment(0);
    },
    skipMoment() {
      const current = run;
      if (current === null) return;
      token++;
      startMomentAfter(current.index);
    },
    skipAll: finish,
    cancel,
  };
}
