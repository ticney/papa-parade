import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

interface LoadedObservations {
  rows: ObservationRow[];
  warnings: string[];
  /** What the report calls the notes file; `null` = none was read. */
  path: string | null;
}

/**
 * The default file may be missing (the computed indicators come first); a path given with
 * `--observations` must exist.
 */
async function loadObservations(
  explicitPath: string | null,
): Promise<Result<LoadedObservations, string[]>> {
  const path = explicitPath ?? join(REPO_DIR, DEFAULT_OBSERVATIONS_FILE);
  const shown = explicitPath ?? DEFAULT_OBSERVATIONS_FILE;
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
    return err([`cannot read the observations ${shown}: ${reasonOf(cause)}`]);
  }
  const parsed = parseObservations(text, shown, await listThreatIds());
  if (!parsed.ok) return err(parsed.error);
  return ok({ rows: parsed.value.rows, warnings: parsed.value.warnings, path: shown });
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

  for (const [flag, path] of [
    ['--out', args.outPath],
    ['--json', args.jsonPath],
  ] as const) {
    if (path === null) continue;
    const problem = await outProblem(path);
    if (problem !== null) return failAll([`${flag}: ${problem}`]);
  }

  const thresholds = await loadThresholds();
  if (!thresholds.ok) return failAll(thresholds.error);
  const journals = await loadJournals(args.dir);
  if (!journals.ok) return failAll(journals.error);
  const observations = await loadObservations(args.observationsPath);
  if (!observations.ok) return failAll(observations.error);
  for (const warning of observations.value.warnings) log.warn('playtest', warning);

  const loaded = journals.value;
  const report = computeMetrics({
    testers: loaded.testers,
    observations: observations.value.rows,
    thresholds: thresholds.value,
    warnings: [...loaded.warnings, ...observations.value.warnings],
    inputs: {
      folder: args.dir,
      observationsPath: observations.value.path,
      levels: loaded.levels,
      contentHashes: loaded.contentHashes,
      filesRead: loaded.filesRead,
      skipped: loaded.skipped,
    },
  });

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
