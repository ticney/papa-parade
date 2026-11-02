import { invariant } from '@shared/invariant';
import type { StepContext } from '../context.ts';
import { putPapaToSleep } from '../papa/sleep.ts';
import { dropProps } from '../physics/dropProps.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * Every gag a threat can end in, as data. A gag is a harmless, comic consequence (NFR9). The sim
 * applies the consequences that need the sim (`applyGag`: a near miss, a pushed prop); the rest
 * comes from the events and from `World` (noise from `PropImpact`, story 3.1; Mama's sigh from
 * `world.mess` and her scream from `world.score.nearMisses`, story 1.22: the stairs gag writes it, and
 * `recordFrozenNearMisses` adds the baby's frozen ones when the level ends, story 3.6). The presentation is the client's
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
  'arms_wail',
  'baby_eyes_reopened',
  'baby_sat_up',
  'baby_woke_on_drop',
  'baby_woke_by_touch',
  'baby_woke_crying',
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
  // The choice and the push are shared with the door's spill (story 3.5): one prop, any kind.
  dropProps(world, ctx, threat.xM, threat.zM, {
    count: 1,
    reachM: propReachDistM,
    pushImpulseNs,
    isUnbreakableOnly: false,
  });
}

/**
 * Papa nods off for a few seconds (story 1.19 D10): no near miss. The snore and its noise belong
 * to the sequence's failure (`failSequenceOnGag`, story 4.4 D2), never to a nap outside one.
 */
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

/** The baby wails in Papa's arms: the cry is the def's `gagCryMs`, so there is nothing more for the sim to do. */
function armsWail(): void {}

/** The baby's eyes reopen in the bedtime duel (story 4.6): the cost is the sequence's retreat (`failSequenceOnGag`), nothing for the sim to do here. */
function babyEyesReopened(): void {}

/** The baby sits up in the fake sleep (story 4.7): the retreat is the sequence's and the cry is the def's `gagCryMs`, so nothing for the sim to do here. */
function babySatUp(): void {}

/** The baby wakes as he is laid down (story 4.8): the retreat is the sequence's and the cry is the def's `gagCryMs`, so nothing for the sim to do here. */
function babyWokeOnDrop(): void {}

/** The baby wakes because Papa touched him on a false alarm (story 4.9): the sequence fails (`failSequenceOnGag`) and the cry is the def's `gagCryMs`, so nothing for the sim to do here. */
function babyWokeByTouch(): void {}

/** The baby wakes for real and nobody rocked him (story 4.9): same as {@link babyWokeByTouch}. */
function babyWokeCrying(): void {}

/** One entry per `GagId`, defined once at module scope: a new gag without a consequence is a type error. */
const GAG_CONSEQUENCES: Readonly<Record<GagId, GagConsequence>> = {
  outlet_hair: outletHair,
  stairs_slide: stairsSlide,
  table_object_fall: tableObjectFall,
  papa_asleep: papaAsleep,
  tissues_everywhere: addMischief,
  crayon_scribbles: addMischief,
  // The cry in the arms (story 4.1): no sim consequence. The baby's cry is `gagCryMs` on the def (story 3.1 D9), which feeds the noise gauge.
  arms_wail: armsWail,
  baby_eyes_reopened: babyEyesReopened,
  baby_sat_up: babySatUp,
  baby_woke_on_drop: babyWokeOnDrop,
  baby_woke_by_touch: babyWokeByTouch,
  baby_woke_crying: babyWokeCrying,
};

/**
 * Whether each gag is a near miss: the one answer the end of the level needs (story 3.6, D2). Today
 * `stairs_slide` alone is. A table typed on `GagId`, as `GAG_CONSEQUENCES` is, so that a new gag must
 * say whether it counts.
 */
const NEAR_MISS_GAGS: Readonly<Record<GagId, boolean>> = {
  outlet_hair: false,
  stairs_slide: true,
  table_object_fall: false,
  papa_asleep: false,
  tissues_everywhere: false,
  crayon_scribbles: false,
  arms_wail: false,
  baby_eyes_reopened: false,
  baby_sat_up: false,
  baby_woke_on_drop: false,
  baby_woke_by_touch: false,
  baby_woke_crying: false,
};

/** Whether `gag` is a near miss: the frozen rule of the end photo reads it (`recordFrozenNearMisses`). */
export function isNearMissGag(gag: GagId): boolean {
  return NEAR_MISS_GAGS[gag];
}

/**
 * Applies what `gag` does to the world. `gagThreat` calls it right after `GagTriggered`, inside
 * `runThreats`: a prop pushed here is stepped by `runPhysics` in the same step.
 */
export function applyGag(world: World, ctx: StepContext, threat: ThreatInstance, gag: GagId): void {
  GAG_CONSEQUENCES[gag](world, ctx, threat);
}
