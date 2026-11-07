import { describe, expect, it } from 'vitest';
import {
  type BalanceReports,
  type BalanceTargets,
  balanceLevelArg,
  balanceVerdict,
  renderBalanceLine,
} from '../../../tools/sim/balanceCheck.ts';
import type { SimReport } from '../../../tools/sim/simReport.ts';

// `balanceVerdict` on hand-made reports (story 9.8, AC 9): each target goes KO alone, the bounds are
// inclusive, and a batch of zero games is refused.

const TARGETS: BalanceTargets = {
  runs: 200,
  seed: 1,
  tier: 'normal',
  humanLossPct: { min: 10, max: 30 },
  humanMustFailDefs: ['outlet', 'stairs'],
  humanOpenDoorMustGag: true,
  perfectChoresEveryRun: true,
  idleLosesBeforeTimer: true,
};
const RUNS = 200;
const UNTIL_MS = 180_000;

/** Only what the verdict reads of a report. */
function report(patch: {
  runs?: number;
  mamaHome?: number;
  mamaWoke?: number;
  fails?: Record<string, number>;
  gags?: number;
  fairnessViolations?: number;
  choresCompleted?: Record<string, number>;
  openGagged?: number;
  idleRuns?: { endReason: string | null; mamaHomeAtMs: number | null }[];
}): SimReport {
  const runs = patch.runs ?? RUNS;
  const fails = patch.fails ?? {};
  return {
    runs,
    untilSimMs: UNTIL_MS,
    endsByReason: {
      timer: 0,
      mamaWoke: patch.mamaWoke ?? 0,
      cycleDone: 0,
      mamaHome: patch.mamaHome ?? 0,
    },
    threats: Object.fromEntries(
      Object.entries(fails).map(([defId, fail]) => [defId, { responses: 50, fail }]),
    ),
    gags: { total: patch.gags ?? 0 },
    fairnessViolations: patch.fairnessViolations ?? 0,
    chores: {
      byDef: Object.fromEntries(
        Object.entries(patch.choresCompleted ?? { cooking: runs, unload_dishwasher: runs }).map(
          ([id, runsCompleted]) => [id, { runsCompleted }],
        ),
      ),
      open: { telegraphed: 5, closed: 3, gagged: patch.openGagged ?? 2 },
    },
    runList: patch.idleRuns ?? [],
  } as unknown as SimReport;
}

const idleRuns = (mamaHomeAtMs: number | null = 26_000, count = RUNS) =>
  Array.from({ length: count }, () => ({
    endReason: mamaHomeAtMs === null ? 'timer' : 'mamaHome',
    mamaHomeAtMs,
  }));

/** A set of reports that holds every target of `TARGETS`. */
function good(): { -readonly [K in keyof BalanceReports]: SimReport } {
  return {
    human: report({ mamaHome: 40, fails: { outlet: 30, stairs: 12 } }),
    perfect: report({}),
    idle: report({ mamaHome: RUNS, idleRuns: idleRuns() }),
  };
}

function verdictOf(reports: BalanceReports, targets: BalanceTargets = TARGETS) {
  const verdict = balanceVerdict(reports, targets);
  if (!verdict.ok) throw new Error(verdict.error);
  return verdict.value;
}

const koNames = (reports: BalanceReports, targets?: BalanceTargets): string[] =>
  verdictOf(reports, targets)
    .lines.filter((entry) => !entry.isOk)
    .map((entry) => entry.name);

describe('balanceVerdict', () => {
  it('is OK when every target holds, with one line per target', () => {
    const verdict = verdictOf(good());
    expect(koNames(good())).toEqual([]);
    expect(verdict.isOk).toBe(true);
    expect(verdict.lines.map((entry) => entry.name)).toEqual([
      'human loses the level',
      'human fails each new mischief at least once',
      'the baby gets into the open dishwasher',
      'perfect fails no threat',
      'perfect never loses and the director is fair',
      'perfect finishes every chore in every game',
      'idle loses every game before the timer',
    ]);
  });

  it('keeps the loss range inclusive: 10 % and 30 % pass, 9.5 % and 30.5 % do not', () => {
    for (const [lost, isOk] of [
      [20, true],
      [60, true],
      [19, false],
      [61, false],
    ] as const) {
      const reports = { ...good(), human: report({ mamaHome: lost, fails: { outlet: 1 } }) };
      expect(koNames(reports).includes('human loses the level'), `${lost}`).toBe(!isOk);
    }
  });

  it('judges the loss range on the exact share, not on the rounded one', () => {
    const targets = { ...TARGETS, runs: 3000 };
    const lost = (mamaHome: number) =>
      koNames(
        { ...good(), human: report({ runs: 3000, mamaHome, fails: { outlet: 1 } }) },
        targets,
      ).includes('human loses the level');
    // 299/3000 = 9.967 % rounds to 10.0 on one decimal, and is still under the 10 % minimum.
    expect(lost(299)).toBe(true);
    expect(lost(300)).toBe(false);
    expect(lost(900)).toBe(false);
    // 901/3000 = 30.033 % rounds to 30.0 and is over the maximum.
    expect(lost(901)).toBe(true);
  });

  it('goes KO on a human who never fails a threat, or never lets the baby into the dishwasher', () => {
    expect(
      koNames({ ...good(), human: report({ mamaHome: 40, fails: { outlet: 3, stairs: 0 } }) }),
    ).toEqual(['human fails each new mischief at least once']);
    expect(
      koNames({
        ...good(),
        human: report({ mamaHome: 40, fails: { outlet: 3, stairs: 1 }, openGagged: 0 }),
      }),
    ).toEqual(['the baby gets into the open dishwasher']);
  });

  it('goes KO on a perfect that fails a threat, wakes Mama, or breaks the director’s fairness', () => {
    expect(koNames({ ...good(), perfect: report({ fails: { outlet: 1 }, gags: 1 }) })).toEqual([
      'perfect fails no threat',
      'perfect never loses and the director is fair',
    ]);
    expect(koNames({ ...good(), perfect: report({ mamaWoke: 1 }) })).toEqual([
      'perfect never loses and the director is fair',
    ]);
    expect(koNames({ ...good(), perfect: report({ fairnessViolations: 1 }) })).toEqual([
      'perfect never loses and the director is fair',
    ]);
  });

  it('goes KO when the perfect bot leaves one chore unfinished in one game', () => {
    const perfect = report({ choresCompleted: { cooking: RUNS, unload_dishwasher: RUNS - 1 } });
    expect(koNames({ ...good(), perfect })).toEqual(['perfect finishes every chore in every game']);
  });

  it('goes KO on a level with no chore when the chores are asked for (nothing was measured)', () => {
    expect(koNames({ ...good(), perfect: report({ choresCompleted: {} }) })).toEqual([
      'perfect finishes every chore in every game',
    ]);
  });

  it('goes KO when idle survives one game, or loses it only at the timer', () => {
    expect(
      koNames({ ...good(), idle: report({ mamaHome: RUNS - 1, idleRuns: idleRuns() }) }),
    ).toEqual(['idle loses every game before the timer']);
    expect(
      koNames({ ...good(), idle: report({ mamaHome: RUNS, idleRuns: idleRuns(UNTIL_MS) }) }),
    ).toEqual(['idle loses every game before the timer']);
  });

  it('skips the lines whose target is switched off', () => {
    const off: BalanceTargets = {
      ...TARGETS,
      humanMustFailDefs: [],
      humanOpenDoorMustGag: false,
      perfectChoresEveryRun: false,
      idleLosesBeforeTimer: false,
    };
    expect(verdictOf(good(), off).lines.map((entry) => entry.name)).toEqual([
      'human loses the level',
      'perfect fails no threat',
      'perfect never loses and the director is fair',
    ]);
  });

  it('refuses a batch of zero games, whichever bot it is, rather than passing it', () => {
    for (const bot of ['human', 'perfect', 'idle'] as const) {
      const verdict = balanceVerdict({ ...good(), [bot]: report({ runs: 0 }) }, TARGETS);
      expect(verdict.ok, bot).toBe(false);
      if (!verdict.ok) expect(verdict.error).toContain(bot);
    }
  });
});

describe('renderBalanceLine', () => {
  it('starts with OK or KO, then the target, the measure and the bounds', () => {
    const [first] = verdictOf(good()).lines;
    expect(renderBalanceLine(first as NonNullable<typeof first>)).toBe(
      'OK  human loses the level: 20 % (40/200) (target 10..30 %)',
    );
    const ko = verdictOf({ ...good(), human: report({ mamaHome: 100, fails: { outlet: 1 } }) })
      .lines[0];
    expect(renderBalanceLine(ko as NonNullable<typeof ko>)).toMatch(
      /^KO {2}human loses the level: 50 %/,
    );
  });
});

describe('balanceLevelArg', () => {
  it('defaults to the first level and takes --level', () => {
    expect(balanceLevelArg([])).toEqual({ ok: true, value: 'salon_kitchen' });
    expect(balanceLevelArg(['--level', 'chambre_night'])).toEqual({
      ok: true,
      value: 'chambre_night',
    });
    expect(balanceLevelArg(['--level']).ok).toBe(false);
    expect(balanceLevelArg(['--bot', 'human']).ok).toBe(false);
    expect(balanceLevelArg(['--level', '../x']).ok).toBe(false);
  });
});
