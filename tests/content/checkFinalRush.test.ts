import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';

// `content:check` and the final rush (story 3.5), on a copy of the real content tree: the same words
// as `simLevelOf`, through the shared `finalRushProblems`, and the playable time given to the cycle.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BEDROOM = 'content/levels/chambre_night.json';
const SALON = 'content/levels/salon_crawler.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-rush-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('content:check and the final rush', () => {
  it('accepts the content as it is', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('refuses a spill anchor that is not an anchor of the level', async () => {
    await mutateJson(SALON, (level) => {
      level.finalRush = { spillAnchor: 'nowhere' };
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SALON,
        jsonPath: 'finalRush',
        message: 'finalRush: the spill anchor "nowhere" is not an anchor of the level',
      }),
    );
  });

  it('refuses a level that does not outlast the rush', async () => {
    await mutateJson(SALON, (level) => {
      level.durationMs = 10_000;
      level.waves = [];
      level.sequences = [];
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: SALON,
        jsonPath: 'finalRush',
        message: expect.stringContaining('which is not above the 10000 ms of the rush'),
      }),
    );
  });

  it('reads the rush of the level’s own feel (feelOverrides)', async () => {
    await mutateJson(SALON, (level) => {
      level.feelOverrides = { endOfLevel: { finalRushMs: 200_000 } };
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SALON,
        jsonPath: 'finalRush',
        message: expect.stringContaining('200000 ms'),
      }),
    );
  });

  it('gives the cycle the playable time: the bedroom is refused once the rush leaves it too little', async () => {
    await mutateJson('content/feel.json', (feel) => {
      (feel.endOfLevel as { finalRushMs: number }).finalRushMs = 230_000;
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: BEDROOM,
        jsonPath: 'cycle',
        message: expect.stringContaining('below the'),
      }),
    );
  });

  it('refuses an object that has the id of a prop', async () => {
    await mutateJson(SALON, (level) => {
      (level.objects as { id: string }[])[0] = {
        id: 'mug_01',
        kind: 'phone',
        anchor: 'phone',
      } as never;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SALON,
        message: expect.stringContaining('the prop "mug_01" has the id of an object'),
      }),
    );
  });
});
