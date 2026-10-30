import type { Feel } from '@content/schemas/feel';
import { ISO_CAMERA_DISTANCE_M, REDUCED_MOTION_ZOOM_CAP_PCT } from '@shared/constants';
import type { World } from '@sim';
import { type OrthographicCamera, Quaternion, Vector3 } from 'three';

// Art constant of the provisional camera move (E7 anchors on the real response point).
/** The point the view moves toward is this high above the floor point of the action, in metres. */
const FOCUS_HEIGHT_M = 0.5;
const DEG_TO_RAD = Math.PI / 180;

type PerfectCamera = Feel['fx']['perfectCamera'];
type SlowMoEntry = World['time']['slowMos'][number];

/** Smoothstep on `[0, 1]`: the curve of the slow-mo's own return (`slowMoFactorAt`). */
const smoothstep = (u: number): number => u * u * (3 - 2 * u);

/**
 * How far the perfect camera move has got, 0 to 1, at sim time `clockMs`, for the `perfect`
 * slow-mo (`undefined` when there is none): 0 before it starts, a linear rise over `zoomInMs`, 1
 * until `holdUntil`, then back down along the slow-mo's own return (`1 − smoothstep`), exactly 0
 * from `endsAt`. Pure: the sim clock is the only input, so a pause holds the move and the hitstop
 * (a clock that stands still) holds it back.
 */
export function perfectCameraBlendAt(
  slowMo: Readonly<SlowMoEntry> | undefined,
  clockMs: number,
  zoomInMs: number,
): number {
  if (slowMo === undefined || clockMs < slowMo.startedAt || clockMs >= slowMo.endsAt) return 0;
  const rise = zoomInMs > 0 ? Math.min(1, (clockMs - slowMo.startedAt) / zoomInMs) : 1;
  if (clockMs < slowMo.holdUntil) return rise;
  const u = (clockMs - slowMo.holdUntil) / (slowMo.endsAt - slowMo.holdUntil);
  return Math.min(rise, 1 - smoothstep(u));
}

/**
 * How far the special sequence's framing has got, 0 to 1 (story 4.4), at sim time `clockMs`: 0
 * before `startedAt`, a linear rise over `inMs`, held, and from `endedAt` (null while the sequence
 * runs) the value it had then going down to 0 along `1 − smoothstep` over `outMs`. Pure, with the
 * world's `sequence` slice and the sim clock as the only inputs: a pause holds it, the hitstop
 * (a clock that stands still) holds it back, and a restart (a fresh slice) clears it.
 */
export function sequenceFramingBlendAt(
  startedAt: number,
  endedAt: number | null,
  clockMs: number,
  inMs: number,
  outMs: number,
): number {
  if (clockMs < startedAt) return 0;
  const riseAt = (atMs: number): number => (inMs > 0 ? Math.min(1, (atMs - startedAt) / inMs) : 1);
  if (endedAt === null || clockMs < endedAt) return riseAt(clockMs);
  const u = outMs > 0 ? (clockMs - endedAt) / outMs : 1;
  if (u >= 1) return 0;
  return riseAt(endedAt) * (1 - smoothstep(u));
}

/**
 * The special sequence's framing as the camera takes it (story 4.4): `blend` from
 * `sequenceFramingBlendAt`, the def's zoom and pan, and Papa's floor point. One object, written by
 * the caller each frame.
 */
export interface SequenceFraming {
  blend: number;
  zoomPct: number;
  focusPct: number;
  xM: number;
  zM: number;
}

export interface CameraFx {
  /** Takes the camera's current pose as the framing to move around: call it after every `fitIsoCamera`. */
  captureBase(): void;
  /**
   * The floor point the move leans toward (the resolved threat). With a move under way the view
   * glides to it over `refocusMs` of sim time (counted from the next `update`); otherwise it is
   * there at once.
   */
  focusOn(xM: number, zM: number): void;
  /**
   * Moves the camera for the sim time `clockMs`, around the captured framing. Call it every
   * rendered frame, before the draw. The perfect's move and the special sequence's framing
   * (`framing`, story 4.4) compose: the zooms add, the pans add. With both blends at 0 it puts the
   * base back bit for bit and writes nothing on the next frames. Allocates nothing.
   */
  update(
    world: Readonly<World>,
    clockMs: number,
    perfectCamera: Readonly<PerfectCamera>,
    isMotionReduced: boolean,
    framing: Readonly<SequenceFraming>,
  ): void;
  /** Puts the framing back at once (level end, restart, loading). */
  reset(): void;
  /** The zoom and the rotation now applied, for the debug `fx()`. */
  readonly zoom: number;
  readonly yawDeg: number;
}

const direction = new Vector3();

/**
 * The perfect response's camera move (FR61): zoom, a pan toward the action and a slight turn
 * around the vertical, driven by the `perfect` slow-mo of the world. It moves the camera *around*
 * the framing `fitIsoCamera` computed, never instead of it, so what the world UI and the hit-test
 * read through the same camera stays what is drawn.
 */
export function createCameraFx(camera: OrthographicCamera): CameraFx {
  const basePosition = new Vector3();
  const baseCentre = new Vector3();
  const baseQuaternion = new Quaternion();
  const centre = new Vector3();
  // The focus the view leans toward now, the one it left and the one it goes to (a new perfect
  // while a move is under way glides between them instead of cutting).
  const focus = new Vector3();
  const focusFrom = new Vector3();
  const focusTo = new Vector3();
  let isFocused = false;
  let isRefocusPending = false;
  let refocusStartMs = 0;
  let isRefocusing = false;
  let isDisplaced = false;
  // Whether the last write had a perfect move in it (a new perfect glides only from one that is under way).
  let wasPerfectMoving = false;
  // The inputs of the last write: nothing is written again while they are the same.
  let appliedBlend = -1;
  let appliedReduced = false;
  let appliedZoomPct = -1;
  let appliedYawDeg = -1;
  let appliedFocusPct = -1;
  let appliedFrameBlend = -1;
  let appliedFrameZoomPct = -1;
  let appliedFrameFocusPct = -1;
  let appliedFrameXM = Number.NaN;
  let appliedFrameZM = Number.NaN;
  let isDirty = true;
  let yawDeg = 0;

  const restore = (): void => {
    camera.position.copy(basePosition);
    camera.quaternion.copy(baseQuaternion);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    isDisplaced = false;
    wasPerfectMoving = false;
    appliedBlend = 0;
    appliedFrameBlend = 0;
    yawDeg = 0;
  };

  return {
    captureBase() {
      camera.updateMatrixWorld(true);
      basePosition.copy(camera.position);
      baseQuaternion.copy(camera.quaternion);
      camera.getWorldDirection(direction);
      baseCentre.copy(basePosition).addScaledVector(direction, ISO_CAMERA_DISTANCE_M);
      // A refit put the base framing back under a move that may be under way: draw it again.
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      isDisplaced = false;
      wasPerfectMoving = false;
      appliedBlend = -1;
      appliedFrameBlend = -1;
      isDirty = true;
    },
    focusOn(xM, zM) {
      focusTo.set(xM, FOCUS_HEIGHT_M, zM);
      isRefocusPending = true;
      isDirty = true;
    },
    update(world, clockMs, perfectCamera, isMotionReduced, framing) {
      let slowMo: SlowMoEntry | undefined;
      const { slowMos } = world.time;
      for (let i = 0; i < slowMos.length; i++) {
        if ((slowMos[i] as SlowMoEntry).source === 'perfect') slowMo = slowMos[i];
      }
      const blend = perfectCameraBlendAt(slowMo, clockMs, perfectCamera.zoomInMs);
      const frameBlend = framing.blend;
      if (blend === 0 && frameBlend === 0) {
        if (isDisplaced) restore();
        return;
      }
      // The refocus and its glide belong to the perfect's move alone (a framing never starts one).
      if (blend !== 0 && isRefocusPending) {
        isRefocusPending = false;
        // A move under way glides from where the view leans now; a fresh one starts on the point.
        if (wasPerfectMoving && isFocused && perfectCamera.refocusMs > 0) {
          focusFrom.copy(focus);
          refocusStartMs = clockMs;
          isRefocusing = true;
        } else {
          focus.copy(focusTo);
          isRefocusing = false;
        }
        isFocused = true;
      }
      if (blend !== 0 && isRefocusing) {
        const glide = Math.min(
          1,
          Math.max(0, (clockMs - refocusStartMs) / perfectCamera.refocusMs),
        );
        focus.lerpVectors(focusFrom, focusTo, smoothstep(glide));
        if (glide === 1) isRefocusing = false;
        isDirty = true;
      }
      if (
        !isDirty &&
        blend === appliedBlend &&
        isMotionReduced === appliedReduced &&
        perfectCamera.zoomPct === appliedZoomPct &&
        perfectCamera.yawDeg === appliedYawDeg &&
        perfectCamera.focusPct === appliedFocusPct &&
        frameBlend === appliedFrameBlend &&
        framing.zoomPct === appliedFrameZoomPct &&
        framing.focusPct === appliedFrameFocusPct &&
        framing.xM === appliedFrameXM &&
        framing.zM === appliedFrameZM
      ) {
        return;
      }
      const capPct = isMotionReduced ? REDUCED_MOTION_ZOOM_CAP_PCT / 100 : 1;
      const k = isFocused ? (perfectCamera.focusPct / 100) * capPct * blend : 0;
      // Pan: the view centre moves toward the focus point, the position with it (orthographic: the
      // framing shifts, the perspective does not change).
      // The sequence's framing adds its own pan, toward Papa (it is 0 outside a sequence: no change).
      const kFrame = (framing.focusPct / 100) * capPct * frameBlend;
      const dx = (focus.x - baseCentre.x) * k + (framing.xM - baseCentre.x) * kFrame;
      const dy = (focus.y - baseCentre.y) * k + (FOCUS_HEIGHT_M - baseCentre.y) * kFrame;
      const dz = (focus.z - baseCentre.z) * k + (framing.zM - baseCentre.z) * kFrame;
      centre.set(baseCentre.x + dx, baseCentre.y + dy, baseCentre.z + dz);
      // Turn around the vertical axis through the moved centre; none under reduced motion.
      const turnDeg = isMotionReduced ? 0 : perfectCamera.yawDeg * blend;
      const turn = turnDeg * DEG_TO_RAD;
      const offsetX = basePosition.x - baseCentre.x;
      const offsetZ = basePosition.z - baseCentre.z;
      camera.position.set(
        centre.x + offsetX * Math.cos(turn) + offsetZ * Math.sin(turn),
        basePosition.y + dy,
        centre.z - offsetX * Math.sin(turn) + offsetZ * Math.cos(turn),
      );
      camera.lookAt(centre);
      camera.zoom =
        1 +
        (perfectCamera.zoomPct / 100) * capPct * blend +
        (framing.zoomPct / 100) * capPct * frameBlend;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      isDisplaced = true;
      isDirty = false;
      appliedBlend = blend;
      appliedReduced = isMotionReduced;
      appliedZoomPct = perfectCamera.zoomPct;
      appliedYawDeg = perfectCamera.yawDeg;
      appliedFocusPct = perfectCamera.focusPct;
      appliedFrameBlend = frameBlend;
      appliedFrameZoomPct = framing.zoomPct;
      appliedFrameFocusPct = framing.focusPct;
      appliedFrameXM = framing.xM;
      appliedFrameZM = framing.zM;
      wasPerfectMoving = blend !== 0;
      yawDeg = turnDeg;
    },
    reset() {
      if (isDisplaced) restore();
      // The next move leans toward nothing until its own perfect says where: no stale point.
      isFocused = false;
      isRefocusPending = false;
      isRefocusing = false;
      isDirty = true;
    },
    get zoom() {
      return camera.zoom;
    },
    get yawDeg() {
      return yawDeg;
    },
  };
}
