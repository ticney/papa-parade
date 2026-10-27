import { hashJson } from '@shared/hash';
import type { Sim, SimEvent } from '@sim';

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

/** What one run produced, kept small: counts, never events. */
export interface RunSummary {
  seed: number;
  worldHash: string;
  responses: number;
  gags: number;
  commands: number;
  threats: Record<string, ThreatTally>;
  byGag: Record<string, number>;
}

export interface RunRecorder {
  onEvent(event: SimEvent): void;
  /** Call once the run is over. */
  finish(): RunSummary;
}

/** The tally of `defId` in `tallies`, created empty on first use. */
function tallyOf(tallies: Record<string, ThreatTally>, defId: string): ThreatTally {
  let tally = tallies[defId];
  if (tally === undefined) {
    tally = emptyTally();
    tallies[defId] = tally;
  }
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
 * threat def, gags, and at the end the final world hash and the number of commands sent.
 */
export function createRunRecorder(sim: Sim, seed: number): RunRecorder {
  // Threat ids and defs never change after `createSim`.
  const defIdOf = new Map<number, string>();
  for (const threat of sim.world.threats) defIdOf.set(threat.id, threat.defId);
  const threats: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let gags = 0;
  return {
    onEvent(event) {
      if (event.type === 'ResponseResolved') {
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
        byGag[event.gag] = (byGag[event.gag] ?? 0) + 1;
      }
    },
    finish() {
      return {
        seed,
        worldHash: hashJson(sim.world),
        responses,
        gags,
        commands: sim.journal().entries.length,
        threats,
        byGag,
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

export interface SimReport {
  level: string;
  bot: string;
  seed: number;
  runs: number;
  untilSimMs: number;
  hashes: { feel: string; geometry: string; level: string; bots: string };
  /** Mama's score arrives with story 1.22. */
  meanScore: null;
  scoreNote: string;
  meanSuccessPct: number;
  threats: Record<string, ThreatReport>;
  gags: { total: number; meanPerRun: number; byGag: Record<string, number> };
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
const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : round((part / whole) * 100, 1);

export interface ReportInput {
  level: string;
  bot: string;
  seed: number;
  untilSimMs: number;
  hashes: SimReport['hashes'];
}

const sortedKeys = (record: Record<string, unknown>): string[] => Object.keys(record).sort();

/** Folds the runs into the report. Pure: the same runs give the same report, key for key. */
export function summarizeRuns(input: ReportInput, runs: readonly RunSummary[]): SimReport {
  const merged: Record<string, ThreatTally> = {};
  const byGag: Record<string, number> = {};
  let responses = 0;
  let good = 0;
  let gags = 0;
  for (const run of runs) {
    gags += run.gags;
    for (const gag of Object.keys(run.byGag))
      byGag[gag] = (byGag[gag] ?? 0) + (run.byGag[gag] ?? 0);
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
    hashes: input.hashes,
    meanScore: null,
    scoreNote: SCORE_NOTE,
    meanSuccessPct: pct(good, responses),
    threats,
    gags: {
      total: gags,
      meanPerRun: runs.length === 0 ? 0 : round(gags / runs.length, 2),
      byGag: sortedByGag,
    },
    runList: runs.map((run) => ({
      seed: run.seed,
      worldHash: run.worldHash,
      responses: run.responses,
      gags: run.gags,
      commands: run.commands,
    })),
  };
}

/** The report as it is written: 2-space JSON and a trailing newline. */
export function renderReport(report: SimReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
