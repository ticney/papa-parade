import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PlaytestFile } from '@content/schemas/playtest';
import { DEFAULT_LEVEL_ID } from '@shared/constants';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { loadThresholds } from '../playtest/playtestMetrics.ts';
import { loadSimLevel } from './loadSimLevel.ts';
import { runSim } from './runSim.ts';
import type { SimArgs } from './simArgs.ts';
import type { SimReport } from './simReport.ts';

// `npm run sim:balance` (story 9.8, D8): plays the first level with `human`, `perfect` and `idle` and proves
// the GDD's « La défaite est possible sans être un mur » from the targets kept in `content/playtest.json`.
// `npm run ci` runs it, so a content change that breaks the rhythm fails the check that precedes a playtest link.

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const BALANCE_BOTS = ['human', 'perfect', 'idle'] as const;

export type BalanceTargets = PlaytestFile['simulated'];
export type BalanceReports = Readonly<Record<(typeof BALANCE_BOTS)[number], SimReport>>;

/** One target, judged. */
export interface BalanceLine {
  readonly name: string;
  readonly isOk: boolean;
  /** What the games gave. */
  readonly measured: string;
  /** What the target asked for. */
  readonly bounds: string;
}

export interface BalanceVerdict {
  readonly lines: readonly BalanceLine[];
  /** Every line is OK. */
  readonly isOk: boolean;
}

const pct = (part: number, whole: number): number => (part * 100) / whole;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Every fail of every threat def over the games. */
const failsOf = (report: SimReport): number =>
  Object.values(report.threats).reduce((sum, tally) => sum + tally.fail, 0);

/**
 * Judges the reports of the three bots against the targets, one line per target. Pure. A batch of zero
 * games is refused (it would pass every target by having nothing to measure). The bounds are inclusive.
 */
export function balanceVerdict(
  reports: BalanceReports,
  targets: BalanceTargets,
): Result<BalanceVerdict, string> {
  for (const bot of BALANCE_BOTS) {
    if (reports[bot].runs === 0) return err(`the ${bot} report holds no game: nothing to judge`);
  }
  const lines: BalanceLine[] = [];
  const line = (name: string, isOk: boolean, measured: string, bounds: string): void => {
    lines.push({ name, isOk, measured, bounds });
  };

  const { human, perfect, idle } = reports;
  const lostPct = round1(pct(human.endsByReason.mamaHome, human.runs));
  const { min, max } = targets.humanLossPct;
  line(
    'human loses the level',
    // On the exact share, not the rounded one printed: 299/3000 is 9.97 %, not the 10 % it rounds to.
    human.endsByReason.mamaHome * 100 >= min * human.runs &&
      human.endsByReason.mamaHome * 100 <= max * human.runs,
    `${lostPct} % (${human.endsByReason.mamaHome}/${human.runs})`,
    `${min}..${max} %`,
  );
  if (targets.humanMustFailDefs.length > 0) {
    const unfailed = targets.humanMustFailDefs.filter(
      (defId) => (human.threats[defId]?.fail ?? 0) === 0,
    );
    line(
      'human fails each new mischief at least once',
      unfailed.length === 0,
      unfailed.length === 0 ? 'all of them' : `never failed: ${unfailed.join(', ')}`,
      `${targets.humanMustFailDefs.length} defs`,
    );
  }
  if (targets.humanOpenDoorMustGag) {
    line(
      'the baby gets into the open dishwasher',
      human.chores.open.gagged > 0,
      `${human.chores.open.gagged} time(s)`,
      '> 0',
    );
  }
  const perfectFails = failsOf(perfect);
  line('perfect fails no threat', perfectFails === 0, `${perfectFails} fail(s)`, '0 fail');
  line(
    'perfect never loses and the director is fair',
    perfect.gags.total === 0 &&
      perfect.endsByReason.mamaHome === 0 &&
      perfect.endsByReason.mamaWoke === 0 &&
      perfect.fairnessViolations === 0,
    `${perfect.endsByReason.mamaHome} home, ${perfect.endsByReason.mamaWoke} woke, ${perfect.fairnessViolations} unfair`,
    '0, 0, 0',
  );
  if (targets.perfectChoresEveryRun) {
    const defs = Object.entries(perfect.chores.byDef);
    const short = defs
      .filter(([, total]) => total.runsCompleted !== perfect.runs)
      .map(([id, total]) => `${id} ${total.runsCompleted}/${perfect.runs}`);
    line(
      'perfect finishes every chore in every game',
      defs.length > 0 && short.length === 0,
      defs.length === 0
        ? 'no chore in the level'
        : short.length === 0
          ? 'all of them'
          : short.join(', '),
      `${perfect.runs}/${perfect.runs} each`,
    );
  }
  if (targets.idleLosesBeforeTimer) {
    const lateOnes = idle.runList.filter(
      (run) =>
        run.endReason !== 'mamaHome' ||
        run.mamaHomeAtMs === null ||
        run.mamaHomeAtMs >= idle.untilSimMs,
    ).length;
    line(
      'idle loses every game before the timer',
      lateOnes === 0 && idle.endsByReason.mamaHome === idle.runs,
      `${idle.endsByReason.mamaHome}/${idle.runs} lost, ${lateOnes} not before the timer`,
      `${idle.runs}/${idle.runs} before ${idle.untilSimMs / 1000} s`,
    );
  }
  return ok({ lines, isOk: lines.every((candidate) => candidate.isOk) });
}

/** One line of the table the command prints. */
export function renderBalanceLine(entry: BalanceLine): string {
  return `${entry.isOk ? 'OK' : 'KO'}  ${entry.name}: ${entry.measured} (target ${entry.bounds})`;
}

function argsFor(
  levelId: string,
  botId: (typeof BALANCE_BOTS)[number],
  targets: BalanceTargets,
): SimArgs {
  return {
    levelId,
    botId,
    tier: targets.tier,
    seed: targets.seed,
    runs: targets.runs,
    untilSimMs: null,
    outPath: null,
    journalsDir: null,
    chronoRing: 'on',
    compareDir: null,
    sequenceId: null,
    sequenceAtMs: 1000,
    help: false,
  };
}

/** The level to check: `--level <id>`, or the game's first level. */
export function balanceLevelArg(argv: readonly string[]): Result<string, string> {
  if (argv.length === 0) return ok(DEFAULT_LEVEL_ID);
  if (argv.length === 2 && argv[0] === '--level' && /^[a-z][a-z0-9_]*$/.test(argv[1] as string)) {
    return ok(argv[1] as string);
  }
  return err('usage: npm run sim:balance [-- --level <levelId>]');
}

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('sim', message);
    process.exitCode = 1;
  };
  const level = balanceLevelArg(process.argv.slice(2));
  if (!level.ok) return fail(level.error);
  const thresholds = await loadThresholds();
  if (!thresholds.ok) return fail(thresholds.error.join('; '));
  const targets = thresholds.value.simulated;
  const loaded = await loadSimLevel(CONTENT_DIR, level.value);
  if (!loaded.ok) return fail(loaded.error);

  const reports: Partial<Record<(typeof BALANCE_BOTS)[number], SimReport>> = {};
  for (const bot of BALANCE_BOTS) {
    // The loaded level is read, never changed, by a run: one load serves the three bots.
    const result = await runSim(argsFor(level.value, bot, targets), loaded.value);
    if (!result.ok) return fail(`${bot}: ${result.error}`);
    reports[bot] = result.value;
  }
  const verdict = balanceVerdict(reports as BalanceReports, targets);
  if (!verdict.ok) return fail(verdict.error);
  const heading = `sim:balance ${level.value}: ${targets.runs} games per bot from seed ${targets.seed}, tier ${targets.tier}\n`;
  process.stdout.write(
    `${heading}${verdict.value.lines.map((entry) => renderBalanceLine(entry)).join('\n')}\n`,
  );
  if (!verdict.value.isOk) {
    fail(
      'the balance targets are not held: retune the waves of the level (content/levels/), not the targets',
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
