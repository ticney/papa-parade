import { describe, expect, it } from 'vitest';
import {
  createTestCoffeeTableObject,
  createTestContent,
  createTestGeometry,
  createTestOutlet,
  createTestStairs,
  testMicroSleepBusyMs,
} from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that each of the
 * séquelles scenarios (story 3.15) really shows what it is there for, with the durations of the frozen defs.
 */
const content = createTestContent();
const geometry = createTestGeometry();

async function eventsOf(name: string) {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return (await recordScenario(content, geometry, scenario)).events;
}
type Events = Awaited<ReturnType<typeof eventsOf>>;

const only = <T extends Events[number]['type']>(events: Events, type: T) =>
  events.filter((event): event is Extract<Events[number], { type: T }> => event.type === type);
const afterEffects = (events: Events) =>
  events
    .filter((event) => event.type === 'AfterEffectStarted' || event.type === 'AfterEffectEnded')
    .map(
      (event) =>
        `${event.type === 'AfterEffectStarted' ? '+' : '-'}${(event as { kind: string }).kind}@${event.t}`,
    );

function effectOf<K extends string>(def: { afterEffect: { kind: string } }, kind: K) {
  if (def.afterEffect.kind !== kind) throw new Error(`the frozen def is not ${kind}`);
  return def.afterEffect as unknown as Record<string, number>;
}
const ELECTRIFIED = effectOf(createTestOutlet(), 'electrified');
const DOWNSTAIRS = effectOf(createTestStairs(), 'babyDownstairs');
const DEBRIS = effectOf(createTestCoffeeTableObject(), 'debris');

describe('golden scenario outlet_electrified_dim covers the outlet’s séquelle', () => {
  it('shocks Papa for busyMs and dims the room for dimMs, each told when it begins and ends', async () => {
    const events = await eventsOf('outlet_electrified_dim');
    const [gag] = only(events, 'GagTriggered');
    const at = gag?.t ?? 0;
    expect(afterEffects(events)).toEqual([
      `+electrified@${at}`,
      `+dim@${at}`,
      `-electrified@${at + (ELECTRIFIED.busyMs ?? 0)}`,
      `-dim@${at + (ELECTRIFIED.dimMs ?? 0)}`,
    ]);
    expect(only(events, 'AfterEffectStarted')[0]?.until).toBe(at + (ELECTRIFIED.busyMs ?? 0));
  });

  it('ignores the tap made during the shock and obeys the one made after it', async () => {
    const events = await eventsOf('outlet_electrified_dim');
    const planned = only(events, 'PapaStateChanged').filter((event) => event.to === 'walkPath');
    // The tap at 2000 is inside the shock (from the gag at 1670 to 3170): only the one at 3500 walks him.
    expect(planned.map((event) => event.t)).toEqual([3500]);
  });
});

describe('golden scenario stairs_fetch_carry_up covers the baby left downstairs and fetched', () => {
  it('leaves him downstairs at the gag, then carries him up for carryUpMs after the walk', async () => {
    const events = await eventsOf('stairs_fetch_carry_up');
    const [gag] = only(events, 'GagTriggered');
    const [carried] = only(events, 'BabyStateChanged').filter((event) => event.to === 'carriedUp');
    expect(
      only(events, 'BabyStateChanged').filter((event) => event.to === 'downstairs')[0]?.t,
    ).toBe(gag?.t);
    const carryAt = carried?.t ?? 0;
    expect(carryAt).toBeGreaterThan(3000);
    expect(afterEffects(events)).toEqual([
      `+babyDownstairs@${gag?.t}`,
      `-babyDownstairs@${carryAt}`,
      `+carryUp@${carryAt}`,
      `-carryUp@${carryAt + (DOWNSTAIRS.carryUpMs ?? 0)}`,
    ]);
    expect(only(events, 'NearMiss')).toHaveLength(1);
    const babble = only(events, 'BabyStateChanged').find((event) => event.from === 'carriedUp');
    expect(babble).toMatchObject({ to: 'babble', t: carryAt + (DOWNSTAIRS.carryUpMs ?? 0) });
  });
});

describe('golden scenario stairs_self_return covers the baby who climbs back by himself', () => {
  it('is back selfReturnMs after the gag, at that very step, with nobody to fetch him', async () => {
    const events = await eventsOf('stairs_self_return');
    const [gag] = only(events, 'GagTriggered');
    const backAt = (gag?.t ?? 0) + (DOWNSTAIRS.selfReturnMs ?? 0);
    expect(afterEffects(events)).toEqual([
      `+babyDownstairs@${gag?.t}`,
      `-babyDownstairs@${backAt}`,
    ]);
    expect(
      only(events, 'BabyStateChanged').find((event) => event.from === 'downstairs'),
    ).toMatchObject({
      to: 'babble',
      t: backAt,
    });
    expect(only(events, 'BabyPickedUp')).toEqual([]);
  });
});

describe('golden scenario debris_pick_up_and_step covers the debris', () => {
  it('stays on the floor from the gag, is stepped on once with its noise, then picked up in pickUpMs', async () => {
    const events = await eventsOf('debris_pick_up_and_step');
    const [gag] = only(events, 'GagTriggered');
    const [stepped] = only(events, 'DebrisSteppedOn');
    expect(only(events, 'DebrisSteppedOn')).toHaveLength(1);
    expect(stepped).toMatchObject({ propId: 'mug_01' });
    const stepNoise = only(events, 'NoiseChanged').filter((event) => event.source === 'debrisStep');
    expect(stepNoise).toEqual([expect.objectContaining({ t: stepped?.t, deltaPct: 3 })]);
    const picking = only(events, 'PapaStateChanged').find((event) => event.to === 'pickingUp');
    const tidied = only(events, 'PropTidied')[0];
    expect(tidied?.t).toBe((picking?.t ?? 0) + (DEBRIS.pickUpMs ?? 0));
    expect(afterEffects(events)).toEqual([`+debris@${gag?.t}`, `-debris@${tidied?.t}`]);
    // Walking to the debris to pick it up is no step on it: the only step is the walk across.
    expect((stepped?.t ?? 0) < (picking?.t ?? 0)).toBe(true);
  });
});

describe('golden scenario silence_mess_mark covers the mess that stays', () => {
  it('starts a `mess` at the mischief, with no end: it lasts to the end of the level', async () => {
    const events = await eventsOf('silence_mess_mark');
    const [gag] = only(events, 'GagTriggered');
    expect(['tissues_everywhere', 'crayon_scribbles']).toContain(gag?.gag);
    expect(afterEffects(events)).toEqual([`+mess@${gag?.t}`]);
    expect(only(events, 'AfterEffectStarted')[0]).toMatchObject({ until: null, propId: null });
  });
});

describe('golden scenario after_effect_replaced covers a séquelle replaced without being extended', () => {
  it('a shock in the middle of the nap replaces it and ends where the nap would have', async () => {
    const events = await eventsOf('after_effect_replaced');
    const [nap] = only(events, 'AfterEffectStarted').filter((event) => event.kind === 'asleep');
    const [shock] = only(events, 'AfterEffectStarted').filter(
      (event) => event.kind === 'electrified',
    );
    const napEnd = (nap?.t ?? 0) + testMicroSleepBusyMs();
    expect(nap?.until).toBe(napEnd);
    // Not the shock's own 1.5 s after it began: the end is the nap's.
    expect(shock?.until).toBe(napEnd);
    expect(shock?.t).toBeGreaterThan(nap?.t ?? 0);
    expect(shock?.t).toBeLessThan(napEnd);
    expect(afterEffects(events).slice(0, 4)).toEqual([
      `+asleep@${nap?.t}`,
      `-asleep@${shock?.t}`,
      `+electrified@${shock?.t}`,
      `+dim@${shock?.t}`,
    ]);
    expect(only(events, 'PapaStateChanged').map((event) => `${event.from}>${event.to}`)).toEqual([
      'idle>asleep',
      'asleep>electrified',
      'electrified>idle',
    ]);
  });
});
