import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LEVEL_ID } from '@shared/constants';
import { log } from '@shared/log';
import { blendPath, exportScriptPath, glbPath } from './paths.ts';

const MACOS_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

/** `BLENDER_BIN`, else the macOS app, else `blender` on the PATH (null when none is found). */
export async function findBlender(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => Promise<boolean> = (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
): Promise<string | null> {
  const fromEnv = env.BLENDER_BIN;
  if (fromEnv !== undefined && fromEnv !== '') return (await exists(fromEnv)) ? fromEnv : null;
  if (await exists(MACOS_BLENDER)) return MACOS_BLENDER;
  return 'blender'; // the spawn error tells the player when it is not there
}

function run(
  command: string,
  args: string[],
): Promise<{ code: number | null; output: string; spawnError?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (cause) => resolve({ code: null, output, spawnError: cause.message }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? DEFAULT_LEVEL_ID;
  const blender = await findBlender();
  if (blender === null) {
    log.error(
      'assets',
      `BLENDER_BIN=${process.env.BLENDER_BIN} does not exist: fix it or unset it`,
    );
    process.exitCode = 1;
    return;
  }
  const result = await run(blender, [
    '-b',
    blendPath(id),
    '-P',
    exportScriptPath(),
    '--',
    '--out',
    glbPath(id),
  ]);
  if (result.spawnError !== undefined) {
    log.error(
      'assets',
      `cannot start Blender (${blender}): ${result.spawnError}. Install Blender 5.2 or set BLENDER_BIN to its executable.`,
    );
    process.exitCode = 1;
    return;
  }
  if (result.code !== 0) {
    // The script prints the names that break the conventions on stderr, prefixed `export_level.py:`.
    const lines = result.output
      .split('\n')
      .filter((line) => line.startsWith('export_level.py:') || line.startsWith('  - '));
    log.error(
      'assets',
      `level export failed (exit ${result.code})`,
      lines.length > 0 ? lines.join('\n') : result.output.trim(),
    );
    process.exitCode = 1;
    return;
  }
  log.info('assets', 'level exported', { glb: glbPath(id) });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
