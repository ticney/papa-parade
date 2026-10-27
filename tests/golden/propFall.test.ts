import { hashJson } from '@shared/hash';
import { replayJournal } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `prop_fall` really is the chain accident it is there for: the pushed mug falls on the vase, which
 * breaks, and the mug does not, so that a later edit of the feel fixture or of the physics cannot
 * silently turn it into a mug that falls on the floor.
 */
const scenario = SCENARIOS.find((candidate) => candidate.name === 'prop_fall');
if (scenario === undefined) throw new Error('missing scenario prop_fall');
const content = createTestContent();
const geometry = createTestGeometry();
const { events, journal, worldHash } = await recordScenario(content, geometry, scenario);

const propEvents = events.filter((event) => event.type.startsWith('Prop'));
const impacts = events.filter((event) => event.type === 'PropImpact');
const { breakImpulseNs } = content.feel.physics.kinds.vase as { breakImpulseNs: number };

describe('golden scenario prop_fall covers the chain accident it is there for', () => {
  it('has a PropImpact for the mug that names the vase, and one for the vase that names the mug', () => {
    expect(impacts).toContainEqual(
      expect.objectContaining({ propId: 'mug_01', otherPropId: 'vase_01' }),
    );
    expect(impacts).toContainEqual(
      expect.objectContaining({ propId: 'vase_01', otherPropId: 'mug_01' }),
    );
  });

  it('breaks the vase, once, at an impulse of at least its break impulse, and never the mug', () => {
    const broken = events.filter((event) => event.type === 'PropBroken');
    expect(broken).toEqual([
      expect.objectContaining({ propId: 'vase_01', impulseNs: expect.any(Number) }),
    ]);
    expect(broken[0]?.type === 'PropBroken' && broken[0].impulseNs).toBeGreaterThanOrEqual(
      breakImpulseNs,
    );
  });

  it('lands the mug on the floor after the vase is hit', () => {
    const firstChain = impacts.findIndex(
      (event) => event.type === 'PropImpact' && event.otherPropId !== null,
    );
    // The mug's first impact after the chain names no other prop: it is the floor (or furniture).
    const mugOnFloor = impacts.findIndex(
      (event, index) =>
        index > firstChain &&
        event.type === 'PropImpact' &&
        event.propId === 'mug_01' &&
        event.otherPropId === null,
    );
    expect(firstChain).toBeGreaterThanOrEqual(0);
    expect(mugOnFloor).toBeGreaterThan(firstChain);
    expect(propEvents.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves the mess at {propsOnFloor: 1, propsBroken: 1} and the vase broken where it stood', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const { world } = replay.value.sim;
    expect(world.mess).toEqual({ propsOnFloor: 1, propsBroken: 1 });
    expect(world.props.map((prop) => [prop.id, prop.isBroken])).toEqual([
      ['mug_01', false],
      ['vase_01', true],
    ]);
    const mug = world.props[0];
    expect(mug?.isOnFloor).toBe(true);
    expect(mug?.xM).toBeGreaterThan(geometry.props[0]?.centerM[0] ?? 0);
    replay.value.sim.dispose();
  });

  it('replays to exactly the same positions, bit for bit', async () => {
    const replay = await replayJournal({
      content,
      geometry,
      level: scenario.level,
      journal,
      untilSimMs: scenario.untilSimMs,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(worldHash);
    const again = await recordScenario(content, geometry, scenario);
    expect(replay.value.events).toEqual(again.events);
    replay.value.sim.dispose();
  });
});
