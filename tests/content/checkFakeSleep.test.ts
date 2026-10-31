import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';

// `content:check` and the feint of the fake sleep (story 4.7): one failing test per rule, on a copy
// of the real content tree. The feint must be told by sound, visual and vibration, and told from the
// signal by its vibration and its clip (readable with the sound off, and with the phone off the wrist).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREAT = 'content/threats/fake_sleep.json';
const FEEDBACK = 'content/feedback.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

type Cue = Record<string, unknown>;
const cueOf = (feedback: Record<string, unknown>, id: string): Cue =>
  (feedback.cues as Record<string, Cue>)[id] as Cue;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-fake-sleep-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('checkContent and the feint cue (story 4.7)', () => {
  it('accepts the live fake sleep', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('names a feint cue that is not in feedback.json', async () => {
    await mutateJson(THREAT, (threat) => {
      (threat.feedback as Record<string, unknown>).feint = 'no_such_peek';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: THREAT,
        jsonPath: 'feedback.feint',
        message: expect.stringMatching(/"no_such_peek" is not a cue of content\/feedback\.json/),
      }),
    );
  });

  it('names a feint cue with no audio', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      delete cueOf(feedback, 'fake_sleep_eye_peeks').audio;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: THREAT,
        jsonPath: 'feedback.feint',
        message: expect.stringMatching(
          /the cue "fake_sleep_eye_peeks" has no audio, but the feint of a "wait" threat is told by sound, visual and vibration alike/,
        ),
      }),
    );
  });

  it('refuses a feint cue with no visual or no haptic, which the cue rule already refuses beside an audio', async () => {
    for (const channel of ['visual', 'haptic']) {
      await mutateJson(FEEDBACK, (feedback) => {
        delete cueOf(feedback, 'fake_sleep_eye_peeks')[channel];
      });
      const problems = await checkContent(root);
      expect(problems.length, channel).toBeGreaterThan(0);
      expect(JSON.stringify(problems), channel).toContain('fake_sleep_eye_peeks');
      await cp(join(REPO, FEEDBACK), join(root, FEEDBACK));
    }
  });

  it('names a feint that vibrates like the signal', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      cueOf(feedback, 'fake_sleep_eye_peeks').haptic = cueOf(
        feedback,
        'bedtime_eyes_closed',
      ).haptic;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: THREAT,
        jsonPath: 'feedback.feint',
        message: expect.stringMatching(
          /vibrates "medium" like the signal "bedtime_eyes_closed", but the feint must be told from the signal by its vibration/,
        ),
      }),
    );
  });

  it('names a feint that plays the signal’s clip', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const signal = cueOf(feedback, 'bedtime_eyes_closed').audio as Record<string, unknown>;
      (cueOf(feedback, 'fake_sleep_eye_peeks').audio as Record<string, unknown>).clip = signal.clip;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: THREAT,
        jsonPath: 'feedback.feint',
        message: expect.stringMatching(
          /plays the clip "baby_eyes_close" like the signal "bedtime_eyes_closed", but the feint must be told from the signal by its sound/,
        ),
      }),
    );
  });
});
