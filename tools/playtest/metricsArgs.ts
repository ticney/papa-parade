import { parseArgs } from 'node:util';
import { err, ok, type Result } from '@shared/result';

export interface MetricsArgs {
  /** The folder of tester folders; `null` only with `--help`. */
  dir: string | null;
  /** `--observations`; `null` = the default `docs/playtest/observations.csv` (whose absence is only a warning). */
  observationsPath: string | null;
  /** Where the Markdown report goes; `null` = stdout. */
  outPath: string | null;
  /** Where the JSON report goes; `null` = nowhere. */
  jsonPath: string | null;
  help: boolean;
}

export const DEFAULT_OBSERVATIONS_FILE = 'docs/playtest/observations.csv';

export const METRICS_HELP = `Usage: npm run playtest:metrics -- <dir> [options]

Computes the playtest indicators (NFR11) from the journals the testers exported and from your notes.

  <dir>                    a folder with one sub-folder per tester, named after the pseudonym you gave
                           them (T1, T2…), each holding that tester's exported .json journals
  --observations <file>    your notes, a CSV (default ${DEFAULT_OBSERVATIONS_FILE}; see docs/playtest/observations.example.csv)
  --out <file>             write the Markdown report there (default: stdout)
  --json <file>            also write the report as JSON there
  --help                   print this

Exit 0 when the report is written, even if some indicators are KO (that is the finding).
Exit 1 when an input must be fixed (a bad folder layout, a malformed notes file, an unwritable output).
`;

/** Parses the command line. Pure: nothing is read from disk or from the environment. */
export function parseMetricsArgs(argv: readonly string[]): Result<MetricsArgs, string> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        observations: { type: 'string' },
        out: { type: 'string' },
        json: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch (cause) {
    // Node's own message names the offending flag; it becomes the error of the Result.
    return err(`${cause instanceof Error ? cause.message : String(cause)} (see --help)`);
  }
  const { values, positionals } = parsed;
  const help = values.help === true;
  if (positionals.length > 1) {
    return err(
      `expected one folder, got ${positionals.length}: ${positionals.map((p) => `"${p}"`).join(', ')} (see --help)`,
    );
  }
  const dir = positionals[0] ?? null;
  if (dir === null && !help) {
    return err(
      'the folder of tester journals is required: npm run playtest:metrics -- <dir> (see --help)',
    );
  }
  if (dir === '') return err('the folder of tester journals cannot be an empty string');

  const path = (name: string): Result<string | null, string> => {
    const value = values[name];
    if (value === undefined) return ok(null);
    if (typeof value !== 'string' || value === '') {
      return err(`--${name} needs a file path, got an empty string`);
    }
    return ok(value);
  };
  const observationsPath = path('observations');
  if (!observationsPath.ok) return observationsPath;
  const outPath = path('out');
  if (!outPath.ok) return outPath;
  const jsonPath = path('json');
  if (!jsonPath.ok) return jsonPath;

  return ok({
    dir,
    observationsPath: observationsPath.value,
    outPath: outPath.value,
    jsonPath: jsonPath.value,
    help,
  });
}
