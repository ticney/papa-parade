import type { Feel } from '@content/schemas/feel';
import type { SimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import type { OrthographicCamera } from 'three';
import type { StickAxes } from './gamepadInput.ts';
import {
  type FloorDir,
  keysToScreenDir,
  type ScreenDir,
  screenToWorldDir,
  stickToScreenDir,
} from './moveDirection.ts';

export interface MoveIntent {
  /**
   * Looks at the keys and the stick and, if the combined direction is not the one last sent, sends
   * `Move` (a new direction) or `MoveStop` (nothing pushed any more) stamped `t`. Does nothing
   * when it is unchanged (D9): a held key sends one command, not one per frame.
   */
  update(held: ReadonlySet<string>, stick: StickAxes, t: SimMs): void;
  /** Forgets what was sent: the next `update` sends whatever is pushed now. A new level (a new sim) starts so. */
  reset(): void;
}

export interface MoveIntentDeps {
  camera: OrthographicCamera;
  /** The stick's deadzone and angle step, read at each update. */
  input: Pick<Feel['input'], 'stickDeadzonePct' | 'stickAngleStepDeg'>;
  send(command: SimCommand): void;
}

/**
 * The player's wish to walk, turned into commands. The stick wins over the keys outside its
 * deadzone; keys and stick are tracked at all times, and the caller decides when this may send.
 */
export function createMoveIntent(deps: MoveIntentDeps): MoveIntent {
  const keyDir: ScreenDir = { x: 0, up: 0 };
  const stickDir: ScreenDir = { x: 0, up: 0 };
  const worldDir: FloorDir = { x: 0, z: 0 };
  // The direction last sent; `hasSent` false means "none sent since the level began".
  let isMoving = false;
  let sentX = 0;
  let sentZ = 0;

  return {
    update(held, stick, t) {
      const { stickDeadzonePct, stickAngleStepDeg } = deps.input;
      const hasStick = stickToScreenDir(
        stick.x,
        stick.y,
        stickDeadzonePct,
        stickAngleStepDeg,
        stickDir,
      );
      const hasKeys = keysToScreenDir(held, keyDir);
      const screen = hasStick ? stickDir : keyDir;
      const hasDirection =
        (hasStick || hasKeys) && screenToWorldDir(deps.camera, screen.x, screen.up, worldDir);
      if (!hasDirection) {
        if (isMoving) {
          isMoving = false;
          deps.send({ type: 'MoveStop', t });
        }
        return;
      }
      if (isMoving && worldDir.x === sentX && worldDir.z === sentZ) return;
      isMoving = true;
      sentX = worldDir.x;
      sentZ = worldDir.z;
      deps.send({ type: 'Move', t, dirX: worldDir.x, dirZ: worldDir.z });
    },
    reset() {
      isMoving = false;
      sentX = 0;
      sentZ = 0;
    },
  };
}
