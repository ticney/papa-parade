import { STEP_MS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import { findPath } from '../nav/astar.ts';
import { smoothPath } from '../nav/smoothPath.ts';
import type { World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';
import { advanceAlongPath, stepInDirection } from './walk.ts';

/**
 * Plans the walk to a tapped point (D7). The path ends exactly at the point when it is in an open
 * cell of Papa's region, else at the centre of the nearest open cell of that region, so a tap is
 * never unreachable. Replans from where Papa stands, in any state. A* failing anyway (it should
 * not) leaves Papa where he is.
 */
function tapFloor(world: World, ctx: StepContext, tapXM: number, tapZM: number): void {
  const { papa } = world;
  const grid = ctx.nav.papa;

  let startCell = grid.cellAt(papa.xM, papa.zM);
  if (startCell < 0 || grid.open[startCell] !== 1) {
    // Impossible after the spawn snapping, but cheap: stand on the nearest open cell of any region.
    startCell = grid.nearestOpenCell(papa.xM, papa.zM, -1);
    if (startCell < 0) return;
    papa.xM = grid.centerXM(startCell);
    papa.zM = grid.centerZM(startCell);
  }
  const region = grid.region[startCell] as number;

  let goalCell = grid.cellAt(tapXM, tapZM);
  let goalXM = tapXM;
  let goalZM = tapZM;
  if (goalCell < 0 || grid.region[goalCell] !== region) {
    goalCell = grid.nearestOpenCell(tapXM, tapZM, region);
    if (goalCell < 0) return;
    goalXM = grid.centerXM(goalCell);
    goalZM = grid.centerZM(goalCell);
  }

  const cells = grid.scratch.cells;
  if (!findPath(grid, startCell, goalCell, cells)) return;
  const path: number[] = []; // one per tap: it becomes part of the world
  smoothPath(grid, cells, papa.xM, papa.zM, goalXM, goalZM, path);

  papa.path = path;
  papa.pathIndex = 0;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  ctx.events.push({
    type: 'PapaPathPlanned',
    t: world.time.sim,
    targetXM: goalXM,
    targetZM: goalZM,
    waypointCount: path.length / 2,
  });
  enterPapaState(world, ctx, 'walkPath');
}

/** A direction cancels a path. A new direction while already walking one only updates it. */
function move(world: World, ctx: StepContext, dirX: number, dirZ: number): void {
  // Scaled by the larger component first, so that a huge (or tiny) finite vector neither overflows
  // nor underflows when squared.
  const largest = Math.max(Math.abs(dirX), Math.abs(dirZ));
  if (!(largest > 0)) return; // `commandProblem` refuses (0, 0)
  const scaledX = dirX / largest;
  const scaledZ = dirZ / largest;
  const length = Math.sqrt(scaledX * scaledX + scaledZ * scaledZ);
  const { papa } = world;
  // `+ 0` turns a -0 into 0: nothing in the sim may depend on a sign of zero.
  const nextX = scaledX / length + 0;
  const nextZ = scaledZ / length + 0;
  // Turning towards another wall is a new blockage: it must be reported again.
  if (nextX !== papa.dirX || nextZ !== papa.dirZ) papa.isBlocked = false;
  papa.dirX = nextX;
  papa.dirZ = nextZ;
  papa.headingX = papa.dirX;
  papa.headingZ = papa.dirZ;
  if (papa.state === 'walkPath') {
    papa.path.length = 0;
    papa.pathIndex = 0;
  }
  enterPapaState(world, ctx, 'walkDir');
}

/** Releasing a key only stops a direction walk: it must not cancel a tap made meanwhile (D6). */
function moveStop(world: World, ctx: StepContext): void {
  const { papa } = world;
  if (papa.state !== 'walkDir') return;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  enterPapaState(world, ctx, 'idle');
}

/**
 * System: Papa. Remembers where he stood (for the view's interpolation), handles this step's
 * `TapFloor` / `Move` / `MoveStop` in order, then moves him once by `walkSpeedMps` for one step.
 * The speed is read each step, so a changed feel applies at once.
 */
export function runPapa(world: World, ctx: StepContext): void {
  const { papa } = world;
  papa.prevXM = papa.xM;
  papa.prevZM = papa.zM;

  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command === undefined) continue;
    if (command.type === 'TapFloor') tapFloor(world, ctx, command.xM, command.zM);
    else if (command.type === 'Move') move(world, ctx, command.dirX, command.dirZ);
    else if (command.type === 'MoveStop') moveStop(world, ctx);
  }

  const budgetM = (ctx.feel.movement.walkSpeedMps * STEP_MS) / 1000;
  if (papa.state === 'walkPath') {
    if (advanceAlongPath(papa, budgetM)) {
      papa.path.length = 0;
      papa.pathIndex = 0;
      ctx.events.push({ type: 'PapaArrived', t: world.time.sim, xM: papa.xM, zM: papa.zM });
      enterPapaState(world, ctx, 'idle');
    }
  } else if (papa.state === 'walkDir') {
    if (stepInDirection(papa, ctx.nav.papa, budgetM)) {
      papa.isBlocked = false;
    } else if (!papa.isBlocked) {
      papa.isBlocked = true;
      ctx.events.push({ type: 'PapaBlocked', t: world.time.sim, xM: papa.xM, zM: papa.zM });
    }
  }
}
