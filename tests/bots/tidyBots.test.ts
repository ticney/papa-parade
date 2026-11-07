import type { BotId } from '@bots/bot';
import { playGame } from '@bots/playGame';
import { asSimMs } from '@shared/time';
import { createSim, type Sim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot } from '../support/botSupport.ts';
import {
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../support/testContent.ts';

// The tidying of the final rush (story 3.5): `perfect` and `human` put the mess back before the photo,
// `idle` and `random` do nothing new, and a level with no rush sees no bot change.
const DURATION_MS = 20_000;
const content = createTestContent();
const RUSH_AT = DURATION_MS - content.feel.endOfLevel.finalRushMs;
const { reactionMeanMs: reactionMs } = createTestBots().human;
// A row is a whole number: half a point rounds up (story 3.12).
// The sigh row of one prop on the floor, the only mess here: the row is rounded once over all the
// props (story 3.12), so it is not a per-prop cost from any other count.
const ONE_PROP_SIGH_POINTS = Math.round(
  Math.min(content.feel.mama.sighPerPropOnFloorPoints, content.feel.mama.sighMaxPoints),
);

interface Game {
  sim: Sim;
  events: SimEvent[];
}

/** The mug is knocked off its table at 100 ms (the frozen room's props are breakable, so no door spill: `doorSpillCount` 0). */
async function play(
  id: BotId,
  options: { finalRush?: boolean; waves?: boolean } = {},
): Promise<Game> {
  const bundle = createTestContent();
  bundle.feel.endOfLevel.doorSpillCount = 0;
  const sim = await createSim({
    content: bundle,
    geometry: createTestGeometry(),
    level: createTestLevel({
      durationMs: DURATION_MS,
      waves: options.waves === true ? [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })] : [],
      ...(options.finalRush === false ? {} : { finalRush: { spillAnchor: 'coffee_table' } }),
    }),
    seed: 4,
    strictInvariants: true,
  });
  sim.enqueue({
    type: 'PushProp',
    t: asSimMs(100),
    propId: 'mug_01',
    impulseXNs: 0,
    impulseYNs: 0,
    impulseZNs: content.feel.gags.tableObjectFall.pushImpulseNs,
  });
  const events: SimEvent[] = [];
  playGame(sim, makeBot(id, botSetup(4)), DURATION_MS * 2, (event) => events.push(event));
  return { sim, events };
}

const tapsOf = (sim: Sim) =>
  sim
    .journal()
    .entries.filter((entry) => entry.command.type === 'TapObject')
    .map((entry) => ({ applyAt: entry.applyAt, command: entry.command }));

describe('the tidying bots in the final rush (story 3.5)', () => {
  it('perfect taps the mess the moment the door opens, and the photo finds it tidied', async () => {
    const { sim, events } = await play('perfect');
    expect(sim.world.flow.state).toBe('photo');
    expect(sim.world.score.propsTidied).toBe(1);
    expect(sim.world.mess.propsOnFloor).toBe(0);
    expect(sim.world.score.final?.sighPoints).toBe(0);
    const taps = tapsOf(sim);
    expect(taps).toHaveLength(1);
    expect(taps[0]?.command).toMatchObject({ type: 'TapObject', objectId: 'mug_01' });
    expect(taps[0]?.applyAt).toBeLessThanOrEqual(RUSH_AT + 20);
    expect(events.filter((event) => event.type === 'PropTidied')).toHaveLength(1);
  });

  it('human waits reactionMs after the door opened, then tidies it too', async () => {
    const { sim } = await play('human');
    expect(sim.world.score.propsTidied).toBe(1);
    expect(sim.world.score.final?.sighPoints).toBe(0);
    const [tap] = tapsOf(sim);
    expect(tap?.applyAt).toBeGreaterThanOrEqual(RUSH_AT + reactionMs);
    expect(tap?.applyAt).toBeLessThanOrEqual(RUSH_AT + reactionMs + 20);
  });

  it('idle tidies nothing and pays the sigh for the prop on the floor', async () => {
    const { sim } = await play('idle');
    expect(sim.world.score.propsTidied).toBe(0);
    expect(tapsOf(sim)).toEqual([]);
    expect(sim.world.score.final?.sighPoints).toBe(ONE_PROP_SIGH_POINTS);
  });

  it('random never names a prop: it does nothing new in the rush', async () => {
    const { sim } = await play('random');
    expect(tapsOf(sim).filter((tap) => 'objectId' in tap.command)).toEqual([]);
    expect(sim.world.score.propsTidied).toBe(0);
  });

  it('does nothing outside the rush: a level without one sees no TapObject, whatever the bot', async () => {
    for (const id of ['perfect', 'human'] as const) {
      const { sim } = await play(id, { finalRush: false });
      expect(tapsOf(sim), id).toEqual([]);
      expect(sim.world.score.propsTidied, id).toBe(0);
      expect(sim.world.flow.state, id).toBe('ended');
    }
  });

  it('draws nothing from world.rng: the stream after a game is the same as an idle bot’s', async () => {
    const idle = await play('idle');
    for (const id of ['perfect', 'human'] as const) {
      const game = await play(id);
      expect(game.sim.world.rng, id).toEqual(idle.sim.world.rng);
    }
  });

  // That a threat to answer comes first is pinned by `planTidy`'s own test (`threatTiming.test.ts`).
  it('still tidies in a game that also has threats to parry: it parries them and puts the mug back', async () => {
    const { sim, events } = await play('perfect', { waves: true });
    const responses = events.filter((event) => event.type === 'ResponseResolved');
    expect(responses.length).toBeGreaterThan(0);
    expect(sim.world.score.propsTidied).toBe(1);
  });
});
