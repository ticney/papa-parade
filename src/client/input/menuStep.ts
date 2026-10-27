import { STICK_RELEASE_RATIO } from '@shared/constants';
import type { StickAxes } from './gamepadInput.ts';

/** What `stickToMenuStep` remembers between two calls: whether the stick is already pushed. */
export interface MenuStickMemory {
  isActive: boolean;
}

export type MenuStep = 'up' | 'down' | 'left' | 'right';

/**
 * The menu step a left stick makes (story 1.17, D14): one step on the **edge** of leaving the
 * deadzone, along the dominant axis (a tie goes to the horizontal one), then nothing until the stick
 * has fallen back below `STICK_RELEASE_RATIO` of the deadzone (hysteresis) and is pushed again. No
 * auto-repeat. `axes.y` is DOWN, so a push toward the top is `up`. Returns null while it holds.
 */
export function stickToMenuStep(
  axes: Readonly<StickAxes>,
  memory: MenuStickMemory,
  deadzonePct: number,
): MenuStep | null {
  const magnitude = Math.sqrt(axes.x * axes.x + axes.y * axes.y);
  if (memory.isActive) {
    if (!(magnitude >= (deadzonePct * STICK_RELEASE_RATIO) / 100)) memory.isActive = false;
    return null;
  }
  if (!(magnitude > 0) || magnitude < deadzonePct / 100) return null;
  memory.isActive = true;
  if (Math.abs(axes.x) >= Math.abs(axes.y)) return axes.x > 0 ? 'right' : 'left';
  return axes.y > 0 ? 'down' : 'up';
}
