import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BeatTimelineStep, beatTimelineOf, judgedBeatCountOf } from '@sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent } from '../../tools/content/contentChecks.ts';

// `content:check` and the sequences (story 4.4, AC 3): one failing test per rule, on a copy of the
// real content tree.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEVEL = 'content/levels/salon_crawler.json';
const SEQUENCE = 'content/sequences/stay_awake.json';
const FEEDBACK = 'content/feedback.json';

let root: string;

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-sequences-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('checkContent and the special sequences (story 4.4)', () => {
  it('accepts the live level with « Rester éveillé »', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('names a level that lists a sequence with no file', async () => {
    await mutateJson(LEVEL, (level) => {
      level.sequences = ['stay_awake', 'sleep_walk'];
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'sequences[1]',
        message: expect.stringMatching(/no sequence "sleep_walk".*sequences\/sleep_walk\.json/),
      }),
    ]);
  });

  it('names a sequence that carries the baby in a level with no carry', async () => {
    await mutateJson(LEVEL, (level) => {
      delete level.carry;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'sequences[0]',
        message: expect.stringMatching(/"stay_awake" carries the baby.*no carry/),
      }),
    );
  });

  it('names a microSleeps step in a level with no micro-sleep def', async () => {
    await mutateJson(LEVEL, (level) => {
      (level.gauges as Record<string, unknown>).fatigue = undefined;
      level.objects = (level.objects as { kind: string }[]).filter(
        (object) => object.kind !== 'coffee_machine',
      );
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'sequences[0]',
        message: expect.stringMatching(/"stay_awake" has a microSleeps step.*microSleepDef/),
      }),
    );
  });

  it('names a sequence too short for its first micro-sleep to be judged', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      sequence.steps = (sequence.steps as Record<string, unknown>[]).map((step) => ({
        ...step,
        durationMs: 1000,
      }));
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'sequences[0]',
        message: expect.stringMatching(/"stay_awake" lasts 3000 ms, but its first micro-sleep/),
      }),
    );
  });

  it('names a first gap longer than the whole sequence', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      const [first, ...rest] = sequence.steps as Record<string, unknown>[];
      sequence.steps = [{ ...first, gapMinMs: 60_000, gapMaxMs: 60_000 }, ...rest];
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'sequences[0]',
        message: expect.stringMatching(/gapMinMs 60000/),
      }),
    );
  });

  it.each([
    ['started', 'sequence_started'],
    ['succeeded', 'sequence_succeeded'],
    ['failed', 'sequence_failed'],
  ])('names a %s cue that is not in feedback.json', async (role) => {
    await mutateJson(SEQUENCE, (sequence) => {
      (sequence.feedback as Record<string, string>)[role] = 'no_such_cue';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: `feedback.${role}`,
        message: expect.stringContaining('"no_such_cue" is not in feedback.json'),
      }),
    ]);
  });

  it('names a sequence cue anchored on a threat or an object, and one with a uiElement visual', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, { visual: Record<string, unknown> }>;
      (cues.sequence_started as { visual: Record<string, unknown> }).visual.anchor = 'threat';
      cues.sequence_succeeded = {
        ...cues.sequence_succeeded,
        visual: { kind: 'uiElement' },
      } as never;
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'feedback.started',
        message: expect.stringContaining('anchored on a threat'),
      }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'feedback.succeeded',
        message: expect.stringContaining('uiElement'),
      }),
    );
  });

  it('names a music loop that is not in feedback.json › loops.sequenceMusic', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      (sequence.framing as Record<string, unknown>).musicLoop = 'no_such_loop';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'framing.musicLoop',
        message: expect.stringContaining('"no_such_loop" is not in feedback.json'),
      }),
    ]);
  });

  it('names a bar label that is not in the strings (the walker already scans sequence files)', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      ((sequence.framing as Record<string, unknown>).bar as Record<string, unknown>).labelKey =
        'hud.no_such_label';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: SEQUENCE,
        jsonPath: 'framing.bar.labelKey',
        message: expect.stringContaining('"hud.no_such_label"'),
      }),
    ]);
  });

  it('names a sequence music that is not a music clip, and a clip with no file', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const loops = (feedback.loops as Record<string, Record<string, { clip: string }>>)
        .sequenceMusic as Record<string, { clip: string }>;
      (loops.stay_awake as { clip: string }).clip = 'papa_bump';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: 'loops.sequenceMusic.stay_awake.clip',
        message: expect.stringContaining('not a music clip'),
      }),
    );
    await mutateJson(FEEDBACK, (feedback) => {
      const loops = (feedback.loops as Record<string, Record<string, { clip: string }>>)
        .sequenceMusic as Record<string, { clip: string }>;
      (loops.stay_awake as { clip: string }).clip = 'music_missing';
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: 'loops.sequenceMusic.stay_awake.clip',
        message: expect.stringContaining('music_missing.m4a'),
      }),
    );
  });

  it('refuses a snore and a wake that name no sim event (a typo is a cue that never plays)', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const events = feedback.events as Record<string, string>;
      events.PapaSnore = events.PapaSnored as string;
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({ file: FEEDBACK, jsonPath: 'events.PapaSnore' }),
    );
  });
});

// `content:check` and the lullaby walk (story 4.5, AC 4): one failing test per rule, in the same
// words `simLevelOf` uses (they share `sequenceBeatProblems`).
const LULLABY = 'content/sequences/lullaby_walk.json';

// The live numbers the tests below work from, read from `content/`: tuning the lullaby or the feel
// moves them with it, and no test holds a literal copy.
const readLive = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(REPO, relativePath), 'utf8')) as T;
const LIVE_STEP = readLive<{ steps: BeatTimelineStep[] }>(LULLABY).steps[0] as BeatTimelineStep;
const LIVE_FEEL = readLive<{
  timing: { toleranceMs: number };
  difficulty: Record<string, { windowMultiplier: number }>;
}>('content/feel.json');
const LIVE_TOLERANCE_MS = LIVE_FEEL.timing.toleranceMs;
const LIVE_WIDEST_TIER = Math.max(
  ...Object.values(LIVE_FEEL.difficulty).map((tier) => tier.windowMultiplier),
);
const LIVE_JUDGED_COUNT = judgedBeatCountOf(beatTimelineOf(LIVE_STEP));
const LIVE_FIRST_DECOY = LIVE_STEP.decoyBeats[0] as number;

/** The shortest gap between two judged or count-in beats of `step`, in ms. */
function shortestGapMs(step: BeatTimelineStep): number {
  const beats = beatTimelineOf(step).filter((entry) => entry.kind !== 'decoy');
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < beats.length; i++) {
    shortest = Math.min(shortest, (beats[i]?.offsetMs ?? 0) - (beats[i - 1]?.offsetMs ?? 0));
  }
  return shortest;
}

describe('checkContent and the beats steps (story 4.5)', () => {
  async function beatsStep(change: (step: Record<string, unknown>) => void) {
    await mutateJson(LULLABY, (sequence) => {
      change((sequence.steps as Record<string, unknown>[])[0] as Record<string, unknown>);
    });
    return checkContent(root);
  }

  it('accepts the live level with « Les 100 pas en rythme »', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('names a track that feedback.json › beatTracks does not have', async () => {
    expect(
      await beatsStep((step) => {
        step.track = 'march';
      }),
    ).toEqual([
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringMatching(
          /"lullaby_walk" has a beats step with the track "march".*beatTracks/,
        ),
      }),
    ]);
  });

  it('names a decoy with no next judged beat', async () => {
    expect(
      await beatsStep((step) => {
        step.decoyBeats = [LIVE_FIRST_DECOY, LIVE_JUDGED_COUNT + 100];
      }),
    ).toEqual([
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringMatching(
          new RegExp(
            `decoy after judged beat ${LIVE_JUDGED_COUNT + 100}, which has no next judged beat`,
          ),
        ),
      }),
    ]);
  });

  it('names a decoy after the very last judged beat', async () => {
    const last = LIVE_JUDGED_COUNT - 1;
    const problems = await beatsStep((step) => {
      step.decoyBeats = [LIVE_FIRST_DECOY, last];
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(
      new RegExp(
        `decoy after judged beat ${last}, which has no next judged beat \\(the step has ${LIVE_JUDGED_COUNT}\\)`,
      ),
    );
    // And the beat before it is fine: a decoy needs a next judged beat, not a last one.
    expect(
      await beatsStep((step) => {
        step.decoyBeats = [LIVE_FIRST_DECOY, last - 1];
      }),
    ).toEqual([]);
  });

  it('names a window that is not below the shortest beat interval', async () => {
    const windowMs = shortestGapMs(LIVE_STEP) + 20;
    const problems = await beatsStep((step) => {
      step.windowMs = windowMs;
      step.decoyBeats = [];
    });
    const shortest = shortestGapMs({ ...LIVE_STEP, windowMs, decoyBeats: [] });
    expect(problems).toEqual([
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringContaining(
          `windowMs of ${windowMs} ms, which is not below its shortest beat interval of ${shortest} ms`,
        ),
      }),
    ]);
  });

  it('names a decoy whose hit zone would overlap its beats at the widest tier', async () => {
    // A window wide enough that the zone of the first beat's decoy (half a beat away) overlaps.
    const spacingMs = Math.round(shortestGapMs(LIVE_STEP) / 2);
    const windowMs = Math.ceil((spacingMs - 2 * LIVE_TOLERANCE_MS) / LIVE_WIDEST_TIER) + 10;
    const widened = { ...LIVE_STEP, windowMs, decoyBeats: [0] };
    const decoy = beatTimelineOf(widened).find((entry) => entry.kind === 'decoy');
    const timeline = beatTimelineOf(widened);
    const at = timeline.findIndex((entry) => entry.kind === 'decoy');
    const nearestMs = Math.min(
      (decoy?.offsetMs ?? 0) - (timeline[at - 1]?.offsetMs ?? 0),
      (timeline[at + 1]?.offsetMs ?? 0) - (decoy?.offsetMs ?? 0),
    );
    const zoneMs = windowMs * LIVE_WIDEST_TIER + 2 * LIVE_TOLERANCE_MS;
    expect(zoneMs).toBeGreaterThan(nearestMs);
    const problems = await beatsStep((step) => {
      step.windowMs = windowMs;
      step.decoyBeats = [0];
    });
    expect(problems).toEqual([
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringContaining(
          `decoy after judged beat 0 sits ${nearestMs} ms from its nearest beat, but a hit zone is ${zoneMs} ms wide at the widest tier (windowMs ${windowMs} × ${LIVE_WIDEST_TIER} + 2 × ${LIVE_TOLERANCE_MS} ms of tolerance)`,
        ),
      }),
    ]);
  });

  it('still checks the beats when feel.json did not load: only the decoy zones are looser', async () => {
    await mutateJson('content/feel.json', (feel) => {
      for (const key of Object.keys(feel)) delete feel[key];
    });
    const problems = await beatsStep((step) => {
      step.track = 'march';
    });
    // The feel is reported on its own; the beats rules that need nothing from it still run.
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringMatching(/has a beats step with the track "march"/),
      }),
    );
    expect(problems.some((problem) => problem.file === 'content/feel.json')).toBe(true);
  });

  it('names a tempo so fast that two beats would fall on the same millisecond', async () => {
    const problems = await beatsStep((step) => {
      step.bpmStart = 130_000;
    });
    expect(problems).toContainEqual(
      expect.objectContaining({ file: LULLABY, jsonPath: 'steps[0].bpmStart' }),
    );
  });

  it('names a step with no judged beat at all: the sequence would be won by waiting', async () => {
    const problems = await beatsStep((step) => {
      step.countInBeats = 500;
      step.decoyBeats = [];
    });
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: LULLABY,
        message: expect.stringMatching(/"lullaby_walk" has a beats step with no judged beat/),
      }),
    );
  });

  it('names a calmLeft bar on a sequence that has no babyAwake failure', async () => {
    await mutateJson(SEQUENCE, (sequence) => {
      ((sequence.framing as Record<string, unknown>).bar as Record<string, unknown>).value =
        'calmLeft';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: SEQUENCE,
        // The schema says it first (and `sequenceBeatProblems`, run on a def that skipped the schema,
        // says it in the same words: `beatClock.test.ts`).
        message: expect.stringMatching(/has a bar that shows calmLeft, but no "babyAwake" failure/),
      }),
    ]);
  });

  it('names a beat event that is not a sim event, and a note clip that has no file', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const events = feedback.events as Record<string, string>;
      events.BeatHitt = events.BeatHit as string;
      const tracks = feedback.beatTracks as Record<string, { notes: string[] }>;
      (tracks.lullaby as { notes: string[] }).notes[0] = 'music_lullaby_note_9';
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({ file: FEEDBACK, jsonPath: 'events.BeatHitt' }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('music_lullaby_note_9.m4a') }),
    );
  });
});
