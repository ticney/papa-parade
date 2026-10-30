import { STEP_MS } from '@shared/constants';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `stay_awake_held` and `stay_awake_dozed` are the stories they are there for (story 4.4): a
 * sequence that is won, with the baby put down and the director back after it, and a miss that
 * ends it with the snore, the wake and the noise.
 */
const content = createTestContent();
const geometry = createTestGeometry();
const { resumeGapMs } = content.feel.sequences;
const { snore } = content.feel.noise.sources;

async function eventsOf(name: string): Promise<SimEvent[]> {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return (await recordScenario(content, geometry, scenario)).events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const heldEvents = await eventsOf('stay_awake_held');
const dozedEvents = await eventsOf('stay_awake_dozed');

describe('golden scenario stay_awake_held covers the sequence it is there for', () => {
  const events = heldEvents;
  const microSleepIds = ofType(events, 'ThreatTelegraphed')
    .filter((event) => event.kind === 'papa_microsleep')
    .map((event) => event.t);

  it('starts at once, takes the baby and starts its first step, in the helpers order', () => {
    const start = events.filter((event) => event.t === STEP_MS);
    expect(start.map((event) => event.type).slice(0, 4)).toEqual([
      'BabyStateChanged',
      'BabyPickedUp',
      'SequenceStarted',
      'SequenceStepStarted',
    ]);
  });

  it('telegraphs a micro-sleep every 2.5 s, parries both at the centre of their window and ends won', () => {
    expect(microSleepIds).toEqual([2510, 5010]);
    const resolved = ofType(events, 'ResponseResolved').filter((event) => event.t < 8000);
    expect(resolved.map((event) => event.quality)).toEqual(['perfect', 'perfect']);
    expect(ofType(events, 'GagTriggered').filter((event) => event.t < 11000)).toEqual([]);
    expect(
      ofType(events, 'SequenceStepStarted').map((event) => [event.stepIndex, event.t]),
    ).toEqual([
      [0, STEP_MS],
      [1, 4010],
    ]);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 8010, id: 'stay_awake', outcome: 'succeeded' },
    ]);
  });

  it('draws nothing from the director until he is put down, then telegraphs the outlet at the pushed time', () => {
    const outlet = ofType(events, 'ThreatTelegraphed').filter((event) => event.kind === 'outlet');
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    expect(ofType(events, 'BabyPutDown')[0]?.t).toBe(8510);
    expect(outlet).toHaveLength(1);
    expect(outlet[0]?.t).toBe(8010 + resumeGapMs);
    expect(ofType(events, 'WaveStarted')).toEqual([
      { type: 'WaveStarted', t: STEP_MS, waveIndex: 0 },
    ]);
  });
});

describe('golden scenario stay_awake_dozed covers the failure it is there for', () => {
  const events = dozedEvents;

  it('misses the first micro-sleep: late, asleep, snore, wake, end, in that order', () => {
    const missAt = ofType(events, 'GagTriggered')[0]?.t ?? 0;
    const atMiss = events.filter((event) => event.t === missAt).map((event) => event.type);
    expect(atMiss).toEqual([
      'ResponseResolved',
      'GagTriggered',
      'PapaStateChanged',
      'PapaSnored',
      'BabyWoke',
      'SequenceEnded',
      'NoiseChanged',
    ]);
    expect(ofType(events, 'ResponseResolved')[0]).toMatchObject({
      quality: 'fail',
      reason: 'late',
    });
    expect(ofType(events, 'GagTriggered')[0]).toMatchObject({ gag: 'papa_asleep' });
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed', t: missAt });
  });

  it('adds the snore noise, exactly noisePct, and the baby stays carried', () => {
    const noise = ofType(events, 'NoiseChanged').filter((event) => event.source === 'snore');
    expect(noise).toHaveLength(1);
    expect(noise[0]?.deltaPct).toBeCloseTo(snore.noisePct, 9);
    expect(ofType(events, 'BabyPutDown')).toEqual([]);
  });

  it('wakes Papa asleep.asleepMs later', () => {
    const asleep = ofType(events, 'PapaStateChanged').filter((event) => event.to === 'asleep');
    const awake = ofType(events, 'PapaStateChanged').filter((event) => event.from === 'asleep');
    expect(asleep).toHaveLength(1);
    expect(awake).toHaveLength(1);
    expect((awake[0]?.t ?? 0) - (asleep[0]?.t ?? 0)).toBe(content.feel.fatigue.asleepMs);
  });
});
