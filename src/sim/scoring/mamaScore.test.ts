import type { Feel } from '@content/schemas/feel';
import { MAMA_SCORE_MAX_POINTS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import type { SimEvent } from '../events.ts';
import { createWorld, type MamaScore } from '../world.ts';
import { computeMamaScore, type ScoreTally, scoreLevel } from './mamaScore.ts';

// Every bound is read from the test feel (`tests/support/testFeel.json`), never typed here; the
// weights the tests set themselves are said where they are set.
const mama = createTestContent().feel.mama;
const NONE: ScoreTally = {
  perfects: 0,
  nearMisses: 0,
  propsOnFloor: 0,
  propsBroken: 0,
  mischiefs: 0,
};
const tally = (changes: Partial<ScoreTally>): ScoreTally => ({ ...NONE, ...changes });
const withMama = (changes: Partial<Feel['mama']>): Feel['mama'] => ({ ...mama, ...changes });

/** The rows always add up to the score (D3). */
const rowSum = (score: MamaScore, from: Feel['mama'] = mama): number =>
  score.laughPoints +
  score.babyStatePoints +
  (from.sighMaxPoints - score.sighPoints) +
  (from.screamMaxPoints - score.screamPoints);

describe('computeMamaScore', () => {
  it('gives a game with nothing in it the fixed baby state and the full base', () => {
    const score = computeMamaScore(NONE, mama, false);
    expect(score.laughPoints).toBe(0);
    expect(score.babyStatePoints).toBe(mama.babyStateFixedPoints);
    expect(score.sighPoints).toBe(0);
    expect(score.screamPoints).toBe(0);
    expect(score.scorePoints).toBe(mama.babyStateFixedPoints + mama.baseScorePoints);
    expect(rowSum(score)).toBe(score.scorePoints);
  });

  it('counts the laughs per perfect, and holds them to their maximum', () => {
    expect(computeMamaScore(tally({ perfects: 3 }), mama, false).laughPoints).toBe(
      Math.min(mama.laughMaxPoints, 3 * mama.laughPerPerfectPoints),
    );
    const over = Math.ceil(mama.laughMaxPoints / mama.laughPerPerfectPoints) + 5;
    expect(computeMamaScore(tally({ perfects: over }), mama, false).laughPoints).toBe(
      mama.laughMaxPoints,
    );
  });

  it('adds the floor, the broken props and the mischiefs into the sigh, and holds it to its maximum', () => {
    const score = computeMamaScore(tally({ propsOnFloor: 1 }), mama, false);
    expect(score.sighPoints).toBe(Math.min(mama.sighMaxPoints, mama.sighPerPropOnFloorPoints));
    // One of each, with weights small enough that the sum stays under the cap.
    const small = withMama({
      sighPerPropOnFloorPoints: 1,
      sighPerBrokenPropPoints: 2,
      sighPerMischiefPoints: 3,
    });
    const mixed = computeMamaScore(
      tally({ propsOnFloor: 1, propsBroken: 1, mischiefs: 1 }),
      small,
      false,
    );
    expect(mixed.sighPoints).toBe(6);
    expect(rowSum(mixed, small)).toBe(mixed.scorePoints);
    const capped = computeMamaScore(tally({ propsBroken: 50, mischiefs: 50 }), mama, false);
    expect(capped.sighPoints).toBe(mama.sighMaxPoints);
  });

  it('counts the screams per near miss, and holds them to their maximum', () => {
    expect(computeMamaScore(tally({ nearMisses: 1 }), mama, false).screamPoints).toBe(
      Math.min(mama.screamMaxPoints, mama.screamPerNearMissPoints),
    );
    expect(computeMamaScore(tally({ nearMisses: 1000 }), mama, false).screamPoints).toBe(
      mama.screamMaxPoints,
    );
  });

  it('rounds fractional weights to whole rows, and the rows still add up', () => {
    const fractional = withMama({
      laughPerPerfectPoints: 0.7,
      sighPerPropOnFloorPoints: 1.25,
      screamPerNearMissPoints: 2.6,
    });
    const score = computeMamaScore(
      tally({ perfects: 3, propsOnFloor: 1, nearMisses: 1 }),
      fractional,
      false,
    );
    expect(score.laughPoints).toBe(2); // 2.1
    expect(score.sighPoints).toBe(1); // 1.25
    expect(score.screamPoints).toBe(3); // 2.6
    for (const value of Object.values(score)) expect(Number.isInteger(value)).toBe(true);
    expect(rowSum(score, fractional)).toBe(score.scorePoints);
  });

  it('holds a fixed baby state to its maximum (the schema refuses more; the sim does not trust it)', () => {
    const score = computeMamaScore(NONE, withMama({ babyStateFixedPoints: 999 }), false);
    expect(score.babyStatePoints).toBe(mama.babyStateMaxPoints);
  });

  it('holds the score to 0 and 100, with the refines bypassed by a hand-made feel', () => {
    const generous = withMama({ baseScorePoints: 500 });
    expect(computeMamaScore(NONE, generous, false).scorePoints).toBe(MAMA_SCORE_MAX_POINTS);
    const harsh = withMama({ baseScorePoints: 0, babyStateFixedPoints: 0 });
    expect(
      computeMamaScore(tally({ nearMisses: 100, propsBroken: 100 }), harsh, false).scorePoints,
    ).toBe(0);
  });

  it('gives the stars of the score, from the feel’s thresholds', () => {
    const top = computeMamaScore(tally({ perfects: 10_000 }), mama, false);
    expect(top.scorePoints).toBe(
      mama.laughMaxPoints + mama.babyStateFixedPoints + mama.baseScorePoints,
    );
    expect(top.stars).toBe(
      mama.starThresholdPoints.filter((points) => points <= top.scorePoints).length,
    );
    const none = computeMamaScore(
      NONE,
      withMama({ starThresholdPoints: [99, 99.5, 99.7, 99.8, 99.9] }),
      false,
    );
    expect(none.stars).toBe(0);
  });
});

describe('computeMamaScore: a woken Mama (story 3.2)', () => {
  /** A game that earns stars, then one that earns none (a feel whose thresholds the score never reaches). */
  const rich = withMama({ earlyWakePenaltyStars: 1 });
  const baseStars = computeMamaScore(NONE, rich, false).stars;

  it('has no lost star for a timer end', () => {
    expect(computeMamaScore(NONE, rich, false).lostStars).toBe(0);
  });

  it('takes earlyWakePenaltyStars off the stars when she wakes, and keeps every point', () => {
    expect(baseStars).toBeGreaterThanOrEqual(1);
    const timer = computeMamaScore(NONE, rich, false);
    const woken = computeMamaScore(NONE, rich, true);
    expect(woken.lostStars).toBe(1);
    expect(woken.stars).toBe(baseStars - 1);
    const { stars: _timerStars, lostStars: _timerLost, ...timerPoints } = timer;
    const { stars: _wokenStars, lostStars: _wokenLost, ...wokenPoints } = woken;
    expect(wokenPoints).toEqual(timerPoints);
    expect(rowSum(woken, rich)).toBe(woken.scorePoints);
  });

  it('never goes below 0 stars: no base star means nothing to lose', () => {
    const none = withMama({ starThresholdPoints: [99, 99.5, 99.7, 99.8, 99.9] });
    const woken = computeMamaScore(NONE, none, true);
    expect(woken.stars).toBe(0);
    expect(woken.lostStars).toBe(0);
  });

  it('a penalty of 2 with 1 base star loses 1 and leaves 0', () => {
    const oneStar = withMama({
      earlyWakePenaltyStars: 2,
      starThresholdPoints: [
        mama.babyStateFixedPoints + mama.baseScorePoints,
        mama.babyStateFixedPoints + mama.baseScorePoints + 1,
        mama.babyStateFixedPoints + mama.baseScorePoints + 2,
        mama.babyStateFixedPoints + mama.baseScorePoints + 3,
        mama.babyStateFixedPoints + mama.baseScorePoints + 4,
      ],
    });
    expect(computeMamaScore(NONE, oneStar, false).stars).toBe(1);
    const woken = computeMamaScore(NONE, oneStar, true);
    expect(woken.lostStars).toBe(1);
    expect(woken.stars).toBe(0);
  });

  it('a penalty of 0 loses nothing even when she wakes', () => {
    const woken = computeMamaScore(NONE, withMama({ earlyWakePenaltyStars: 0 }), true);
    expect(woken.lostStars).toBe(0);
    expect(woken.stars).toBe(baseStars);
  });
});

describe('scoreLevel', () => {
  it('writes world.score.final and pushes one LevelScored with the same fields, at the world’s t', () => {
    const world = createWorld({
      seed: 1,
      feel: createTestContent().feel,
      papaSpawn: { xM: 0, zM: 0 },
      babySpawn: { xM: 1, zM: 1 },
      firstWanderAt: asSimMs(0),
    });
    world.time.sim = asSimMs(1230);
    world.score.perfects = 4;
    world.score.nearMisses = 1;
    world.mess.propsOnFloor = 1;
    world.mess.mischiefs = 2;
    const events: SimEvent[] = [];
    const ctx = { events, feel: createTestContent().feel } as unknown as StepContext;

    scoreLevel(world, ctx, 'timer');

    const expected = computeMamaScore(
      { perfects: 4, nearMisses: 1, propsOnFloor: 1, propsBroken: 0, mischiefs: 2 },
      mama,
      false,
    );
    expect(world.score.final).toEqual(expected);
    expect(events).toEqual([{ type: 'LevelScored', t: 1230, ...expected }]);
    expect(expected.lostStars).toBe(0);
    // The counters are read, never reset.
    expect(world.score.perfects).toBe(4);
    expect(world.score.nearMisses).toBe(1);
  });

  it('passes the reason: mamaWoke takes the penalty off the stars, in the world and in the event', () => {
    const world = createWorld({
      seed: 1,
      feel: createTestContent().feel,
      papaSpawn: { xM: 0, zM: 0 },
      babySpawn: { xM: 1, zM: 1 },
      firstWanderAt: asSimMs(0),
    });
    world.time.sim = asSimMs(500);
    const events: SimEvent[] = [];
    const ctx = { events, feel: createTestContent().feel } as unknown as StepContext;

    scoreLevel(world, ctx, 'mamaWoke');

    const expected = computeMamaScore(NONE, mama, true);
    expect(expected.lostStars).toBeGreaterThanOrEqual(1);
    expect(world.score.final).toEqual(expected);
    expect(events).toEqual([{ type: 'LevelScored', t: 500, ...expected }]);
  });
});
