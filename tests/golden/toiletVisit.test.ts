import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `toilet_visit` really is the story it is there for: a full need slows the walk to the door by
 * `slowdownPct`, Papa goes in and is out of the room for exactly `toiletDurationMs`, an outlet
 * nobody answers gags `late` meanwhile, and the visit ends with the need back at 0.
 */
const content = createTestContent();
const { bladder } = content.feel;
const SHORT_VISIT_MS = 1500; // the scenario's `SetFeel`
const scenario = SCENARIOS.find((candidate) => candidate.name === 'toilet_visit');
if (scenario === undefined) throw new Error('missing scenario toilet_visit');
const geometry = createTestGeometry();
const { events, finalBladderPct } = await recordScenario(content, geometry, scenario);

const kinds = events.map((event) => event.type);
const ofType = <T extends (typeof events)[number]['type']>(type: T) =>
  events.filter(
    (event): event is Extract<(typeof events)[number], { type: T }> => event.type === type,
  );

describe('golden scenario toilet_visit covers the need it is there for', () => {
  it('fills the need at once: one BladderFilled, before Papa has left', () => {
    expect(ofType('BladderFilled')).toHaveLength(1);
    expect(kinds.indexOf('BladderFilled')).toBeLessThan(kinds.indexOf('PapaPathPlanned'));
  });

  it('slows the walk to the door by slowdownPct: the same walk with an empty need is 30 % shorter in time', async () => {
    const withoutNeed = {
      ...scenario,
      actions: scenario.actions.filter((action) => action.command.type !== 'SetBladder'),
    };
    const quick = await recordScenario(content, geometry, withoutNeed);
    const startOf = (list: readonly (typeof events)[number][]) =>
      list.find((event) => event.type === 'PapaPathPlanned')?.t ?? 0;
    const arrivalOf = (list: readonly (typeof events)[number][]) =>
      list.find((event) => event.type === 'PapaArrived')?.t ?? 0;
    const slowMs = arrivalOf(events) - startOf(events);
    const quickMs = arrivalOf(quick.events) - startOf(quick.events);
    expect(quickMs).toBeGreaterThan(0);
    // One step of slack per rounding: the walk ends on a step boundary either way.
    expect(Math.abs(slowMs - quickMs / (1 - bladder.slowdownPct / 100))).toBeLessThanOrEqual(
      2 * STEP_MS,
    );
    expect(kinds).not.toContain('PapaGlideStarted');
  });

  it('goes in on arrival and comes out exactly toiletDurationMs later, with the need back at 0', () => {
    const [arrived] = ofType('PapaArrived');
    const [started] = ofType('ToiletStarted');
    const [finished] = ofType('ToiletFinished');
    expect(started).toMatchObject({ objectId: 'toilet' });
    expect(started?.t).toBe(arrived?.t);
    expect(started?.untilAt).toBe((started?.t ?? 0) + SHORT_VISIT_MS);
    expect(finished?.t).toBe(started?.untilAt);
    // Back at 0 at the end of the visit, then rising again at `perSec` for the rest of the run (to
    // within a step of gain: the step that finishes it also adds one).
    const afterMs = scenario.untilSimMs - (finished?.t ?? 0);
    expect(finalBladderPct).toBeCloseTo((bladder.perSec * afterMs) / 1000, 1);
    expect(finalBladderPct).toBeLessThan(bladder.slowFromPct / 2);
    expect(kinds.indexOf('ToiletStarted')).toBeLessThan(kinds.indexOf('ToiletFinished'));
    expect(ofType('PapaStateChanged').map((event) => `${event.from}>${event.to}`)).toEqual([
      'idle>walkPath',
      'walkPath>onToilet',
      'onToilet>idle',
    ]);
  });

  it('misses the outlet meanwhile: it gags late while Papa is out of the room', () => {
    const [started] = ofType('ToiletStarted');
    const [finished] = ofType('ToiletFinished');
    const [resolved] = ofType('ResponseResolved');
    expect(ofType('ResponseResolved')).toHaveLength(1);
    expect(resolved).toMatchObject({ quality: 'fail', reason: 'late' });
    expect(resolved?.t).toBeGreaterThan(started?.t ?? Number.POSITIVE_INFINITY);
    expect(resolved?.t).toBeLessThan(finished?.t ?? 0);
    expect(ofType('GagTriggered')).toEqual([expect.objectContaining({ reason: 'late' })]);
  });
});
