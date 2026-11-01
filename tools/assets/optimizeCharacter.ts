import { readFile, rename, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { parseGlb } from './glb.ts';
import { isOptimised, runGltfpack } from './optimizeGlb.ts';
import { characterGlbPath } from './paths.ts';

/**
 * The same as a room's, by proof rather than by habit (story 7.2, T0): `-kn` keeps bones and hidden
 * nodes by name; a held pose is kept with no `-ac`, and a track equal to the rest pose is dropped
 * safely, since the mixer brings a bone back to its rest when no clip holds it; the 30 Hz and 12-bit
 * defaults keep the poses, and the skinned mesh's bounds match the raw export's in every clip.
 * A list of its own so that a change here never touches the rooms' bytes.
 */
export const CHARACTER_GLTFPACK_FLAGS = ['-cc', '-kn'] as const;

async function main(): Promise<void> {
  const id = process.argv[2];
  if (id === undefined) {
    log.error('assets', 'usage: npm run assets:character:optimize -- <id> (papa, baby)');
    process.exitCode = 1;
    return;
  }
  const target = characterGlbPath(id);
  const bytes = await readFile(target).catch((cause: unknown) => {
    log.error(
      'assets',
      `cannot read ${target}: run \`npm run assets:character:export\` first`,
      cause,
    );
    return null;
  });
  if (bytes === null) {
    process.exitCode = 1;
    return;
  }
  if (isOptimised(parseGlb(new Uint8Array(bytes)).json)) {
    log.warn('assets', `${target} is already optimised: nothing to do (re-export to start over)`);
    return;
  }
  const temporary = `${target}.tmp.glb`;
  const { code, output } = await runGltfpack([
    '-i',
    target,
    '-o',
    temporary,
    ...CHARACTER_GLTFPACK_FLAGS,
  ]);
  if (code !== 0) {
    await rm(temporary, { force: true });
    log.error('assets', `gltfpack failed (exit ${code})`, output.trim());
    process.exitCode = 1;
    return;
  }
  await rename(temporary, target);
  log.info('assets', 'character optimised in place', {
    target,
    beforeBytes: bytes.byteLength,
    afterBytes: (await readFile(target)).byteLength,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
