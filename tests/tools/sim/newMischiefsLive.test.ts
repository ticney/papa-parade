import { fileURLToPath } from 'node:url';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';

// The five new mischiefs of the big salon on the LIVE `salon_kitchen` (story 9.7, AC 3 and AC 10): the data
// Geo tunes (the five threat files, `feedback.json`, `salon_kitchen.json`, `bots.json`) played end to end,
// which the frozen test room cannot prove. The shape of `choresLive.test.ts`.

const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));

/** The five, the gag each ends in and the anchor each stands at (the noise of a crash is read from the def). */
const NEW_DEFS = [
  { id: 'tablecloth_pull', gag: 'dishes_on_floor', anchor: 'dining_table' },
  { id: 'low_cabinet_open', gag: 'pan_concert', anchor: 'low_cabinet' },
  { id: 'bin_rummage', gag: 'peelings_everywhere', anchor: 'bin' },
  { id: 'plant_dig', gag: 'soil_on_rug', anchor: 'plant' },
  { id: 'papa_mug_low', gag: 'coffee_spilled', anchor: 'papa_mug' },
] as const;

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

describe('the new mischiefs on the live salon_kitchen: the bots', () => {
  it('has perfect meet and answer each of the five in 30 games, fail no threat, and never wake or call Mama', async () => {
    const report = await reportOf('perfect', 30);
    for (const { id } of NEW_DEFS) {
      const tally = report.threats[id];
      expect(tally?.responses, id).toBeGreaterThan(0);
      expect(tally?.fail, id).toBe(0);
    }
    // 0 threat failed over all defs, the micro-sleep included (it keeps out of a held Firmness).
    for (const [defId, tally] of Object.entries(report.threats)) {
      expect(tally.fail, defId).toBe(0);
    }
    expect(report.gags.total).toBe(0);
    expect(report.endsByReason.mamaWoke).toBe(0);
    expect(report.endsByReason.mamaHome).toBe(0);
  });

  it('has human meet each of the five and miss some of them, sometimes (« les rate parfois »)', async () => {
    const report = await reportOf('human', 30);
    let fails = 0;
    for (const { id } of NEW_DEFS) {
      const tally = report.threats[id];
      expect(tally?.responses, id).toBeGreaterThan(0);
      fails += tally?.fail ?? 0;
    }
    expect(fails).toBeGreaterThan(0);
  });
});

describe('the new mischiefs on the live salon_kitchen: left alone, each ends in its own gag', () => {
  /** A live game with one of the five forced at once and nobody to answer it: its events up to the end of its gag. */
  async function forgotten(defId: string) {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
    if (!loaded.ok) throw new Error(loaded.error);
    const { content, geometry, level } = loaded.value;
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    const threat = sim.world.threats.find((candidate) => candidate.defId === defId);
    if (threat === undefined) throw new Error(`the level plans no ${defId}`);
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(0), threatId: threat.id });
    const events: SimEvent[] = [];
    // The director's first gap is 4 s: the forced threat is over well before another comes.
    while (sim.world.time.sim < 3500) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
    return { sim, content, level, threat, events };
  }

  it.each(NEW_DEFS)(
    '$id: $gag, one mischief, the mess at $anchor, +mess catastrophe',
    async ({ id, gag, anchor }) => {
      const { sim, content, threat, events } = await forgotten(id);
      const gags = events.filter((event) => event.type === 'GagTriggered');
      expect(gags).toEqual([expect.objectContaining({ threatId: threat.id, gag, reason: 'late' })]);
      expect(sim.world.mess.mischiefs).toBe(1);
      // The mess lies at the threat's own point, which is its anchor's.
      expect(sim.world.afterEffects.mischiefMarks).toEqual([{ gag, xM: threat.xM, zM: threat.zM }]);
      expect(threat.anchorId).toBe(anchor);
      const rises = events.filter(
        (event) => event.type === 'CatastropheChanged' && event.source === 'mess',
      );
      expect(rises).toHaveLength(1);
      expect(rises[0]).toMatchObject({ deltaPct: content.feel.catastrophe.risePct.mess });
    },
  );

  it('makes the noise of its def (gagNoisePct) when it is a crash, and none when it is not', async () => {
    for (const { id } of NEW_DEFS) {
      const { level, events } = await forgotten(id);
      const def = level.threats[id];
      const noise = events.filter(
        (event) => event.type === 'NoiseChanged' && event.source === 'gag',
      );
      if (def?.gagNoisePct === undefined) {
        expect(noise, id).toEqual([]);
      } else {
        expect(noise, id).toHaveLength(1);
        expect(noise[0], id).toMatchObject({ deltaPct: def.gagNoisePct });
      }
    }
    // The two crashes are the ones that have a noise, read from the content: the tablecloth and the cabinet.
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_kitchen');
    if (!loaded.ok) throw new Error(loaded.error);
    const noisy = NEW_DEFS.filter(
      ({ id }) => loaded.value.level.threats[id]?.gagNoisePct !== undefined,
    );
    expect(noisy.map(({ id }) => id)).toEqual(['tablecloth_pull', 'low_cabinet_open']);
  });
});
