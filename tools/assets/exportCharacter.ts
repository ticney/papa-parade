import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { findBlender } from './exportLevel.ts';
import { characterBlendPath, characterExportScriptPath, characterGlbPath } from './paths.ts';

/** `papa`, `baby`: the only characters that exist in the world (story 7.2, D1). */
const CHARACTER_ID = /^[a-z][a-z0-9_]*$/;

function run(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  const id = process.argv[2];
  if (id === undefined || !CHARACTER_ID.test(id)) {
    log.error('assets', 'usage: npm run assets:character:export -- <id> (papa, baby)');
    process.exitCode = 1;
    return;
  }
  const blender = await findBlender();
  if (blender === null) {
    log.error(
      'assets',
      `BLENDER_BIN=${process.env.BLENDER_BIN} does not exist: fix it or unset it`,
    );
    process.exitCode = 1;
    return;
  }
  const { code, output } = await run(blender, [
    '-b',
    characterBlendPath(id),
    '-P',
    characterExportScriptPath(),
    '--',
    '--out',
    characterGlbPath(id),
  ]);
  if (code !== 0) {
    const lines = output.split('\n').filter((line) => line.startsWith('export_character.py:'));
    log.error(
      'assets',
      `character export failed (exit ${code})`,
      lines.length > 0 ? lines.join('\n') : output.trim(),
    );
    process.exitCode = 1;
    return;
  }
  log.info('assets', 'character exported', { glb: characterGlbPath(id) });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
