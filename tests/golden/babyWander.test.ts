import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `baby_wander` really is the baby alone, living through several cycles, so that a later edit of
 * the script or of the feel fixture cannot silently turn it into a baby that never moves.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'baby_wander');
if (scenario === undefined) throw new Error('missing scenario baby_wander');
const content = createTestContent();
const { events, journal } = await recordScenario(content, createTestGeometry(), scenario);

describe('golden scenario baby_wander covers the cases it is there for', () => {
  const changes = events.filter((event) => event.type === 'BabyStateChanged');

  it('has no command: the baby lives on its own', () => {
    expect(journal.entries).toEqual([]);
  });

  it('only emits baby events', () => {
    expect(events.every((event) => event.type === 'BabyStateChanged')).toBe(true);
  });

  it('starts babbling, and sets off at the first step at or after babbleMinMs', () => {
    expect(changes[0]).toMatchObject({ from: 'babble', to: 'wander' });
    const t = changes[0]?.t as number;
    expect(t).toBeGreaterThanOrEqual(content.feel.baby.babbleMinMs);
    expect(t).toBeLessThan(content.feel.baby.babbleMinMs + STEP_MS);
  });

  it('strictly alternates babble and wander, for at least three full cycles', () => {
    expect(changes.length).toBeGreaterThanOrEqual(6);
    changes.forEach((change, index) => {
      expect(change).toMatchObject(
        index % 2 === 0 ? { from: 'babble', to: 'wander' } : { from: 'wander', to: 'babble' },
      );
    });
  });
});
