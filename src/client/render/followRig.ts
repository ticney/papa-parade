import type { LevelCameraMode } from '@content/schemas/level';
import {
  createFollowFrame,
  createFollowState,
  type FollowFrame,
  type FollowParams,
  fitFollowFrame,
  settleFollow,
  snapFollow,
  stepFollow,
  viewUM,
  viewVM,
  worldOfView,
} from '@shared/followCamera';
import type { SimEvent, World } from '@sim';
import type { OrthographicCamera } from 'three';
import type { CameraFx, SequenceFraming } from './cameraFx.ts';
import { fitFollowCamera, fitIsoCamera, type RoomSize } from './isoCamera.ts';

/** The camera a level starts with (story 9.2): its mode, and the follow tuning of its effective feel. */
export interface LevelCameraSetup {
  readonly mode: LevelCameraMode;
  readonly follow: Readonly<FollowParams>;
  /** Where Papa starts, on the floor: the follow is on him behind the loading screen already. */
  readonly papaStartXM: number;
  readonly papaStartZM: number;
}

/**
 * The game camera's framing under the effects (story 9.2): the whole room for a `fixed` level, a
 * frame that follows Papa for a `follow` one. It fits the camera, steps the follow on the drawn sim
 * clock and moves `cameraFx`'s base; `cameraFx` keeps the perfect's move and the sequence framing on
 * top. Client state only.
 */
export interface FollowRig {
  readonly mode: LevelCameraMode;
  /** What the follow aims at now: Papa, or the threat just judged under a slow-mo or a framing (D5). */
  readonly aim: 'papa' | 'threat';
  /** The follow's frame (its size and the room's extent), for the debug and the tests. */
  readonly frame: Readonly<FollowFrame>;
  /** A new level: its room and camera. The follow starts over (its first frame snaps to Papa). */
  setLevel(room: RoomSize, setup: LevelCameraSetup): void;
  /**
   * Fits the camera at `aspect` (every resize, a new level), then captures `cameraFx`'s base: the
   * whole room, or the follow frame at its centre, kept, with Papa back inside the edge margin and
   * no catch-up. `params` is the live `feel.camera` of the running level, used once the level has
   * drawn its first frame (before that, the level's own). Does nothing before a level.
   */
  fit(aspect: number, params?: Readonly<FollowParams>): void;
  /** Told each sim event: a judgement records its threat's point (follow levels only). */
  onSimEvent(event: Readonly<SimEvent>, world: Readonly<World>): void;
  /**
   * Steps the follow to the drawn sim time `clockMs` toward Papa's drawn point or the judged threat,
   * and moves `cameraFx`'s base there. Call it every rendered frame before `cameraFx.update`. A fixed
   * level is left alone. A change of the frame's size in `world.feel.camera` refits at once.
   */
  update(
    world: Readonly<World>,
    clockMs: number,
    papaXM: number,
    papaZM: number,
    framing: Readonly<SequenceFraming>,
    isMotionReduced: boolean,
  ): void;
}

export function createFollowRig(camera: OrthographicCamera, cameraFx: CameraFx): FollowRig {
  const frame = createFollowFrame();
  let state = createFollowState();
  const lookPoint = { xM: 0, zM: 0 };
  let room: RoomSize | null = null;
  let mode: LevelCameraMode = 'fixed';
  let levelParams: Readonly<FollowParams> | null = null;
  let fittedAspect = 0;
  let fittedWidthM = 0;
  let fittedDepthM = 0;
  // Papa's last known floor point: his start, then where he was last drawn.
  let papaXM = 0;
  let papaZM = 0;
  // The last judged threat (D5): its floor point and its sim time.
  let hasJudged = false;
  let judgedXM = 0;
  let judgedZM = 0;
  let judgedAtMs = 0;
  let aim: 'papa' | 'threat' = 'papa';

  /**
   * Whether the judged threat is still to be framed at `clockMs`: a slow-mo or the sequence framing
   * that was under way at the judgement (or that it started) still runs. Once nothing runs any more,
   * the judgement is forgotten and the follow goes back to Papa.
   */
  const isJudgedFramed = (
    world: Readonly<World>,
    clockMs: number,
    framing: Readonly<SequenceFraming>,
  ): boolean => {
    if (!hasJudged) return false;
    let isAnyRunning = false;
    const { slowMos } = world.time;
    for (let i = 0; i < slowMos.length; i++) {
      const slowMo = slowMos[i];
      if (slowMo === undefined || clockMs >= slowMo.endsAt) continue;
      isAnyRunning = true;
      if (slowMo.startedAt <= judgedAtMs && slowMo.endsAt > judgedAtMs) return true;
    }
    if (framing.blend > 0) {
      isAnyRunning = true;
      if (world.sequence.startedAt <= judgedAtMs) return true;
    }
    // Drawn just behind the judgement's step: its slow-mo may not show yet.
    if (!isAnyRunning && clockMs >= judgedAtMs) hasJudged = false;
    return false;
  };

  const fitFollow = (aspect: number, params: Readonly<FollowParams>): void => {
    if (room === null) return;
    fitFollowFrame(frame, room, params.frameWidthM, params.frameDepthM, aspect);
    const papaUM = viewUM(papaXM, papaZM);
    const papaVM = viewVM(papaXM, 0, papaZM);
    if (state.lastAtMs === null) {
      // Behind the loading screen already on Papa; the first frame snaps again on the clock.
      snapFollow(state, frame, params, papaUM, papaVM, papaUM, papaVM, 0);
      state.lastAtMs = null;
    } else {
      settleFollow(state, frame, params, papaUM, papaVM);
    }
    worldOfView(state.centreUM, state.centreVM, frame.lookYM, lookPoint);
    fitFollowCamera(camera, room, params, lookPoint.xM, lookPoint.zM, aspect);
    fittedAspect = aspect;
    fittedWidthM = params.frameWidthM;
    fittedDepthM = params.frameDepthM;
    cameraFx.clampTo(frame);
    cameraFx.captureBase();
  };

  return {
    get mode() {
      return mode;
    },
    get aim() {
      return aim;
    },
    frame,
    setLevel(levelRoom, setup) {
      room = levelRoom;
      mode = setup.mode;
      levelParams = setup.follow;
      state = createFollowState();
      hasJudged = false;
      aim = 'papa';
      fittedAspect = 0;
      papaXM = setup.papaStartXM;
      papaZM = setup.papaStartZM;
      // No clamp left from a previous follow level, even if the canvas has no size to fit yet.
      cameraFx.clampTo(null);
    },
    fit(aspect, params) {
      if (room === null) return;
      if (mode === 'fixed' || levelParams === null) {
        fitIsoCamera(camera, room, aspect);
        cameraFx.clampTo(null);
        cameraFx.captureBase();
        return;
      }
      // Before the level's first frame the running sim may still be the previous level's: its own
      // tuning, then the live one.
      fitFollow(aspect, state.lastAtMs === null ? levelParams : (params ?? levelParams));
    },
    onSimEvent(event, world) {
      if (mode !== 'follow') return;
      if (event.type !== 'ResponseResolved' && event.type !== 'GagTriggered') return;
      const threat = world.threats.find((candidate) => candidate.id === event.threatId);
      if (threat === undefined) return;
      hasJudged = true;
      judgedXM = threat.xM;
      judgedZM = threat.zM;
      judgedAtMs = event.t;
    },
    update(world, clockMs, drawnPapaXM, drawnPapaZM, framing, isMotionReduced) {
      if (mode !== 'follow' || room === null || fittedAspect === 0) return;
      papaXM = drawnPapaXM;
      papaZM = drawnPapaZM;
      const params = world.feel.camera;
      if (params.frameWidthM !== fittedWidthM || params.frameDepthM !== fittedDepthM) {
        fitFollow(fittedAspect, params);
      }
      const papaUM = viewUM(papaXM, papaZM);
      const papaVM = viewVM(papaXM, 0, papaZM);
      const isOnThreat = isJudgedFramed(world, clockMs, framing);
      aim = isOnThreat ? 'threat' : 'papa';
      const aimUM = isOnThreat ? viewUM(judgedXM, judgedZM) : papaUM;
      const aimVM = isOnThreat ? viewVM(judgedXM, 0, judgedZM) : papaVM;
      stepFollow(state, frame, params, isMotionReduced, papaUM, papaVM, aimUM, aimVM, clockMs);
      worldOfView(state.centreUM, state.centreVM, frame.lookYM, lookPoint);
      cameraFx.moveBaseTo(lookPoint.xM, lookPoint.zM);
    },
  };
}
