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

/**
 * Papa's face at `nowMs`, read from a world whose sim time is `simMs`: the same with no render leftover
 * (the default), later when the frame is read between two steps (`nowMs` over `simMs`).
 */
function papaFaceAt(
  track: FaceTrack<PapaExpression>,
  nowMs: number,
  isTired: boolean,
  isSignalOnly: boolean,
  simMs = nowMs,
): PapaFace {
  return papaExpressionAt(track, nowMs, simMs, isTired, isSignalOnly);
}

function babyFaceAt(
  track: FaceTrack<BabyExpression>,
  nowMs: number,
  isFocused: boolean,
  isSleepy: boolean,
  isSignalOnly: boolean,
  simMs = nowMs,
): BabyFace {
  return babyExpressionAt(track, nowMs, simMs, isFocused, isSleepy, isSignalOnly);
}

/** A Papa track fed `events`, read at `nowMs` (not tired, no guard). */
function papaAfter(events: SimEvent[], nowMs: number, isAsleep = false): PapaFace {
  const track = createFaceTrack<PapaExpression>();
  for (const event of events) notePapaEvent(track, event, isAsleep, PAPA);
  return papaFaceAt(track, nowMs, false, false);
}

function babyAfter(events: SimEvent[], nowMs: number): BabyFace {
  const track = createFaceTrack<BabyExpression>();
  for (const event of events) noteBabyEvent(track, event, BABY);
  return babyFaceAt(track, nowMs, false, false, false);
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
    expect(papaFaceAt(track, 0, true, false)).toBe('tired');
    expect(papaFaceAt(track, 10, false, false)).toBe('neutral');
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
    expect(babyFaceAt(track, 0, true, false, false)).toBe('focused');
    expect(babyFaceAt(track, 10, false, true, false)).toBe('sleepy');
    expect(babyFaceAt(track, 20, true, true, false)).toBe('focused');
    expect(babyFaceAt(track, 30, false, false, false)).toBe('neutral');
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
    expect(papaFaceAt(track, 500, true, false)).toBe('tired');
    notePapaEvent(track, telegraph(1000), false, PAPA);
    expect(papaFaceAt(track, 1000, true, false)).toBe('surprised');
    expect(papaFaceAt(track, 1000 + PAPA.surprisedMs, true, false)).toBe('tired');
  });

  it('a lasting state that starts after a moment covers it, and the moment does not come back', () => {
    const track = createFaceTrack<BabyExpression>();
    noteBabyEvent(track, { type: 'BabyPickedUp', t: asSimMs(1000) }, BABY);
    expect(babyFaceAt(track, 1010, false, false, false)).toBe('delighted');
    expect(babyFaceAt(track, 1020, true, false, false)).toBe('focused');
    // The focus ends while the delight would still run: it is over in the player's eyes.
    expect(babyFaceAt(track, 1030, false, false, false)).toBe('neutral');
  });

  it('a lasting state that ends starts nothing', () => {
    const track = createFaceTrack<PapaExpression>();
    notePapaEvent(track, telegraph(1000), false, PAPA);
    expect(papaFaceAt(track, 1010, true, false)).toBe('tired');
    expect(papaFaceAt(track, 1020, false, false)).toBe('neutral');
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

  it('comes back after a surprise at another threat, while its threat is still held', () => {
    const events = [held(1000), telegraph(1500, 'stove', 2)];
    expect(papaAfter([held(1000)], 1400)).toBe('firm');
    expect(papaAfter(events, 1500)).toBe('surprised');
    expect(papaAfter(events, 1500 + PAPA.surprisedMs - 1)).toBe('surprised');
    expect(papaAfter(events, 1500 + PAPA.surprisedMs)).toBe('firm');
    expect(papaAfter(events, 60_000)).toBe('firm');
  });

  it('comes back after the pride of another threat, and ends with its own threat', () => {
    const events = [held(1000, 1), resolved(1500, 'perfect', 'parry', 2)];
    expect(papaAfter(events, 1600)).toBe('proud');
    expect(papaAfter(events, 1500 + PAPA.proudMs)).toBe('firm');
    const ended = [...events, resolved(5000, 'success', 'firm', 1)];
    expect(papaAfter(ended, 5000 + PAPA.firmAfterMs - 1)).toBe('firm');
    expect(papaAfter(ended, 5000 + PAPA.firmAfterMs)).toBe('neutral');
  });

  it('ends with its threat while a surprise still runs: nothing comes back after it', () => {
    const events = [held(1000), telegraph(1500, 'stove', 2), resolved(1600, 'fail')];
    expect(papaAfter(events, 1700)).toBe('surprised');
    expect(papaAfter(events, 1500 + PAPA.surprisedMs)).toBe('neutral');
    const succeeded = [held(1000), telegraph(1500, 'stove', 2), resolved(1600, 'success')];
    expect(papaAfter(succeeded, 1600 + PAPA.firmAfterMs)).toBe('surprised');
    expect(papaAfter(succeeded, 1500 + PAPA.surprisedMs)).toBe('neutral');
  });

  it('is covered by a lasting state that begins after it, and shows over one that began before', () => {
    const before = createFaceTrack<PapaExpression>();
    expect(papaFaceAt(before, 500, true, false)).toBe('tired');
    notePapaEvent(before, held(1000), false, PAPA);
    expect(papaFaceAt(before, 1010, true, false)).toBe('firm');
    expect(papaFaceAt(before, 1020, false, false)).toBe('firm');
    const after = createFaceTrack<PapaExpression>();
    notePapaEvent(after, held(1000), false, PAPA);
    expect(papaFaceAt(after, 1010, false, false)).toBe('firm');
    expect(papaFaceAt(after, 1020, true, false)).toBe('tired');
  });

  it('is dropped by the guard of the signals and does not come back', () => {
    const track = createFaceTrack<PapaExpression>();
    notePapaEvent(track, held(1000), false, PAPA);
    expect(papaFaceAt(track, 1010, false, true)).toBe('neutral');
    expect(papaFaceAt(track, 1020, false, false)).toBe('neutral');
  });

  it('is cut by the gag of any threat, even while a surprise covers it', () => {
    const track = createFaceTrack<PapaExpression>();
    notePapaEvent(track, held(1000), false, PAPA);
    notePapaEvent(track, telegraph(1100, 'stove', 2), false, PAPA);
    notePapaEvent(track, gag(1200, 9), false, PAPA);
    expect(papaFaceAt(track, 1200, false, false)).toBe('neutral');
    expect(papaFaceAt(track, 1100 + PAPA.surprisedMs, false, false)).toBe('neutral');
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
    expect(papaFaceAt(track, 1100, true, false)).toBe('tired');
  });
});

describe('only the signals count (D5)', () => {
  it('the guard shows both at rest, drops the moments and forgets the lasting states', () => {
    const papa = createFaceTrack<PapaExpression>();
    const baby = createFaceTrack<BabyExpression>();
    notePapaEvent(papa, telegraph(1000), false, PAPA);
    noteBabyEvent(baby, { type: 'BabyPickedUp', t: asSimMs(1000) }, BABY);
    expect(papaFaceAt(papa, 1010, true, true)).toBe('neutral');
    expect(babyFaceAt(baby, 1010, true, true, true)).toBe('neutral');
    // The guard ends: the dropped moments do not come back; a lasting state still there starts again.
    expect(papaFaceAt(papa, 1020, false, false)).toBe('neutral');
    expect(babyFaceAt(baby, 1020, false, false, false)).toBe('neutral');
    expect(papaFaceAt(papa, 1030, true, false)).toBe('tired');
    expect(babyFaceAt(baby, 1030, false, true, false)).toBe('sleepy');
  });
});

describe('the baby in a bedtime level (D3, D8)', () => {
  // `sleepy` holds all along; the focus begins and ends over it. A focus that ends is a fall back to
  // `sleepy`, which begins nothing: the moment that ended it (a perfect, a Firmness) keeps showing. The frame
  // that sees the focus end reads the world a step after the event (two steps in a frame at 30 fps), so a
  // fall that was dated as a beginning would cover the moment.
  const focusedThen = (event: SimEvent, simMs: number, nowMs: number) => {
    const track = createFaceTrack<BabyExpression>();
    expect(babyFaceAt(track, 500, false, true, false)).toBe('sleepy');
    expect(babyFaceAt(track, 1000, true, true, false)).toBe('focused');
    noteBabyEvent(track, event, BABY);
    return { track, face: babyFaceAt(track, nowMs, false, true, false, simMs) };
  };

  it.each([0, 0.5, 0.99])(
    'a perfect that ends the focus delights him, then he is sleepy again (leftover %s of a step)',
    (alpha) => {
      const at = (sinceMs: number) => 2000 + sinceMs + alpha * 10;
      const { track, face } = focusedThen(resolved(2000, 'perfect', 'parry'), 2010, at(10));
      expect(face).toBe('delighted');
      expect(
        babyFaceAt(
          track,
          at(BABY.delightedMs - 20),
          false,
          true,
          false,
          2000 + BABY.delightedMs - 20,
        ),
      ).toBe('delighted');
      expect(
        babyFaceAt(track, at(BABY.delightedMs), false, true, false, 2000 + BABY.delightedMs),
      ).toBe('sleepy');
    },
  );

  it('a Firmness that ends the focus makes him sulk, then he is sleepy again', () => {
    const { track, face } = focusedThen(resolved(2000, 'success', 'firm'), 2010, 2015);
    expect(face).toBe('sulky');
    expect(babyFaceAt(track, 2000 + BABY.sulkyMs, false, true, false)).toBe('sleepy');
  });

  it('a focus that begins covers the moment that started before it, and that moment does not come back', () => {
    const track = createFaceTrack<BabyExpression>();
    expect(babyFaceAt(track, 500, false, true, false)).toBe('sleepy');
    noteBabyEvent(track, { type: 'BabyPickedUp', t: asSimMs(1000) }, BABY);
    expect(babyFaceAt(track, 1005, false, true, false, 1000)).toBe('delighted');
    expect(babyFaceAt(track, 1105, true, true, false, 1100)).toBe('focused');
    expect(babyFaceAt(track, 1205, false, true, false, 1200)).toBe('sleepy');
  });

  it('the end of the guard is a return of his sleep, not a beginning: the last result of a duel still delights him', () => {
    const track = createFaceTrack<BabyExpression>();
    expect(babyFaceAt(track, 900, false, true, true)).toBe('neutral');
    // The result is the first step of the frame in which the guard ends: the frame reads the world a step
    // later, and the sleep that returns must not cover it.
    noteBabyEvent(track, resolved(1000, 'perfect', 'wait'), BABY);
    expect(babyFaceAt(track, 1015, false, true, false, 1010)).toBe('delighted');
    expect(babyFaceAt(track, 1000 + BABY.delightedMs, false, true, false)).toBe('sleepy');
  });

  it("Papa's fatigue returns with the guard the same way", () => {
    const track = createFaceTrack<PapaExpression>();
    expect(papaFaceAt(track, 900, true, true)).toBe('neutral');
    notePapaEvent(track, resolved(1000, 'perfect', 'wait'), false, PAPA);
    expect(papaFaceAt(track, 1015, true, false, 1010)).toBe('proud');
    expect(papaFaceAt(track, 1000 + PAPA.proudMs, true, false)).toBe('tired');
  });
});

describe('the leftover of a step does not change which faces show', () => {
  it.each([0, 0.5, 0.99])('a lasting state and a moment in one frame, leftover %s', (alpha) => {
    const track = createFaceTrack<PapaExpression>();
    // Tired begins at sim time 2000; his pride is noted at 2000 too, and shows (the later or equal).
    notePapaEvent(track, resolved(2000, 'perfect', 'parry'), false, PAPA);
    expect(papaFaceAt(track, 2000 + alpha * 10, true, false, 2000)).toBe('proud');
    // A moment noted before the step that made him tired is covered, whatever the leftover.
    const earlier = createFaceTrack<PapaExpression>();
    notePapaEvent(earlier, resolved(1990, 'perfect', 'parry'), false, PAPA);
    expect(papaFaceAt(earlier, 2000 + alpha * 10, true, false, 2000)).toBe('tired');
  });
});

describe('reproducible', () => {
  it('clearExpressions puts the faces at rest', () => {
    const track: FaceTrack<PapaExpression> = createFaceTrack();
    notePapaEvent(track, held(1000), false, PAPA);
    papaFaceAt(track, 1000, true, false);
    clearExpressions(track);
    expect(papaFaceAt(track, 1010, false, false)).toBe('neutral');
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
          papaFaceAt(papa, nowMs, nowMs > 2000, false),
          babyFaceAt(baby, nowMs, nowMs > 3000, false, false),
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
