import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';
import { recordScenario, SCENARIOS } from './scenarios.ts';

/**
 * The golden compares hashes, which say nothing about what a scenario exercises. This pins that
 * `stealth_exit_won` and `stealth_exit_touched_sigh` are the stories they are there for (story 4.9): a
 * crossing with a false alarm sat through (breath held to the end of its window, three boards creaked),
 * and a crossing lost by touching the false alarm.
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

const wonEvents = await eventsOf('stealth_exit_won');
const touchedEvents = await eventsOf('stealth_exit_touched_sigh');
const FALSE_ALARM_ID = 2;

describe('golden scenario stealth_exit_won covers the crossing it is there for', () => {
  it('starts at 10 ms and puts Papa and the baby over the playpen', () => {
    expect(ofType(wonEvents, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: 10, id: 'stealth_exit' },
    ]);
  });

  it('creaks once for each of the three boards on the way', () => {
    expect(ofType(wonEvents, 'FloorCreaked').map((event) => event.zoneId)).toEqual([
      'board_01',
      'board_02',
      'board_03',
    ]);
    expect(
      ofType(wonEvents, 'NoiseChanged').filter((event) => event.source === 'floorCreak'),
    ).toHaveLength(3);
  });

  it('meets the false alarm at 4350 and sits it through: a success at the end of its 2000 ms, never a gag', () => {
    expect(ofType(wonEvents, 'ThreatTelegraphed')).toEqual([
      expect.objectContaining({ t: 4350, kind: 'false_alarm_sigh', threatId: FALSE_ALARM_ID }),
    ]);
    expect(ofType(wonEvents, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        t: 7250,
        response: 'nothing',
        quality: 'success',
        offsetMs: 0,
        threatId: FALSE_ALARM_ID,
      }),
    ]);
    expect(ofType(wonEvents, 'GagTriggered')).toEqual([]);
  });

  it('holds the breath through the whole window and lets go at its very end: no gasp', () => {
    expect(ofType(wonEvents, 'BreathHeld')).toHaveLength(1);
    // Stamped 7250, the end of the window; the step that applies it is the next one, once the alert is over.
    expect(ofType(wonEvents, 'BreathReleased')).toEqual([{ type: 'BreathReleased', t: 7260 }]);
    expect(ofType(wonEvents, 'BreathGasped')).toEqual([]);
  });

  it('leaves only the step after the alert is over: the door is reached at 5820 but the exit waits', () => {
    expect(ofType(wonEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 7260, id: 'stealth_exit', outcome: 'succeeded' },
    ]);
  });
});

describe('golden scenario stealth_exit_touched_sigh covers the touch it is there for', () => {
  it('gags the press on the false alarm as acted, with the touch gag, and a cry', () => {
    expect(ofType(touchedEvents, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        response: 'nothing',
        quality: 'fail',
        reason: 'acted',
        offsetMs: null,
        threatId: FALSE_ALARM_ID,
      }),
    ]);
    expect(ofType(touchedEvents, 'GagTriggered')).toEqual([
      expect.objectContaining({
        gag: 'baby_woke_by_touch',
        reason: 'acted',
        threatId: FALSE_ALARM_ID,
      }),
    ]);
    expect(ofType(touchedEvents, 'BabyCrying').length).toBeGreaterThan(0);
  });

  it('loses the sequence in the step of the touch, with no snore and no wake of the sequence’s own', () => {
    const [gag] = ofType(touchedEvents, 'GagTriggered');
    expect(ofType(touchedEvents, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: gag?.t, id: 'stealth_exit', outcome: 'failed' },
    ]);
    expect(ofType(touchedEvents, 'PapaSnored')).toEqual([]);
    expect(ofType(touchedEvents, 'BabyWoke')).toEqual([]);
  });
});
