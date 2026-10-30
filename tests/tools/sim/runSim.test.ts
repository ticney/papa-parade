import { fileURLToPath } from 'node:url';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { UINT32_RANGE } from '@shared/constants';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { loadSimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { renderReport } from '../../../tools/sim/simReport.ts';
import { createTestSimLevel, simArgs } from '../../support/simSupport.ts';

async function reportOf(overrides: Parameters<typeof simArgs>[0]) {
  const result = await runSim(simArgs(overrides), createTestSimLevel());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim', () => {
  it('plays one game per run, on the seeds seed, seed + 1…', async () => {
    const report = await reportOf({ seed: 7, runs: 3 });
    expect(report.runs).toBe(3);
    expect(report.runList.map((entry) => entry.seed)).toEqual([7, 8, 9]);
    expect(report.threats.outlet?.responses).toBeGreaterThan(0);
  });

  it('wraps the seed at 2**32', async () => {
    const report = await reportOf({ seed: UINT32_RANGE - 1, runs: 2 });
    expect(report.runList.map((entry) => entry.seed)).toEqual([UINT32_RANGE - 1, 0]);
  });

  it('gives a byte-identical report for the same arguments', async () => {
    const a = renderReport(await reportOf({ botId: 'human', seed: 3, runs: 2 }));
    const b = renderReport(await reportOf({ botId: 'human', seed: 3, runs: 2 }));
    expect(a).toBe(b);
  });

  it('shows the perfect bot perfect and the idle bot failing', async () => {
    const perfect = await reportOf({ botId: 'perfect', runs: 2 });
    expect(perfect.meanSuccessPct).toBe(100);
    expect(perfect.threats.outlet?.perfectPct).toBe(100);
    expect(perfect.gags.total).toBe(0);
    const idle = await reportOf({ botId: 'idle', runs: 2 });
    expect(idle.meanSuccessPct).toBe(0);
    expect(idle.threats.outlet?.failReasons.late).toBe(idle.threats.outlet?.responses);
    expect(idle.gags.total).toBeGreaterThan(0);
  });

  it('tells the bot about every threat def of the level: the perfect bot answers the outlet', async () => {
    const report = await reportOf({ botId: 'perfect' });
    expect(report.threats.outlet?.perfect).toBeGreaterThan(0);
  });

  it('hands over each recorded game, and reports progress', async () => {
    const games: [string, RunFile][] = [];
    const progress: number[] = [];
    const result = await runSim(
      simArgs({ botId: 'human', seed: 4, runs: 2 }),
      createTestSimLevel(),
      {
        onGame: (name, game) => games.push([name, game]),
        onProgress: (done) => progress.push(done),
      },
    );
    expect(result.ok).toBe(true);
    expect(games.map(([name]) => name)).toEqual([
      'salon_crawler_human_4.journal.json',
      'salon_crawler_human_5.journal.json',
    ]);
    expect(progress).toEqual([1, 2]);
    expect(games[0]?.[1]).toMatchObject({
      kind: 'papa-parade.run',
      levelId: 'salon_crawler',
      bot: 'human',
      untilSimMs: 20_000,
    });
  });

  it('is an err, not a throw, when a run crashes: it names the seed', async () => {
    const loaded = createTestSimLevel();
    // A level whose anchor is not in the geometry: the sim refuses it at creation.
    loaded.level = {
      ...loaded.level,
      level: {
        ...loaded.level.level,
        waves: [
          {
            fromMs: 0,
            maxSimultaneous: 1,
            gapMinMs: 0,
            gapMaxMs: 0,
            lullMs: 0,
            threats: [{ def: 'outlet', anchor: 'no_such_anchor' }],
            disruptions: [],
          },
        ],
      },
    };
    const result = await runSim(simArgs({ seed: 9 }), loaded);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('seed 9');
  });

  it('is an err when the bot cannot be made', async () => {
    const loaded = createTestSimLevel();
    loaded.content = { ...loaded.content, bots: { ...loaded.content.bots, tapMs: 9999 } };
    const result = await runSim(simArgs(), loaded);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('tapMs');
  });
});

// Story 1.18: the CLI plays the live level to its end.
describe('runSim on the live content', () => {
  const CONTENT_DIR = fileURLToPath(new URL('../../../content', import.meta.url));
  const load = async () => {
    const loaded = await loadSimLevel(CONTENT_DIR, 'salon_crawler');
    if (!loaded.ok) throw new Error(loaded.error);
    return loaded.value;
  };

  it('plays each idle game to LevelEnded: every wave telegraphs, none goes over its limit', async () => {
    const loaded = await load();
    const result = await runSim(simArgs({ botId: 'idle', runs: 5, untilSimMs: null }), loaded);
    if (!result.ok) throw new Error(result.error);
    const report = result.value;
    expect(report.untilSimMs).toBe(loaded.level.level.durationMs);
    expect(report.endedRuns).toBe(report.runs);
    expect(report.waves.map((wave) => wave.fromMs)).toEqual(
      loaded.level.level.waves.map((wave) => wave.fromMs),
    );
    for (const wave of report.waves) {
      expect(wave.telegraphs).toBeGreaterThan(0);
      expect(wave.overLimitRuns).toBe(0);
      expect(wave.peakSimultaneous).toBeLessThanOrEqual(wave.maxSimultaneous);
    }
  }, 120_000);

  it.each(['assistance', 'experienced'] as const)(
    'sends a SetDifficultyTier at t = 0 at the %s tier, and the report and the file carry it',
    async (tier) => {
      const games: RunFile[] = [];
      const result = await runSim(simArgs({ botId: 'human', tier }), createTestSimLevel(), {
        onGame: (_name, game) => games.push(game),
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.value.tier).toBe(tier);
      const file = games[0] as RunFile;
      expect(file.tier).toBe(tier);
      const commands = file.journal.entries.filter(
        (entry) => entry.command.type === 'SetDifficultyTier',
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]?.command).toMatchObject({ t: 0, tier });
    },
  );

  it('sends nothing at normal: the journal is what it was before the tiers', async () => {
    const games: RunFile[] = [];
    const result = await runSim(simArgs({ botId: 'human' }), createTestSimLevel(), {
      onGame: (_name, game) => games.push(game),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.tier).toBe('normal');
    const types = (games[0] as RunFile).journal.entries.map((entry) => entry.command.type);
    expect(types).not.toContain('SetDifficultyTier');
  });

  it('records where a game stopped, so that it replays to the same world', async () => {
    const loaded = await load();
    const games: RunFile[] = [];
    const result = await runSim(simArgs({ botId: 'human', untilSimMs: null }), loaded, {
      onGame: (_name, game) => games.push(game),
    });
    expect(result.ok).toBe(true);
    expect(games[0]?.untilSimMs).toBe(loaded.level.level.durationMs);
    const replayed = await replayRunFile(games[0] as RunFile, loaded);
    expect(replayed.ok).toBe(true);
  }, 120_000);

  it('stops at --until-ms when that is sooner, and the game has not ended', async () => {
    const loaded = await load();
    const result = await runSim(simArgs({ botId: 'idle', untilSimMs: 5000 }), loaded);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.untilSimMs).toBe(5000);
    expect(result.value.endedRuns).toBe(0);
  });

  it('draws another first telegraph on another seed (AC 4)', async () => {
    const loaded = await load();
    const firsts = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = await createSim({ ...loaded, seed, strictInvariants: true });
      let first: number | null = null;
      for (let i = 0; i < 20_000 && first === null; i++) {
        sim.step();
        for (const event of sim.drainEvents()) {
          if (first === null && event.type === 'ThreatTelegraphed') first = event.threatId;
        }
      }
      sim.dispose();
      if (first === null) throw new Error(`seed ${seed}: no threat was ever telegraphed`);
      firsts.add(first);
    }
    expect(firsts.size).toBeGreaterThan(1);
  }, 120_000);

  it('shows the last-threat slow-mo (×0.2, slower than the perfect one) in some perfect game', async () => {
    const loaded = await load();
    const { feel } = loaded.content;
    expect(feel.timing.slowMoLastThreat.timeScale).toBeLessThan(
      feel.timing.slowMoPerfect.timeScale,
    );
    let lastThreatSlowMos = 0;
    for (const seed of [1, 2, 3]) {
      const bot = createBot('perfect', {
        seed,
        holdMinMs: feel.input.holdMinMs,
        responses: botResponsesOf(loaded.level.threats),
        settings: loaded.content.bots,
      });
      if (!bot.ok) throw new Error(bot.error.message);
      const sim = await createSim({ ...loaded, seed, strictInvariants: true });
      playGame(sim, bot.value, loaded.level.level.durationMs, (event: SimEvent) => {
        if (
          event.type === 'TimeScaleChanged' &&
          event.to === feel.timing.slowMoLastThreat.timeScale
        ) {
          lastThreatSlowMos++;
        }
      });
      sim.dispose();
    }
    expect(lastThreatSlowMos).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
