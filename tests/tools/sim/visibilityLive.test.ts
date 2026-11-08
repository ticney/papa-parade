import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';

// What the `human` bot sees of the LIVE `salon_kitchen` (story 9.8, AC 10): the follow frame rebuilt from
// Papa's position, the off-screen bubbles, and the cost of reading one. The data Geo tunes (`bots.json ›
// human.view`, `feel.camera`, the level) played end to end, which the frozen test level (a fixed camera)
// cannot prove. The shape of `choresLive.test.ts`.

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
const RUNS = 30;

async function reportOf(botId: 'perfect' | 'human' | 'idle', bubbleReadMs?: number) {
  const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
  if (!loaded.ok) throw new Error(loaded.error);
  // The loaded bundle is this test's own: a screen that reads a bubble slower is a what-if, not a file edit.
  if (bubbleReadMs !== undefined) loaded.value.content.bots.human.view.bubbleReadMs = bubbleReadMs;
  const result = await runSim(
    simArgs({ levelId: 'salon_kitchen', botId, runs: RUNS, untilSimMs: null }),
    loaded.value,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('the sight of the human bot on the live salon_kitchen', () => {
  it('counts what it sees: threats telegraphed, some first seen through a bubble, none lost to the cap', async () => {
    const report = await reportOf('human');
    expect(report.visibility).not.toBeNull();
    const visibility = report.visibility;
    if (visibility === null) return;
    expect(visibility.telegraphs).toBeGreaterThan(0);
    // The kitchen threats telegraph while Papa is at the sofa end: they are seen through their bubble.
    expect(visibility.seenOffscreen).toBeGreaterThan(0);
    expect(visibility.seenOffscreen).toBeLessThan(visibility.telegraphs);
    expect(visibility.meanSeenDelayMs).not.toBeNull();
    expect(visibility.neverSeen).toBeLessThanOrEqual(visibility.telegraphs);
  });

  it('has the other bots ignore the view: no visibility block', async () => {
    expect((await reportOf('perfect')).visibility).toBeNull();
    expect((await reportOf('idle')).visibility).toBeNull();
  });

  it('answers a threat from the moment it saw it: a bubble that takes longer to read costs answers', async () => {
    const quick = await reportOf('human', 0);
    // A bubble read after the window has closed: every off-screen threat is lost, whatever the bot would do.
    const slow = await reportOf('human', 5000);
    const fails = (report: typeof quick): number =>
      Object.values(report.threats).reduce((sum, tally) => sum + tally.fail, 0);
    expect(fails(slow)).toBeGreaterThan(fails(quick));
    expect(slow.endsByReason.mamaHome).toBeGreaterThanOrEqual(quick.endsByReason.mamaHome);
  });
});
