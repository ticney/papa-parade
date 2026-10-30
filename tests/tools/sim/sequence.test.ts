import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it, vi } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim, withSequenceStart } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  testWave,
} from '../../support/testContent.ts';

// `npm run sim -- --sequence` (story 4.4): the golden rule, a sequence played end to end by a bot
// with no human, and journaled so that `sim:replay` agrees.
function levelWithSequence(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })],
      gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
      carry: CARRY,
      sequences: ['stay_awake'],
      durationMs: 40_000,
    }),
    geometry: createTestGeometry(),
  };
}

async function reportOf(overrides: Parameters<typeof simArgs>[0]) {
  const result = await runSim(
    simArgs({ sequenceId: 'stay_awake', sequenceAtMs: 5000, ...overrides }),
    levelWithSequence(),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim with --sequence', () => {
  it.each([1, 2, 3, 4, 5])('the perfect bot wins the sequence on seed %i', async (seed) => {
    const report = await reportOf({ botId: 'perfect', seed, runs: 1, untilSimMs: 40_000 });
    expect(report.sequencesStarted).toBe(1);
    expect(report.sequencesSucceeded).toBe(1);
    expect(report.sequencesFailed).toBe(0);
    expect(report.gags.total).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('the idle bot loses it on seed %i, with the snore', async (seed) => {
    const report = await reportOf({ botId: 'idle', seed, runs: 1, untilSimMs: 40_000 });
    expect(report.sequencesStarted).toBe(1);
    expect(report.sequencesSucceeded).toBe(0);
    expect(report.sequencesFailed).toBe(1);
    expect(report.noiseBySourcePct.snore).toBeGreaterThanOrEqual(15);
  });

  it('counts per run and over the runs', async () => {
    const report = await reportOf({ botId: 'idle', runs: 3, untilSimMs: 40_000 });
    expect(report.runList.map((run) => run.sequencesStarted)).toEqual([1, 1, 1]);
    expect(report.sequencesStarted).toBe(3);
    expect(report.sequencesFailed).toBe(3);
  });

  it('refuses an id the level does not plan, naming the ones it plans', async () => {
    const result = await runSim(
      simArgs({ botId: 'idle', sequenceId: 'typo', sequenceAtMs: 5000 }),
      levelWithSequence(),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('--sequence typo');
    expect(result.ok ? '' : result.error).toContain('stay_awake');
  });

  it('warns when the sim refuses the start, and reports 0 started', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      // The cap ends the game before the start step: nothing is ever sent.
      const report = await reportOf({ botId: 'idle', runs: 2, untilSimMs: 3000 });
      expect(report.sequencesStarted).toBe(0);
      const messages = warn.mock.calls.map(([, message]) => message);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('--sequence stay_awake never started');
    } finally {
      warn.mockRestore();
    }
  });

  it('starts nothing without --sequence: the counters are 0 and the noise has no snore', async () => {
    const result = await runSim(
      simArgs({ botId: 'idle', runs: 1, untilSimMs: 40_000 }),
      levelWithSequence(),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.sequencesStarted).toBe(0);
    expect(result.value.noiseBySourcePct.snore).toBe(0);
  });

  it('journals the StartSequence, so that sim:replay replays the game to the same world', async () => {
    const games: [string, RunFile][] = [];
    const result = await runSim(
      simArgs({
        botId: 'perfect',
        seed: 2,
        sequenceId: 'stay_awake',
        sequenceAtMs: 5000,
        untilSimMs: 40_000,
      }),
      levelWithSequence(),
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    expect(game.journal.entries.map((entry) => entry.command.type)).toContain('StartSequence');
    const replayed = await replayRunFile(game, levelWithSequence());
    expect(replayed).toMatchObject({ ok: true });
  });

  it('a headless game does not stop at the sequence: it plays on to the end of the level', async () => {
    const report = await reportOf({ botId: 'perfect', seed: 3, untilSimMs: 40_000 });
    expect(report.endedRuns).toBe(1);
    expect(report.endsByReason.timer).toBe(1);
  });
});

describe('withSequenceStart', () => {
  it('enqueues StartSequence once, first, at the first step at or after atMs', async () => {
    const calls: string[] = [];
    const bot = {
      id: 'idle' as const,
      act: () => {
        calls.push('bot');
      },
    };
    const wrapped = withSequenceStart(bot, 'stay_awake', 1000);
    const out: { type: string }[] = [];
    const world = (sim: number) => ({ time: { sim } }) as never;
    wrapped.act(world(990), out as never);
    expect(out).toEqual([]);
    wrapped.act(world(1000), out as never);
    expect(out).toEqual([{ type: 'StartSequence', t: 1000, sequenceId: 'stay_awake' }]);
    wrapped.act(world(1010), out as never);
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(wrapped.id).toBe('idle');
  });
});

describe('what a bot does not see', () => {
  it('an event list with a sequence ends exactly when the level does', async () => {
    const level = levelWithSequence();
    const sim = await createSim({
      content: level.content,
      geometry: level.geometry,
      level: level.level,
      seed: 4,
    });
    const events: SimEvent[] = [];
    sim.enqueue({ type: 'StartSequence', t: 0 as never, sequenceId: 'stay_awake' });
    for (let i = 0; i < 4000; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.filter((event) => event.type === 'LevelEnded')).toHaveLength(1);
    sim.dispose();
  });
});
