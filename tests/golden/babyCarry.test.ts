import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `baby_carry` really is the story it is there for: the baby is taken while the outlet is
 * telegraphed (the outlet is cancelled with no gag), carried to the playpen and put down safe, and
 * the outlet comes back and is parried.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'baby_carry');
if (scenario === undefined) throw new Error('missing scenario baby_carry');
const { events } = await recordScenario(createTestContent(), createTestGeometry(), scenario);

const kinds = events.map((event) => event.type);
const indexOf = (type: string, from = 0) => kinds.indexOf(type as never, from);

describe('golden scenario baby_carry covers the carrying it is there for', () => {
  it('takes the baby once, cancels the telegraphed outlet with no gag, in this order', () => {
    const pickUp = indexOf('BabyPickedUp');
    expect(pickUp).toBeGreaterThan(indexOf('ThreatTelegraphed'));
    expect(events[pickUp - 1]).toMatchObject({ type: 'BabyStateChanged', to: 'carried' });
    expect(events[pickUp + 1]).toMatchObject({
      type: 'ThreatCancelled',
      threatId: 1,
      reason: 'carried',
    });
    expect(kinds.filter((type) => type === 'BabyPickedUp')).toHaveLength(1);
    // The cancelled outlet has neither a result nor a gag before it is drawn again.
    const secondTelegraph = indexOf('ThreatTelegraphed', indexOf('ThreatTelegraphed') + 1);
    const between = kinds.slice(pickUp, secondTelegraph);
    expect(between).not.toContain('ResponseResolved');
    expect(between).not.toContain('GagTriggered');
    expect(between).not.toContain('ThreatRearmed');
  });

  it('puts him down safe in the playpen, once, after Papa walked there', () => {
    const putDowns = events.filter((event) => event.type === 'BabyPutDown');
    expect(putDowns).toEqual([expect.objectContaining({ safe: true })]);
    const putDown = indexOf('BabyPutDown');
    expect(events[putDown - 1]).toMatchObject({
      type: 'BabyStateChanged',
      from: 'carried',
      to: 'babble',
    });
    expect(indexOf('PapaArrived')).toBeLessThan(putDown);
  });

  it('draws the outlet again after the put-down, and a perfect Parry resolves it', () => {
    const putDown = indexOf('BabyPutDown');
    const telegraphs = events.filter((event) => event.type === 'ThreatTelegraphed');
    expect(telegraphs).toHaveLength(2);
    expect(indexOf('ThreatTelegraphed', putDown)).toBeGreaterThan(putDown);
    const resolved = events.filter((event) => event.type === 'ResponseResolved');
    expect(resolved).toEqual([expect.objectContaining({ threatId: 1, quality: 'perfect' })]);
  });

  it('ends on a whole number of steps', () => {
    expect(scenario.untilSimMs % STEP_MS).toBe(0);
  });
});
