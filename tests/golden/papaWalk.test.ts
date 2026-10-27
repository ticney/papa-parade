import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `papa_walk` really contains the cases its comment promises, so that a later edit of the script
 * cannot silently turn it into a walk in a straight line.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'papa_walk');
if (scenario === undefined) throw new Error('missing scenario papa_walk');
const { events, journal } = await recordScenario(
  createTestContent(),
  createTestGeometry(),
  scenario,
);

describe('golden scenario papa_walk covers the cases it is there for', () => {
  const planned = events.filter((event) => event.type === 'PapaPathPlanned');
  const changes = events.filter((event) => event.type === 'PapaStateChanged');

  it('plans a path with a detour round the sofa', () => {
    // A straight walk is one waypoint (the goal): the second one is the corner of the detour.
    expect(planned[0]).toMatchObject({ targetXM: 0.5, targetZM: -2.6, waypointCount: 2 });
  });

  const tapped = journal.entries
    .map((entry) => entry.command)
    .filter((command) => command.type === 'TapFloor');
  const isSnapped = (index: number): boolean =>
    planned[index]?.targetXM !== (tapped[index] as { xM: number }).xM ||
    planned[index]?.targetZM !== (tapped[index] as { zM: number }).zM;

  it('keeps a tap on open floor where it was, and snaps a tap on the sofa to the nearest open cell', () => {
    expect(tapped[0]).toMatchObject({ xM: 0.5, zM: -2.6 });
    expect(isSnapped(0)).toBe(false);
    expect(tapped[1]).toMatchObject({ xM: 0.5, zM: -1.7 });
    expect(isSnapped(1)).toBe(true);
  });

  it('snaps a tap outside the grid to the nearest open cell', () => {
    expect(tapped[2]).toMatchObject({ xM: 10, zM: 10 });
    expect(isSnapped(2)).toBe(true);
  });

  it('ignores a MoveStop during a path: the first walk ends by arriving', () => {
    expect(changes[0]).toMatchObject({ from: 'idle', to: 'walkPath' });
    expect(changes[1]).toMatchObject({ from: 'walkPath', to: 'idle', t: 1850 });
  });

  it('runs into a wall once', () => {
    expect(events.filter((event) => event.type === 'PapaBlocked')).toHaveLength(1);
  });

  it('lets a Move cancel a path and a TapFloor replace a direction walk', () => {
    expect(changes.some((c) => c.from === 'walkPath' && c.to === 'walkDir')).toBe(true);
    expect(changes.some((c) => c.from === 'walkDir' && c.to === 'walkPath')).toBe(true);
  });

  it('records a command whose t is off the step grid and already past', () => {
    const offGrid = journal.entries.find((entry) => entry.command.t % 10 !== 0);
    expect(offGrid).toBeDefined();
    expect((offGrid?.command.t as number) < (offGrid?.applyAt as number)).toBe(true);
  });
});
