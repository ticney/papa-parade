import type { BeatsStep } from '@content/schemas/sequence';
import { beatTimelineOf, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLullabyWalk,
} from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `lullaby_walk_kept` and `lullaby_walk_woken` are the stories they are there for (story 4.5): a
 * walk in time that the baby sleeps through after two stirs, and a walk that wakes him.
 */
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestLullabyWalk();
const TIMELINE = beatTimelineOf(DEF.steps[0] as BeatsStep);
const JUDGED = TIMELINE.filter((entry) => entry.kind === 'beat').length;
const { missWakePct, decoyWakePct, strayWakePct } =
  DEF.failure.kind === 'babyAwake'
    ? DEF.failure
    : { missWakePct: 0, decoyWakePct: 0, strayWakePct: 0 };

async function eventsOf(name: string): Promise<SimEvent[]> {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return (await recordScenario(content, geometry, scenario)).events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const keptEvents = await eventsOf('lullaby_walk_kept');
const wokenEvents = await eventsOf('lullaby_walk_woken');

describe('golden scenario lullaby_walk_kept covers the walk it is there for', () => {
  it('starts at 10 ms, takes the baby and runs the beats step', () => {
    expect(ofType(keptEvents, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: 10, id: 'lullaby_walk' },
    ]);
    expect(ofType(keptEvents, 'BabyPickedUp')).toHaveLength(1);
  });

  it('hits every beat but one, with the early and late offsets it taps at', () => {
    const hits = ofType(keptEvents, 'BeatHit');
    expect(hits).toHaveLength(JUDGED - 1);
    expect(new Set(hits.map((hit) => hit.offsetMs))).toEqual(new Set([-30, 30]));
    expect(hits.map((hit) => hit.judgedIndex)).not.toContain(6);
    expect(ofType(keptEvents, 'BeatMissed')).toEqual([expect.objectContaining({ judgedIndex: 6 })]);
  });

  it('stirs the baby twice, a stray and a miss, and he sleeps on', () => {
    expect(ofType(keptEvents, 'BabyStirred').map((e) => [e.reason, e.wakePct])).toEqual([
      ['stray', strayWakePct],
      ['missed', strayWakePct + missWakePct],
    ]);
    expect(ofType(keptEvents, 'BabyWoke')).toEqual([]);
  });

  it('announces every note, the count-in and the decoy included, once', () => {
    const cues = keptEvents.filter((e) => e.type === 'BeatCued' || e.type === 'DecoyCued');
    expect(cues).toHaveLength(TIMELINE.length);
    expect(ofType(keptEvents, 'DecoyCued')).toHaveLength(1);
  });

  it('ends won at the end of the step, with the baby still carried and no gag', () => {
    expect(ofType(keptEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 10_010, id: 'lullaby_walk', outcome: 'succeeded' },
    ]);
    expect(ofType(keptEvents, 'BabyPutDown')).toEqual([]);
    expect(ofType(keptEvents, 'GagTriggered')).toEqual([]);
  });
});

describe('golden scenario lullaby_walk_woken covers the failure it is there for', () => {
  it('taps the decoy, misses two beats and a stray tap takes the wake to 100, in that order', () => {
    const stirs = ofType(wokenEvents, 'BabyStirred');
    expect(stirs.map((e) => [e.reason, e.wakePct])).toEqual([
      ['decoy', decoyWakePct],
      ['missed', decoyWakePct + missWakePct],
      ['missed', decoyWakePct + 2 * missWakePct],
      ['stray', 100],
    ]);
    expect(ofType(wokenEvents, 'DecoyTapped')).toHaveLength(1);
    expect(ofType(wokenEvents, 'BeatHit')).toHaveLength(5);
  });

  it('wakes him, ends the sequence lost and plays no snore, in that order', () => {
    const wokeAt = ofType(wokenEvents, 'BabyWoke')[0]?.t ?? 0;
    const atWake = wokenEvents.filter((e) => e.t === wokeAt).map((e) => e.type);
    expect(atWake).toEqual(['BeatStrayTapped', 'BabyStirred', 'BabyWoke', 'SequenceEnded']);
    expect(ofType(wokenEvents, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
    expect(wokenEvents.some((e) => e.type === 'PapaSnored')).toBe(false);
  });

  it('keeps the baby in the arms: he woke, he did not cry', () => {
    expect(ofType(wokenEvents, 'BabyPutDown')).toEqual([]);
    expect(ofType(wokenEvents, 'BabyCrying')).toEqual([]);
  });
});
