import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestCycleGeometry } from '../support/cycleSupport.ts';
import { createTestContent } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `bedtime_cycle_won` is the story it is there for (story 4.10): the five sequences in order, the baby
 * put down in the crib and fetched between them, the level ended by the cycle.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'bedtime_cycle_won');
if (scenario === undefined) throw new Error('missing scenario bedtime_cycle_won');
const { events } = await recordScenario(createTestContent(), createTestCycleGeometry(), scenario);

const ofType = <T extends SimEvent['type']>(type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('golden scenario bedtime_cycle_won covers the evening it is there for', () => {
  it('runs the five sequences in order, each won at the first try', () => {
    expect(ofType('SequenceStarted').map((event) => event.id)).toEqual([
      'stay_awake',
      'lullaby_walk',
      'bedtime_duel',
      'bomb_drop',
      'stealth_exit',
    ]);
    expect(ofType('SequenceEnded').map((event) => event.outcome)).toEqual(
      Array.from({ length: 5 }, () => 'succeeded'),
    );
  });

  it('cashes in at the crib between the sequences, and the drop is one of them', () => {
    expect(ofType('ComboCashedIn').length).toBeGreaterThanOrEqual(2);
    expect(ofType('BabyPickedUp').length).toBeGreaterThanOrEqual(2);
  });

  it('parries a base threat in an interlude', () => {
    const baseKinds = new Set(['outlet', 'coffee_table_object']);
    const baseIds = new Set(
      ofType('ThreatTelegraphed')
        .filter((event) => baseKinds.has(event.kind))
        .map((event) => event.threatId),
    );
    expect(
      ofType('ResponseResolved').filter((event) => baseIds.has(event.threatId)).length,
    ).toBeGreaterThan(0);
    expect(ofType('GagTriggered')).toEqual([]);
  });

  it('ends on the cycle, in the step of the exit', () => {
    const [completed] = ofType('CycleCompleted');
    expect(completed).toBeDefined();
    expect(ofType('LevelEnded')).toEqual([
      { type: 'LevelEnded', t: completed?.t, reason: 'cycleDone' },
    ]);
    expect(ofType('SequenceEnded').at(-1)?.t).toBe(completed?.t);
  });
});
