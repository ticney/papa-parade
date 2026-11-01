import { asSimMs } from '@shared/time';
import { LEVEL_END_REASONS, type LevelEndReason, type ResponseQuality, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createGameSummary, type GameSummaryRecorder, type JournalDevice } from './gameSummary.ts';

const WINDOW = { windowMs: 300, perfectMs: 60, toleranceMs: 60, bufferMs: 100 };

function telegraph(threatId: number, kind: string, type: 'ThreatTelegraphed' | 'ThreatHidden') {
  return {
    type,
    t: asSimMs(0),
    threatId,
    kind,
    anchorId: 'ANCHOR_x',
    waveIndex: 0,
  } satisfies SimEvent;
}

function resolved(
  t: number,
  threatId: number,
  quality: ResponseQuality,
  extra: {
    reason?: 'early' | 'late' | 'wrongResponse' | 'released';
    offsetMs?: number | null;
  } = {},
): SimEvent {
  return {
    type: 'ResponseResolved',
    t: asSimMs(t),
    threatId,
    response: 'parry',
    quality,
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    offsetMs: extra.offsetMs === undefined ? 0 : extra.offsetMs,
    responseWindow: WINDOW,
  };
}

function ended(reason: LevelEndReason = 'timer'): SimEvent {
  return { type: 'LevelEnded', t: asSimMs(180_000), reason };
}

function scored(): SimEvent {
  return {
    type: 'LevelScored',
    t: asSimMs(180_000),
    laughPoints: 12,
    babyStatePoints: 20,
    sighPoints: 4,
    screamPoints: 1,
    scorePoints: 77,
    stars: 3,
    lostStars: 1,
  };
}

function recorder(overrides: Partial<Parameters<typeof createGameSummary>[0]> = {}) {
  return createGameSummary({
    sessionId: '0a1b2c3d',
    gameIndexInSession: 1,
    autoplay: null,
    ...overrides,
  });
}

function finish(game: GameSummaryRecorder, device: JournalDevice = 'none'): void {
  game.onEvent(ended(), device);
  game.onEvent(scored(), device);
}

describe('the sequences of a game (story 4.10)', () => {
  const t = asSimMs(1000);
  const seq = (id = 'bedtime_duel'): SimEvent => ({ type: 'SequenceStarted', t, id });
  const step = (stepIndex: number): SimEvent => ({
    type: 'SequenceStepStarted',
    t,
    id: 'bedtime_duel',
    stepIndex,
  });
  const retreat = (fromStepIndex: number, stepIndex: number): SimEvent => ({
    type: 'SequenceStepRetreated',
    t,
    id: 'bedtime_duel',
    fromStepIndex,
    stepIndex,
    retreats: 1,
    reason: 'late',
  });
  const end = (outcome: 'succeeded' | 'failed' | 'levelEnded'): SimEvent => ({
    type: 'SequenceEnded',
    t,
    id: 'bedtime_duel',
    outcome,
  });
  const summaryOf = (...events: SimEvent[]) => {
    const game = recorder();
    for (const event of events) game.onEvent(event, 'none');
    game.onEvent(ended(), 'none');
    game.onEvent(scored(), 'none');
    return game.summary()?.sequences;
  };

  it('always writes the key, empty with no sequence', () => {
    expect(summaryOf()).toEqual([]);
  });

  it('closes each step as passed on the next, and the last with the win', () => {
    expect(summaryOf(seq(), step(0), step(1), step(2), end('succeeded'))).toEqual([
      {
        id: 'bedtime_duel',
        t: 1000,
        outcome: 'succeeded',
        steps: [
          { stepIndex: 0, outcome: 'passed' },
          { stepIndex: 1, outcome: 'passed' },
          { stepIndex: 2, outcome: 'passed' },
        ],
      },
    ]);
  });

  it('counts a retreat from step 0 back to step 0 as a failed attempt, and opens another', () => {
    expect(summaryOf(seq(), step(0), retreat(0, 0), step(0), end('succeeded'))?.[0]?.steps).toEqual(
      [
        { stepIndex: 0, outcome: 'failed' },
        { stepIndex: 0, outcome: 'passed' },
      ],
    );
  });

  it('follows a duel forward then back: the new index is lower, so nothing is passed by it', () => {
    expect(
      summaryOf(seq(), step(0), step(1), retreat(1, 0), step(0), step(1), end('failed'))?.[0]
        ?.steps,
    ).toEqual([
      { stepIndex: 0, outcome: 'passed' },
      { stepIndex: 1, outcome: 'failed' },
      { stepIndex: 0, outcome: 'passed' },
      { stepIndex: 1, outcome: 'failed' },
    ]);
  });

  it('cuts the open step when the level ends in mid-sequence: endLevel closes it first', () => {
    expect(summaryOf(seq(), step(0), step(1), end('levelEnded'))).toEqual([
      {
        id: 'bedtime_duel',
        t: 1000,
        outcome: 'levelEnded',
        steps: [
          { stepIndex: 0, outcome: 'passed' },
          { stepIndex: 1, outcome: 'cut' },
        ],
      },
    ]);
  });

  it('keeps each try of a retried sequence, and returns a copy', () => {
    const game = recorder();
    for (const event of [seq(), step(0), end('failed'), seq(), step(0), end('succeeded')]) {
      game.onEvent(event, 'none');
    }
    game.onEvent(ended(), 'none');
    game.onEvent(scored(), 'none');
    const first = game.summary();
    expect(first?.sequences?.map((entry) => entry.outcome)).toEqual(['failed', 'succeeded']);
    first?.sequences?.[0]?.steps.push({ stepIndex: 9, outcome: 'cut' });
    expect(game.summary()?.sequences?.[0]?.steps).toHaveLength(1);
  });
});

describe('a response during a sequence (story 4.10)', () => {
  it('is marked in the timeline, and only then', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(1000, 1, 'success'), 'touch');
    game.onEvent({ type: 'SequenceStarted', t: 2000, id: 'stay_awake' } as SimEvent, 'touch');
    game.onEvent(telegraph(2, 'fake_sleep', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(3000, 2, 'fail'), 'touch');
    game.onEvent(
      { type: 'SequenceEnded', t: 3000, id: 'stay_awake', outcome: 'failed' } as SimEvent,
      'touch',
    );
    game.onEvent(telegraph(3, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(4000, 3, 'success'), 'touch');
    finish(game);
    expect(game.summary()?.responses.timeline.map((entry) => entry.inSequence)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });
});

describe('createGameSummary (story 3.3)', () => {
  it('has no summary until the level has ended and been scored', () => {
    const game = recorder();
    expect(game.summary()).toBeNull();
    game.onEvent(ended(), 'none');
    expect(game.summary()).toBeNull();
    game.onEvent(scored(), 'none');
    expect(game.summary()).not.toBeNull();
  });

  it('carries the session id, the index of the game and the bot of an autoplay game', () => {
    const game = recorder({ sessionId: 'deadbeef', gameIndexInSession: 3, autoplay: 'human' });
    finish(game);
    const summary = game.summary();
    expect(summary?.sessionId).toBe('deadbeef');
    expect(summary?.gameIndexInSession).toBe(3);
    expect(summary?.autoplay).toBe('human');
  });

  it('takes the end reason from LevelEnded, whatever it is', () => {
    for (const reason of LEVEL_END_REASONS) {
      const game = recorder();
      game.onEvent(ended(reason), 'none');
      game.onEvent(scored(), 'none');
      expect(game.summary()?.endReason).toBe(reason);
    }
  });

  it('takes the score from LevelScored, without its type and its time', () => {
    const game = recorder();
    finish(game);
    expect(game.summary()?.score).toEqual({
      laughPoints: 12,
      babyStatePoints: 20,
      sighPoints: 4,
      screamPoints: 1,
      scorePoints: 77,
      stars: 3,
      lostStars: 1,
    });
  });

  it('names a response by the kind of the event that named the threat', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(telegraph(2, 'suspicious_silence', 'ThreatHidden'), 'touch');
    game.onEvent(resolved(1000, 1, 'perfect'), 'touch');
    game.onEvent(resolved(2000, 2, 'fail', { reason: 'late', offsetMs: null }), 'touch');
    finish(game, 'touch');
    const { timeline, byThreat } = game.summary()?.responses ?? { timeline: [], byThreat: {} };
    expect(timeline.map((entry) => entry.threatDefId)).toEqual(['outlet', 'suspicious_silence']);
    expect(Object.keys(byThreat).sort()).toEqual(['outlet', 'suspicious_silence']);
  });

  it('falls back on threat_<id> for a threat no event named', () => {
    const game = recorder();
    game.onEvent(resolved(1000, 7, 'success'), 'keyboard');
    finish(game);
    const responses = game.summary()?.responses;
    expect(responses?.timeline[0]?.threatDefId).toBe('threat_7');
    expect(responses?.byThreat).toEqual({ threat_7: { perfect: 0, success: 1, fail: 0 } });
  });

  it('counts the qualities, per threat and per device, exactly', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(telegraph(2, 'stairs', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(1000, 1, 'perfect'), 'touch');
    game.onEvent(resolved(2000, 2, 'success'), 'touch');
    game.onEvent(resolved(3000, 1, 'fail', { reason: 'early' }), 'keyboard');
    game.onEvent(resolved(4000, 1, 'perfect'), 'keyboard');
    game.onEvent(resolved(5000, 2, 'fail', { reason: 'late', offsetMs: null }), 'mouse');
    finish(game, 'mouse');
    const responses = game.summary()?.responses;
    expect(responses?.byQuality).toEqual({ perfect: 2, success: 1, fail: 2 });
    expect(responses?.byThreat).toEqual({
      outlet: { perfect: 2, success: 0, fail: 1 },
      stairs: { perfect: 0, success: 1, fail: 1 },
    });
    expect(responses?.byDevice).toEqual({
      touch: { perfect: 1, success: 1, fail: 0 },
      mouse: { perfect: 0, success: 0, fail: 1 },
      keyboard: { perfect: 1, success: 0, fail: 1 },
      gamepad: { perfect: 0, success: 0, fail: 0 },
      none: { perfect: 0, success: 0, fail: 0 },
    });
  });

  it('records each response in order, with its reason, offset and device', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(1500, 1, 'success', { offsetMs: -42 }), 'touch');
    game.onEvent(resolved(2500, 1, 'fail', { reason: 'late', offsetMs: null }), 'gamepad');
    finish(game);
    expect(game.summary()?.responses.timeline).toEqual([
      {
        t: 1500,
        threatDefId: 'outlet',
        quality: 'success',
        reason: null,
        offsetMs: -42,
        device: 'touch',
      },
      {
        t: 2500,
        threatDefId: 'outlet',
        quality: 'fail',
        reason: 'late',
        offsetMs: null,
        device: 'gamepad',
      },
    ]);
  });

  it('counts the responses only, not the telegraphs', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'none');
    finish(game);
    expect(game.summary()?.responses.byThreat).toEqual({});
    expect(game.summary()?.responses.byQuality).toEqual({ perfect: 0, success: 0, fail: 0 });
  });

  describe('dominantDevice', () => {
    function withResponses(devices: JournalDevice[], lastInput?: JournalDevice) {
      const game = recorder();
      game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'none');
      devices.forEach((device, index) => {
        game.onEvent(resolved(1000 * (index + 1), 1, 'success'), device);
      });
      if (lastInput !== undefined) game.onInput(lastInput);
      finish(game, lastInput ?? 'none');
      return game.summary()?.dominantDevice;
    }

    it('is the device with the most responses', () => {
      expect(withResponses(['touch', 'keyboard', 'touch'])).toBe('touch');
      expect(withResponses(['keyboard', 'touch', 'keyboard', 'keyboard'])).toBe('keyboard');
    });

    it('breaks a tie in favour of the device used last among the tied ones', () => {
      expect(withResponses(['touch', 'keyboard'])).toBe('keyboard');
      expect(withResponses(['keyboard', 'touch'])).toBe('touch');
      expect(withResponses(['touch', 'keyboard', 'gamepad', 'keyboard', 'touch'])).toBe('touch');
      // gamepad has fewer responses: it is not tied, even though it was used last of all.
      expect(withResponses(['touch', 'keyboard', 'touch', 'keyboard', 'gamepad'])).toBe('keyboard');
    });

    it('counts none and mouse as devices of their own', () => {
      expect(withResponses(['none', 'none', 'touch'])).toBe('none');
      expect(withResponses(['mouse', 'mouse', 'touch'])).toBe('mouse');
    });

    it('with no response, is the device of the last input of the level', () => {
      expect(withResponses([], 'keyboard')).toBe('keyboard');
      const game = recorder();
      game.onInput('touch');
      game.onInput('gamepad');
      finish(game, 'gamepad');
      expect(game.summary()?.dominantDevice).toBe('gamepad');
    });

    it('with no response and no input, is none', () => {
      expect(withResponses([])).toBe('none');
    });

    it('ignores the last input once there is a response', () => {
      expect(withResponses(['touch'], 'keyboard')).toBe('touch');
    });
  });

  it('hands out a copy: changing it changes neither a later summary nor the recorder', () => {
    const game = recorder();
    game.onEvent(telegraph(1, 'outlet', 'ThreatTelegraphed'), 'touch');
    game.onEvent(resolved(1000, 1, 'perfect'), 'touch');
    finish(game, 'touch');
    const first = game.summary();
    expect(first).not.toBeNull();
    if (first === null) return;
    first.responses.byQuality.perfect = 99;
    first.responses.timeline.length = 0;
    first.responses.byThreat.outlet = { perfect: 99, success: 99, fail: 99 };
    const second = game.summary();
    expect(second?.responses.byQuality.perfect).toBe(1);
    expect(second?.responses.timeline).toHaveLength(1);
    expect(second?.responses.byThreat.outlet).toEqual({ perfect: 1, success: 0, fail: 0 });
  });

  it('ignores the events it does not read', () => {
    const game = recorder();
    game.onEvent({ type: 'WaveStarted', t: asSimMs(0), waveIndex: 0 }, 'touch');
    finish(game);
    expect(game.summary()?.responses.timeline).toEqual([]);
  });
});
