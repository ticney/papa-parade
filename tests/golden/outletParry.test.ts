import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `outlet_parry` really goes through the cycles its comment promises, so that a later edit of the
 * script or of the feel fixture cannot silently turn it into four gags.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'outlet_parry');
if (scenario === undefined) throw new Error('missing scenario outlet_parry');
const content = createTestContent();
const { events, journal, worldHash } = await recordScenario(
  content,
  createTestGeometry(),
  scenario,
);

const resolved = events.filter((event) => event.type === 'ResponseResolved');
const babyTo = (state: string) =>
  events.filter((event) => event.type === 'BabyStateChanged' && event.to === state);

describe('golden scenario outlet_parry covers the cases it is there for', () => {
  it('rates the four cycles: perfect, early gag, late gag, perfect', () => {
    expect(resolved.map((event) => [event.quality, event.reason])).toEqual([
      ['perfect', undefined],
      ['fail', 'early'],
      ['fail', 'late'],
      ['perfect', undefined],
    ]);
    expect(resolved.map((event) => event.offsetMs)).toEqual([0, expect.any(Number), null, 0]);
  });

  it('plays a gag for each failure, with the outlet’s gag', () => {
    const gags = events.filter((event) => event.type === 'GagTriggered');
    expect(gags.map((event) => [event.gag, event.reason])).toEqual([
      ['outlet_hair', 'early'],
      ['outlet_hair', 'late'],
    ]);
  });

  it('is always the same threat, id 1, and rearms it between cycles', () => {
    expect(new Set(resolved.map((event) => event.threatId))).toEqual(new Set([1]));
    expect(events.filter((event) => event.type === 'ThreatRearmed').length).toBeGreaterThanOrEqual(
      3,
    );
    expect(events.filter((event) => event.type === 'ThreatTelegraphed')).toHaveLength(4);
  });

  it('has the baby lock on, approach and act, each time', () => {
    expect(babyTo('targetLocked')).toHaveLength(4);
    expect(babyTo('approach')).toHaveLength(4);
    expect(babyTo('act')).toHaveLength(2);
  });

  it('draws from the rng: the baby wanders between the cycles', () => {
    expect(babyTo('wander').length).toBeGreaterThan(0);
    expect(babyTo('babble').length).toBeGreaterThan(0);
  });

  it('judges a press that reached the sim after its own t on that t', () => {
    // The press at 25250 is applied at 25410 (the step after the enqueue), the result is the one of 25250.
    const last = resolved[3];
    expect(last).toMatchObject({ quality: 'perfect', offsetMs: 0 });
    const entry = journal.entries.find((candidate) => candidate.command.t === 25250);
    expect(entry?.applyAt).toBeGreaterThan(25250);
  });

  it('cancels a glide with a tap', () => {
    const glides = events.filter((event) => event.type === 'PapaGlideStarted');
    // One per press: cycle 1, cycle 2 (zero length: Papa is at the wall) and cycle 4.
    expect(glides).toHaveLength(3);
    expect(glides[1]).toMatchObject({ t: 10310, arriveAt: 10310 });
    const lastGlide = glides[2];
    // The glide of cycle 4 was due to arrive at 26010, but the tap at 25500 sent Papa elsewhere.
    expect(lastGlide).toMatchObject({ t: 25410, arriveAt: 26010 });
    const arrivals = events.filter(
      (event) => event.type === 'PapaArrived' && event.t > 25410 && event.t < 28000,
    );
    expect(arrivals).toEqual([expect.objectContaining({ xM: 0.5, zM: -2.6 })]);
  });

  it('has a world hash that is a hash', () => {
    expect(worldHash).toMatch(/^[0-9a-f]{14}$/);
  });
});
