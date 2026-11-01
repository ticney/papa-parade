import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { World } from '../world.ts';
import { type DropRule, dropProps } from './dropProps.ts';

const content = createTestContent();
const RULE: DropRule = { count: 1, reachM: 0.5, pushImpulseNs: 0.72, isUnbreakableOnly: false };

interface PropAt {
  readonly id: string;
  readonly xM: number;
  readonly zM: number;
  readonly isOnFloor?: boolean;
  readonly isBroken?: boolean;
  readonly isBreakable?: boolean;
}

/** A world whose props are exactly `specs`, over a port that records the impulses asked for. */
async function setup(specs: readonly PropAt[]) {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 1,
  });
  const world = sim.world as World;
  const template = world.props[0] as World['props'][number];
  world.props = specs.map((spec) => ({
    ...template,
    id: spec.id,
    xM: spec.xM,
    zM: spec.zM,
    isOnFloor: spec.isOnFloor ?? false,
    isBroken: spec.isBroken ?? false,
  }));
  const impulses: { propIndex: number; xNs: number; zNs: number }[] = [];
  const ctx = {
    feel: content.feel,
    events: [],
    strictInvariants: true,
    level: {
      props: specs.map((spec) => ({ physics: { breakable: spec.isBreakable ?? true } })),
    },
    physics: {
      applyImpulse: (propIndex: number, xNs: number, _yNs: number, zNs: number) =>
        impulses.push({ propIndex, xNs, zNs }),
    },
  } as unknown as StepContext;
  const rngBefore = structuredClone(world.rng);
  return { world, ctx, impulses, rngBefore };
}

describe('dropProps (story 3.5, AC 32)', () => {
  it('pushes the nearest prop away from the origin at the impulse, and returns 1', async () => {
    const { world, ctx, impulses } = await setup([
      { id: 'far', xM: 0.3, zM: 0 },
      { id: 'near', xM: 0, zM: 0.2 },
    ]);
    expect(dropProps(world, ctx, 0, 0, RULE)).toBe(1);
    expect(impulses).toHaveLength(1);
    expect(impulses[0]?.propIndex).toBe(1);
    expect(impulses[0]?.xNs).toBeCloseTo(0, 12);
    expect(impulses[0]?.zNs).toBeCloseTo(0.72, 12);
  });

  it('sends two props, the two nearest, once each, and the next call starts afresh', async () => {
    const { world, ctx, impulses } = await setup([
      { id: 'c', xM: 0.4, zM: 0 },
      { id: 'a', xM: 0.1, zM: 0 },
      { id: 'b', xM: 0.2, zM: 0 },
    ]);
    expect(dropProps(world, ctx, 0, 0, { ...RULE, count: 2 })).toBe(2);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([1, 2]);
    impulses.length = 0;
    expect(dropProps(world, ctx, 0, 0, { ...RULE, count: 2 })).toBe(2);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([1, 2]);
  });

  it('gives a tie to the lower index', async () => {
    const { world, ctx, impulses } = await setup([
      { id: 'first', xM: 0.2, zM: 0 },
      { id: 'second', xM: 0, zM: 0.2 },
    ]);
    dropProps(world, ctx, 0, 0, RULE);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([0]);
  });

  it('pushes fewer props than asked when fewer are eligible, and none when none is', async () => {
    const { world, ctx, impulses } = await setup([
      { id: 'a', xM: 0.1, zM: 0 },
      { id: 'floor', xM: 0.2, zM: 0, isOnFloor: true },
      { id: 'broken', xM: 0.3, zM: 0, isBroken: true },
      { id: 'out', xM: 0.6, zM: 0 },
    ]);
    expect(dropProps(world, ctx, 0, 0, { ...RULE, count: 3 })).toBe(1);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([0]);
    impulses.length = 0;
    expect(dropProps(world, ctx, 5, 5, RULE)).toBe(0);
    expect(dropProps(world, ctx, 0, 0, { ...RULE, count: 0 })).toBe(0);
    expect(impulses).toEqual([]);
  });

  it('counts the reach as inclusive', async () => {
    const { world, ctx } = await setup([{ id: 'edge', xM: 0.5, zM: 0 }]);
    expect(dropProps(world, ctx, 0, 0, RULE)).toBe(1);
    expect(dropProps(world, ctx, 0, 0, { ...RULE, reachM: 0.49 })).toBe(0);
  });

  it('pushes a prop on the origin along the baby’s gaze', async () => {
    const { world, ctx, impulses } = await setup([{ id: 'on', xM: 1, zM: 1 }]);
    world.baby.gazeX = 0;
    world.baby.gazeZ = -1;
    dropProps(world, ctx, 1, 1, RULE);
    expect(impulses[0]?.xNs).toBeCloseTo(0, 12);
    expect(impulses[0]?.zNs).toBeCloseTo(-0.72, 12);
  });

  it('knocks over only what cannot break when asked: a breakable prop never spills, however near', async () => {
    const { world, ctx, impulses } = await setup([
      { id: 'mug', xM: 0.05, zM: 0, isBreakable: true },
      { id: 'toy', xM: 0.2, zM: 0, isBreakable: false },
      { id: 'book', xM: 0.3, zM: 0, isBreakable: false },
    ]);
    expect(dropProps(world, ctx, 0, 0, { ...RULE, count: 2, isUnbreakableOnly: true })).toBe(2);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([1, 2]);
    // The table gag takes any kind: the mug is the nearest.
    impulses.length = 0;
    dropProps(world, ctx, 0, 0, RULE);
    expect(impulses.map((impulse) => impulse.propIndex)).toEqual([0]);
  });

  it('draws nothing from world.rng and moves nothing itself', async () => {
    const { world, ctx, rngBefore } = await setup([{ id: 'a', xM: 0.1, zM: 0 }]);
    const positions = structuredClone(world.props);
    dropProps(world, ctx, 0, 0, { ...RULE, count: 2 });
    expect(world.rng).toEqual(rngBefore);
    expect(world.props).toEqual(positions);
  });
});
