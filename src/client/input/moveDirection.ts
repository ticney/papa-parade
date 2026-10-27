import type { OrthographicCamera } from 'three';
import { MOVE_KEY_CODES } from './keyboardInput.ts';

/** A direction on the screen: `x` to the right, `up` toward the top, each in `[-1, 1]`. */
export interface ScreenDir {
  x: number;
  up: number;
}

/** A direction on the floor, in world axes (x right, z toward the viewer). */
export interface FloorDir {
  x: number;
  z: number;
}

/** Cleans float dust so that "straight up" really is 0 and equal directions compare equal. */
const snapZero = (value: number): number => (Math.abs(value) < 1e-12 ? 0 : value);

/**
 * The world direction that goes toward `screenX` (right) and `screenUp` on the screen. It follows
 * the camera basis, never a hard-coded 45° (D10): the camera's right and forward vectors are laid
 * flat on the floor and normalised, then combined and normalised again so that a diagonal is as
 * fast as a straight line. Returns false, leaving `out` at (0, 0), when there is no direction.
 */
export function screenToWorldDir(
  camera: OrthographicCamera,
  screenX: number,
  screenUp: number,
  out: FloorDir,
): boolean {
  const e = camera.matrixWorld.elements;
  // Columns of the camera matrix: 0 = right, 2 = backward (the camera looks down -z).
  let rightX = e[0] as number;
  let rightZ = e[2] as number;
  const rightLength = Math.sqrt(rightX * rightX + rightZ * rightZ);
  let forwardX = -(e[8] as number);
  let forwardZ = -(e[10] as number);
  const forwardLength = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ);
  out.x = 0;
  out.z = 0;
  if (rightLength === 0 || forwardLength === 0) return false; // a camera looking straight down or sideways
  rightX /= rightLength;
  rightZ /= rightLength;
  forwardX /= forwardLength;
  forwardZ /= forwardLength;
  const x = screenX * rightX + screenUp * forwardX;
  const z = screenX * rightZ + screenUp * forwardZ;
  const length = Math.sqrt(x * x + z * z);
  if (!(length > 1e-12)) return false;
  out.x = snapZero(x / length);
  out.z = snapZero(z / length);
  return true;
}

/**
 * The screen direction of the keys held: opposite keys cancel, so a diagonal is `(±1, ±1)` (the
 * length is fixed later, in world space). Returns false when nothing is pushed.
 */
export function keysToScreenDir(held: ReadonlySet<string>, out: ScreenDir): boolean {
  const any = (codes: readonly string[]): number => (codes.some((code) => held.has(code)) ? 1 : 0);
  out.x = any(MOVE_KEY_CODES.right) - any(MOVE_KEY_CODES.left);
  out.up = any(MOVE_KEY_CODES.up) - any(MOVE_KEY_CODES.down);
  return out.x !== 0 || out.up !== 0;
}

/**
 * The screen direction of a left stick (gamepad axes: +x right, +y DOWN). Inside the deadzone
 * (`deadzonePct` percent of the full range) it is no direction. Outside, the angle is rounded to a
 * multiple of `stepDeg`, so a resting hand does not journal a command per frame (D5); the length
 * is always 1, the stick's magnitude does not set the speed. Returns false inside the deadzone.
 */
export function stickToScreenDir(
  axisX: number,
  axisY: number,
  deadzonePct: number,
  stepDeg: number,
  out: ScreenDir,
): boolean {
  out.x = 0;
  out.up = 0;
  const magnitude = Math.sqrt(axisX * axisX + axisY * axisY);
  if (!(magnitude > 0) || magnitude < deadzonePct / 100) return false;
  const stepRad = (stepDeg * Math.PI) / 180;
  const turns = Math.round(Math.atan2(-axisY, axisX) / stepRad);
  out.x = snapZero(Math.cos(turns * stepRad));
  out.up = snapZero(Math.sin(turns * stepRad));
  return true;
}
