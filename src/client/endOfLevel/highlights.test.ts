import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { LevelEndReason, SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import { createHighlightRecorder, type Highlight } from './highlights.ts';

const RULES = createTestFeedback().replay;

const telegraph = (
  threatId: number,
  t: number,
  waveIndex = 0,
  anchorId = 'anchor_a',
): SimEvent => ({
  type: 'ThreatTelegraphed',
  t: asSimMs(t),
  threatId,
  kind: 'any',
  anchorId,
  waveIndex,
});
const hidden = (threatId: number, t: number, anchorId: string): SimEvent => ({
  type: 'ThreatHidden',
  t: asSimMs(t),
  threatId,
  kind: 'any',
  anchorId,
  waveIndex: 0,
});
const resolved = (
  threatId: number,
  t: number,
  quality: 'perfect' | 'success' | 'fail' = 'success',
): SimEvent =>
  ({
    type: 'ResponseResolved',
    t: asSimMs(t),
    threatId,
    response: 'parry',
    quality,
    offsetMs: 0,
    responseWindow: {},
  }) as unknown as SimEvent;
const gag = (threatId: number, t: number): SimEvent =>
  ({
    type: 'GagTriggered',
    t: asSimMs(t),
    threatId,
    gag: 'spill',
    reason: 'timeout',
  }) as unknown as SimEvent;
const nearMiss = (threatId: number, t: number): SimEvent =>
  ({ type: 'NearMiss', t: asSimMs(t), threatId, gag: 'spill' }) as unknown as SimEvent;
const nearMissFrozen = (threatId: number, t: number): SimEvent =>
  ({ type: 'NearMissFrozen', t: asSimMs(t), threatId, gag: 'spill' }) as unknown as SimEvent;
const impact = (t: number, propId: string, otherPropId: string | null = null): SimEvent => ({
  type: 'PropImpact',
  t: asSimMs(t),
  propId,
  impulseNs: 1,
  otherPropId,
});
const broken = (t: number, propId: string): SimEvent => ({
  type: 'PropBroken',
  t: asSimMs(t),
  propId,
  impulseNs: 1,
});
const choreBeat = (t: number): SimEvent =>
  ({ type: 'ChoreBeatJudged', t: asSimMs(t), quality: 'perfect' }) as unknown as SimEvent;
const beatHit = (t: number): SimEvent =>
  ({ type: 'BeatHit', t: asSimMs(t), quality: 'perfect' }) as unknown as SimEvent;

function pickOf(
  events: readonly SimEvent[],
  endReason: LevelEndReason = 'timer',
  rules = RULES,
): readonly Highlight[] {
  const recorder = createHighlightRecorder();
  for (const event of events) recorder.onSimEvent(event);
  return recorder.pick(endReason, rules);
}

describe('createHighlightRecorder › one kind alone', () => {
  it('scores a perfect response', () => {
    const moments = pickOf([telegraph(1, 1000, -1, 'door'), resolved(1, 2000, 'perfect')]);
    expect(moments).toEqual([
      { t: 2000, threatId: 1, points: 3, kinds: ['perfect'], anchorId: 'door' },
    ]);
  });

  it('does not score a success or a fail', () => {
    expect(
      pickOf([
        telegraph(1, 0, -1),
        resolved(1, 2000, 'success'),
        telegraph(2, 0, -1),
        resolved(2, 9000, 'fail'),
      ]),
    ).toEqual([]);
  });

  it('scores a near miss', () => {
    const moments = pickOf([telegraph(4, 0, -1, 'stairs'), gag(4, 3000), nearMiss(4, 3000)]);
    expect(moments).toEqual([
      { t: 3000, threatId: 4, points: 2, kinds: ['nearMiss'], anchorId: 'stairs' },
    ]);
  });

  it('scores a messy gag: two distinct props hit within the window', () => {
    const moments = pickOf([
      telegraph(5, 0, -1, 'shelf'),
      gag(5, 3000),
      impact(3100, 'vase'),
      impact(3200, 'ball', 'vase'),
    ]);
    expect(moments).toEqual([
      { t: 3000, threatId: 5, points: 2, kinds: ['messyGag'], anchorId: 'shelf' },
    ]);
  });

  it('scores the last response of a wave, whatever its quality', () => {
    const moments = pickOf([
      telegraph(1, 0, 0),
      telegraph(2, 0, 0),
      resolved(1, 2000, 'success'),
      resolved(2, 4000, 'fail'),
    ]);
    expect(moments).toEqual([
      { t: 4000, threatId: 2, points: 1, kinds: ['waveLast'], anchorId: 'anchor_a' },
    ]);
  });

  it('reads the anchor of a hidden threat', () => {
    const moments = pickOf([hidden(7, 100, 'under_bed'), resolved(7, 5000, 'perfect')]);
    expect(moments[0]?.anchorId).toBe('under_bed');
  });

  it('gives a threat the recorder never saw targeted a null anchor', () => {
    expect(pickOf([resolved(9, 5000, 'perfect')])[0]?.anchorId).toBeNull();
  });
});

describe('createHighlightRecorder › what is not a moment', () => {
  it('NearMissFrozen scores nothing', () => {
    expect(pickOf([telegraph(4, 0, -1), nearMissFrozen(4, 90000)])).toEqual([]);
  });

  it('a chore beat and a rhythm beat are not a perfect', () => {
    expect(pickOf([choreBeat(1000), beatHit(2000)])).toEqual([]);
  });

  it('a threat no wave planned is never the last of a wave', () => {
    expect(pickOf([telegraph(1, 0, -1), resolved(1, 2000, 'success')])).toEqual([]);
  });

  it('no candidate gives no moment', () => {
    expect(pickOf([])).toEqual([]);
  });
});

describe('createHighlightRecorder › the messy gag', () => {
  const base = [telegraph(5, 0, -1), gag(5, 3000)];

  it('needs messyGagMinProps distinct props', () => {
    expect(pickOf([...base, impact(3100, 'vase')])).toEqual([]);
  });

  it('counts the same prop twice once', () => {
    expect(pickOf([...base, impact(3100, 'vase'), impact(3200, 'vase')])).toEqual([]);
  });

  it('counts otherPropId', () => {
    expect(pickOf([...base, impact(3100, 'vase', 'ball')])[0]?.kinds).toEqual(['messyGag']);
  });

  it('counts a broken prop', () => {
    expect(pickOf([...base, impact(3100, 'vase'), broken(3200, 'plate')])[0]?.kinds).toEqual([
      'messyGag',
    ]);
  });

  it('counts a prop at exactly messWindowMs', () => {
    const at = 3000 + RULES.messWindowMs;
    expect(pickOf([...base, impact(3100, 'vase'), impact(at, 'ball')])[0]?.kinds).toEqual([
      'messyGag',
    ]);
  });

  it('does not count a prop one step past messWindowMs', () => {
    const at = 3000 + RULES.messWindowMs + STEP_MS;
    expect(pickOf([...base, impact(3100, 'vase'), impact(at, 'ball')])).toEqual([]);
  });

  it('does not count a prop that moved before the gag', () => {
    expect(pickOf([...base, impact(2990, 'vase'), impact(3100, 'ball')])).toEqual([]);
  });
});

describe('createHighlightRecorder › the points of one threat at one time add up', () => {
  it('a perfect that is also the last of its wave is 3 + 1', () => {
    const moments = pickOf([telegraph(1, 0, 0), resolved(1, 6000, 'perfect')]);
    expect(moments).toEqual([
      { t: 6000, threatId: 1, points: 4, kinds: ['perfect', 'waveLast'], anchorId: 'anchor_a' },
    ]);
  });

  it('a near-miss stair slide that knocked two props is 4', () => {
    const moments = pickOf([
      telegraph(4, 0, -1),
      gag(4, 3000),
      nearMiss(4, 3000),
      impact(3050, 'a'),
      impact(3060, 'b'),
    ]);
    expect(moments).toEqual([
      { t: 3000, threatId: 4, points: 4, kinds: ['messyGag', 'nearMiss'], anchorId: 'anchor_a' },
    ]);
  });

  it('the same threat at another time is another moment', () => {
    const moments = pickOf([
      telegraph(1, 0, -1),
      resolved(1, 6000, 'perfect'),
      resolved(1, 20000, 'perfect'),
    ]);
    expect(moments.map((moment) => moment.t)).toEqual([6000, 20000]);
  });
});

describe('createHighlightRecorder › the selection', () => {
  const perfects = (times: readonly number[]): SimEvent[] =>
    times.flatMap((t, index) => [telegraph(index + 1, 0, -1), resolved(index + 1, t, 'perfect')]);

  it('drops a candidate closer than minSpacingMs to a better one', () => {
    // 10000 is a near miss (2); 6000 is a perfect (3) 4 s away: the perfect wins, the near miss goes.
    const moments = pickOf([
      ...perfects([6000]),
      telegraph(50, 0, -1),
      gag(50, 10000),
      nearMiss(50, 10000),
    ]);
    expect(moments.map((moment) => moment.t)).toEqual([6000]);
  });

  it('keeps a candidate exactly minSpacingMs away', () => {
    const moments = pickOf(perfects([6000, 6000 + RULES.minSpacingMs]));
    expect(moments.map((moment) => moment.t)).toEqual([6000, 11000]);
  });

  it('a tie goes to the later moment', () => {
    const moments = pickOf(perfects([10000, 20000, 30000, 40000, 50000]));
    expect(moments.map((moment) => moment.t)).toEqual([30000, 40000, 50000]);
  });

  it('a tie in points and time goes to the lower threat id', () => {
    const moments = pickOf(
      [
        telegraph(8, 0, -1),
        telegraph(3, 0, -1),
        resolved(8, 9000, 'perfect'),
        resolved(3, 9000, 'perfect'),
      ],
      'timer',
      { ...RULES, momentCount: 1 },
    );
    expect(moments.map((moment) => moment.threatId)).toEqual([3]);
  });

  it('more points beat a later moment', () => {
    const moments = pickOf(
      [...perfects([10000]), telegraph(60, 0, -1), gag(60, 40000), nearMiss(60, 40000)],
      'timer',
      { ...RULES, momentCount: 1 },
    );
    expect(moments.map((moment) => moment.t)).toEqual([10000]);
  });

  it('returns the moments in chronological order', () => {
    const moments = pickOf(perfects([30000, 10000, 20000]));
    expect(moments.map((moment) => moment.t)).toEqual([10000, 20000, 30000]);
  });

  it('keeps at most momentCount moments', () => {
    const moments = pickOf(perfects([10000, 20000, 30000, 40000]), 'timer', {
      ...RULES,
      momentCount: 2,
    });
    expect(moments.map((moment) => moment.t)).toEqual([30000, 40000]);
  });

  it('is the same for the same events', () => {
    const events = perfects([10000, 20000, 30000, 40000]);
    expect(pickOf(events)).toEqual(pickOf(events));
  });

  it('uses the points of the rules', () => {
    const moments = pickOf(
      [...perfects([10000]), telegraph(60, 0, -1), gag(60, 40000), nearMiss(60, 40000)],
      'timer',
      { ...RULES, momentCount: 1, points: { ...RULES.points, nearMiss: 4 } },
    );
    expect(moments.map((moment) => moment.t)).toEqual([40000]);
  });
});

describe('createHighlightRecorder › end reasons', () => {
  const game: SimEvent[] = [
    telegraph(1, 0, -1),
    resolved(1, 50000, 'perfect'),
    telegraph(2, 0, -1),
    gag(2, 20000),
    telegraph(3, 0, -1),
    gag(3, 24000),
    telegraph(4, 0, -1),
    gag(4, 30000),
    nearMiss(4, 30000),
    telegraph(5, 0, -1),
    gag(5, 31000),
  ];

  it('mamaHome replays the last gags, latest first, and ignores the perfects', () => {
    const moments = pickOf(game, 'mamaHome');
    // 31000 (latest), 30000 is 1 s away (dropped), 24000 (7 s), 20000 is 4 s from 24000 (dropped).
    expect(moments.map((moment) => moment.t)).toEqual([24000, 31000]);
    expect(moments.map((moment) => moment.threatId)).toEqual([3, 5]);
  });

  it('mamaHome keeps a gag with no points of its own', () => {
    const moments = pickOf([telegraph(2, 0, -1), gag(2, 20000)], 'mamaHome');
    expect(moments).toEqual([
      { t: 20000, threatId: 2, points: 0, kinds: [], anchorId: 'anchor_a' },
    ]);
  });

  it('mamaHome always ends on the last gag', () => {
    const moments = pickOf(game, 'mamaHome');
    expect(moments.at(-1)?.t).toBe(31000);
  });

  it('mamaHome with no gag has no moment', () => {
    expect(pickOf([telegraph(1, 0, -1), resolved(1, 5000, 'perfect')], 'mamaHome')).toEqual([]);
  });

  it('mamaWoke uses the normal pick', () => {
    const moments = pickOf(game, 'mamaWoke');
    expect(moments.map((moment) => moment.t)).toEqual([30000, 50000]);
  });
});

describe('createHighlightRecorder › clear', () => {
  it('forgets the game', () => {
    const recorder = createHighlightRecorder();
    recorder.onSimEvent(telegraph(1, 0, -1));
    recorder.onSimEvent(resolved(1, 5000, 'perfect'));
    expect(recorder.pick('timer', RULES)).toHaveLength(1);
    recorder.clear();
    expect(recorder.pick('timer', RULES)).toEqual([]);
  });
});
