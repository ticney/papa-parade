import type { PlaytestThresholds } from '@content/schemas/playtest';
import type { SkippedFile, TesterGame, TesterGames } from './loadJournals.ts';
import type { ObservationRow } from './observations.ts';
import { compareNames } from './testerId.ts';

export const PLAYTEST_REPORT_KIND = 'papa-parade.playtest-metrics';
export const PLAYTEST_REPORT_VERSION = 1;

export type Status = 'OK' | 'KO' | 'n/a';
export type DeviceName = 'touch' | 'mouse' | 'keyboard' | 'gamepad' | 'none';
const DEVICE_NAMES: readonly DeviceName[] = ['touch', 'mouse', 'keyboard', 'gamepad', 'none'];

/**
 * A share of a group: `valuePct` is truncated to one decimal for the report (so it never shows the
 * threshold when the status is KO), `status` uses the exact counts.
 */
export interface Measure {
  hits: number;
  /** What the share is computed on (testers, most of the time). */
  count: number;
  valuePct: number | null;
  thresholdPct: number;
  status: Status;
}

export interface ThreatMeasure {
  /** One entry per threat that appears in the data, sorted by id. */
  byThreat: Record<string, Measure>;
  /** `OK` only when every threat is `OK`, `n/a` when no threat appears, `KO` otherwise. */
  status: Status;
}

export interface Rate {
  hits: number;
  total: number;
  ratePct: number | null;
}

export interface TouchVsKeyboard {
  /** Success rate of each device, over every response of the panel. */
  rates: Record<DeviceName, Rate>;
  /** Touch rate as a share of the keyboard rate; `null` when either device has no response or the keyboard rate is 0. */
  ratioPct: number | null;
  thresholdPct: number;
  status: Status;
}

export interface PanelMeasure {
  testers: number;
  minTesters: number;
  status: Status;
}

export interface GameLine {
  file: string;
  sessionId: string;
  gameIndex: number;
  levelId: string;
  endReason: string;
  stars: number;
}

export interface TesterComment {
  line: number;
  sessionId: string | null;
  threatId: string | null;
  text: string;
}

export interface TesterReport {
  testerId: string;
  /** Device types and platforms the tester's journals report, sorted. */
  deviceTypes: string[];
  platforms: string[];
  /** In play order: session order, then game index. */
  games: GameLine[];
  relaunch: { games: number; highestGameIndex: number; relaunched: boolean };
  /** The first resolved response to each threat the tester met. */
  firstEncounter: Record<string, 'success' | 'fail'>;
  /** Success rate of each device the tester used. */
  rates: Partial<Record<DeviceName, Rate>>;
  /** Touch rate over keyboard rate, when the tester used both. */
  touchVsKeyboardPct: number | null;
  identifiedWithoutHelp: Record<string, boolean>;
  perfectCited: boolean | null;
  laughs: number | null;
  laughed: boolean | null;
  comments: TesterComment[];
}

export interface ReportInputs {
  folder: string;
  /** `null` = no observations file. */
  observationsPath: string | null;
  levels: string[];
  contentHashes: string[];
  filesRead: number;
  skipped: SkippedFile[];
}

export interface PlaytestReport {
  kind: typeof PLAYTEST_REPORT_KIND;
  version: typeof PLAYTEST_REPORT_VERSION;
  thresholds: PlaytestThresholds;
  panel: PanelMeasure;
  /** Indicator 1, computed. */
  relaunch: Measure;
  /** Indicator 2, observed. */
  perfectCited: Measure;
  /** Indicator 3, observed. */
  identification: ThreatMeasure;
  /** Indicator 3, computed proxy. */
  firstEncounter: ThreatMeasure;
  /** Indicator 4, computed. */
  touchVsKeyboard: TouchVsKeyboard;
  /** Indicator 5, observed. */
  laughed: Measure;
  testers: TesterReport[];
  inputs: ReportInputs;
  warnings: string[];
}

export interface ComputeMetricsInput {
  testers: readonly TesterGames[];
  observations: readonly ObservationRow[];
  thresholds: PlaytestThresholds;
  inputs: ReportInputs;
  /** Warnings the readers already raised; they come first in the report. */
  warnings?: readonly string[];
}

/** Truncated, not rounded: 79.96 % is shown as 79.9, never as the 80 it does not reach. */
function roundedPct(hits: number, total: number): number | null {
  return total === 0 ? null : Math.floor((hits * 1000) / total) / 10;
}

/** The value of an own key, so that a threat id such as `constructor` never reads `Object.prototype`. */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Integers only: `hits * 100 >= minPct * count`, so that 4 of 5 at 80 % is exactly `OK`. */
function measureOf(hits: number, count: number, thresholdPct: number): Measure {
  const status: Status = count === 0 ? 'n/a' : hits * 100 >= thresholdPct * count ? 'OK' : 'KO';
  return { hits, count, valuePct: roundedPct(hits, count), thresholdPct, status };
}

function threatMeasureOf(
  perTester: readonly Record<string, boolean>[],
  thresholdPct: number,
): ThreatMeasure {
  const threats = new Set<string>();
  for (const record of perTester) for (const threat of Object.keys(record)) threats.add(threat);
  const byThreat: Record<string, Measure> = {};
  for (const threat of [...threats].sort(compareNames)) {
    let hits = 0;
    let count = 0;
    for (const record of perTester) {
      const value = ownValue(record, threat);
      if (value === undefined) continue;
      count++;
      if (value) hits++;
    }
    byThreat[threat] = measureOf(hits, count, thresholdPct);
  }
  const measures = Object.values(byThreat);
  const status: Status =
    measures.length === 0 ? 'n/a' : measures.every((m) => m.status === 'OK') ? 'OK' : 'KO';
  return { byThreat, status };
}

function emptyRates(): Record<DeviceName, { hits: number; total: number }> {
  return {
    touch: { hits: 0, total: 0 },
    mouse: { hits: 0, total: 0 },
    keyboard: { hits: 0, total: 0 },
    gamepad: { hits: 0, total: 0 },
    none: { hits: 0, total: 0 },
  };
}

function rateOf(counts: { hits: number; total: number }): Rate {
  return { ...counts, ratePct: roundedPct(counts.hits, counts.total) };
}

/**
 * Touch rate over keyboard rate, in % truncated to one decimal, or `null` when it is undefined (a
 * device without response, or a keyboard rate of 0). Computed from the counts, never from rounded rates.
 */
function ratioOf(
  touch: { hits: number; total: number },
  keyboard: { hits: number; total: number },
): number | null {
  if (touch.total === 0 || keyboard.total === 0 || keyboard.hits === 0) return null;
  return Math.floor((touch.hits * keyboard.total * 1000) / (touch.total * keyboard.hits)) / 10;
}

function ratioStatus(
  touch: { hits: number; total: number },
  keyboard: { hits: number; total: number },
  thresholdPct: number,
): Status {
  if (touch.total === 0 || keyboard.total === 0 || keyboard.hits === 0) return 'n/a';
  // touch.hits / touch.total >= (min / 100) * keyboard.hits / keyboard.total, cross-multiplied.
  return touch.hits * keyboard.total * 100 >= thresholdPct * keyboard.hits * touch.total
    ? 'OK'
    : 'KO';
}

/**
 * The order in which a tester's sessions were played: the order their ids first appear in the
 * observations (Geo wrote them as they came), then the others by id. The journal holds no date, so
 * nothing else can say.
 */
function sessionOrderOf(
  journalSessions: ReadonlySet<string>,
  rows: readonly ObservationRow[],
): string[] {
  const order: string[] = [];
  for (const row of rows) {
    if (row.sessionId !== null && !order.includes(row.sessionId)) order.push(row.sessionId);
  }
  const rest = [...journalSessions].filter((id) => !order.includes(id)).sort(compareNames);
  return [...order, ...rest];
}

/** `null` for a quality this tool does not know: the caller leaves the response out and says so. */
function outcomeOf(quality: string): 'success' | 'fail' | null {
  if (quality === 'perfect' || quality === 'success') return 'success';
  return quality === 'fail' ? 'fail' : null;
}

function analyseTester(
  testerId: string,
  tester: TesterGames,
  rows: readonly ObservationRow[],
  warnings: string[],
): TesterReport {
  const journalSessions = new Set(tester.games.map((g) => g.journal.summary.sessionId));
  const order = sessionOrderOf(journalSessions, rows);
  const rank = (sessionId: string): number => order.indexOf(sessionId);

  if (journalSessions.size > 1) {
    const inNotes = new Set(rows.flatMap((row) => (row.sessionId === null ? [] : [row.sessionId])));
    if ([...journalSessions].some((id) => !inNotes.has(id))) {
      warnings.push(
        `tester ${testerId} has ${journalSessions.size} sessions and the notes do not order them all: session order unknown, first encounters may be wrong`,
      );
    }
  }
  for (const sessionId of [...journalSessions].sort((a, b) => rank(a) - rank(b))) {
    const hasFirst = tester.games.some(
      (g) =>
        g.journal.summary.sessionId === sessionId && g.journal.summary.gameIndexInSession === 1,
    );
    if (!hasFirst) {
      warnings.push(
        `tester ${testerId} session ${sessionId} has no game 1: its first encounters may be those of a later game, and its device rates cover only the games sent`,
      );
    }
  }
  for (const row of rows) {
    if (row.sessionId !== null && !journalSessions.has(row.sessionId)) {
      warnings.push(
        `observations line ${row.line}: session ${row.sessionId} is not one of ${testerId}'s journals`,
      );
    }
  }

  const played: TesterGame[] = [...tester.games].sort(
    (a, b) =>
      rank(a.journal.summary.sessionId) - rank(b.journal.summary.sessionId) ||
      a.journal.summary.gameIndexInSession - b.journal.summary.gameIndexInSession,
  );

  const firstEncounter = new Map<string, 'success' | 'fail'>();
  const totals = emptyRates();
  for (const { file, journal } of played) {
    for (const entry of journal.summary.responses.timeline) {
      const outcome = outcomeOf(entry.quality);
      if (outcome === null) {
        warnings.push(
          `${file}: a response to ${entry.threatDefId} has an unknown quality "${entry.quality}" and is left out of the first encounters`,
        );
        continue;
      }
      if (!firstEncounter.has(entry.threatDefId)) firstEncounter.set(entry.threatDefId, outcome);
    }
    for (const device of DEVICE_NAMES) {
      const counts = journal.summary.responses.byDevice[device];
      totals[device].hits += counts.perfect + counts.success;
      totals[device].total += counts.perfect + counts.success + counts.fail;
    }
  }
  const rates: Partial<Record<DeviceName, Rate>> = {};
  for (const device of DEVICE_NAMES) {
    if (totals[device].total > 0) rates[device] = rateOf(totals[device]);
  }

  // One judgment per threat: the row with no session first (it covers the tester), else the earliest session's.
  const identified = new Map<string, { value: boolean; rank: number; line: number }>();
  const conflicting = new Set<string>();
  for (const row of rows) {
    if (row.threatId === null || row.identifiedWithoutHelp === null) continue;
    const rowRank = row.sessionId === null ? -1 : rank(row.sessionId);
    const current = identified.get(row.threatId);
    if (current !== undefined && current.value !== row.identifiedWithoutHelp) {
      conflicting.add(row.threatId);
    }
    if (current === undefined || rowRank < current.rank) {
      identified.set(row.threatId, {
        value: row.identifiedWithoutHelp,
        rank: rowRank,
        line: row.line,
      });
    }
  }
  for (const threatId of [...conflicting].sort(compareNames)) {
    warnings.push(
      `tester ${testerId}: the notes judge ${threatId} differently on several rows: the earliest session's judgment (line ${identified.get(threatId)?.line}) counts`,
    );
  }

  const cited = rows.map((row) => row.perfectCitedSpontaneously).filter((v) => v !== null);
  const laughValues = rows.map((row) => row.laughs).filter((v) => v !== null);
  const laughs = laughValues.length === 0 ? null : laughValues.reduce((sum, v) => sum + v, 0);

  const highest = Math.max(0, ...played.map((g) => g.journal.summary.gameIndexInSession));
  const sortedNames = (values: string[]): string[] => [...new Set(values)].sort(compareNames);

  return {
    testerId,
    deviceTypes: sortedNames(played.map((g) => g.journal.device.type)),
    platforms: sortedNames(played.map((g) => g.journal.device.platform)),
    games: played.map(({ file, journal }) => ({
      file,
      sessionId: journal.summary.sessionId,
      gameIndex: journal.summary.gameIndexInSession,
      levelId: journal.replay.levelId,
      endReason: journal.summary.endReason,
      stars: journal.summary.score.stars,
    })),
    relaunch: { games: played.length, highestGameIndex: highest, relaunched: highest >= 2 },
    firstEncounter: Object.fromEntries(firstEncounter),
    rates,
    touchVsKeyboardPct: ratioOf(totals.touch, totals.keyboard),
    identifiedWithoutHelp: Object.fromEntries(
      [...identified].map(([threatId, judgment]) => [threatId, judgment.value]),
    ),
    perfectCited: cited.length === 0 ? null : cited.includes(true),
    laughs,
    laughed: laughs === null ? null : laughs >= 1,
    comments: rows
      .filter((row) => row.comment.trim() !== '')
      .map((row) => ({
        line: row.line,
        sessionId: row.sessionId,
        threatId: row.threatId,
        text: row.comment.trim(),
      })),
  };
}

/**
 * The five indicators of NFR11 for a panel, per tester and overall. Pure: it reads no file and no
 * clock, and the same input gives the same report. See story 3.4 for the rules; the status always
 * comes from integer comparisons.
 */
export function computeMetrics(input: ComputeMetricsInput): PlaytestReport {
  const { thresholds } = input;
  const warnings = [...(input.warnings ?? [])];
  const journals = new Map(input.testers.map((tester) => [tester.testerId, tester]));
  const rowsByTester = new Map<string, ObservationRow[]>();
  for (const row of input.observations) {
    const rows = rowsByTester.get(row.testerId) ?? [];
    rows.push(row);
    rowsByTester.set(row.testerId, rows);
  }
  // Notes about a tester with no usable journal are left out of the panel and of every indicator: a
  // typo in a testerId (`t1` for `T1`) would otherwise count as one more tester.
  for (const [id, rows] of [...rowsByTester].sort((a, b) => compareNames(a[0], b[0]))) {
    if (journals.has(id)) continue;
    warnings.push(
      `tester ${id} has notes (line${rows.length === 1 ? '' : 's'} ${rows.map((row) => row.line).join(', ')}) and no usable journal: the notes are ignored; check the id against the journal folders`,
    );
  }
  const testers = [...journals.keys()]
    .sort(compareNames)
    .map((id) =>
      analyseTester(id, journals.get(id) as TesterGames, rowsByTester.get(id) ?? [], warnings),
    );

  // Indicator 1
  const relaunch = measureOf(
    testers.filter((t) => t.relaunch.relaunched).length,
    testers.length,
    thresholds.relaunchMinPct,
  );

  // Indicator 3, computed proxy
  const firstEncounter = threatMeasureOf(
    testers.map((t) =>
      Object.fromEntries(Object.entries(t.firstEncounter).map(([id, v]) => [id, v === 'success'])),
    ),
    thresholds.firstEncounterSuccessMinPct,
  );

  // Indicator 4
  const pooled = emptyRates();
  for (const t of testers) {
    for (const device of DEVICE_NAMES) {
      const rate = t.rates[device];
      if (rate === undefined) continue;
      pooled[device].hits += rate.hits;
      pooled[device].total += rate.total;
    }
  }
  if (pooled.touch.total > 0 && pooled.keyboard.total > 0 && pooled.keyboard.hits === 0) {
    warnings.push(
      'indicator 4: the keyboard success rate is 0, so the touch vs keyboard ratio is undefined (n/a): look at the keyboard games',
    );
  }
  const touchVsKeyboard: TouchVsKeyboard = {
    rates: Object.fromEntries(DEVICE_NAMES.map((d) => [d, rateOf(pooled[d])])) as Record<
      DeviceName,
      Rate
    >,
    ratioPct: ratioOf(pooled.touch, pooled.keyboard),
    thresholdPct: thresholds.touchVsKeyboardMinPct,
    status: ratioStatus(pooled.touch, pooled.keyboard, thresholds.touchVsKeyboardMinPct),
  };

  // Indicator 3, observed
  const identification = threatMeasureOf(
    testers.map((t) => t.identifiedWithoutHelp),
    thresholds.identifiedMinPct,
  );

  // Indicator 2
  const citedKnown = testers.filter((t) => t.perfectCited !== null);
  const perfectCited = measureOf(
    citedKnown.filter((t) => t.perfectCited).length,
    citedKnown.length,
    thresholds.perfectCitedMinPct,
  );

  // Indicator 5
  const laughKnown = testers.filter((t) => t.laughed !== null);
  const laughed = measureOf(
    laughKnown.filter((t) => t.laughed).length,
    laughKnown.length,
    thresholds.laughedMinPct,
  );

  // The observed indicators count the testers whose cell is filled in: say when that is fewer than the panel.
  if (input.observations.length > 0) {
    const short: string[] = [];
    if (citedKnown.length < testers.length) {
      short.push(`2 (perfect parry): ${citedKnown.length}/${testers.length} testers`);
    }
    const threatsShort = Object.entries(identification.byThreat)
      .filter(([, measure]) => measure.count < testers.length)
      .map(([threat, measure]) => `${threat} ${measure.count}/${testers.length}`);
    if (threatsShort.length > 0) short.push(`3 (identification): ${threatsShort.join(', ')}`);
    if (laughKnown.length < testers.length) {
      short.push(`5 (laughs): ${laughKnown.length}/${testers.length} testers`);
    }
    if (short.length > 0) {
      warnings.push(
        `observed indicators judged on fewer testers than the panel (a blank cell is not counted): ${short.join('; ')}`,
      );
    }
  }
  if (input.inputs.levels.length > 1) {
    warnings.push(
      `the journals mix ${input.inputs.levels.length} levels (${input.inputs.levels.join(', ')}): relaunches and first encounters span all of them`,
    );
  }
  if (input.inputs.contentHashes.length > 1) {
    warnings.push(
      `the journals come from ${input.inputs.contentHashes.length} content versions (${input.inputs.contentHashes.join(', ')}): the games were not all played on the same build`,
    );
  }

  const panel: PanelMeasure = {
    testers: testers.length,
    minTesters: thresholds.panelMinTesters,
    status: testers.length >= thresholds.panelMinTesters ? 'OK' : 'KO',
  };
  if (panel.status === 'KO') {
    warnings.push(
      `the panel is too small: ${panel.testers} tester${panel.testers === 1 ? '' : 's'}, FR68 asks for at least ${panel.minTesters}`,
    );
  }

  return {
    kind: PLAYTEST_REPORT_KIND,
    version: PLAYTEST_REPORT_VERSION,
    thresholds,
    panel,
    relaunch,
    perfectCited,
    identification,
    firstEncounter,
    touchVsKeyboard,
    laughed,
    testers,
    inputs: input.inputs,
    warnings,
  };
}
