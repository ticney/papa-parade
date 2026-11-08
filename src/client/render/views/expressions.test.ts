import { readFileSync } from 'node:fs';
import { PAPA_TARGET_ANCHOR_ID } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import testFeel from '../../../../tests/support/testFeel.json';
import {
  type BabyExpression,
  type BabyFace,
  babyExpressionAt,
  clearExpressions,
  createFaceTrack,
  type FaceTrack,
  noteBabyEvent,
  notePapaEvent,
  type PapaExpression,
  type PapaFace,
  papaExpressionAt,
} from './expressions.ts';

const FEEL = testFeel.characters.expressions;
const PAPA = FEEL.papa;
const BABY = FEEL.baby;

type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const WINDOW = {
  startOffsetMs: 0,
  endOffsetMs: 0,
  perfectHalfMs: 0,
} as unknown as EventOf<'ResponseResolved'>['responseWindow'];

const telegraph = (t: number, anchorId = 'outlet_1', threatId = 1): SimEvent => ({
  type: 'ThreatTelegraphed',
  t: asSimMs(t),
  threatId,
  kind: 'outlet',
  anchorId,
  waveIndex: 0,
});
const held = (t: number, threatId = 1): SimEvent => ({
  type: 'ResponseHeld',
  t: asSimMs(t),
  threatId,
});
const resolved = (
  t: number,
  quality: 'perfect' | 'success' | 'fail',
  response: 'parry' | 'firm' | 'wait' = 'firm',
  threatId = 1,
): SimEvent => ({
  type: 'ResponseResolved',
  t: asSimMs(t),
  threatId,
  response,
  quality,
  offsetMs: 0,
  responseWindow: WINDOW,
});
const gag = (t: number, threatId = 1): SimEvent =>
  ({
    type: 'GagTriggered',
    t: asSimMs(t),
    threatId,
    gag: 'shock',
    reason: 'late',
  }) as unknown as SimEvent;
const beat = (t: number, quality: 'perfect' | 'success' | 'fail'): SimEvent => ({
  type: 'ChoreBeatJudged',
  t: asSimMs(t),
  choreIndex: 0,
  beatIndex: 0,
  quality,
  reason: null,
  offsetMs: 0,
});
const cancelled = (t: number, threatId = 1): SimEvent =>
  ({ type: 'ThreatCancelled', t: asSimMs(t), threatId, reason: 'carried' }) as unknown as SimEvent;

/** A Papa track fed `events`, read at `nowMs` (not tired, no guard). */
function papaAfter(events: SimEvent[], nowMs: number, isAsleep = false): PapaFace {
  const track = createFaceTrack<PapaExpression>();
  for (const event of events) notePapaEvent(track, event, isAsleep, PAPA);
  return papaExpressionAt(track, nowMs, false, false);
}

function babyAfter(events: SimEvent[], nowMs: number): BabyFace {
  const track = createFaceTrack<BabyExpression>();
  for (const event of events) noteBabyEvent(track, event, BABY);
  return babyExpressionAt(track, nowMs, false, false, false);
}

describe('the triggers of D4, one row each', () => {
  it('a telegraph surprises Papa for surprisedMs', () => {
    expect(papaAfter([telegraph(1000)], 1000)).toBe('surprised');
    expect(papaAfter([telegraph(1000)], 1000 + PAPA.surprisedMs - 1)).toBe('surprised');
    expect(papaAfter([telegraph(1000)], 1000 + PAPA.surprisedMs)).toBe('neutral');
  });

  it('a held press frowns Papa until its threat is resolved, then firmAfterMs more on a success', () => {
    const events = [held(1000), resolved(1500, 'success')];
    expect(papaAfter([held(1000)], 60_000)).toBe('firm');
    expect(papaAfter(events, 1500 + PAPA.firmAfterMs - 1)).toBe('firm');
    expect(papaAfter(events, 1500 + PAPA.firmAfterMs)).toBe('neutral');
  });

  it('a perfect response or a perfect chore beat makes Papa proud for proudMs', () => {
    expect(papaAfter([resolved(1000, 'perfect', 'parry')], 1000 + PAPA.proudMs - 1)).toBe('proud');
    expect(papaAfter([resolved(1000, 'perfect', 'parry')], 1000 + PAPA.proudMs)).toBe('neutral');
    expect(papaAfter([beat(1000, 'perfect')], 1000)).toBe('proud');
  });

  it('Papa is tired while the scene says so, and only then', () => {
    const track = createFaceTrack<PapaExpression>();
    expect(papaExpressionAt(track, 0, true, false)).toBe('tired');
    expect(papaExpressionAt(track, 10, false, false)).toBe('neutral');
  });

  it.each<[string, SimEvent]>([
    ['being picked up', { type: 'BabyPickedUp', t: asSimMs(1000) }],
    ['a gag', gag(1000)],
    [
      'a combo cashed in',
      { type: 'ComboCashedIn', t: asSimMs(1000), multiplier: 2, basePoints: 10, points: 20 },
    ],
    ['a perfect response', resolved(1000, 'perfect', 'parry')],
    ['a perfect chore beat', beat(1000, 'perfect')],
  ])('%s delights the baby for delightedMs', (_name, event) => {
    expect(babyAfter([event], 1000 + BABY.delightedMs - 1)).toBe('delighted');
    expect(babyAfter([event], 1000 + BABY.delightedMs)).toBe('neutral');
  });

  it('a successful Firmness makes the baby sulk for sulkyMs', () => {
    expect(babyAfter([resolved(1000, 'success', 'firm')], 1000)).toBe('sulky');
    expect(babyAfter([resolved(1000, 'success', 'firm')], 1000 + BABY.sulkyMs)).toBe('neutral');
  });

  it('the baby is focused, then sleepy, as the scene says; focus wins over sleep', () => {
    const track = createFaceTrack<BabyExpression>();
    expect(babyExpressionAt(track, 0, true, false, false)).toBe('focused');
    expect(babyExpressionAt(track, 10, false, true, false)).toBe('sleepy');
    expect(babyExpressionAt(track, 20, true, true, false)).toBe('focused');
    expect(babyExpressionAt(track, 30, false, false, false)).toBe('neutral');
  });
});

describe('the exclusions of D4', () => {
  it('a telegraph of a threat on Papa (his micro-sleep) starts nothing', () => {
    expect(papaAfter([telegraph(1000, PAPA_TARGET_ANCHOR_ID)], 1000)).toBe('neutral');
  });

  it('a telegraph while Papa is asleep starts nothing', () => {
    expect(papaAfter([telegraph(1000)], 1000, true)).toBe('neutral');
  });

  it.each<[string, SimEvent]>([
    [
      'ThreatHidden',
      {
        type: 'ThreatHidden',
        t: asSimMs(1000),
        threatId: 1,
        kind: 'x',
        anchorId: 'a',
        waveIndex: 0,
      },
    ],
    ['SilenceStarted', { type: 'SilenceStarted', t: asSimMs(1000), threatId: 1 }],
    [
      'ChoreBeatTelegraphed',
      {
        type: 'ChoreBeatTelegraphed',
        t: asSimMs(1000),
        choreIndex: 0,
        beatIndex: 0,
        windowOpenAt: asSimMs(1500),
      },
    ],
    ['WaitFeintGiven', { type: 'WaitFeintGiven', t: asSimMs(1000), threatId: 1 }],
    ['WaitSignalGiven', { type: 'WaitSignalGiven', t: asSimMs(1000), threatId: 1 }],
    ['DecoyCued', { type: 'DecoyCued', t: asSimMs(1000), entryIndex: 0 }],
    ['a successful parry', resolved(1000, 'success', 'parry')],
    ['a failed response', resolved(1000, 'fail', 'firm')],
    ['a chore beat that is only a success', beat(1000, 'success')],
  ])('%s starts nothing on either face', (_name, event) => {
    expect(papaAfter([event], 1000)).toBe('neutral');
    expect(babyAfter([event], 1000)).toBe('neutral');
  });

  it('a perfect Firmness makes Papa proud and the baby delighted, never sulky', () => {
    const events = [held(900), resolved(1000, 'perfect', 'firm')];
    expect(papaAfter(events, 1000)).toBe('proud');
    expect(babyAfter(events, 1000)).toBe('delighted');
  });
});

describe('the most recent wins (D3)', () => {
  it('of two moments, the later one shows, both ways', () => {
    expect(papaAfter([telegraph(1000), resolved(1100, 'perfect', 'parry')], 1200)).toBe('proud');
    expect(papaAfter([resolved(1000, 'perfect', 'parry'), telegraph(1100, 'stove')], 1200)).toBe(
      'surprised',
    );
    expect(
      babyAfter(
        [resolved(1000, 'success', 'firm'), { type: 'BabyPickedUp', t: asSimMs(1100) }],
        1200,
      ),
    ).toBe('delighted');
    expect(
      babyAfter(
        [{ type: 'BabyPickedUp', t: asSimMs(1000) }, resolved(1100, 'success', 'firm')],
        1200,
      ),
    ).toBe('sulky');
  });

  it('a lasting state shows again when the moment that covered it is over', () => {
    const track = createFaceTrack<PapaExpression>();
    expect(papaExpressionAt(track, 500, true, false)).toBe('tired');
    notePapaEvent(track, telegraph(1000), false, PAPA);
    expect(papaExpressionAt(track, 1000, true, false)).toBe('surprised');
    expect(papaExpressionAt(track, 1000 + PAPA.surprisedMs, true, false)).toBe('tired');
  });

  it('a lasting state that starts after a moment covers it, and the moment does not come back', () => {
    const track = createFaceTrack<BabyExpression>();
    noteBabyEvent(track, { type: 'BabyPickedUp', t: asSimMs(1000) }, BABY);
    expect(babyExpressionAt(track, 1010, false, false, false)).toBe('delighted');
    expect(babyExpressionAt(track, 1020, true, false, false)).toBe('focused');
    // The focus ends while the delight would still run: it is over in the player's eyes.
    expect(babyExpressionAt(track, 1030, false, false, false)).toBe('neutral');
  });

  it('a lasting state that ends starts nothing', () => {
    const track = createFaceTrack<PapaExpression>();
    notePapaEvent(track, telegraph(1000), false, PAPA);
    expect(papaExpressionAt(track, 1010, true, false)).toBe('tired');
    expect(papaExpressionAt(track, 1020, false, false)).toBe('neutral');
  });
});

describe("Papa's held frown (D3)", () => {
  it('ends at once on a fail of its threat', () => {
    expect(papaAfter([held(1000), resolved(1500, 'fail')], 1500)).toBe('neutral');
  });

  it('ends at once on a ThreatCancelled of its threat', () => {
    expect(papaAfter([held(1000), cancelled(1500)], 1500)).toBe('neutral');
  });

  it("ignores another threat's resolution or cancel", () => {
    expect(papaAfter([held(1000, 1), resolved(1500, 'fail', 'firm', 2)], 1600)).toBe('firm');
    expect(papaAfter([held(1000, 1), cancelled(1500, 2)], 1600)).toBe('firm');
  });

  it('turns proud on a perfect', () => {
    expect(papaAfter([held(1000), resolved(1500, 'perfect')], 1500)).toBe('proud');
  });
});

describe("a gag cuts Papa's moment (D15)", () => {
  it.each<[string, SimEvent[]]>([
    ['his surprise', [telegraph(1000)]],
    ['his pride', [resolved(1000, 'perfect', 'parry')]],
    ['his held frown', [held(1000)]],
  ])('%s ends at the gag', (_name, events) => {
    expect(papaAfter([...events, gag(1100, 9)], 1100)).toBe('neutral');
  });

  it('his lasting fatigue still shows', () => {
    const track = createFaceTrack<PapaExpression>();
    notePapaEvent(track, resolved(1000, 'perfect', 'parry'), false, PAPA);
    notePapaEvent(track, gag(1100), false, PAPA);
    expect(papaExpressionAt(track, 1100, true, false)).toBe('tired');
  });
});

describe('only the signals count (D5)', () => {
  it('the guard shows both at rest, drops the moments and forgets the lasting states', () => {
    const papa = createFaceTrack<PapaExpression>();
    const baby = createFaceTrack<BabyExpression>();
    notePapaEvent(papa, telegraph(1000), false, PAPA);
    noteBabyEvent(baby, { type: 'BabyPickedUp', t: asSimMs(1000) }, BABY);
    expect(papaExpressionAt(papa, 1010, true, true)).toBe('neutral');
    expect(babyExpressionAt(baby, 1010, true, true, true)).toBe('neutral');
    // The guard ends: the dropped moments do not come back; a lasting state still there starts again.
    expect(papaExpressionAt(papa, 1020, false, false)).toBe('neutral');
    expect(babyExpressionAt(baby, 1020, false, false, false)).toBe('neutral');
    expect(papaExpressionAt(papa, 1030, true, false)).toBe('tired');
    expect(babyExpressionAt(baby, 1030, false, true, false)).toBe('sleepy');
  });
});

describe('reproducible', () => {
  it('clearExpressions puts the faces at rest', () => {
    const track: FaceTrack<PapaExpression> = createFaceTrack();
    notePapaEvent(track, held(1000), false, PAPA);
    papaExpressionAt(track, 1000, true, false);
    clearExpressions(track);
    expect(papaExpressionAt(track, 1010, false, false)).toBe('neutral');
  });

  it('the same events twice give the same faces', () => {
    const events: SimEvent[] = [
      telegraph(100),
      held(300),
      resolved(500, 'success'),
      { type: 'BabyPickedUp', t: asSimMs(700) },
      gag(900),
      beat(1100, 'perfect'),
    ];
    const play = (): string[] => {
      const papa = createFaceTrack<PapaExpression>();
      const baby = createFaceTrack<BabyExpression>();
      const faces: string[] = [];
      let next = 0;
      for (let nowMs = 0; nowMs < 4000; nowMs += 10) {
        while (next < events.length && (events[next] as SimEvent).t <= nowMs) {
          notePapaEvent(papa, events[next] as SimEvent, false, PAPA);
          noteBabyEvent(baby, events[next] as SimEvent, BABY);
          next++;
        }
        faces.push(
          papaExpressionAt(papa, nowMs, nowMs > 2000, false),
          babyExpressionAt(baby, nowMs, nowMs > 3000, false, false),
        );
      }
      return faces;
    };
    expect(hashJson(play())).toBe(hashJson(play()));
  });
});

describe('the laugh coupling (D4)', () => {
  it('the cues that layer his laugh are exactly the five whose events delight him', () => {
    const feedback = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
      cues: Record<string, { layers?: { clip: string }[] }>;
    };
    const laughing = Object.entries(feedback.cues)
      .filter(([, cue]) => (cue.layers ?? []).some((layer) => layer.clip === 'baby_laugh_perfect'))
      .map(([id]) => id)
      .sort();
    // A new laughing cue fails here until its event is added to D4 (`noteBabyEvent`).
    expect(laughing).toEqual(
      [
        'chore_beat_perfect',
        'combo_cashed_in',
        'resp_firm_perfect',
        'resp_parry_perfect',
        'resp_wait_perfect',
      ].sort(),
    );
  });
});
