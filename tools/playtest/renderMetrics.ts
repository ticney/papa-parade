import type {
  DeviceName,
  Measure,
  PlaytestReport,
  Rate,
  TesterReport,
  ThreatMeasure,
} from './computeMetrics.ts';

const DEVICE_ORDER: readonly DeviceName[] = ['touch', 'mouse', 'keyboard', 'gamepad', 'none'];

/** The JSON report: the same object, two-space indent and a final newline. No date: the same inputs give the same bytes. */
export function renderJson(report: PlaytestReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value} %`;
}

function share(measure: Measure): string {
  return measure.count === 0 ? '—' : `${pct(measure.valuePct)} (${measure.hits}/${measure.count})`;
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)];
}

function rate(value: Rate | undefined): string {
  return value === undefined ? '—' : `${pct(value.ratePct)} (${value.hits}/${value.total})`;
}

function range(counts: readonly number[]): string {
  if (counts.length === 0) return '—';
  const low = Math.min(...counts);
  const high = Math.max(...counts);
  return low === high ? String(low) : `${low}–${high}`;
}

/** Lowest share of the threats, which is the one that decides the indicator. */
function lowest(measure: ThreatMeasure): string {
  const entries = Object.entries(measure.byThreat);
  if (entries.length === 0) return '—';
  const [threat, worst] = entries.reduce((a, b) =>
    (b[1].valuePct ?? 0) < (a[1].valuePct ?? 0) ? b : a,
  );
  return `lowest: ${threat} ${share(worst)}`;
}

function summaryTable(report: PlaytestReport): string[] {
  const t = report.thresholds;
  const kb = report.touchVsKeyboard;
  const rows: string[][] = [
    [
      'Panel (FR68)',
      `${report.panel.testers} tester${report.panel.testers === 1 ? '' : 's'}`,
      `≥ ${report.panel.minTesters}`,
      String(report.panel.testers),
      report.panel.status,
    ],
    [
      '1. Relaunch, without being asked (computed)',
      share(report.relaunch),
      `≥ ${t.relaunchMinPct} %`,
      String(report.relaunch.count),
      report.relaunch.status,
    ],
    [
      '2. Perfect parry cited as a high point (observed)',
      share(report.perfectCited),
      `≥ ${t.perfectCitedMinPct} %`,
      String(report.perfectCited.count),
      report.perfectCited.status,
    ],
    [
      '3. Readability: identified without help, each threat (observed)',
      lowest(report.identification),
      `≥ ${t.identifiedMinPct} %`,
      range(Object.values(report.identification.byThreat).map((m) => m.count)),
      report.identification.status,
    ],
    [
      '3 (proxy). First-encounter success, each threat (computed)',
      lowest(report.firstEncounter),
      `≥ ${t.firstEncounterSuccessMinPct} %`,
      range(Object.values(report.firstEncounter.byThreat).map((m) => m.count)),
      report.firstEncounter.status,
    ],
    [
      '4. Touch success rate vs keyboard (computed)',
      kb.ratioPct === null
        ? `— (touch ${rate(kb.rates.touch)}, keyboard ${rate(kb.rates.keyboard)})`
        : `${pct(kb.ratioPct)} (touch ${pct(kb.rates.touch.ratePct)}, keyboard ${pct(kb.rates.keyboard.ratePct)})`,
      `≥ ${kb.thresholdPct} %`,
      `${kb.rates.touch.total} touch + ${kb.rates.keyboard.total} keyboard responses`,
      kb.status,
    ],
    [
      '5. Laughed at least once (observed)',
      share(report.laughed),
      `≥ ${t.laughedMinPct} %`,
      String(report.laughed.count),
      report.laughed.status,
    ],
  ];
  return table(['Indicator', 'Value', 'Threshold', 'Counted on', 'Status'], rows);
}

function mark(value: boolean | undefined): string {
  return value === undefined ? '—' : value ? '✓' : '✗';
}

function threatTable(
  measure: ThreatMeasure,
  testers: readonly TesterReport[],
  cellOf: (tester: TesterReport, threat: string) => boolean | undefined,
): string[] {
  const threats = Object.keys(measure.byThreat);
  if (threats.length === 0) return ['No data.'];
  return table(
    ['Threat', ...testers.map((t) => t.testerId), 'Share'],
    threats.map((threat) => [
      threat,
      ...testers.map((t) => mark(cellOf(t, threat))),
      share(measure.byThreat[threat] as Measure),
    ]),
  );
}

function testerSection(tester: TesterReport): string[] {
  const lines: string[] = [`### ${tester.testerId}`, ''];
  const devices =
    tester.deviceTypes.length === 0
      ? 'no journal'
      : `${tester.deviceTypes.join(', ')} (${tester.platforms.join(', ')})`;
  lines.push(`- Device: ${devices}`);
  if (tester.relaunch === null) {
    lines.push('- Relaunch: — (no journal)');
  } else {
    lines.push(
      `- Relaunch: ${tester.relaunch.relaunched ? 'yes' : 'no'} (${tester.relaunch.games} game${tester.relaunch.games === 1 ? '' : 's'}, highest game index ${tester.relaunch.highestGameIndex})`,
    );
  }
  const usedRates = DEVICE_ORDER.filter((d) => tester.rates[d] !== undefined);
  lines.push(
    `- Success rate per device: ${usedRates.length === 0 ? '—' : usedRates.map((d) => `${d} ${rate(tester.rates[d])}`).join(', ')}`,
  );
  if (tester.touchVsKeyboardPct !== null) {
    lines.push(`- Touch vs keyboard: ${pct(tester.touchVsKeyboardPct)}`);
  }
  const identified = Object.entries(tester.identifiedWithoutHelp);
  lines.push(
    `- Identified without help: ${identified.length === 0 ? '—' : identified.map(([threat, v]) => `${threat} ${v ? 'O' : 'N'}`).join(', ')}`,
  );
  lines.push(
    `- Perfect parry cited: ${tester.perfectCited === null ? '—' : tester.perfectCited ? 'O' : 'N'}`,
  );
  lines.push(`- Laughs: ${tester.laughs === null ? '—' : tester.laughs}`);
  if (tester.games.length > 0) {
    lines.push(
      '',
      ...table(
        ['File', 'Session', 'Game', 'Level', 'End', 'Stars'],
        tester.games.map((g) => [
          g.file,
          g.sessionId,
          String(g.gameIndex),
          g.levelId,
          g.endReason,
          String(g.stars),
        ]),
      ),
    );
  }
  if (tester.comments.length > 0) {
    lines.push('', 'Comments:');
    for (const comment of tester.comments) {
      const where = [
        comment.threatId,
        comment.sessionId === null ? null : `session ${comment.sessionId}`,
      ]
        .filter((part) => part !== null)
        .join(', ');
      lines.push(
        `- (line ${comment.line}${where === '' ? '' : `, ${where}`}) ${comment.text.replaceAll('\n', ' ')}`,
      );
    }
  }
  lines.push('');
  return lines;
}

/** The Markdown report, in English like every tool's output. Pure: no clock, no file. */
export function renderMetrics(report: PlaytestReport): string {
  const { inputs } = report;
  const lines: string[] = [
    '# Playtest indicators',
    '',
    `${report.panel.testers} tester${report.panel.testers === 1 ? '' : 's'}, panel status ${report.panel.status}. A KO is a finding, not an error.`,
    '',
    '## Summary',
    '',
    ...summaryTable(report),
    '',
    '## Indicator 3 per threat',
    '',
    '### Identified without help (observed)',
    '',
    ...threatTable(
      report.identification,
      report.testers,
      (t, threat) => t.identifiedWithoutHelp[threat],
    ),
    '',
    '### First-encounter success (computed)',
    '',
    ...threatTable(report.firstEncounter, report.testers, (t, threat) => {
      const first = t.firstEncounter[threat];
      return first === undefined ? undefined : first === 'success';
    }),
    '',
    '## Testers',
    '',
    ...report.testers.flatMap(testerSection),
    '## Inputs',
    '',
    `- Folder: ${inputs.folder}`,
    `- Observations: ${inputs.observationsPath ?? 'none'}`,
    `- Levels: ${inputs.levels.length === 0 ? '—' : inputs.levels.join(', ')}`,
    `- Content hashes: ${inputs.contentHashes.length === 0 ? '—' : inputs.contentHashes.join(', ')}`,
    `- Journal files read: ${inputs.filesRead}, skipped: ${inputs.skipped.length}`,
    '',
    '### Skipped files',
    '',
  ];
  if (inputs.skipped.length === 0) lines.push('None.');
  for (const skipped of inputs.skipped) {
    lines.push(`- ${skipped.file}: ${skipped.reason.replaceAll('\n', ' ')}`);
  }
  lines.push('', '### Warnings', '');
  if (report.warnings.length === 0) lines.push('None.');
  for (const warning of report.warnings) lines.push(`- ${warning}`);
  lines.push('');
  return lines.join('\n');
}
