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
  /** The canvas aspect (width over height), for the frame fit. */
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
   * ends or after `skipAll`; never after `cancel`. A replay under way is cancelled first.
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
 */
export function createHighlightReplay(deps: HighlightReplayDeps): HighlightReplay {
  const scheduler = deps.scheduler ?? rafScheduler;
  const makeMomentSim = deps.createMomentSim ?? createMomentSim;
  let run: Run | null = null;
  let moment: ActiveMoment | null = null;
  /** Bumped by everything that makes a pending build or frame stale: a skip, a cancel, a new play. */
  let token = 0;

  const disposeMoment = (): void => {
    if (moment === null) return;
    const finished = moment;
    moment = null;
    finished.loop?.stop();
    if (finished.holdHandle !== null) scheduler.cancel(finished.holdHandle);
    finished.built.sim.dispose();
  };

  /** The scene back to the end of the live game: no effect of the replay is left on it. */
  const restoreLive = (): void => {
    deps.getLevel()?.resetFx();
    deps.drawLive();
  };

  const finish = (): void => {
    const current = run;
    if (current === null) return;
    run = null;
    token++;
    disposeMoment();
    restoreLive();
    deps.onMoment?.(null);
    current.onDone();
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
      if (built === null) startMoment(index + 1);
      else playMoment(current, built, mine);
    };
    makeMomentSim(current.source, highlight, current.rules).then(
      (result) => onBuilt(result.ok ? result.value : null),
      (cause: unknown) => {
        log.warn('render', 'cannot build a moment of the replay', cause);
        onBuilt(null);
      },
    );
  };

  const playMoment = (current: Run, built: MomentSim, mine: number): void => {
    const level = deps.getLevel();
    if (level === null) {
      built.sim.dispose();
      log.warn('render', 'no level scene to replay a moment on');
      finish();
      return;
    }
    const { sim } = built;
    const highlight = current.highlights[current.index] as Highlight;
    try {
      level.resetFx();
      // The focus: the threat's anchor, else Papa (a threat on Papa: the micro-sleep, the duel).
      const [anchorXM, , anchorZM] =
        (highlight.anchorId === null
          ? undefined
          : current.source.geometry.anchors.find((anchor) => anchor.id === highlight.anchorId)
              ?.positionM) ?? [];
      fitFollowCamera(
        deps.replayCamera,
        level.room,
        current.rules.camera,
        anchorXM ?? sim.world.papa.xM,
        anchorZM ?? sim.world.papa.zM,
        deps.getAspect(),
      );
    } catch (cause) {
      sim.dispose();
      log.warn('render', 'cannot frame a moment of the replay', cause);
      startMoment(current.index + 1);
      return;
    }

    const active: ActiveMoment = { built, loop: null, holdHandle: null };
    moment = active;
    let hasReachedEnd = false;
    let holdStartedAtReal: number | null = null;

    const draw = (alpha: number, atReal: number): void => {
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
      draw(1, atReal);
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
        playSimEventFeedback(event, { sim, level: current.source.level }, deps.director);
        level.fx.playCharacterEvent(event, sim.world, deps.isMotionReduced());
      },
      render: (alpha, atReal) => {
        draw(alpha, atReal);
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
