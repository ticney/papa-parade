import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';

// `content:check` and story 7.4: the film framings of the sequences and the finale's celebration. One
// failing test per refusal, on a copy of the real content tree. The grade's reserved hues and the floor
// contrast under it are held by `tests/architecture/levelAssets.test.ts` (it reads DESIGN.md).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEQUENCE = 'content/sequences/bomb_drop.json';
const FEEDBACK = 'content/feedback.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

type Json = Record<string, unknown>;
const framingOf = (sequence: Json) => sequence.framing as Json;
const fireworksOf = (feedback: Json) => (feedback.celebration as Json).fireworks as Json;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-framings-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('checkContent and the film framings (story 7.4)', () => {
  it('accepts the live content: five sequences with a style and a title, the celebration', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('refuses a title key that is not in the strings', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      framingOf(sequence).titleKey = 'framing.title_nowhere';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'framing.titleKey',
        message: expect.stringContaining('framing.title_nowhere'),
      }),
    );
  });

  it('refuses an unknown style', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      framingOf(sequence).style = 'western';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({ file: SEQUENCE, jsonPath: 'framing.style' }),
    );
  });

  it('refuses a title key with no style', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      delete framingOf(sequence).style;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'framing.titleKey',
        message: expect.stringContaining('needs a style'),
      }),
    );
  });

  it('refuses a title key that is not a framing.title_ key', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      framingOf(sequence).titleKey = 'stamp.finale';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({ file: SEQUENCE, jsonPath: 'framing.titleKey' }),
    );
  });

  it('refuses a firework colour that is a reserved hue, or no DESIGN.md colour', async () => {
    for (const token of ['alert', 'parry', 'dodge', 'star', 'chartreuse']) {
      await mutateJson(FEEDBACK, (feedback) => {
        fireworksOf(feedback).colorTokens = ['primary', token];
      });
      expect(await checkContent(root), token).toContainEqual(
        expect.objectContaining({
          file: FEEDBACK,
          jsonPath: 'celebration.fireworks.colorTokens[1]',
        }),
      );
    }
  });

  it('refuses a burst outside its bounds', async () => {
    for (const [key, value] of [
      ['xPct', 120],
      ['zPct', -1],
      ['heightM', 0.1],
      ['sparks', 200],
      ['atMs', 9000],
    ] as const) {
      await cp(join(REPO, FEEDBACK), join(root, FEEDBACK));
      await mutateJson(FEEDBACK, (feedback) => {
        ((fireworksOf(feedback).bursts as Json[])[0] as Json)[key] = value;
      });
      expect(await checkContent(root), key).toContainEqual(
        expect.objectContaining({
          file: FEEDBACK,
          jsonPath: `celebration.fireworks.bursts[0].${key}`,
        }),
      );
    }
  });

  it('refuses bursts whose sparks overflow the pool', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      for (const burst of fireworksOf(feedback).bursts as Json[]) burst.sparks = 96;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: 'celebration.fireworks.bursts',
        message: expect.stringContaining('the pool'),
      }),
    );
  });

  it('refuses a framing style with bars over 12 %, or a missing style row', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      ((feedback.framingStyles as Json).duel as Json as Json).letterboxPct = 20;
      delete (feedback.framingStyles as Json).hostage;
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({ file: FEEDBACK, jsonPath: 'framingStyles.duel.letterboxPct' }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({ file: FEEDBACK, jsonPath: 'framingStyles.hostage' }),
    );
  });
});
