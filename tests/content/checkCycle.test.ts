import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFeel } from '@content/feelMerge';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import { createSim } from '@sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';
import { createTestCycleGeometry, createTestCycleLevel } from '../support/cycleSupport.ts';
import { createTestContent } from '../support/testContent.ts';

// `content:check` and the bedroom (story 4.10): the required anchors shrank to the two spawns and the
// door, which loosens no guarantee, since what a level plans is still checked against its room. On a
// copy of the real content tree.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEVEL = 'content/levels/chambre_night.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-cycle-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('what shrinking the required anchors did not loosen', () => {
  it('content:check refuses a planned threat at an anchor the room lacks', async () => {
    await mutateJson(LEVEL, (level) => {
      const [wave] = level.waves as { threats: { def: string; anchor: string }[] }[];
      if (wave !== undefined) wave.threats = [{ def: 'outlet', anchor: 'stairs_top' }];
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'waves[0].threats[0].anchor',
        message: expect.stringContaining('"stairs_top" is not an anchor'),
      }),
    );
  });

  it('content:check refuses an object at an anchor the room lacks', async () => {
    await mutateJson(LEVEL, (level) => {
      level.objects = [{ id: 'toilet', kind: 'toilet', anchor: 'phone' }];
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        message: expect.stringContaining('"phone", which is not an anchor'),
      }),
    );
  });

  it('content:check refuses a planned silence in a zone the room lacks', async () => {
    await mutateJson(LEVEL, (level) => {
      const [wave] = level.waves as { threats: { def: string; anchor: string }[] }[];
      if (wave !== undefined) wave.threats = [{ def: 'silence_mischief', anchor: 'behind_sofa' }];
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'waves[0].threats[0].anchor',
        message: expect.stringContaining('must be a hidden zone'),
      }),
    );
  });

  it('createSim refuses the same anchor, with the words of the level', async () => {
    const level = createTestCycleLevel();
    const wave = level.level.waves[0];
    if (wave === undefined) throw new Error('the frozen level has a wave');
    await expect(
      createSim({
        content: createTestContent(),
        geometry: createTestCycleGeometry(),
        level: {
          ...level,
          level: {
            ...level.level,
            waves: [{ ...wave, threats: [{ def: 'outlet', anchor: 'stairs_top' }] }],
          },
        },
        seed: 1,
      }),
    ).rejects.toThrow(/planned at stairs_top, which chambre_night does not have/);
  });
});

describe('content:check and the cycle (story 4.10)', () => {
  it('accepts the live level', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('refuses what cycleProblems refuses, with its words, at the key `cycle`', async () => {
    await mutateJson(LEVEL, (level) => {
      level.durationMs = 100_000;
      level.waves = (level.waves as unknown[]).slice(0, 1);
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'cycle',
        message: expect.stringContaining('of one clean cycle'),
      }),
    );
  });

  it('refuses an unknown key of the cycle through the schema', async () => {
    await mutateJson(LEVEL, (level) => {
      (level.cycle as Record<string, unknown>).retryMs = 1;
    });
    expect((await checkContent(root)).some((problem) => problem.file === LEVEL)).toBe(true);
  });
});

describe("the live level's need (AC 3)", () => {
  it('merges bladder.startPct over the base feel and keeps its siblings', async () => {
    const parsedFeel = parseContentFile(
      'content/feel.json',
      await readFile(join(REPO, 'content', 'feel.json'), 'utf8'),
      FeelSchema,
    );
    if (!parsedFeel.ok) throw new Error('content/feel.json must be valid');
    const level = JSON.parse(await readFile(join(REPO, LEVEL), 'utf8')) as {
      feelOverrides: { bladder: Record<string, unknown> };
    };
    const merged = mergeFeel(parsedFeel.value, level.feelOverrides, 'chambre_night');
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(Object.keys(level.feelOverrides.bladder)).toEqual(['startPct']);
    expect(merged.value.bladder).toEqual({
      ...parsedFeel.value.bladder,
      ...level.feelOverrides.bladder,
    });
  });
});
