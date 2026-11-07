import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';

// The house chores on the LIVE `salon_kitchen` (story 9.4, AC 12): the data Geo tunes (`cooking.json`,
// `salon_kitchen.json`, `bots.json`) and the wiring of `BotSetup.choreObjectIds` in `runSim` are played
// end to end, which the frozen test level cannot prove.

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
// The mean score of `perfect` on this level without the chores (30 seeds, 2026-11-07: story 9.8 retuned the waves, it was 79.7).
const SCORE_WITHOUT_CHORES = 77.9;
// ... and with the cooking alone (30 seeds, 2026-11-07, was 87.2): the dishwasher must beat it (story 9.6 AC 12).
const SCORE_WITH_COOKING_ONLY = 85.4;

async function reportOf(botId: 'perfect' | 'human', runs: number, abandonedAfterMs?: number) {
  const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
  if (!loaded.ok) throw new Error(loaded.error);
  if (abandonedAfterMs !== undefined) {
    // The live cooking, its pot due after a short wait (story 9.5): a bot that leaves the stove for a threat
    // leaves the cooking `paused`, so the pot comes within a game.
    const cooking = loaded.value.level.chores?.[0];
    if (cooking?.abandonedThreat === undefined) throw new Error('the live cooking names no pot');
    cooking.abandonedThreat.afterMs = abandonedAfterMs;
  }
  const result = await runSim(
    simArgs({ levelId: 'salon_kitchen', botId, runs, untilSimMs: null }),
    loaded.value,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('the chores of the live salon_kitchen', () => {
  it('has perfect finish the cooking in every one of 30 games, fail no threat and beat the score without chores', async () => {
    const report = await reportOf('perfect', 30);
    expect(report.chores.runsCompleted).toBe(30);
    expect(report.chores.beats.fail).toBe(0);
    expect(report.chores.meanHomePoints).toBeGreaterThan(0);
    // Fails no threat: no gag, so Mama never wakes and never comes home early.
    expect(report.gags.total).toBe(0);
    expect(report.endsByReason.mamaWoke).toBe(0);
    expect(report.endsByReason.mamaHome).toBe(0);
    expect(report.meanScore).toBeGreaterThan(SCORE_WITHOUT_CHORES);
    // Story 9.5: a perfect player never lets the cooking sit, and a pot it met would have been lowered.
    expect(report.chores.abandoned.boiledOver).toBe(0);
  });

  it('has perfect empty the dishwasher too, in every one of 30 games: both chores, the whole Maison row, no door left to the baby (story 9.6)', async () => {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
    if (!loaded.ok) throw new Error(loaded.error);
    const report = await reportOf('perfect', 30);
    const { byDef, open } = report.chores;
    expect(byDef.cooking?.runsCompleted).toBe(30);
    expect(byDef.unload_dishwasher?.runsCompleted).toBe(30);
    // The two chores fill the row: 15 of 15 when both are done, read from the content.
    const homeMax = loaded.value.content.feel.mama.homeMaxPoints;
    expect(report.chores.meanHomePoints).toBe(homeMax);
    // 0 threat failed, the pots and the open dishwasher included: none of the level's threats has a failure.
    for (const [defId, tally] of Object.entries(report.threats)) {
      expect(tally.fail, defId).toBe(0);
    }
    expect(report.gags.total).toBe(0);
    expect(report.endsByReason.mamaWoke).toBe(0);
    expect(report.endsByReason.mamaHome).toBe(0);
    expect(report.chores.meanObjectsBroken).toBe(0);
    expect(byDef.unload_dishwasher?.meanBeatsMissed).toBe(0);
    // It shuts every open door it meets. Story 9.8: the first wave is calm enough for it to finish both chores
    // before the baby has a door to choose (0 telegraphed in the 200 games of `sim:balance`), so none is asked.
    expect(open.closed).toBe(open.telegraphed);
    expect(open.gagged).toBe(0);
    expect(report.meanScore).toBeGreaterThan(SCORE_WITH_COOKING_ONLY);
  });

  it('has human play both chores too: some plates broken, the open door met (the stations are wired to its setup)', async () => {
    // 200 games, not 30 (story 9.8): the calmer first wave leaves a clumsy read of the ring five times in 200 games.
    const report = await reportOf('human', 200);
    const { byDef, open } = report.chores;
    const beats = report.chores.beats;
    expect(beats.perfect + beats.success + beats.fail).toBeGreaterThan(0);
    expect(byDef.cooking?.runsCompleted).toBeGreaterThan(0);
    expect(byDef.unload_dishwasher?.runsCompleted).toBeGreaterThan(0);
    // A clumsy read of the ring drops a plate in some games (seeded, so always the same ones)…
    expect(byDef.unload_dishwasher?.beats.fail).toBeGreaterThan(0);
    expect(report.chores.meanObjectsBroken).toBeGreaterThan(0);
    // … and the door is open to the baby while he is away, and he gets into the dishwasher at least once in the
    // 200 games (story 9.6's deferred item: the live gag; `sim:balance` asks for it too).
    expect(open.telegraphed).toBeGreaterThan(0);
    expect(open.closed + open.gagged).toBeLessThanOrEqual(open.telegraphed);
    expect(open.gagged).toBeGreaterThan(0);
  }, 120_000);

  it('counts the pots of an abandoned cooking end to end: telegraphed, lowered or boiled over (story 9.5)', async () => {
    // The wait cut to 1 s so that the 10 games of `human` leave the stove long enough for a pot to come.
    const report = await reportOf('human', 10, 1000);
    const { abandoned } = report.chores;
    expect(abandoned.telegraphed).toBeGreaterThan(0);
    // Every pot ends lowered or boiled over, but the game may end on one still under way or cancelled.
    expect(abandoned.resolved + abandoned.boiledOver).toBeLessThanOrEqual(abandoned.telegraphed);
    expect(abandoned.resolved + abandoned.boiledOver).toBeGreaterThan(0);
    // `human` both lowers some pots and lets some boil over (seeded, so always the same runs).
    expect(abandoned.resolved).toBeGreaterThan(0);
    expect(abandoned.boiledOver).toBeGreaterThan(0);
    // The boil-overs are the gags of the pot: the report's own gag count says the same.
    expect(report.gags.byGag.pot_boiled_over ?? 0).toBe(abandoned.boiledOver);
  });

  it('has perfect lower every pot an abandoned cooking makes: no boil-over', async () => {
    const report = await reportOf('perfect', 10, 1000);
    const { abandoned } = report.chores;
    // It meets pots (the wait cut to 1 s), and lowers them all.
    expect(abandoned.telegraphed).toBeGreaterThan(0);
    expect(abandoned.resolved).toBeGreaterThan(0);
    expect(abandoned.boiledOver).toBe(0);
    expect(report.gags.total).toBe(0);
  });
});
