import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `bomb_drop_won` and `bomb_drop_released_early` are the stories they are there for (story 4.8): a drop
 * laid at the centre of the window and cashed in, and one let go too early, paid with a retreat.
 */
const content = createTestContent();
const geometry = createTestGeometry();

async function eventsOf(name: string): Promise<SimEvent[]> {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`missing scenario ${name}`);
  return (await recordScenario(content, geometry, scenario)).events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const wonEvents = await eventsOf('bomb_drop_won');
const earlyEvents = await eventsOf('bomb_drop_released_early');
const BOMB_DROP_ID = 2;

describe('golden scenario bomb_drop_won covers the drop it is there for', () => {
  it('starts at 10 ms, takes the baby, and telegraphs the descent after the 2 s rest', () => {
    expect(ofType(wonEvents, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: 10, id: 'bomb_drop' },
    ]);
    expect(ofType(wonEvents, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(wonEvents, 'ThreatTelegraphed').map((event) => event.t)).toEqual([2010]);
  });

  it('gives its signal at the pose, once, right before the window opens', () => {
    const names = wonEvents
      .filter((event) => event.type === 'WaitSignalGiven' || event.type === 'WindowOpened')
      .map((event) => `${event.type}@${event.t}`);
    expect(names).toEqual(['WaitSignalGiven@4610', 'WindowOpened@4610']);
  });

  it('answers at the centre of the window: one perfect response with an offset of 0, and no gag', () => {
    expect(ofType(wonEvents, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        response: 'firm',
        quality: 'perfect',
        offsetMs: 0,
        threatId: BOMB_DROP_ID,
      }),
    ]);
    expect(ofType(wonEvents, 'GagTriggered')).toEqual([]);
    expect(ofType(wonEvents, 'ResponseHeld')).toHaveLength(1);
  });

  it('lays the baby down and cashes the combo in, all in the step of the release', () => {
    const [resolved] = ofType(wonEvents, 'ResponseResolved');
    const at = resolved?.t;
    expect(ofType(wonEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: at, id: 'bomb_drop', outcome: 'succeeded' },
    ]);
    expect(ofType(wonEvents, 'BabyPutDown')).toEqual([{ type: 'BabyPutDown', t: at, safe: true }]);
    expect(ofType(wonEvents, 'ComboCashedIn')).toEqual([expect.objectContaining({ t: at })]);
    expect(ofType(wonEvents, 'SequenceStepRetreated')).toEqual([]);
  });
});

describe('golden scenario bomb_drop_released_early covers the retreat it is there for', () => {
  it('gags the early release, with the drop’s gag, and a cry', () => {
    expect(ofType(earlyEvents, 'GagTriggered')).toEqual([
      expect.objectContaining({
        threatId: BOMB_DROP_ID,
        gag: 'baby_woke_on_drop',
        reason: 'released',
      }),
    ]);
    expect(ofType(earlyEvents, 'BabyCrying').length).toBeGreaterThan(0);
  });

  it('retreats once, at step 0, and the descent starts over after the rest', () => {
    expect(ofType(earlyEvents, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 0, stepIndex: 0, retreats: 1, reason: 'released' }),
    ]);
    const telegraphs = ofType(earlyEvents, 'ThreatTelegraphed').map((event) => event.t);
    expect(telegraphs).toHaveLength(2);
    expect(telegraphs[1]).toBeGreaterThanOrEqual((telegraphs[0] ?? 0) + 2000);
  });

  it('ends won on the second descent, the baby laid and the combo cashed in', () => {
    expect(ofType(earlyEvents, 'ResponseResolved').map((event) => event.quality)).toEqual([
      'fail',
      'perfect',
    ]);
    expect(ofType(earlyEvents, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bomb_drop', outcome: 'succeeded' }),
    ]);
    expect(ofType(earlyEvents, 'BabyPutDown')).toEqual([expect.objectContaining({ safe: true })]);
    expect(ofType(earlyEvents, 'ComboCashedIn')).toHaveLength(1);
  });
});
