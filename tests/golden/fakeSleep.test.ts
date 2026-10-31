import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `fake_sleep_won` and `fake_sleep_feint_pressed` are the stories they are there for (story 4.7): a
 * duel won with the feint let go by, and one where a tap on the feint is paid with a retreat.
 */
const content = createTestContent();
const geometry = createTestGeometry();

async function eventsOf(name: string): Promise<SimEvent[]> {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return (await recordScenario(content, geometry, scenario)).events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const wonEvents = await eventsOf('fake_sleep_won');
const pressedEvents = await eventsOf('fake_sleep_feint_pressed');
const FAKE_SLEEP_ID = 3;

describe('golden scenario fake_sleep_won covers the duel it is there for', () => {
  it('starts at 10 ms, takes the baby, and gives one feint, before the second signal of two', () => {
    expect(ofType(wonEvents, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: 10, id: 'fake_sleep_duel' },
    ]);
    expect(ofType(wonEvents, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(wonEvents, 'WaitFeintGiven')).toEqual([
      { type: 'WaitFeintGiven', t: 8740, threatId: FAKE_SLEEP_ID },
    ]);
    const signals = ofType(wonEvents, 'WaitSignalGiven');
    expect(signals).toHaveLength(2);
    const feint = wonEvents.findIndex((event) => event.type === 'WaitFeintGiven');
    const secondSignal = wonEvents.findIndex(
      (event) => event.type === 'WaitSignalGiven' && event.threatId === FAKE_SLEEP_ID,
    );
    expect(feint).toBeLessThan(secondSignal);
  });

  it('answers each round at the centre of its window: two perfect responses and no gag', () => {
    expect(ofType(wonEvents, 'ResponseResolved')).toEqual(
      Array(2).fill(expect.objectContaining({ response: 'wait', quality: 'perfect', offsetMs: 0 })),
    );
    expect(ofType(wonEvents, 'GagTriggered')).toEqual([]);
  });

  it('goes up one step per round and ends won with the baby still carried', () => {
    expect(ofType(wonEvents, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([
      0, 1,
    ]);
    expect(ofType(wonEvents, 'SequenceStepRetreated')).toEqual([]);
    expect(ofType(wonEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 11_820, id: 'fake_sleep_duel', outcome: 'succeeded' },
    ]);
    expect(ofType(wonEvents, 'BabyPutDown')).toEqual([]);
  });
});

describe('golden scenario fake_sleep_feint_pressed covers the retreat it is there for', () => {
  it('gags the tap on the feint as early, with the fake sleep’s gag, before any signal of the round', () => {
    expect(ofType(pressedEvents, 'GagTriggered')).toEqual([
      expect.objectContaining({
        threatId: FAKE_SLEEP_ID,
        gag: 'baby_sat_up',
        reason: 'early',
        t: 8740,
      }),
    ]);
    // The feint of that first fake sleep is never given: the tap beat it, in the same step.
    expect(ofType(pressedEvents, 'WaitFeintGiven').map((event) => event.t)).toEqual([17_050]);
  });

  it('retreats once, from step 1 to step 0, and the eyes are played again', () => {
    expect(ofType(pressedEvents, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 1, stepIndex: 0, retreats: 1, reason: 'early' }),
    ]);
    expect(ofType(pressedEvents, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('cries for the def’s gagCryMs, in the baby’s arms', () => {
    expect(ofType(pressedEvents, 'BabyCrying')).toHaveLength(2);
  });

  it('is won in the end, with a fresh feint for the second fake sleep, and no BabyWoke', () => {
    expect(ofType(pressedEvents, 'BabyWoke')).toEqual([]);
    // Three rounds won (the eyes twice, the second fake sleep) and one lost (the first fake sleep).
    const resolved = ofType(pressedEvents, 'ResponseResolved');
    expect(resolved.filter((event) => event.quality !== 'fail')).toHaveLength(3);
    expect(resolved.filter((event) => event.quality === 'fail')).toHaveLength(1);
    expect(ofType(pressedEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 19_290, id: 'fake_sleep_duel', outcome: 'succeeded' },
    ]);
    expect(ofType(pressedEvents, 'BabyPutDown')).toEqual([]);
  });
});
