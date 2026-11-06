import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';

// The house chores on the LIVE `salon_kitchen` (story 9.4, AC 12): the data Geo tunes (`cooking.json`,
// `salon_kitchen.json`, `bots.json`) and the wiring of `BotSetup.choreObjectIds` in `runSim` are played
// end to end, which the frozen test level cannot prove.

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
// Today's mean score of `perfect` on this level without the chores (story 9.4 AC 12).
const SCORE_WITHOUT_CHORES = 79.7;

async function reportOf(botId: 'perfect' | 'human', runs: number) {
  const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
  if (!loaded.ok) throw new Error(loaded.error);
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
  });

  it('has human play the chores too: the stations are wired to its setup', async () => {
    const report = await reportOf('human', 10);
    const beats = report.chores.beats;
    expect(beats.perfect + beats.success + beats.fail).toBeGreaterThan(0);
    expect(report.chores.runsCompleted).toBeGreaterThan(0);
  });
});
