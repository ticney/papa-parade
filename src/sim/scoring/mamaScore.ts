import type { Feel } from '@content/schemas/feel';
import { MAMA_SCORE_MAX_POINTS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { LevelEndReason } from '../events.ts';
import type { MamaScore, World } from '../world.ts';
import { starsForScore } from './stars.ts';

/** What the note is computed from: the score counters and the mess, as the level left them. */
export interface ScoreTally {
  perfects: number;
  nearMisses: number;
  /** The points of every combo cashed in (story 4.2): they feed the Rire. */
  comboPoints: number;
  propsOnFloor: number;
  propsBroken: number;
  mischiefs: number;
}

/** `value` held to `[0, max]`, then rounded: every row is a whole number (D3). */
const row = (value: number, maxPoints: number): number =>
  Math.round(Math.min(Math.max(value, 0), maxPoints));

/**
 * Mama's note (GDD › economy, story 1.22): Rire + État du bébé + base − Soupir − Hurlement, each
 * component held to its range and rounded, the sum held to `[0, 100]`. With the refines of
 * `MamaSchema` (the maxima add up to 100, the base is the sigh and scream maxima) the rows always
 * add up to the score. A woken Mama (story 3.2, D3) changes the stars only: she takes off
 * `earlyWakePenaltyStars` of them (never below 0, `lostStars`), the four rows and the points stay
 * those of a timer end. Pure: it reads values and returns one.
 */
export function computeMamaScore(
  tally: ScoreTally,
  mama: Feel['mama'],
  isMamaWoke: boolean,
): MamaScore {
  const laughPoints = row(
    tally.perfects * mama.laughPerPerfectPoints + tally.comboPoints,
    mama.laughMaxPoints,
  );
  const babyStatePoints = row(mama.babyStateFixedPoints, mama.babyStateMaxPoints);
  const sighPoints = row(
    tally.propsOnFloor * mama.sighPerPropOnFloorPoints +
      tally.propsBroken * mama.sighPerBrokenPropPoints +
      tally.mischiefs * mama.sighPerMischiefPoints,
    mama.sighMaxPoints,
  );
  const screamPoints = row(tally.nearMisses * mama.screamPerNearMissPoints, mama.screamMaxPoints);
  const scorePoints = Math.min(
    Math.max(laughPoints + babyStatePoints + mama.baseScorePoints - sighPoints - screamPoints, 0),
    MAMA_SCORE_MAX_POINTS,
  );
  const baseStars = starsForScore(scorePoints, mama.starThresholdPoints);
  const lostStars = isMamaWoke ? Math.min(mama.earlyWakePenaltyStars, baseStars) : 0;
  return {
    laughPoints,
    babyStatePoints,
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
 * `LevelScored` at the same `t`. A helper, not a system (`runScoring` is the combo's carry tick,
 * story 4.2). The combo points cashed in feed the Rire; the ones not cashed are lost. `reason` is why the level ended: a woken Mama costs stars.
 */
export function scoreLevel(world: World, ctx: StepContext, reason: LevelEndReason): void {
  const { perfects, nearMisses, comboPoints } = world.score;
  const { propsOnFloor, propsBroken, mischiefs } = world.mess;
  const score = computeMamaScore(
    { perfects, nearMisses, comboPoints, propsOnFloor, propsBroken, mischiefs },
    ctx.feel.mama,
    reason === 'mamaWoke',
  );
  world.score.final = score;
  ctx.events.push({ type: 'LevelScored', t: world.time.sim, ...score });
}
