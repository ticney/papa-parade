import type { PapaLookPart } from '@content/schemas/threat';
import type { StepContext } from '../context.ts';
import type { PapaLook, World } from '../world.ts';

/** The boolean of `world.papa.look` each part of a def's `lookChange` turns on. */
const LOOK_KEYS: Readonly<Record<PapaLookPart, keyof PapaLook>> = {
  mashOnCheek: 'hasMashOnCheek',
  hairOnEnd: 'hasHairOnEnd',
  shirtInsideOut: 'isShirtInsideOut',
};

/** How many of the three parts are shown (the Laugh's `lookParts`, story 3.7). */
export function lookPartsShown(look: Readonly<PapaLook>): number {
  return (
    (look.hasMashOnCheek ? 1 : 0) + (look.hasHairOnEnd ? 1 : 0) + (look.isShirtInsideOut ? 1 : 0)
  );
}

/**
 * A gag shows `part` of Papa's look (story 3.7): it stays shown to the end of the level and emits
 * `PapaLookChanged`. A part already shown does nothing, so there is one event per part per level.
 * No random draw, no state: the look is `world.papa.look`.
 */
export function changePapaLook(
  world: World,
  ctx: StepContext,
  part: PapaLookPart,
  threatId: number,
): void {
  const key = LOOK_KEYS[part];
  const { look } = world.papa;
  if (look[key]) return;
  look[key] = true;
  ctx.events.push({ type: 'PapaLookChanged', t: world.time.sim, part, threatId });
}
