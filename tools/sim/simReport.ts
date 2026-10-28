import { hashJson } from '@shared/hash';
import { PAPA_ASLEEP_GAG_ID, type Sim, type SimEvent } from '@sim';

const FAIL_REASONS = ['early', 'late', 'wrongResponse'] as const;
type FailReasonKey = (typeof FAIL_REASONS)[number];

/** What one run saw of one threat def. */
export interface ThreatTally {
  responses: number;
  perfect: number;
  success: number;
  fail: number;
  failReasons: Record<FailReasonKey, number>;
  /** Sum of `|offsetMs|` over the responses that have one, and how many have one. */
  absOffsetSumMs: number;
  offsetCount: number;
}

/** What one run saw of one wave. */
export interface WaveTally {
  /** The `ThreatTelegraphed` events the wave's director drew. */
  telegraphs: number;
  /** The most threats announced or open at once, counted at this wave's telegraphs. */
  peakSimultaneous: number;
  /** Whether the count ever went above the wave's `maxSimultaneous`. */
  isOverLimit: boolean;
}

/** What one run produced, kept small: counts, never events. */
export interface RunSummary {
  seed: number;
  worldHash: string;
  responses: number;
  gags: number;
  /** The `NearMiss` events: what Mama's « Hurlement » will count (story 1.22). */
  nearMisses: number;
  /** The micro-sleeps telegraphed (`ThreatTelegraphed` of no wave, story 1.19). */
  microSleeps: number;
  /** The coffees drunk (`CoffeeDrunk`). */
  coffees: number;
  /** The `papa_asleep` gags: a missed micro-sleep. */
  asleepGags: number;
  commands: number;
  threats: Record<string, ThreatTally>;
  byGag: Record<string, number>;
  /** One per wave of the level, in order. */
  waves: WaveTally[];
  /** Whether the run saw `LevelEnded`. */
  isEnded: boolean;
}

export interface RunRecorder {
  onEvent(event: SimEvent): void;
  /** Call once the run is over. */
  finish(): RunSummary;
}

/** The tally of `defId` in `tallies`, created empty on first use. */
function tallyOf(tallies: Record<string, ThreatTally>, defId: string): ThreatTally {
  // `hasOwn`: an id such as `constructor` must not find a member of `Object.prototype`.
  if (Object.hasOwn(tallies, defId)) return tallies[defId] as ThreatTally;
  const tally = emptyTally();
  tallies[defId] = tally;
  return tally;
}

const emptyTally = (): ThreatTally => ({
  responses: 0,
  perfect: 0,
  success: 0,
  fail: 0,
  failReasons: { early: 0, late: 0, wrongResponse: 0 },
  absOffsetSumMs: 0,
  offsetCount: 0,
});

/**
 * Counts the events of one run of `sim` (created for it, before the first step): responses per
 * threat def, gags, threats at once per wave (against the limits `waves` gives, the level's waves),
 * whether the level ended, and at the end the final world hash and the number of commands sent.
 */
export function createRunRecorder(
  sim: Sim,
  seed: number,
  waves: readonly { readonly maxSimultaneous: number }[] = [],
): RunRecorder {
  // Threat ids and defs never change after `createSim`.
  const defIdOf = new Map<number, string>();
  for (const threat of sim.world.threats) defIdOf.set(threat.id, threat.defId);
  const threats: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let gags = 0;
  let nearMisses = 0;
  let microSleeps = 0;
  let coffees = 0;
  let asleepGags = 0;
  // The threats no wave planned (the micro-sleep): they are in no wave's tally and never count
  // against a wave's limit, so their results must not move the active count either.
  const systemThreatIds = new Set<number>();
  const waveTallies: WaveTally[] = waves.map(() => ({
    telegraphs: 0,
    peakSimultaneous: 0,
    isOverLimit: false,
  }));
  // Each telegraph ends in exactly one `ResponseResolved`: +1 and −1 give the threats at once.
  let activeCount = 0;
  let isEnded = false;
  return {
    onEvent(event) {
      if (event.type === 'ThreatTelegraphed' && event.waveIndex < 0) {
        microSleeps++;
        systemThreatIds.add(event.threatId);
      } else if (event.type === 'ThreatTelegraphed') {
        activeCount++;
        const wave = waveTallies[event.waveIndex];
        if (wave !== undefined) {
          wave.telegraphs++;
          if (activeCount > wave.peakSimultaneous) wave.peakSimultaneous = activeCount;
          const limit = waves[event.waveIndex]?.maxSimultaneous ?? Number.POSITIVE_INFINITY;
          if (activeCount > limit) wave.isOverLimit = true;
        }
      } else if (event.type === 'LevelEnded') {
        isEnded = true;
      } else if (event.type === 'ResponseResolved') {
        if (!systemThreatIds.has(event.threatId)) activeCount--;
        responses++;
        const defId = defIdOf.get(event.threatId) ?? `threat_${event.threatId}`;
        const tally = tallyOf(threats, defId);
        tally.responses++;
        tally[event.quality]++;
        if (event.quality === 'fail' && event.reason !== undefined) {
          tally.failReasons[event.reason]++;
        }
        if (event.offsetMs !== null) {
          tally.absOffsetSumMs += Math.abs(event.offsetMs);
          tally.offsetCount++;
        }
      } else if (event.type === 'GagTriggered') {
        gags++;
        byGag[event.gag] = countOf(byGag, event.gag) + 1;
        if (event.gag === PAPA_ASLEEP_GAG_ID) asleepGags++;
      } else if (event.type === 'NearMiss') {
        nearMisses++;
      } else if (event.type === 'CoffeeDrunk') {
        coffees++;
      }
    },
    finish() {
      return {
        seed,
        worldHash: hashJson(sim.world),
        responses,
        gags,
        nearMisses,
        microSleeps,
        coffees,
        asleepGags,
        commands: sim.journal().entries.length,
        threats,
        byGag,
        waves: waveTallies.map((wave) => ({ ...wave })),
        isEnded,
      };
    },
  };
}

export interface ThreatReport {
  responses: number;
  perfect: number;
  success: number;
  fail: number;
  perfectPct: number;
  successPct: number;
  failPct: number;
  failReasons: Record<FailReasonKey, number>;
  meanAbsOffsetMs: number | null;
}

/** What the runs saw of one wave of the level. */
export interface WaveReport {
  fromMs: number;
  maxSimultaneous: number;
  /** Summed over the runs. */
  telegraphs: number;
  /** The most threats at once, over the runs. */
  peakSimultaneous: number;
  /** The runs where the count went above `maxSimultaneous`: always 0 unless the director is wrong. */
  overLimitRuns: number;
}

export interface SimReport {
  level: string;
  bot: string;
  seed: number;
  runs: number;
  /** Where each game stops at the latest: the cap, or the level's duration. */
  untilSimMs: number;
  /** The runs that saw `LevelEnded`. */
  endedRuns: number;
  hashes: { feel: string; geometry: string; level: string; bots: string };
  /** Mama's score arrives with story 1.22. */
  meanScore: null;
  scoreNote: string;
  /** `null` when no response was seen (no threat, or a game too short for one): not 0 %. */
  meanSuccessPct: number | null;
  threats: Record<string, ThreatReport>;
  /** One per wave of the level, in order. */
  waves: WaveReport[];
  gags: {
    total: number;
    meanPerRun: number;
    byGag: Record<string, number>;
    /** Total `NearMiss` events over the runs (the stairs' gags today). */
    nearMisses: number;
  };
  /** The micro-sleeps telegraphed, over the runs (story 1.19). */
  microSleeps: number;
  /** The coffees drunk, over the runs. */
  coffees: number;
  /** The runs where Papa fell asleep at least once (a missed micro-sleep). */
  asleepRuns: number;
  runList: {
    seed: number;
    worldHash: string;
    responses: number;
    gags: number;
    commands: number;
  }[];
}

export const SCORE_NOTE = "Mama's score arrives with story 1.22";

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0; // + 0: no "-0"
};
const countOf = (counts: Record<string, number>, key: string): number =>
  Object.hasOwn(counts, key) ? (counts[key] as number) : 0;
const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : round((part / whole) * 100, 1);

export interface ReportInput {
  level: string;
  bot: string;
  seed: number;
  untilSimMs: number;
  hashes: SimReport['hashes'];
  /** The level's waves: where they start and how many threats they allow at once. */
  waves: readonly { readonly fromMs: number; readonly maxSimultaneous: number }[];
}

const sortedKeys = (record: Record<string, unknown>): string[] => Object.keys(record).sort();

/** Folds the runs into the report. Pure: the same runs give the same report, key for key. */
export function summarizeRuns(input: ReportInput, runs: readonly RunSummary[]): SimReport {
  const merged: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let good = 0;
  let gags = 0;
  let nearMisses = 0;
  let endedRuns = 0;
  let microSleeps = 0;
  let coffees = 0;
  let asleepRuns = 0;
  const waves: WaveReport[] = input.waves.map((wave) => ({
    fromMs: wave.fromMs,
    maxSimultaneous: wave.maxSimultaneous,
    telegraphs: 0,
    peakSimultaneous: 0,
    overLimitRuns: 0,
  }));
  for (const run of runs) {
    if (run.isEnded) endedRuns++;
    run.waves.forEach((tally, index) => {
      const into = waves[index];
      if (into === undefined) return;
      into.telegraphs += tally.telegraphs;
      into.peakSimultaneous = Math.max(into.peakSimultaneous, tally.peakSimultaneous);
      if (tally.isOverLimit) into.overLimitRuns++;
    });
    gags += run.gags;
    nearMisses += run.nearMisses;
    microSleeps += run.microSleeps;
    coffees += run.coffees;
    if (run.asleepGags > 0) asleepRuns++;
    for (const gag of Object.keys(run.byGag)) {
      byGag[gag] = countOf(byGag, gag) + countOf(run.byGag, gag);
    }
    for (const defId of Object.keys(run.threats)) {
      const from = run.threats[defId] as ThreatTally;
      const into = tallyOf(merged, defId);
      into.responses += from.responses;
      into.perfect += from.perfect;
      into.success += from.success;
      into.fail += from.fail;
      for (const reason of FAIL_REASONS) into.failReasons[reason] += from.failReasons[reason];
      into.absOffsetSumMs += from.absOffsetSumMs;
      into.offsetCount += from.offsetCount;
    }
    responses += run.responses;
  }

  const threats: Record<string, ThreatReport> = {};
  for (const defId of sortedKeys(merged)) {
    const tally = merged[defId] as ThreatTally;
    good += tally.perfect + tally.success;
    threats[defId] = {
      responses: tally.responses,
      perfect: tally.perfect,
      success: tally.success,
      fail: tally.fail,
      perfectPct: pct(tally.perfect, tally.responses),
      successPct: pct(tally.success, tally.responses),
      failPct: pct(tally.fail, tally.responses),
      failReasons: { ...tally.failReasons },
      meanAbsOffsetMs:
        tally.offsetCount === 0 ? null : round(tally.absOffsetSumMs / tally.offsetCount, 1),
    };
  }

  const sortedByGag: Record<string, number> = {};
  for (const gag of sortedKeys(byGag)) sortedByGag[gag] = byGag[gag] as number;

  return {
    level: input.level,
    bot: input.bot,
    seed: input.seed,
    runs: runs.length,
    untilSimMs: input.untilSimMs,
    endedRuns,
    hashes: input.hashes,
    meanScore: null,
    scoreNote: SCORE_NOTE,
    meanSuccessPct: responses === 0 ? null : pct(good, responses),
    threats,
    waves,
    gags: {
      total: gags,
      meanPerRun: runs.length === 0 ? 0 : round(gags / runs.length, 2),
      byGag: sortedByGag,
      nearMisses,
    },
    microSleeps,
    coffees,
    asleepRuns,
    runList: runs.map((run) => ({
      seed: run.seed,
      worldHash: run.worldHash,
      responses: run.responses,
      gags: run.gags,
      commands: run.commands,
    })),
  };
}

const WAVES_PLACEHOLDER = '__waves__';

/** The report as it is written: 2-space JSON and a trailing newline, one line per wave. */
export function renderReport(report: SimReport): string {
  const text = JSON.stringify({ ...report, waves: WAVES_PLACEHOLDER }, null, 2);
  const lines = report.waves.map((wave) => `    ${JSON.stringify(wave)}`);
  const waves = lines.length === 0 ? '[]' : `[\n${lines.join(',\n')}\n  ]`;
  return `${text.replace(`"${WAVES_PLACEHOLDER}"`, waves)}\n`;
}
