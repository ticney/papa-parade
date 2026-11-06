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
// A game with nothing in it: the baby calm the whole time, no chore, no mess.
const PLAYED_MS = 60_000;
const NONE: ScoreTally = {
  perfects: 0,
  successes: 0,
  nearMisses: 0,
  comboPoints: 0,
  calmMs: PLAYED_MS,
  playedMs: PLAYED_MS,
  homePoints: 0,
  propsOnFloor: 0,
  propsBroken: 0,
  mischiefs: 0,
};
const tally = (changes: Partial<ScoreTally>): ScoreTally => ({ ...NONE, ...changes });
const withMama = (changes: Partial<Feel['mama']>): Feel['mama'] => ({ ...mama, ...changes });

/** The rows always add up to the score (D3). */
const rowSum = (score: MamaScore, from: Feel['mama'] = mama): number =>
  score.laughPoints +
  score.calmPoints +
  score.homePoints +
  (from.sighMaxPoints - score.sighPoints) +
  (from.screamMaxPoints - score.screamPoints);

describe('computeMamaScore', () => {
  it('gives a calm game with nothing else in it the full calm row, no chore and the full base', () => {
    const score = computeMamaScore(NONE, mama, 'timer');
    expect(score.laughPoints).toBe(0);
    expect(score.calmPoints).toBe(mama.calmMaxPoints);
    expect(score.homePoints).toBe(0);
    expect(score.sighPoints).toBe(0);
    expect(score.screamPoints).toBe(0);
    expect(score.scorePoints).toBe(mama.calmMaxPoints + mama.baseScorePoints);
    expect(rowSum(score)).toBe(score.scorePoints);
  });

  it('counts half a perfect per success (story 3.12), whole numbers after one rounding', () => {
    const slopes = withMama({ laughPerPerfectPoints: 1, laughPerSuccessPoints: 0.5 });
    expect(computeMamaScore(tally({ successes: 4 }), slopes, 'timer').laughPoints).toBe(2);
    // 2 perfects + 3 successes = 3.5, rounded up once.
    expect(
      computeMamaScore(tally({ perfects: 2, successes: 3 }), slopes, 'timer').laughPoints,
    ).toBe(4);
    expect(computeMamaScore(tally({ successes: 10_000 }), mama, 'timer').laughPoints).toBe(
      mama.laughMaxPoints,
    );
  });

  it('gives the calm row the share of the played time the baby was calm, times its maximum', () => {
    const calm = (calmMs: number, playedMs: number) =>
      computeMamaScore(tally({ calmMs, playedMs }), mama, 'timer').calmPoints;
    expect(calm(0, PLAYED_MS)).toBe(0);
    expect(calm(PLAYED_MS / 2, PLAYED_MS)).toBe(Math.round(mama.calmMaxPoints / 2));
    expect(calm(PLAYED_MS, PLAYED_MS)).toBe(mama.calmMaxPoints);
    // A third of the time, rounded to a whole row.
    expect(calm(20_000, PLAYED_MS)).toBe(Math.round(mama.calmMaxPoints / 3));
    // No time played: nothing disturbed the baby.
    expect(calm(0, 0)).toBe(mama.calmMaxPoints);
    // More calm time than played time (a hand-made tally): held to the maximum.
    expect(calm(2 * PLAYED_MS, PLAYED_MS)).toBe(mama.calmMaxPoints);
  });

  it('holds the home row to its maximum, to the nearest half (a chore is worth 7.5, story 9.4)', () => {
    const home = (homePoints: number) =>
      computeMamaScore(tally({ homePoints }), mama, 'timer').homePoints;
    expect(home(0)).toBe(0);
    expect(home(7)).toBe(7);
    expect(home(7.5)).toBe(7.5);
    expect(home(7.4)).toBe(7.5);
    expect(home(7.2)).toBe(7);
    expect(home(15)).toBe(15);
    expect(home(mama.homeMaxPoints + 0.4)).toBe(mama.homeMaxPoints);
    const half = computeMamaScore(tally({ homePoints: 7.5 }), mama, 'timer');
    expect(rowSum(half)).toBe(half.scorePoints);
    expect(home(mama.homeMaxPoints + 40)).toBe(mama.homeMaxPoints);
    expect(home(-3)).toBe(0);
    const full = computeMamaScore(tally({ homePoints: 999 }), mama, 'timer');
    expect(full.scorePoints).toBe(mama.calmMaxPoints + mama.homeMaxPoints + mama.baseScorePoints);
    expect(rowSum(full)).toBe(full.scorePoints);
  });

  it('counts the laughs per perfect, and holds them to their maximum', () => {
    expect(computeMamaScore(tally({ perfects: 3 }), mama, 'timer').laughPoints).toBe(
      Math.min(mama.laughMaxPoints, 3 * mama.laughPerPerfectPoints),
    );
    const over = Math.ceil(mama.laughMaxPoints / mama.laughPerPerfectPoints) + 5;
    expect(computeMamaScore(tally({ perfects: over }), mama, 'timer').laughPoints).toBe(
      mama.laughMaxPoints,
    );
  });

  it('adds the points of the combos cashed in to the laughs (story 4.2), not rounded before the sum', () => {
    const small = withMama({ laughPerPerfectPoints: 1, laughMaxPoints: 40 });
    expect(
      computeMamaScore(tally({ perfects: 2, comboPoints: 6 }), small, 'timer').laughPoints,
    ).toBe(8);
    // 0.4 + 0.4 + 0.4 cashed in: 1.2, shown as 1 (one rounding, at the end).
    expect(computeMamaScore(tally({ comboPoints: 1.2 }), small, 'timer').laughPoints).toBe(1);
    expect(computeMamaScore(tally({ comboPoints: 28 }), small, 'timer').laughPoints).toBe(28);
  });

  it('holds the laughs to their maximum with the combo points, and the five rows still add up', () => {
    const score = computeMamaScore(
      tally({ perfects: mama.laughMaxPoints, comboPoints: 500 }),
      mama,
      'timer',
    );
    expect(score.laughPoints).toBe(mama.laughMaxPoints);
    expect(rowSum(score)).toBe(score.scorePoints);
    const onlyCombo = computeMamaScore(tally({ comboPoints: 500 }), mama, 'timer');
    expect(onlyCombo.laughPoints).toBe(mama.laughMaxPoints);
    expect(rowSum(onlyCombo)).toBe(onlyCombo.scorePoints);
  });

  it('adds the floor, the broken props and the mischiefs into the sigh, and holds it to its maximum', () => {
    const score = computeMamaScore(tally({ propsOnFloor: 1 }), mama, 'timer');
    expect(score.sighPoints).toBe(
      Math.round(Math.min(mama.sighMaxPoints, mama.sighPerPropOnFloorPoints)),
    );
    // One of each, with weights small enough that the sum stays under the cap.
    const small = withMama({
      sighPerPropOnFloorPoints: 1,
      sighPerBrokenPropPoints: 2,
      sighPerMischiefPoints: 3,
    });
    const mixed = computeMamaScore(
      tally({ propsOnFloor: 1, propsBroken: 1, mischiefs: 1 }),
      small,
      'timer',
    );
    expect(mixed.sighPoints).toBe(6);
    expect(rowSum(mixed, small)).toBe(mixed.scorePoints);
    const capped = computeMamaScore(tally({ propsBroken: 50, mischiefs: 50 }), mama, 'timer');
    expect(capped.sighPoints).toBe(mama.sighMaxPoints);
  });

  it('counts the screams per near miss, and holds them to their maximum', () => {
    expect(computeMamaScore(tally({ nearMisses: 1 }), mama, 'timer').screamPoints).toBe(
      Math.round(Math.min(mama.screamMaxPoints, mama.screamPerNearMissPoints)),
    );
    expect(computeMamaScore(tally({ nearMisses: 1000 }), mama, 'timer').screamPoints).toBe(
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
      'timer',
    );
    expect(score.laughPoints).toBe(2); // 2.1
    expect(score.sighPoints).toBe(1); // 1.25
    expect(score.screamPoints).toBe(3); // 2.6
    for (const value of Object.values(score)) expect(Number.isInteger(value)).toBe(true);
    expect(rowSum(score, fractional)).toBe(score.scorePoints);
  });

  it('adds up over a grid of tallies, clamped and not (AC 4), with whole rows', () => {
    let count = 0;
    for (const perfects of [0, 3, 12, 80]) {
      for (const successes of [0, 7, 15, 90]) {
        for (const propsOnFloor of [0, 1, 3, 9]) {
          for (const nearMisses of [0, 2, 5, 40]) {
            for (const calmMs of [0, 22_000, PLAYED_MS]) {
              for (const homePoints of [0, 6, 99]) {
                const score = computeMamaScore(
                  tally({ perfects, successes, propsOnFloor, nearMisses, calmMs, homePoints }),
                  mama,
                  'timer',
                );
                expect(rowSum(score)).toBe(score.scorePoints);
                for (const value of Object.values(score))
                  expect(Number.isInteger(value)).toBe(true);
                expect(score.laughPoints).toBeLessThanOrEqual(mama.laughMaxPoints);
                expect(score.calmPoints).toBeLessThanOrEqual(mama.calmMaxPoints);
                expect(score.homePoints).toBeLessThanOrEqual(mama.homeMaxPoints);
                expect(score.sighPoints).toBeLessThanOrEqual(mama.sighMaxPoints);
                expect(score.screamPoints).toBeLessThanOrEqual(mama.screamMaxPoints);
                count += 1;
              }
            }
          }
        }
      }
    }
    expect(count).toBe(4 * 4 * 4 * 4 * 3 * 3);
  });

  it('rounds half a point up, one row at a time: the score is the sum of rounded rows', () => {
    // 3 props on the floor = 7.5 -> 8 and 5 near misses = 7.5 -> 8 with these slopes.
    const slopes = withMama({ sighPerPropOnFloorPoints: 2.5, screamPerNearMissPoints: 1.5 });
    const score = computeMamaScore(tally({ propsOnFloor: 3, nearMisses: 5 }), slopes, 'timer');
    expect(score.sighPoints).toBe(8);
    expect(score.screamPoints).toBe(8);
    expect(score.scorePoints).toBe(slopes.calmMaxPoints + slopes.baseScorePoints - 8 - 8);
  });

  it('holds the score to 0 and 100, with the refines bypassed by a hand-made feel', () => {
    const generous = withMama({ baseScorePoints: 500 });
    expect(computeMamaScore(NONE, generous, 'timer').scorePoints).toBe(MAMA_SCORE_MAX_POINTS);
    const harsh = withMama({ baseScorePoints: 0 });
    expect(
      computeMamaScore(tally({ calmMs: 0, nearMisses: 100, propsBroken: 100 }), harsh, 'timer')
        .scorePoints,
    ).toBe(0);
  });

  it('gives the stars of the score, from the feel’s thresholds', () => {
    const top = computeMamaScore(tally({ perfects: 10_000 }), mama, 'timer');
    expect(top.scorePoints).toBe(mama.laughMaxPoints + mama.calmMaxPoints + mama.baseScorePoints);
    expect(top.stars).toBe(
      mama.starThresholdPoints.filter((points) => points <= top.scorePoints).length,
    );
    const none = computeMamaScore(
      NONE,
      withMama({ starThresholdPoints: [99, 99.5, 99.7, 99.8, 99.9] }),
      'timer',
    );
    expect(none.stars).toBe(0);
  });
});

describe('computeMamaScore: Mama come home early (story 3.16)', () => {
  const rich = withMama({ earlyWakePenaltyStars: 1 });

  it('gives 0 stars and no lost star whatever the score, and keeps every row and point', () => {
    const timer = computeMamaScore(NONE, rich, 'timer');
    expect(timer.stars).toBeGreaterThanOrEqual(1);
    const home = computeMamaScore(NONE, rich, 'mamaHome');
    expect(home.stars).toBe(0);
    expect(home.lostStars).toBe(0);
    const { stars: _timerStars, lostStars: _timerLost, ...timerPoints } = timer;
    const { stars: _homeStars, lostStars: _homeLost, ...homePoints } = home;
    expect(homePoints).toEqual(timerPoints);
    expect(rowSum(home, rich)).toBe(home.scorePoints);
  });

  it('is not the woken Mama: she takes no star off a score that earns none, and a score of 100 earns none either', () => {
    const top = withMama({ starThresholdPoints: [1, 2, 3, 4, 5] });
    expect(computeMamaScore(NONE, top, 'timer').stars).toBe(5);
    expect(computeMamaScore(NONE, top, 'mamaWoke').lostStars).toBe(1);
    const home = computeMamaScore(NONE, top, 'mamaHome');
    expect({ stars: home.stars, lostStars: home.lostStars }).toEqual({ stars: 0, lostStars: 0 });
  });
});

describe('computeMamaScore: a woken Mama (story 3.2)', () => {
  /** A game that earns stars, then one that earns none (a feel whose thresholds the score never reaches). */
  const rich = withMama({ earlyWakePenaltyStars: 1 });
  const baseStars = computeMamaScore(NONE, rich, 'timer').stars;

  it('has no lost star for a timer end', () => {
    expect(computeMamaScore(NONE, rich, 'timer').lostStars).toBe(0);
  });

  it('takes earlyWakePenaltyStars off the stars when she wakes, and keeps every point', () => {
    expect(baseStars).toBeGreaterThanOrEqual(1);
    const timer = computeMamaScore(NONE, rich, 'timer');
    const woken = computeMamaScore(NONE, rich, 'mamaWoke');
    expect(woken.lostStars).toBe(1);
    expect(woken.stars).toBe(baseStars - 1);
    const { stars: _timerStars, lostStars: _timerLost, ...timerPoints } = timer;
    const { stars: _wokenStars, lostStars: _wokenLost, ...wokenPoints } = woken;
    expect(wokenPoints).toEqual(timerPoints);
    expect(rowSum(woken, rich)).toBe(woken.scorePoints);
  });

  it('never goes below 0 stars: no base star means nothing to lose', () => {
    const none = withMama({ starThresholdPoints: [99, 99.5, 99.7, 99.8, 99.9] });
    const woken = computeMamaScore(NONE, none, 'mamaWoke');
    expect(woken.stars).toBe(0);
    expect(woken.lostStars).toBe(0);
  });

  it('a penalty of 2 with 1 base star loses 1 and leaves 0', () => {
    const oneStar = withMama({
      earlyWakePenaltyStars: 2,
      starThresholdPoints: [
        mama.calmMaxPoints + mama.baseScorePoints,
        mama.calmMaxPoints + mama.baseScorePoints + 1,
        mama.calmMaxPoints + mama.baseScorePoints + 2,
        mama.calmMaxPoints + mama.baseScorePoints + 3,
        mama.calmMaxPoints + mama.baseScorePoints + 4,
      ],
    });
    expect(computeMamaScore(NONE, oneStar, 'timer').stars).toBe(1);
    const woken = computeMamaScore(NONE, oneStar, 'mamaWoke');
    expect(woken.lostStars).toBe(1);
    expect(woken.stars).toBe(0);
  });

  it('a penalty of 0 loses nothing even when she wakes', () => {
    const woken = computeMamaScore(NONE, withMama({ earlyWakePenaltyStars: 0 }), 'mamaWoke');
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
    world.score.successes = 6;
    world.score.calmMs = 800;
    world.score.nearMisses = 1;
    world.mess.propsOnFloor = 1;
    world.mess.mischiefs = 2;
    const events: SimEvent[] = [];
    const ctx = { events, feel: createTestContent().feel } as unknown as StepContext;

    scoreLevel(world, ctx, 'timer');

    const expected = computeMamaScore(
      {
        perfects: 4,
        successes: 6,
        nearMisses: 1,
        comboPoints: 0,
        calmMs: 800,
        playedMs: 1230,
        homePoints: 0,
        propsOnFloor: 1,
        propsBroken: 0,
        mischiefs: 2,
      },
      mama,
      'timer',
    );
    expect(world.score.final).toEqual(expected);
    expect(events).toEqual([{ type: 'LevelScored', t: 1230, ...expected }]);
    expect(expected.lostStars).toBe(0);
    // The counters are read, never reset.
    expect(world.score.perfects).toBe(4);
    expect(world.score.successes).toBe(6);
    expect(world.score.calmMs).toBe(800);
    expect(world.score.nearMisses).toBe(1);
  });

  it('pays the Maison row with the chores that are done, an unfinished one nothing (story 9.4)', () => {
    const feel = createTestContent().feel;
    const world = createWorld({
      seed: 1,
      feel,
      papaSpawn: { xM: 0, zM: 0 },
      babySpawn: { xM: 1, zM: 1 },
      firstWanderAt: asSimMs(0),
    });
    world.time.sim = asSimMs(500);
    world.score.calmMs = 500;
    const instance = (state: 'done' | 'paused' | 'working' | 'untouched') => ({
      state,
      enteredAt: asSimMs(0),
      beatsDone: 0,
      beatState: 'none' as const,
      beatTelegraphAt: asSimMs(0),
      beatWindowOpenAt: asSimMs(0),
      responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
    });
    const planned = (homePoints: number) => ({ def: { homePoints } });
    const run = (states: ('done' | 'paused' | 'working' | 'untouched')[], points: number[]) => {
      world.chores = states.map(instance);
      const events: SimEvent[] = [];
      const ctx = {
        events,
        feel,
        level: { chores: points.map(planned) },
      } as unknown as StepContext;
      scoreLevel(world, ctx, 'timer');
      return world.score.final?.homePoints;
    };
    expect(run(['done'], [7.5])).toBe(7.5);
    expect(run(['paused'], [7.5])).toBe(0);
    expect(run(['working'], [7.5])).toBe(0);
    expect(run(['untouched', 'done'], [7.5, 5])).toBe(5);
    expect(run(['done', 'done'], [7.5, 7.5])).toBe(15);
    // Held to the row's maximum: the sum may not be worth more.
    expect(run(['done', 'done'], [10, 10])).toBe(mama.homeMaxPoints);
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
    // Nothing happened for 500 ms and the baby was calm the whole time.
    world.score.calmMs = 500;
    const events: SimEvent[] = [];
    const ctx = { events, feel: createTestContent().feel } as unknown as StepContext;

    scoreLevel(world, ctx, 'mamaWoke');

    const expected = computeMamaScore(tally({ calmMs: 500, playedMs: 500 }), mama, 'mamaWoke');
    expect(expected.lostStars).toBeGreaterThanOrEqual(1);
    expect(world.score.final).toEqual(expected);
    expect(events).toEqual([{ type: 'LevelScored', t: 500, ...expected }]);
  });
});

describe('the Geo tally of the 2026-11-03 playtest (story 3.12, D7)', () => {
  // Geo kept no journal of that playtest: this tally is how the change proposal describes his games.
  // No perfect, 20 successes, the sigh and the scream saturated (3 props on the floor, 5 near
  // misses), the baby calm half of the time. The note of story 1.22 gave every such game 20.
  const geo = tally({
    perfects: 0,
    successes: 20,
    propsOnFloor: 3,
    nearMisses: 5,
    calmMs: PLAYED_MS / 2,
  });

  it('is 34 points and 1 star with the five-row note, row by row', () => {
    const score = computeMamaScore(geo, mama, 'timer');
    expect(score).toEqual({
      laughPoints: 10,
      calmPoints: 10,
      homePoints: 0,
      sighPoints: 8, // 7.5, rounded up
      screamPoints: 8, // 7.5, rounded up
      scorePoints: 34,
      stars: 1,
      lostStars: 0,
    });
  });

  it('was 20 points with the four-row note of story 1.22 (its values, written out)', () => {
    // laughMax 40 (no perfect: 0), baby state fixed at 20, base 30, sigh 5 per prop to 15, scream 3
    // per near miss to 15.
    const sigh = Math.min(geo.propsOnFloor * 5, 15);
    const scream = Math.min(geo.nearMisses * 3, 15);
    expect(0 + 20 + 30 - sigh - scream).toBe(20);
  });
});
