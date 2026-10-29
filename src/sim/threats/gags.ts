import { invariant } from '@shared/invariant';
import type { StepContext } from '../context.ts';
import { putPapaToSleep } from '../papa/sleep.ts';
import { pushProp } from '../physics/propsSystem.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * Every gag a threat can end in, as data. A gag is a harmless, comic consequence (NFR9). The sim
 * applies the consequences that need the sim (`applyGag`: a near miss, a pushed prop); the rest
 * comes from the events and from `World` (noise from `PropImpact`, story 3.1; Mama's sigh from
 * `world.mess` and her scream from `world.score.nearMisses`, story 1.22). The presentation is the client's
 * (`client/render/gags.ts`). `content:check` checks a threat's `gag` (or `surpriseGags`) against this
 * list. The surprise mischiefs of the suspicious silence (story 1.21) add to `world.mess.mischiefs`.
 * A gag that makes the baby cry is not a gag id's business: the def says it with `gagCryMs`, and
 * `gagThreat` starts the cry (story 3.1 D9).
 */
export const GAG_IDS = [
  'outlet_hair',
  'stairs_slide',
  'table_object_fall',
  'papa_asleep',
  'tissues_everywhere',
  'crayon_scribbles',
] as const;

export type GagId = (typeof GAG_IDS)[number];

/** The gag of the micro-sleep, and only of it: `createSim` and `content:check` pair it with `target: "papa"`. */
export const PAPA_ASLEEP_GAG_ID: GagId = 'papa_asleep';

/** The gag a threat def names, as a `GagId`. `createSim` has already refused a def with another, so this guards a bug, not content. */
export function gagIdOf(gag: string): GagId {
  const known = (GAG_IDS as readonly string[]).includes(gag);
  invariant(known, `unknown gag ${gag}`);
  return gag as GagId;
}

/**
 * What a gag does to the world, at the step its threat is failed. It never writes a slice
 * directly: it emits events and goes through helpers (`pushProp`, `putPapaToSleep`).
 */
type GagConsequence = (world: World, ctx: StepContext, threat: ThreatInstance) => void;

/** Cartoon jolt, lights and hair: all client-side (D3: not a near miss). */
function outletHair(): void {}

/** The baby slides down the stairs, delighted: a near accident, never an injury (NFR9). */
function stairsSlide(world: World, ctx: StepContext, threat: ThreatInstance): void {
  // Mama's « Hurlement » counts it (story 1.22): the one writer, beside the one `NearMiss`.
  world.score.nearMisses += 1;
  ctx.events.push({
    type: 'NearMiss',
    t: world.time.sim,
    threatId: threat.id,
    gag: 'stairs_slide',
  });
}

/**
 * The object on the coffee table falls. It is the unbroken prop that is off the floor, nearest the
 * threat's anchor within `propReachDistM` (ties go to the lower index), pushed horizontally away from
 * the anchor, so that it leaves the table by its nearest edge. A prop exactly on the anchor is
 * pushed along the baby's gaze. No such prop: nothing is pushed.
 */
function tableObjectFall(world: World, ctx: StepContext, threat: ThreatInstance): void {
  const { pushImpulseNs, propReachDistM } = ctx.feel.gags.tableObjectFall;
  let nearestIndex = -1;
  let nearestM = Number.POSITIVE_INFINITY;
  let nearestDxM = 0;
  let nearestDzM = 0;
  for (let index = 0; index < world.props.length; index++) {
    const prop = world.props[index];
    if (prop === undefined || prop.isBroken || prop.isOnFloor) continue;
    const dxM = prop.xM - threat.xM;
    const dzM = prop.zM - threat.zM;
    const distanceM = Math.sqrt(dxM * dxM + dzM * dzM);
    if (distanceM > propReachDistM || distanceM >= nearestM) continue;
    nearestIndex = index;
    nearestM = distanceM;
    nearestDxM = dxM;
    nearestDzM = dzM;
  }
  if (nearestIndex < 0) return;
  const awayX = nearestM > 0 ? nearestDxM / nearestM : world.baby.gazeX;
  const awayZ = nearestM > 0 ? nearestDzM / nearestM : world.baby.gazeZ;
  pushProp(world, ctx, nearestIndex, awayX * pushImpulseNs, 0, awayZ * pushImpulseNs);
}

/** Papa nods off for a few seconds (story 1.19 D10): no near miss, no snore noise yet (E4's `stay_awake`). */
function papaAsleep(world: World, ctx: StepContext): void {
  putPapaToSleep(world, ctx);
}

/**
 * A surprise mischief of the suspicious silence (story 1.21 D11): mess, not a near accident. It
 * adds one to the cumulative `mess.mischiefs` (story 1.22 counts it in the Sigh) and emits no
 * `NearMiss`. The gag cue is its whole presentation until E7.
 */
function addMischief(world: World): void {
  world.mess.mischiefs += 1;
}

/** One entry per `GagId`, defined once at module scope: a new gag without a consequence is a type error. */
const GAG_CONSEQUENCES: Readonly<Record<GagId, GagConsequence>> = {
  outlet_hair: outletHair,
  stairs_slide: stairsSlide,
  table_object_fall: tableObjectFall,
  papa_asleep: papaAsleep,
  tissues_everywhere: addMischief,
  crayon_scribbles: addMischief,
};

/**
 * Applies what `gag` does to the world. `gagThreat` calls it right after `GagTriggered`, inside
 * `runThreats`: a prop pushed here is stepped by `runPhysics` in the same step.
 */
export function applyGag(world: World, ctx: StepContext, threat: ThreatInstance, gag: GagId): void {
  GAG_CONSEQUENCES[gag](world, ctx, threat);
}
