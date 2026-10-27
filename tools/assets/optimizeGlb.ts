import { spawn } from 'node:child_process';
import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LEVEL_ID } from '@shared/constants';
import { log } from '@shared/log';
import { parseGlb } from './glb.ts';
import { glbPath, ROOT } from './paths.ts';

const GLTFPACK_CLI = join(ROOT, 'node_modules', 'gltfpack', 'cli.js');

/**
 * `-cc` meshopt compression, so the real decode path (EXT_meshopt_compression) is exercised from
 * the start; `-kn` keeps the named nodes, because the client finds `PROP_*` and removes `COL_*`,
 * `NAV_*`, `ZONE_*`, `ANCHOR_*` by name.
 */
export const GLTFPACK_FLAGS = ['-cc', '-kn'] as const;

/** Is this .glb already compressed by gltfpack? Optimising it again would fail or do nothing. */
export function isOptimised(json: unknown): boolean {
  const used = (json as { extensionsUsed?: string[] }).extensionsUsed;
  return used?.includes('EXT_meshopt_compression') === true;
}

function run(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GLTFPACK_CLI, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (cause) => resolve({ code: null, output: String(cause) }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? DEFAULT_LEVEL_ID;
  const target = glbPath(id);
  const bytes = await readFile(target).catch((cause: unknown) => {
    log.error('assets', `cannot read ${target}: run \`npm run assets:export\` first`, cause);
    return null;
  });
  if (bytes === null) {
    process.exitCode = 1;
    return;
  }
  try {
    if (isOptimised(parseGlb(new Uint8Array(bytes)).json)) {
      log.warn('assets', `${target} is already optimised: nothing to do (re-export to start over)`);
      return;
    }
  } catch (cause) {
    log.error('assets', `${target}: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
    return;
  }

  const temporary = `${target}.tmp.glb`;
  const { code, output } = await run(['-i', target, '-o', temporary, ...GLTFPACK_FLAGS]);
  if (code !== 0) {
    await rm(temporary, { force: true });
    log.error('assets', `gltfpack failed (exit ${code})`, output.trim());
    process.exitCode = 1;
    return;
  }
  await rename(temporary, target);
  const after = (await readFile(target)).byteLength;
  log.info('assets', 'level optimised in place', {
    target,
    beforeBytes: bytes.byteLength,
    afterBytes: after,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
