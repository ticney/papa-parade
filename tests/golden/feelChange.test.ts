import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `feel_change` really changes the feel in the middle of the game and that the change matters: the
 * same press is a `perfect` with the unchanged feel and a `success` with the widened window, and an
 * early press is a gag until `earlyPress` goes to `guard`.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'feel_change');
if (scenario === undefined) throw new Error('missing scenario feel_change');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal } = await recordScenario(content, geometry, scenario);
const resolved = events.filter((event) => event.type === 'ResponseResolved');

describe('golden scenario feel_change covers the cases it is there for', () => {
  it('journals the two SetFeel commands, each at the step after its time', () => {
    const entries = journal.entries.filter((entry) => entry.command.type === 'SetFeel');
    expect(entries.map((entry) => [entry.command.t, entry.applyAt])).toEqual([
      [1500, 1510],
      [5000, 5010],
    ]);
  });

  it('judges the first cycle against the widened window, and the second against the one put back', () => {
    const { windowMs } = content.feel.timing;
    expect(resolved.map((event) => event.responseWindow.windowMs)).toEqual([
      windowMs + 200,
      windowMs,
      windowMs,
    ]);
  });

  it('rates the first press a success 100 ms early of the new centre, though it was the old centre', () => {
    expect(resolved[0]).toMatchObject({ quality: 'success', offsetMs: -100 });
  });

  it('the same press is a perfect when the feel is not changed (the change matters)', async () => {
    const unchanged = await recordScenario(content, geometry, {
      ...scenario,
      actions: scenario.actions.filter((action) => action.command.type !== 'SetFeel'),
    });
    const first = unchanged.events.find((event) => event.type === 'ResponseResolved');
    expect(first).toMatchObject({ quality: 'perfect', offsetMs: 0 });
  });

  it('ignores a press far too early once earlyPress is guard, and rates the next one perfect', () => {
    expect(resolved[1]).toMatchObject({ quality: 'perfect', offsetMs: 0 });
    const gags = events.filter((event) => event.type === 'GagTriggered');
    expect(gags.map((event) => event.reason)).toEqual(['late']);
    expect(gags.some((event) => event.reason === 'early')).toBe(false);
  });

  it('puts the effective feel in the world hash: a SetFeel on a leaf nothing reads changes the hash alone', async () => {
    const withoutChanges = {
      ...scenario,
      actions: scenario.actions.filter((action) => action.command.type !== 'SetFeel'),
    };
    // `fatigue.startPoints` is read when the sim is created only, and this level has no fatigue
    // gauge: the run cannot tell the difference, except through the feel the world carries.
    const inert = {
      ...withoutChanges,
      actions: [
        {
          atStep: 10,
          command: {
            type: 'SetFeel',
            t: asSimMs(100),
            patch: { fatigue: { startPoints: content.feel.fatigue.startPoints + 1 } },
          },
        } as const,
        ...withoutChanges.actions,
      ],
    };
    const baseline = await recordScenario(content, geometry, withoutChanges);
    const tweaked = await recordScenario(content, geometry, inert);
    expect(tweaked.events).toEqual(baseline.events);
    expect(tweaked.worldHash).not.toBe(baseline.worldHash);
  });
});
