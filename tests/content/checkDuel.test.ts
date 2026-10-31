import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';

// `content:check` and the bedtime duel (story 4.6): one failing test per rule, on a copy of the real
// content tree, in the words `simLevelOf` uses (they share `sequenceDuelProblems`).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEQUENCE = 'content/sequences/bedtime_duel.json';
const THREAT = 'content/threats/bedtime_eyes.json';
const FEEDBACK = 'content/feedback.json';
const LEVEL = 'content/levels/salon_crawler.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-duel-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// The live numbers the tests below work from, read from `content/`: tuning moves them with it.
const readLive = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(REPO, relativePath), 'utf8')) as T;
const LIVE_FEEL = readLive<{
  timing: { toleranceMs: number; windowMs: number; telegraphDelayDefaultMs: number };
  difficulty: Record<string, { windowMultiplier: number }>;
}>('content/feel.json');
const LIVE_EYES = readLive<{
  cooldownMs: number;
  telegraphDelayMs: number | null;
  maxDelayMs: number;
  windowMs: number | null;
}>(THREAT);
const LIVE_REST_MS = readLive<{ steps: { restMs: number }[] }>(SEQUENCE).steps[0]?.restMs ?? 0;
const WIDEST = Math.max(
  ...Object.values(LIVE_FEEL.difficulty).map((tier) => tier.windowMultiplier),
);
/** The shortest `durationMs` a round of the live duel can fit in. */
const NEEDED_MS =
  Math.max(LIVE_REST_MS, LIVE_EYES.cooldownMs) +
  (LIVE_EYES.telegraphDelayMs ?? LIVE_FEEL.timing.telegraphDelayDefaultMs) +
  LIVE_EYES.maxDelayMs +
  (LIVE_EYES.windowMs ?? LIVE_FEEL.timing.windowMs) * WIDEST +
  LIVE_FEEL.timing.toleranceMs;

describe('checkContent and the duel steps (story 4.6)', () => {
  it('accepts the live duel and its eyes', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('names a threatDef that is not loaded', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      (sequence.steps as Record<string, unknown>[])[1] = {
        kind: 'duel',
        durationMs: 9000,
        threatDef: 'no_such_eyes',
        restMs: 1200,
      };
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        message: expect.stringMatching(
          /the sequence "bedtime_duel" has a duel step \(steps\[1\]\) whose threatDef "no_such_eyes" is not loaded/,
        ),
      }),
    );
  });

  it('names a threatDef whose response is not wait', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      for (const step of sequence.steps as Record<string, unknown>[])
        step.threatDef = 'papa_microsleep';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        message: expect.stringMatching(/has the response "parry", but a duel asks for "wait"/),
      }),
    );
  });

  it('names a threatDef whose target is not papa', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      for (const step of sequence.steps as Record<string, unknown>[]) step.threatDef = 'outlet';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        message: expect.stringMatching(/has the target "anchor", but a duel threat stands on Papa/),
      }),
    );
  });

  it('names a durationMs below what a round can take, and accepts the exact minimum', async () => {
    const withDuration = async (durationMs: number) => {
      await mutateJson(SEQUENCE, (sequence) => {
        for (const step of sequence.steps as Record<string, unknown>[])
          step.durationMs = durationMs;
      });
      return checkContent(root);
    };
    expect(await withDuration(Math.ceil(NEEDED_MS))).toEqual([]);
    expect(await withDuration(Math.ceil(NEEDED_MS) - 1)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        message: expect.stringMatching(
          /with a durationMs of \d+, below the \d+(\.\d+)? ms a round can take/,
        ),
      }),
    );
  });

  it('names the papa_asleep gag on a duel threat', async () => {
    await mutateJson(THREAT, (threat) => {
      threat.gag = 'papa_asleep';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        message: expect.stringMatching(
          /has the gag "papa_asleep", which is the micro-sleep's alone/,
        ),
      }),
    );
  });

  it('names a wave that plans the eyes (a threat on Papa)', async () => {
    await mutateJson(LEVEL, (level) => {
      const waves = level.waves as { threats: Record<string, unknown>[] }[];
      waves[0]?.threats.push({ def: 'bedtime_eyes', anchor: 'outlet_02' });
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(
          /only the sim spawns it \(gauges\.fatigue\.microSleepDef, carry\.armsCryDef or a sequence's duel step\)/,
        ),
      }),
    );
  });
});

describe('checkContent and the signal cue of a wait threat (story 4.6)', () => {
  it('names a signal cue that is not in feedback.json', async () => {
    await mutateJson(THREAT, (threat) => {
      (threat.feedback as Record<string, string>).signal = 'no_such_cue';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: THREAT,
        jsonPath: 'feedback.signal',
        message: expect.stringContaining('"no_such_cue" is not a cue of content/feedback.json'),
      }),
    );
  });

  it.each(['audio', 'visual', 'haptic'] as const)(
    'names a signal cue with no %s',
    async (channel) => {
      await mutateJson(FEEDBACK, (feedback) => {
        const cues = feedback.cues as Record<string, Record<string, unknown>>;
        delete cues.bedtime_eyes_closed?.[channel];
      });
      expect(await checkContent(root)).toContainEqual(
        expect.objectContaining({
          file: THREAT,
          jsonPath: 'feedback.signal',
          message: expect.stringMatching(
            new RegExp(`has no ${channel}, but the signal of a "wait"`),
          ),
        }),
      );
    },
  );
});
