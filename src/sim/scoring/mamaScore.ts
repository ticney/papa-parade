import type { Feel } from '@content/schemas/feel';
import { MAMA_SCORE_MAX_POINTS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { LevelEndReason } from '../events.ts';
import { lookPartsShown } from '../papa/look.ts';
import type { MamaScore, World } from '../world.ts';
import { calmShareOf } from './calmTracker.ts';
import { starsForScore } from './stars.ts';

/** What the note is computed from: the score counters and the mess, as the level left them. */
export interface ScoreTally {
  perfects: number;
  /** Responses in time but not perfect (story 3.12): they feed the Rire at half a perfect. */
  successes: number;
  nearMisses: number;
  /** The points of every combo cashed in (story 4.2): they feed the Rire. */
  comboPoints: number;
  /** Sim time the baby was calm (`world.score.calmMs`, story 3.12). */
  calmMs: number;
  /** Sim time played, at the step the level ends (`world.time.sim`): the calm share's denominator. */
  playedMs: number;
  /** How many of the three parts of Papa's look are shown at the end (story 3.7): each feeds the Rire. */
  lookParts: number;
  /** Points of the house chores, before the clamp (story 9.4: the sum of the done chores' `homePoints`). */
  homePoints: number;
  propsOnFloor: number;
  propsBroken: number;
  mischiefs: number;
}

/** `value` held to `[0, max]`, then rounded: every row is a whole number (D3), the Maison row apart. */
const row = (value: number, maxPoints: number): number =>
  Math.round(Math.min(Math.max(value, 0), maxPoints));

/**
 * The Maison row (story 9.4): `value` held to `[0, max]`, then rounded to the nearest half, because
 * a chore is worth `7.5` (two of them fill the 15) and the Result screen shows it (`7,5 / 15`).
 */
const homeRow = (value: number, maxPoints: number): number =>
  Math.round(Math.min(Math.max(value, 0), maxPoints) * 2) / 2;

/**
 * Mama's note (GDD › economy, story 1.22, five rows since 3.12): Rire (the look's parts included, story 3.7) + Calme du bébé + Maison +
 * base − Soupir − Hurlement, each row held to its range and rounded (to a whole number, the Maison row to a half), the sum held to `[0, 100]`.
 * With the refines of `MamaSchema` (the maxima add up to 100, the base is the sigh and scream
 * maxima) the rows always add up to the score. A woken Mama (story 3.2, D3) changes the stars only:
 * she takes off `earlyWakePenaltyStars` of them (never below 0, `lostStars`), the five rows and the
 * points stay those of a timer end. A Mama come home early (`mamaHome`, story 3.16) gives 0 stars
 * and takes none off (`lostStars` 0: every slot is an empty star, whatever the score); the five rows and
 * the points are those of the room as it is. Pure: it reads values and returns one.
 */
export function computeMamaScore(
  tally: ScoreTally,
  mama: Feel['mama'],
  reason: LevelEndReason,
): MamaScore {
  const laughPoints = row(
    tally.perfects * mama.laughPerPerfectPoints +
      tally.successes * mama.laughPerSuccessPoints +
      tally.comboPoints +
      tally.lookParts * mama.laughPerLookPartPoints,
    mama.laughMaxPoints,
  );
  const calmPoints = row(
    calmShareOf(tally.calmMs, tally.playedMs) * mama.calmMaxPoints,
    mama.calmMaxPoints,
  );
  const homePoints = homeRow(tally.homePoints, mama.homeMaxPoints);
  const sighPoints = row(
    tally.propsOnFloor * mama.sighPerPropOnFloorPoints +
      tally.propsBroken * mama.sighPerBrokenPropPoints +
      tally.mischiefs * mama.sighPerMischiefPoints,
    mama.sighMaxPoints,
  );
  const screamPoints = row(tally.nearMisses * mama.screamPerNearMissPoints, mama.screamMaxPoints);
  const scorePoints = Math.min(
    Math.max(
      laughPoints + calmPoints + homePoints + mama.baseScorePoints - sighPoints - screamPoints,
      0,
    ),
    MAMA_SCORE_MAX_POINTS,
  );
  // Mama come home early: no star whatever the score, and nothing to take off (story 3.16 D6).
  const baseStars =
    reason === 'mamaHome' ? 0 : starsForScore(scorePoints, mama.starThresholdPoints);
  const lostStars = reason === 'mamaWoke' ? Math.min(mama.earlyWakePenaltyStars, baseStars) : 0;
  return {
    laughPoints,
    calmPoints,
    homePoints,
    sighPoints,
    screamPoints,
    scorePoints,
    stars: baseStars - lostStars,
    lostStars,
  };
}

/**
 * Gives the note, once, at the step the level ends (`runFlow`, right after `LevelEnded`; D1): reads
 * the counters and the mess of the frozen room (D5), writes `world.score.final` and emits
 * `LevelScored` at the same `t`. A helper, not a system (`runScoring` holds the calm tracker and the
 * combo's carry tick). The combo points cashed in feed the Rire; the ones not cashed are lost. `reason` is why
 * the level ended: a woken Mama costs stars, a Mama come home early gives none.
 */
export function scoreLevel(world: World, ctx: StepContext, reason: LevelEndReason): void {
  const { perfects, successes, nearMisses, comboPoints, calmMs } = world.score;
  const { propsOnFloor, mischiefs } = world.mess;
  // The Maison row (story 9.4): what the chores finished by now are worth; an unfinished one pays nothing.
  // The Soupir's broken objects (story 9.6): the physics' recount (`world.mess.propsBroken`) plus the plates
  // the chores broke, one `missBrokenObjects` per missed beat, finished or not.
  let homePoints = 0;
  let propsBroken = world.mess.propsBroken;
  for (let i = 0; i < world.chores.length; i++) {
    const chore = world.chores[i];
    const def = ctx.level.chores[i]?.def;
    if (chore?.state === 'done') homePoints += def?.homePoints ?? 0;
    propsBroken += (chore?.beatsMissed ?? 0) * (def?.missBrokenObjects ?? 0);
  }
  const score = computeMamaScore(
    {
      perfects,
      successes,
      nearMisses,
      comboPoints,
      calmMs,
      lookParts: lookPartsShown(world.papa.look),
      // The clock stops mattering from the ending step on (`ENDED_SYSTEMS` keeps it going): read it here.
      playedMs: world.time.sim,
      homePoints,
      propsOnFloor,
      propsBroken,
      mischiefs,
    },
    ctx.feel.mama,
    reason,
  );
  world.score.final = score;
  ctx.events.push({ type: 'LevelScored', t: world.time.sim, ...score });
}
