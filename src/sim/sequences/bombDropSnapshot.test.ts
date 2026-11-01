import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBombDropLay,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SLOW_MO_SOURCES, type World } from '../world.ts';

// Snapshot v25 (story 4.8): the `sequence` slow-mo source is the only change. A round trip taken
// mid-descent with the press held keeps the press, the slow motion and the drawn instants; both copies
// are played to the end and their hashes compared (the reviews of 4.4 to 4.6).
const content = createTestContent();
const geometry = createTestGeometry();
const LAY = createTestBombDropLay();
const windowMs = LAY.windowMs ?? content.feel.timing.windowMs;
const level = createTestLevel({ carry: CARRY, sequences: ['bomb_drop'] });
const newSim = () => createSim({ content, geometry, level, seed: 5 });
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
const worldOf = (sim: Sim) => sim.world as World;
const layOf = (sim: Sim) => {
  const lay = worldOf(sim).threats.find((threat) => threat.defId === LAY.id);
  if (lay === undefined) throw new Error('no bomb drop instance');
  return lay;
};

function stepFor(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function stepUntil(sim: Sim, isDone: () => boolean): void {
  for (let i = 0; i < 3000 && !isDone(); i++) {
    sim.step();
    // What happened before the snapshot is not part of what both copies play next.
    sim.drainEvents();
  }
  expect(isDone()).toBe(true);
}

async function started(): Promise<Sim> {
  const sim = await newSim();
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
  stepFor(sim, 1);
  return sim;
}

describe('the bomb drop in a snapshot (story 4.8)', () => {
  it('is version 27 and knows the sequence slow-mo source', async () => {
    const sim = await started();
    expect(sim.snapshot().version).toBe(27);
    expect(SLOW_MO_SOURCES).toContain('sequence');
  });

  it('refuses a slow-mo source it does not know, naming the field', async () => {
    const sim = await started();
    stepUntil(sim, () => layOf(sim).state === 'telegraph');
    const snapshot = roundTrip(sim);
    const slowMo = snapshot.world.time.slowMos.find((candidate) => candidate.source === 'sequence');
    expect(slowMo).toBeDefined();
    if (slowMo === undefined) return;
    (slowMo as { source: string }).source = 'bomb';
    const target = await newSim();
    expect(() => target.restore(snapshot)).toThrow(/slowMos\[\d+\]\.source/);
  });

  describe.each([
    ['in the rest before the descent', async (sim: Sim) => stepFor(sim, 20)],
    [
      'mid-descent with the press held (the press and the slow-mo must survive)',
      async (sim: Sim) => {
        stepUntil(sim, () => layOf(sim).state === 'telegraph');
        const lay = layOf(sim);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(lay.enteredAt + 100), threatId: lay.id });
        stepUntil(sim, () => layOf(sim).press !== null);
        stepFor(sim, 60);
      },
    ],
    [
      'with the window open and the press still held',
      async (sim: Sim) => {
        stepUntil(sim, () => layOf(sim).state === 'telegraph');
        const lay = layOf(sim);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(lay.enteredAt + 100), threatId: lay.id });
        stepUntil(sim, () => layOf(sim).state === 'windowOpen');
        stepFor(sim, 3);
      },
    ],
    [
      'after a retreat, with the slow-mo ended',
      async (sim: Sim) => {
        stepUntil(sim, () => layOf(sim).state === 'telegraph');
        const lay = layOf(sim);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(lay.enteredAt + 100), threatId: lay.id });
        sim.enqueue({ type: 'Release', t: asSimMs(lay.enteredAt + 140) });
        stepUntil(sim, () => worldOf(sim).sequence.duel.retreats === 1);
        stepFor(sim, 5);
      },
    ],
  ] as const)('%s', (_name, bring) => {
    it('restores to the same state and plays the same to the end, released or not', async () => {
      for (const isReleased of [true, false]) {
        const live = await started();
        await bring(live);
        const snapshot = roundTrip(live);
        const copy = await newSim();
        copy.restore(snapshot);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
        expect(worldOf(copy).time.slowMos).toEqual(worldOf(live).time.slowMos);
        expect(layOf(copy).windowOpenAt).toBe(layOf(live).windowOpenAt);
        expect(layOf(copy).press).toEqual(layOf(live).press);
        const releaseAt = (sim: Sim) => {
          const lay = layOf(sim);
          if (lay.press === null || lay.press.releasedAt !== null) return;
          sim.enqueue({ type: 'Release', t: asSimMs(lay.windowOpenAt + windowMs / 2) });
        };
        if (isReleased) for (const sim of [live, copy]) releaseAt(sim);
        const liveEvents: SimEvent[] = [];
        const copyEvents: SimEvent[] = [];
        for (let i = 0; i < 4000; i++) {
          liveEvents.push(...stepFor(live, 1));
          copyEvents.push(...stepFor(copy, 1));
          if (worldOf(live).sequence.id === null) break;
          if (isReleased && layOf(live).state === 'telegraph' && layOf(live).press === null) {
            for (const sim of [live, copy]) {
              const lay = layOf(sim);
              sim.enqueue({
                type: 'PressThreat',
                t: asSimMs(lay.enteredAt + 100),
                threatId: lay.id,
              });
              sim.enqueue({ type: 'Release', t: asSimMs(lay.windowOpenAt + windowMs / 2) });
            }
          }
        }
        expect(worldOf(live).sequence.id).toBeNull();
        expect(copyEvents).toEqual(liveEvents);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
      }
    });
  });
});
