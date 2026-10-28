import { asSimMs } from '@shared/time';
import { createSim, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  createTestOutlet,
  FATIGUE_GAUGES,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { threatCueOf } from './threatFeedback.ts';

const outlet = createTestOutlet();
const defs = { [outlet.id]: outlet };
const world: World = (
  await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  })
).world;
const threatId = (world.threats[0] as { id: number }).id;
const t = asSimMs(1000);

const resolved = (quality: 'perfect' | 'success' | 'fail', id = threatId): SimEvent => ({
  type: 'ResponseResolved',
  t,
  threatId: id,
  response: 'parry',
  quality,
  offsetMs: quality === 'fail' ? null : 0,
});

describe('threatCueOf', () => {
  it('maps a telegraph to the def telegraph cue', () => {
    const event: SimEvent = {
      type: 'ThreatTelegraphed',
      t,
      threatId,
      kind: 'outlet',
      anchorId: 'outlet_01',
      waveIndex: 0,
    };
    expect(threatCueOf(event, world, defs)).toBe(outlet.feedback.telegraph);
  });

  it('maps a perfect response to the perfect cue and a success to the success cue', () => {
    expect(threatCueOf(resolved('perfect'), world, defs)).toBe(outlet.feedback.perfect);
    expect(threatCueOf(resolved('success'), world, defs)).toBe(outlet.feedback.success);
  });

  it('plays nothing for a failed response: its gag plays the cue, so a miss sounds once', () => {
    expect(threatCueOf(resolved('fail'), world, defs)).toBeNull();
    const gag: SimEvent = { type: 'GagTriggered', t, threatId, gag: 'outlet_hair', reason: 'late' };
    expect(threatCueOf(gag, world, defs)).toBe(outlet.feedback.gag);
  });

  it('plays nothing for any other event', () => {
    const others: SimEvent[] = [
      { type: 'WindowOpened', t, threatId },
      { type: 'ThreatRearmed', t, threatId },
      { type: 'PapaArrived', t, xM: 0, zM: 0 },
    ];
    for (const event of others) expect(threatCueOf(event, world, defs), event.type).toBeNull();
  });

  it('plays nothing for a threat the world or the defs do not know', () => {
    expect(threatCueOf(resolved('success', threatId + 99), world, defs)).toBeNull();
    expect(threatCueOf(resolved('success'), world, {})).toBeNull();
    const inherited = { ...world, threats: [{ ...world.threats[0], defId: 'constructor' }] };
    expect(threatCueOf(resolved('success'), inherited as World, defs)).toBeNull();
  });

  it('picks the cues of the def, whichever def it is (no code per threat)', () => {
    const other = {
      ...outlet,
      id: 'toaster',
      feedback: { telegraph: 'a', success: 'b', perfect: 'c', gag: 'd' },
    };
    const swapped = { ...world, threats: [{ ...world.threats[0], defId: 'toaster' }] } as World;
    expect(threatCueOf(resolved('perfect'), swapped, { toaster: other })).toBe('c');
  });
});

describe('threatCueOf for the micro-sleep (story 1.19)', () => {
  it('takes the cues of its own def: the micro-sleep telegraph, the parry cues, then the papa_asleep gag', async () => {
    const microSleep = createTestMicroSleep();
    const microWorld = (
      await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel({ gauges: FATIGUE_GAUGES }),
        seed: 1,
      })
    ).world;
    const id = (microWorld.threats[0] as { id: number }).id;
    const microDefs = { [microSleep.id]: microSleep };
    const telegraph: SimEvent = {
      type: 'ThreatTelegraphed',
      t,
      threatId: id,
      kind: 'papa_microsleep',
      anchorId: 'papa',
      waveIndex: -1,
    };
    expect(threatCueOf(telegraph, microWorld, microDefs)).toBe('tel_papa_microsleep');
    expect(threatCueOf(resolved('success', id), microWorld, microDefs)).toBe('resp_parry');
    expect(threatCueOf(resolved('perfect', id), microWorld, microDefs)).toBe('resp_parry_perfect');
    const gag: SimEvent = {
      type: 'GagTriggered',
      t,
      threatId: id,
      gag: 'papa_asleep',
      reason: 'late',
    };
    expect(threatCueOf(gag, microWorld, microDefs)).toBe('gag_papa_asleep');
  });
});
