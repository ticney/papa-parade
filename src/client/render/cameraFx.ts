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

export interface CameraFx {
  /** Takes the camera's current pose as the framing to move around: call it after every `fitIsoCamera`. */
  captureBase(): void;
  /** The floor point the next perfect move leans toward (the resolved threat). */
  focusOn(xM: number, zM: number): void;
  /**
   * Moves the camera for the sim time `clockMs`, around the captured framing. Call it every
   * rendered frame, before the draw. At blend 0 it puts the base back bit for bit and writes
   * nothing on the next frames. Allocates nothing.
   */
  update(
    world: Readonly<World>,
    clockMs: number,
    perfectCamera: Readonly<PerfectCamera>,
    isMotionReduced: boolean,
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
  const focus = new Vector3();
  let isFocused = false;
  let isDisplaced = false;
  // The inputs of the last write: nothing is written again while they are the same.
  let appliedBlend = -1;
  let appliedReduced = false;
  let isDirty = true;
  let yawDeg = 0;

  const restore = (): void => {
    camera.position.copy(basePosition);
    camera.quaternion.copy(baseQuaternion);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    isDisplaced = false;
    appliedBlend = 0;
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
      appliedBlend = -1;
      isDirty = true;
    },
    focusOn(xM, zM) {
      focus.set(xM, FOCUS_HEIGHT_M, zM);
      isFocused = true;
      isDirty = true;
    },
    update(world, clockMs, perfectCamera, isMotionReduced) {
      let slowMo: SlowMoEntry | undefined;
      const { slowMos } = world.time;
      for (let i = 0; i < slowMos.length; i++) {
        if ((slowMos[i] as SlowMoEntry).source === 'perfect') slowMo = slowMos[i];
      }
      const blend = perfectCameraBlendAt(slowMo, clockMs, perfectCamera.zoomInMs);
      if (blend === 0) {
        if (isDisplaced) restore();
        return;
      }
      if (!isDirty && blend === appliedBlend && isMotionReduced === appliedReduced) return;
      const capPct = isMotionReduced ? REDUCED_MOTION_ZOOM_CAP_PCT / 100 : 1;
      const k = isFocused ? (perfectCamera.focusPct / 100) * capPct * blend : 0;
      // Pan: the view centre moves toward the focus point, the position with it (orthographic: the
      // framing shifts, the perspective does not change).
      const dx = (focus.x - baseCentre.x) * k;
      const dy = (focus.y - baseCentre.y) * k;
      const dz = (focus.z - baseCentre.z) * k;
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
      camera.zoom = 1 + (perfectCamera.zoomPct / 100) * capPct * blend;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      isDisplaced = true;
      isDirty = false;
      appliedBlend = blend;
      appliedReduced = isMotionReduced;
      yawDeg = turnDeg;
    },
    reset() {
      if (isDisplaced) restore();
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
