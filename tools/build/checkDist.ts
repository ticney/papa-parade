import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import {
  type DistFile,
  type DistFlavor,
  type DistInput,
  type DistManifest,
  inspectDist,
} from './inspectDist.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: npm run dist:check -- --flavor prod|playtest [--dir dist]';

export interface CheckDistArgs {
  flavor: DistFlavor;
  dir: string;
}

/** Reads `--flavor prod|playtest` (required) and `--dir <folder>` (default `dist`). */
export function parseCheckDistArgs(argv: readonly string[]): Result<CheckDistArgs, string> {
  let flavor: string | null = null;
  let dir = 'dist';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (arg === '--flavor' || arg === '--dir') {
      if (value === undefined || value.startsWith('--'))
        return err(`${arg} needs a value. ${USAGE}`);
      if (arg === '--flavor') flavor = value;
      else dir = value;
      i++;
    } else {
      return err(`unknown argument "${arg}". ${USAGE}`);
    }
  }
  if (flavor !== 'prod' && flavor !== 'playtest') {
    return err(`--flavor must be "prod" or "playtest". ${USAGE}`);
  }
  return ok({ flavor, dir });
}

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else found.push(path);
  }
  return found;
}

/** Loads a built folder (and the level ids of `content/levels/`) for `inspectDist`. */
export async function readDist(dir: string): Promise<Result<DistInput, string>> {
  try {
    const manifestText = await readFile(join(dir, '.vite', 'manifest.json'), 'utf8').catch(
      () => null,
    );
    if (manifestText === null) {
      return err(
        `${dir}/.vite/manifest.json is missing: is ${dir} a build made by \`npm run build\`?`,
      );
    }
    const manifest = JSON.parse(manifestText) as DistManifest;
    const files: DistFile[] = [];
    const jsText = new Map<string, string>();
    for (const absolute of await listFiles(dir)) {
      const path = relative(dir, absolute).split(sep).join('/');
      if (path.startsWith('.vite/')) continue;
      const content = await readFile(absolute);
      files.push({ path, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength });
      if (path.endsWith('.js')) jsText.set(path, content.toString('utf8'));
    }
    const indexHtml = await readFile(join(dir, 'index.html'), 'utf8');
    const headersText = await readFile(join(dir, '_headers'), 'utf8').catch(() => null);
    const levelIds = (await readdir(join(ROOT, 'content', 'levels')))
      .filter((name) => name.endsWith('.json') && !name.endsWith('.geometry.json'))
      .map((name) => name.slice(0, -'.json'.length));
    return ok({ manifest, files, jsText, indexHtml, headersText, levelIds });
  } catch (cause) {
    return err(`cannot read ${dir}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

async function main(): Promise<void> {
  const args = parseCheckDistArgs(process.argv.slice(2));
  if (!args.ok) {
    log.error('assets', args.error);
    process.exitCode = 1;
    return;
  }
  const input = await readDist(args.value.dir);
  if (!input.ok) {
    log.error('assets', input.error);
    process.exitCode = 1;
    return;
  }
  const report = inspectDist(input.value, args.value.flavor);
  log.info('assets', 'dist payload', {
    flavor: args.value.flavor,
    levelPayload: kib(report.levelPayloadBytes),
    firstLoadGzip: kib(report.firstLoadGzipBytes),
  });
  for (const problem of report.problems) log.error('assets', problem);
  if (report.problems.length > 0) {
    log.error('assets', `${report.problems.length} dist problem(s) (${args.value.flavor})`);
    process.exitCode = 1;
    return;
  }
  log.info('assets', `dist OK (${args.value.flavor})`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
