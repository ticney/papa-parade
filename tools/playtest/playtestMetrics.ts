import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatContentProblem } from '@content/contentError';
import { PLAYTEST_FILE, THREAT_DEF_PATTERN } from '@content/contentFiles';
import { parseContentFile } from '@content/parseContentFile';
import type { PlaytestThresholds } from '@content/schemas/playtest';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { outProblem, writeText } from '../outputFile.ts';
import { computeMetrics } from './computeMetrics.ts';
import { loadJournals } from './loadJournals.ts';
import { DEFAULT_OBSERVATIONS_FILE, METRICS_HELP, parseMetricsArgs } from './metricsArgs.ts';
import { type ObservationRow, parseObservations } from './observations.ts';
import { outputConflict } from './outputPaths.ts';
import { renderJson, renderMetrics } from './renderMetrics.ts';

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT_DIR = join(REPO_DIR, 'content');

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function loadThresholds(): Promise<Result<PlaytestThresholds, string[]>> {
  const display = `content/${PLAYTEST_FILE.file}`;
  let text: string;
  try {
    text = await readFile(join(CONTENT_DIR, PLAYTEST_FILE.file), 'utf8');
  } catch (cause) {
    return err([`cannot read ${display}: ${reasonOf(cause)}`]);
  }
  const parsed = parseContentFile(display, text, PLAYTEST_FILE.schema);
  return parsed.ok ? ok(parsed.value) : err(parsed.error.map(formatContentProblem));
}

/** The ids of `content/threats/*.json`, to tell a typo in the notes from a real threat. */
async function listThreatIds(): Promise<Set<string>> {
  const dir = join(CONTENT_DIR, THREAT_DEF_PATTERN.dir);
  try {
    const names = await readdir(dir);
    return new Set(
      names
        .filter((name) => name.endsWith(THREAT_DEF_PATTERN.suffix))
        .map((name) => name.slice(0, name.length - THREAT_DEF_PATTERN.suffix.length)),
    );
  } catch (cause) {
    log.warn('playtest', `cannot list the threats in ${dir}`, { reason: reasonOf(cause) });
    return new Set();
  }
}

export interface LoadedObservations {
  rows: ObservationRow[];
  warnings: string[];
  /** What the report calls the notes file; `null` = none was read. */
  path: string | null;
}

/**
 * The default file may be missing (the computed indicators come first); a path given with
 * `--observations` must exist.
 */
export async function loadObservations(
  explicitPath: string | null,
  defaultPath: string = join(REPO_DIR, DEFAULT_OBSERVATIONS_FILE),
): Promise<Result<LoadedObservations, string[]>> {
  const path = explicitPath ?? defaultPath;
  // The report is meant to be shared: it names the file, not the folders of this machine.
  const shown = explicitPath === null ? DEFAULT_OBSERVATIONS_FILE : basename(explicitPath);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    const missing = (cause as NodeJS.ErrnoException).code === 'ENOENT';
    if (explicitPath === null && missing) {
      return ok({
        rows: [],
        path: null,
        warnings: [
          `no observations file at ${DEFAULT_OBSERVATIONS_FILE}: the observed indicators (2, 3, 5) are n/a`,
        ],
      });
    }
    return err([`cannot read the observations ${explicitPath ?? defaultPath}: ${reasonOf(cause)}`]);
  }
  const parsed = parseObservations(text, shown, await listThreatIds());
  if (!parsed.ok) return err(parsed.error);
  const warnings = [...parsed.value.warnings];
  if (text.includes('\uFFFD')) {
    warnings.push(
      `${shown} is not valid UTF-8 (a spreadsheet saved it as ANSI?): the accents in the comments are lost; save it as "CSV UTF-8"`,
    );
  }
  return ok({ rows: parsed.value.rows, warnings, path: shown });
}

async function main(): Promise<void> {
  const failAll = (messages: readonly string[]): void => {
    for (const message of messages) log.error('playtest', message);
    process.exitCode = 1;
  };
  const parsed = parseMetricsArgs(process.argv.slice(2));
  if (!parsed.ok) return failAll([parsed.error]);
  const args = parsed.value;
  if (args.help || args.dir === null) {
    process.stdout.write(METRICS_HELP);
    return;
  }

  const outputs = [
    { flag: '--out', path: args.outPath },
    { flag: '--json', path: args.jsonPath },
  ].filter((output): output is { flag: string; path: string } => output.path !== null);
  for (const { flag, path } of outputs) {
    const problem = await outProblem(path);
    if (problem !== null) return failAll([`${flag}: ${problem}`]);
  }
  const conflict = outputConflict(outputs, args.dir, [
    {
      label: 'observations file',
      path: args.observationsPath ?? join(REPO_DIR, DEFAULT_OBSERVATIONS_FILE),
    },
  ]);
  if (conflict !== null) return failAll([conflict]);

  const thresholds = await loadThresholds();
  if (!thresholds.ok) return failAll(thresholds.error);
  const journals = await loadJournals(args.dir);
  if (!journals.ok) return failAll(journals.error);
  const observations = await loadObservations(args.observationsPath);
  if (!observations.ok) return failAll(observations.error);
  for (const warning of observations.value.warnings) log.warn('playtest', warning);

  const loaded = journals.value;
  const readerWarnings = [...loaded.warnings, ...observations.value.warnings];
  const report = computeMetrics({
    testers: loaded.testers,
    observations: observations.value.rows,
    thresholds: thresholds.value,
    warnings: readerWarnings,
    inputs: {
      folder: basename(resolve(args.dir)),
      observationsPath: observations.value.path,
      levels: loaded.levels,
      contentHashes: loaded.contentHashes,
      filesRead: loaded.filesRead,
      skipped: loaded.skipped,
    },
  });
  // The readers logged theirs; the computation adds its own to the report, and they go to stderr too.
  for (const warning of report.warnings.slice(readerWarnings.length)) log.warn('playtest', warning);

  if (args.jsonPath !== null) {
    const written = await writeText(args.jsonPath, renderJson(report));
    if (!written.ok) return failAll([written.error]);
  }
  const markdown = renderMetrics(report);
  if (args.outPath === null) {
    // stdout carries the report: nothing else at `info`.
    process.stdout.write(markdown);
    return;
  }
  const written = await writeText(args.outPath, markdown);
  if (!written.ok) return failAll([written.error]);
  log.info('playtest', 'done', {
    testers: report.panel.testers,
    out: args.outPath,
    json: args.jsonPath,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
