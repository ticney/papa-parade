import type { AfterEffectDefKind, ThreatCatastrophe, ThreatDef } from '@content/schemas/threat';
import { invariant } from '@shared/invariant';
import type { StepContext } from '../context.ts';
import { dropProps } from '../physics/dropProps.ts';
import type { ThreatInstance, World } from '../world.ts';
import { markDebris } from './afterEffects.ts';

/**
 * Every gag a threat can end in, as data. A gag is a harmless, comic consequence (NFR9). The sim
 * applies the consequences that need the sim (`applyGag`: a near miss, a pushed prop); the rest
 * comes from the events and from `World` (noise from `PropImpact`, story 3.1; Mama's sigh from
 * `world.mess` and her scream from `world.score.nearMisses`, story 1.22: the stairs gag writes it, and
 * `recordFrozenNearMisses` adds the baby's frozen ones when the level ends, story 3.6). The presentation is the client's
 * (`client/render/gags.ts`). `content:check` checks a threat's `gag` (or `surpriseGags`) against this
 * list. The surprise mischiefs of the suspicious silence (story 1.21), the pot boiling over (story 9.5), the baby in the open
 * dishwasher (story 9.6) and the five mischiefs of the big salon (story 9.7: `dishes_on_floor`, `pan_concert`,
 * `peelings_everywhere`, `soil_on_rug`, `coffee_spilled`) add to `world.mess.mischiefs`.
 * Papa's look (story 3.7) is not a gag id's business either: the def says which part its gag shows
 * (`lookChange`), `gagThreat` applies it (`changePapaLook`) and the client reads `world.papa.look`.
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
  'pot_boiled_over',
  'baby_in_dishwasher',
  'dishes_on_floor',
  'pan_concert',
  'peelings_everywhere',
  'soil_on_rug',
  'coffee_spilled',
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
 * directly: it emits events and goes through helpers (`pushProp`, `markDebris`). What the gag leaves
 * behind (Papa electrified or asleep, the baby downstairs, the mess) is `applyAfterEffect`'s (story 3.15).
 * `def` is the threat's def, when the caller has it: the coffee table's gag reads its `afterEffect` to mark the debris.
 */
type GagConsequence = (
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef | undefined,
) => void;

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
function tableObjectFall(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  def: ThreatDef | undefined,
): void {
  const { pushImpulseNs, propReachDistM } = ctx.feel.gags.tableObjectFall;
  // The choice and the push are shared with the door's spill (story 3.5): one prop, any kind.
  const pushed: number[] = [];
  dropProps(
    world,
    ctx,
    threat.xM,
    threat.zM,
    { count: 1, reachM: propReachDistM, pushImpulseNs, isUnbreakableOnly: false },
    pushed,
  );
  // The pushed prop stays on the floor until Papa picks it up (story 3.15): only this gag knows which one it chose.
  if (def !== undefined && def.afterEffect.kind === 'debris') {
    markDebris(world, ctx, pushed, def.afterEffect.pickUpMs);
  }
}

/**
 * Papa nods off for a few seconds (story 1.19 D10): no near miss, and nothing for the gag to do: the
 * nap is the séquelle of the micro-sleep's def (`applyAfterEffect`, story 3.15 D7). The snore and its
 * noise belong to the sequence's failure (`failSequenceOnGag`, story 4.4 D2), never to a nap outside one.
 */
function papaAsleep(): void {}

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
  // The pot on the stove (story 9.5): a mess like the silence's, its noise is the def's `gagNoisePct`.
  pot_boiled_over: addMischief,
  // The open dishwasher (story 9.6): « bébé assis dans le panier, couverts au sol », a mischief like the silence's.
  baby_in_dishwasher: addMischief,
  // The five mischiefs of the big salon (story 9.7): mess like the silence's; the two crashes add their noise through the def's `gagNoisePct`.
  dishes_on_floor: addMischief,
  pan_concert: addMischief,
  peelings_everywhere: addMischief,
  soil_on_rug: addMischief,
  coffee_spilled: addMischief,
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
  pot_boiled_over: false,
  baby_in_dishwasher: false,
  dishes_on_floor: false,
  pan_concert: false,
  peelings_everywhere: false,
  soil_on_rug: false,
  coffee_spilled: false,
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
 * The kind of `afterEffect` each gag goes with (story 3.15, FR72): a def's séquelle is data, but which
 * kind fits which gag is a rule of the sim (`applyAfterEffect` dispatches on the kind and reads the
 * gag's own state), so `createSim` and `content:check` refuse a mismatch. Every silence mischief
 * (`tissues_everywhere`, `crayon_scribbles`), the pot boiling over (`pot_boiled_over`), the baby in the open dishwasher (`baby_in_dishwasher`)
 * and the five mischiefs of the big salon (story 9.7: `dishes_on_floor`, `pan_concert`, `peelings_everywhere`, `soil_on_rug`, `coffee_spilled`) are a `mess`; the gags of the E4 sequences are `none`
 * (GDD: their séquelles are to be costed later).
 */
export const AFTER_EFFECT_OF_GAG: Readonly<Record<GagId, AfterEffectDefKind>> = {
  outlet_hair: 'electrified',
  stairs_slide: 'babyDownstairs',
  table_object_fall: 'debris',
  papa_asleep: 'asleep',
  tissues_everywhere: 'mess',
  crayon_scribbles: 'mess',
  pot_boiled_over: 'mess',
  baby_in_dishwasher: 'mess',
  dishes_on_floor: 'mess',
  pan_concert: 'mess',
  peelings_everywhere: 'mess',
  soil_on_rug: 'mess',
  coffee_spilled: 'mess',
  arms_wail: 'none',
  baby_eyes_reopened: 'none',
  baby_sat_up: 'none',
  baby_woke_on_drop: 'none',
  baby_woke_by_touch: 'none',
  baby_woke_crying: 'none',
};

/**
 * Why a def's `afterEffect.kind` does not fit its gags, or `null` when it does. A gag the sim does
 * not know is not this check's business (it has its own message). Shared by `createSim` and `content:check`.
 */
export function afterEffectProblem(
  defId: string,
  gags: readonly string[],
  kind: AfterEffectDefKind,
): string | null {
  for (const gag of gags) {
    if (!(GAG_IDS as readonly string[]).includes(gag)) continue;
    const expected = AFTER_EFFECT_OF_GAG[gag as GagId];
    if (expected !== kind) {
      return `the threat "${defId}" has the gag "${gag}", whose afterEffect.kind must be "${expected}", not "${kind}"`;
    }
  }
  return null;
}

/**
 * The catastrophe category of each gag (story 3.16, FR73, GDD mechanic 14): the row of
 * `feel.catastrophe.risePct` it raises the gauge by. A def declares it too (`catastrophe`, GDD: a
 * threat « doit déclarer sa hausse de catastrophe ») and `createSim` / `content:check` refuse a def
 * that disagrees with its gag, so that two defs sharing a gag cannot disagree. The outlet is a
 * `nearMiss` here (GDD L226) though it is not a `NearMiss` for Mama's scream (`NEAR_MISS_GAGS`); the
 * gags of the E4 sequences are `none` (GDD: to be costed with E4).
 */
export const CATASTROPHE_OF_GAG: Readonly<Record<GagId, ThreatCatastrophe>> = {
  outlet_hair: 'nearMiss',
  stairs_slide: 'nearMiss',
  table_object_fall: 'mess',
  papa_asleep: 'microSleep',
  tissues_everywhere: 'mess',
  crayon_scribbles: 'mess',
  pot_boiled_over: 'mess',
  baby_in_dishwasher: 'mess',
  dishes_on_floor: 'mess',
  pan_concert: 'mess',
  peelings_everywhere: 'mess',
  soil_on_rug: 'mess',
  coffee_spilled: 'mess',
  arms_wail: 'none',
  baby_eyes_reopened: 'none',
  baby_sat_up: 'none',
  baby_woke_on_drop: 'none',
  baby_woke_by_touch: 'none',
  baby_woke_crying: 'none',
};

/**
 * Why a def's `catastrophe` does not fit its gags, or `null` when it does (the pattern of
 * {@link afterEffectProblem}, which it follows). Shared by `createSim` and `content:check`.
 */
export function catastropheProblem(
  defId: string,
  gags: readonly string[],
  category: ThreatCatastrophe,
): string | null {
  for (const gag of gags) {
    if (!(GAG_IDS as readonly string[]).includes(gag)) continue;
    const expected = CATASTROPHE_OF_GAG[gag as GagId];
    if (expected !== category) {
      return `the threat "${defId}" has the gag "${gag}", whose catastrophe must be "${expected}", not "${category}"`;
    }
  }
  return null;
}

/**
 * Applies what `gag` does to the world. `gagThreat` calls it right after `GagTriggered`, inside
 * `runThreats`: a prop pushed here is stepped by `runPhysics` in the same step. `def` is the
 * threat's def (omitted, a gag leaves no séquelle of its own).
 */
export function applyGag(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  gag: GagId,
  def?: ThreatDef,
): void {
  GAG_CONSEQUENCES[gag](world, ctx, threat, def);
}
