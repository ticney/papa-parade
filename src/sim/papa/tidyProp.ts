import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * The index in `world.props` of the prop `propId` when it is a mess to tidy (`isMess`), else -1.
 * Pure: a broken prop is not a mess, a prop on its furniture is not either (story 3.5).
 */
export function messPropIndexOf(world: World, propId: string): number {
  const { props } = world;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop !== undefined && prop.id === propId) return prop.isMess ? i : -1;
  }
  return -1;
}

/**
 * Papa puts the prop at `propIndex` back where it spawned (story 3.5, D5): zero velocities and no
 * rotation (`PhysicsPort.resetProp`, which wakes it so that it settles again), its slice written to
 * the same pose and out of the mess at once, `score.propsTidied + 1` and `PropTidied`. `runPhysics`
 * runs after `runPapa`, so it recounts `mess.propsOnFloor` in this very step, and the pose written
 * here becomes the previous pose in its step 2 (the view does not slide the prop across the room).
 * It allocates only the event.
 */
export function tidyProp(world: World, ctx: StepContext, propIndex: number): void {
  const prop = world.props[propIndex];
  const spec = ctx.level.props[propIndex];
  if (prop === undefined || spec === undefined) return;
  const [xM, yM, zM] = spec.spawnM;
  ctx.physics.resetProp(propIndex, xM, yM, zM);
  prop.xM = xM;
  prop.yM = yM;
  prop.zM = zM;
  prop.qx = 0;
  prop.qy = 0;
  prop.qz = 0;
  prop.qw = 1;
  prop.isOnFloor = false;
  prop.isMess = false;
  world.score.propsTidied += 1;
  ctx.events.push({ type: 'PropTidied', t: world.time.sim, propId: prop.id });
}
