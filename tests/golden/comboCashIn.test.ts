import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `combo_cash_in` really is the story it is there for: the baby is carried, the combo climbs on a
 * carry tick and on a perfect Parry of the cry in the arms, the put-down in the playpen cashes it in
 * (with its slow-mo), and the points end up in the Rire of the note.
 */
const content = createTestContent();
const { feel } = content;
const scenario = SCENARIOS.find((candidate) => candidate.name === 'combo_cash_in');
if (scenario === undefined) throw new Error('missing scenario combo_cash_in');
const { events } = await recordScenario(content, createTestGeometry(), scenario);

const kinds = events.map((event) => event.type);
const ofType = <T extends (typeof events)[number]['type']>(type: T) =>
  events.filter(
    (event): event is Extract<(typeof events)[number], { type: T }> => event.type === type,
  );

describe('golden scenario combo_cash_in covers the combo it is there for', () => {
  it('climbs on the carry tick, exactly carryTickMs after the pick-up', () => {
    const [pickUp] = ofType('BabyPickedUp');
    const [tick] = ofType('ComboChanged');
    expect(ofType('BabyPickedUp')).toHaveLength(1);
    expect(tick).toMatchObject({ multiplier: feel.combo.minMultiplier + 1, reason: 'carryTick' });
    expect(tick?.t).toBe((pickUp?.t ?? 0) + feel.combo.carryTickMs);
  });

  it('climbs once more on the perfect Parry of the cry in the arms', () => {
    const resolved = ofType('ResponseResolved');
    expect(resolved).toEqual([expect.objectContaining({ quality: 'perfect', response: 'parry' })]);
    expect(ofType('ComboChanged')[1]).toMatchObject({
      t: resolved[0]?.t,
      multiplier: feel.combo.minMultiplier + 2,
      reason: 'response',
    });
  });

  it('cashes in at the safe put-down, in this order, with multiplier × basePoints', () => {
    const putDown = kinds.indexOf('BabyPutDown');
    expect(events[putDown]).toMatchObject({ safe: true });
    expect(events[putDown - 1]).toMatchObject({ type: 'BabyStateChanged', from: 'carried' });
    const cashedIn = ofType('ComboCashedIn');
    expect(cashedIn).toHaveLength(1);
    const [cash] = cashedIn;
    const expectedBasePoints = feel.combo.basePerCarryTickPoints + feel.combo.basePerResponsePoints;
    expect(cash).toMatchObject({ multiplier: feel.combo.minMultiplier + 2 });
    expect(cash?.basePoints).toBeCloseTo(expectedBasePoints, 9);
    expect(cash?.points).toBeCloseTo((cash?.multiplier ?? 0) * expectedBasePoints, 9);
    expect(kinds.slice(putDown + 1, putDown + 3)).toEqual(['ComboCashedIn', 'ComboChanged']);
    expect(events[putDown + 2]).toMatchObject({
      multiplier: feel.combo.minMultiplier,
      reason: 'cashIn',
    });
  });

  it('slows time down at the cash-in, and the slow-mo has run out before the level ends', () => {
    const [cash] = ofType('ComboCashedIn');
    const scaleChanges = ofType('TimeScaleChanged');
    const atCashIn = scaleChanges.find((change) => change.t === cash?.t);
    expect(atCashIn?.to).toBe(feel.combo.slowMoCashIn.timeScale);
    const last = scaleChanges.at(-1);
    expect(last?.to).toBe(1);
    expect(last?.t).toBeLessThan(scenario.untilSimMs);
  });

  it('ends the level with the combo points in the Rire of the note', () => {
    const [cash] = ofType('ComboCashedIn');
    const [ended] = ofType('LevelEnded');
    const [scored] = ofType('LevelScored');
    expect(scored?.t).toBe(ended?.t);
    expect(scored?.laughPoints).toBe(
      Math.round(
        Math.min(feel.mama.laughMaxPoints, feel.mama.laughPerPerfectPoints + (cash?.points ?? 0)),
      ),
    );
    expect(scored?.laughPoints).toBeGreaterThan(feel.mama.laughPerPerfectPoints);
  });

  it('ends on a whole number of steps', () => {
    expect(scenario.untilSimMs % STEP_MS).toBe(0);
  });
});
