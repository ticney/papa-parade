import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestFakeSleepRound,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// Snapshot v24 (story 4.7): the feint of a fake sleep round-trips. The round trips are taken with
// something in flight: before the feint (the drawn `feintAt` must survive), and after it and before the
// signal (`isFeintGiven` must survive, so that no second `WaitFeintGiven` comes). Each copy is played to
// the end next to the live sim, with the events and the hashes compared.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestFakeSleepRound();
const level = createTestLevel({
  carry: CARRY,
  sequences: [DEF.id],
  sequenceDefs: { [DEF.id]: DEF },
});
const newSim = () => createSim({ content, geometry, level, seed: 5 });
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
const worldOf = (sim: Sim) => sim.world as World;
const roundOf = (sim: Sim) => {
  const round = worldOf(sim).threats.find((threat) => threat.defId === 'fake_sleep');
  if (round === undefined) throw new Error('no fake sleep');
  return round;
};
const feintsIn = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'WaitFeintGiven');

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
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: DEF.id });
  stepFor(sim, 1);
  return sim;
}

/** Presses the open round dead centre, as the player would. */
function pressCentre(sim: Sim): void {
  const round = roundOf(sim);
  const centre = round.windowOpenAt + (round.responseWindow?.windowMs ?? 0) / 2;
  sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: round.id });
  sim.enqueue({ type: 'Release', t: asSimMs(centre + 50) });
}

describe('the feint in a snapshot (story 4.7)', () => {
  it('is version 34 and carries a clear feint at rest', async () => {
    const sim = await started();
    const snapshot = roundTrip(sim);
    expect(snapshot.version).toBe(34);
    expect(snapshot.world.threats.find((threat) => threat.defId === 'fake_sleep')).toMatchObject({
      feintAt: null,
      isFeintGiven: false,
    });
  });

  describe.each([
    [
      'before the feint (the drawn feintAt must survive)',
      async (sim: Sim) => {
        stepUntil(sim, () => roundOf(sim).state === 'telegraph');
        expect(roundOf(sim).isFeintGiven).toBe(false);
      },
      false,
    ],
    [
      'after the feint and before the signal (isFeintGiven must survive: no second feint)',
      async (sim: Sim) => {
        stepUntil(sim, () => roundOf(sim).isFeintGiven);
        expect(roundOf(sim).state).toBe('telegraph');
      },
      true,
    ],
  ] as const)('%s', (_name, bring, isFeintGivenAtSnapshot) => {
    it('restores to the same state and plays the same to the end, answered or not', async () => {
      for (const isAnswered of [true, false]) {
        const live = await started();
        await bring(live);
        const snapshot = roundTrip(live);
        const copy = await newSim();
        copy.restore(snapshot);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
        expect(roundOf(copy).feintAt).toBe(roundOf(live).feintAt);
        expect(roundOf(copy).feintAt).not.toBeNull();
        expect(roundOf(copy).isFeintGiven).toBe(isFeintGivenAtSnapshot);
        expect(roundOf(copy).windowOpenAt).toBe(roundOf(live).windowOpenAt);
        // To the end of the sequence or 40 s, whichever comes first, on both copies.
        let isPressed = false;
        const liveEvents: SimEvent[] = [];
        const copyEvents: SimEvent[] = [];
        for (let i = 0; i < 4000; i++) {
          liveEvents.push(...stepFor(live, 1));
          copyEvents.push(...stepFor(copy, 1));
          if (worldOf(live).sequence.id === null) break;
          if (isAnswered && !isPressed && roundOf(live).state === 'windowOpen') {
            isPressed = true;
            for (const sim of [live, copy]) pressCentre(sim);
          }
        }
        expect(worldOf(live).sequence.id).toBeNull();
        expect(copyEvents).toEqual(liveEvents);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
        // The feint given before the snapshot is not given again; one drawn and not given comes once,
        // before the signal (a later round, after a retreat, has a telegraph and a feint of its own).
        const signalIndex = copyEvents.findIndex((event) => event.type === 'WaitSignalGiven');
        expect(signalIndex).toBeGreaterThanOrEqual(0);
        expect(feintsIn(copyEvents.slice(0, signalIndex))).toHaveLength(
          isFeintGivenAtSnapshot ? 0 : 1,
        );
      }
    });
  });
});
