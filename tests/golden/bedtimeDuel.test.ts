import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `bedtime_duel_won` and `bedtime_duel_retreated` are the stories they are there for (story 4.6): a
 * duel won in three perfect rounds, and one that is lost twice (early, then late) and then won.
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

const wonEvents = await eventsOf('bedtime_duel_won');
const retreatedEvents = await eventsOf('bedtime_duel_retreated');

describe('golden scenario bedtime_duel_won covers the duel it is there for', () => {
  it('starts at 10 ms, takes the baby, and gives three signals', () => {
    expect(ofType(wonEvents, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: 10, id: 'bedtime_duel' },
    ]);
    expect(ofType(wonEvents, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(wonEvents, 'WaitSignalGiven')).toHaveLength(3);
  });

  it('answers each round at the centre of its window: three perfect responses', () => {
    expect(ofType(wonEvents, 'ResponseResolved')).toEqual(
      Array(3).fill(expect.objectContaining({ response: 'wait', quality: 'perfect', offsetMs: 0 })),
    );
    expect(ofType(wonEvents, 'GagTriggered')).toEqual([]);
  });

  it('goes up one step per round and ends won with the baby still carried', () => {
    expect(ofType(wonEvents, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(ofType(wonEvents, 'SequenceStepRetreated')).toEqual([]);
    expect(ofType(wonEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 15_020, id: 'bedtime_duel', outcome: 'succeeded' },
    ]);
    expect(ofType(wonEvents, 'BabyPutDown')).toEqual([]);
  });
});

describe('golden scenario bedtime_duel_retreated covers the retreats it is there for', () => {
  it('retreats twice: an early tap from step 1, then a late round that stays at step 0', () => {
    expect(ofType(retreatedEvents, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 1, stepIndex: 0, retreats: 1, reason: 'early' }),
      expect.objectContaining({ fromStepIndex: 0, stepIndex: 0, retreats: 2, reason: 'late' }),
    ]);
    expect(ofType(retreatedEvents, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_eyes_reopened', reason: 'early' }),
      expect.objectContaining({ gag: 'baby_eyes_reopened', reason: 'late' }),
    ]);
  });

  it('takes six rounds in all, four of them won, and walks 0, 1, 0, 0, 1, 2', () => {
    expect(ofType(retreatedEvents, 'ThreatTelegraphed')).toHaveLength(6);
    // The round tapped before its signal is gagged first: it never gives one.
    expect(ofType(retreatedEvents, 'WaitSignalGiven')).toHaveLength(5);
    expect(
      ofType(retreatedEvents, 'ResponseResolved').filter((event) => event.quality !== 'fail'),
    ).toHaveLength(4);
    expect(ofType(retreatedEvents, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([
      0, 1, 0, 0, 1, 2,
    ]);
  });

  it('is won in the end, with no BabyWoke and the baby still carried', () => {
    expect(ofType(retreatedEvents, 'BabyWoke')).toEqual([]);
    expect(ofType(retreatedEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 27_870, id: 'bedtime_duel', outcome: 'succeeded' },
    ]);
    expect(ofType(retreatedEvents, 'BabyPutDown')).toEqual([]);
  });
});
