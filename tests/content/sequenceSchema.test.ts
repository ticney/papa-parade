import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import {
  SEQUENCE_STEP_KINDS,
  SequenceDefSchema,
  sequenceDurationMs,
} from '@content/schemas/sequence';
import { describe, expect, it } from 'vitest';
import { createTestLullabyWalk, createTestStayAwake } from '../support/testContent.ts';

const FILE = 'content/sequences/stay_awake.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/sequences/stay_awake.json', import.meta.url), 'utf8'),
);

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), SequenceDefSchema);
}

function pathsOf(value: unknown): string[] {
  const result = parse(value);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

const step = (patch: Record<string, unknown> = {}) => ({
  kind: 'microSleeps',
  durationMs: 10000,
  gapMinMs: 4500,
  gapMaxMs: 6000,
  ...patch,
});

describe('content/sequences/stay_awake.json (story 4.4)', () => {
  it('parses against SequenceDefSchema as « Rester éveillé »: 30 s, three tightening steps', () => {
    const parsed = parse(real);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('stay_awake');
    expect(parsed.value.babyCarried).toBe(true);
    expect(parsed.value.steps).toHaveLength(3);
    expect(sequenceDurationMs(parsed.value)).toBe(30_000);
    const gaps = parsed.value.steps.map((entry) =>
      entry.kind === 'microSleeps' ? entry.gapMaxMs : 0,
    );
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
  });

  it('keeps every number in the JSON, with a unit suffix', () => {
    const framing = (real.framing as { camera: Record<string, unknown> }).camera;
    for (const key of Object.keys(framing)) expect(key, key).toMatch(/(Ms|Pct)$/);
    for (const entry of real.steps as Record<string, unknown>[]) {
      for (const key of Object.keys(entry).filter((candidate) => candidate !== 'kind')) {
        expect(key, key).toMatch(/Ms$/);
      }
    }
  });

  it('the frozen test def has the same shape as the live one (only the numbers differ)', () => {
    const frozen = createTestStayAwake();
    const live = parse(real);
    expect(live.ok && Object.keys(live.value).sort()).toEqual(Object.keys(frozen).sort());
    expect(sequenceDurationMs(frozen)).toBe(15_000);
  });

  it('has a duration that is the sum of its steps, not a key of its own', () => {
    expect(Object.keys(real)).not.toContain('durationMs');
    expect(sequenceDurationMs({ steps: [step(), step({ durationMs: 2500 })] as never })).toBe(
      12_500,
    );
  });

  it('lists the step kinds the sim has a handler for', () => {
    expect([...SEQUENCE_STEP_KINDS]).toEqual(['microSleeps', 'beats']);
  });

  it('accepts a bar and a music of null: no bar, no compact timer, no change of music', () => {
    const framing = real.framing as Record<string, unknown>;
    expect(parse({ ...real, framing: { ...framing, bar: null, musicLoop: null } })).toMatchObject({
      ok: true,
    });
  });

  it.each<[string, unknown, string[]]>([
    ['no step', { ...real, steps: [] }, ['steps']],
    ['an unknown step kind', { ...real, steps: [step({ kind: 'dance' })] }, ['steps[0].kind']],
    [
      'a gapMinMs above gapMaxMs',
      { ...real, steps: [step({ gapMinMs: 7000 })] },
      ['steps[0].gapMinMs'],
    ],
    ['a step of 0 ms', { ...real, steps: [step({ durationMs: 0 })] }, ['steps[0].durationMs']],
    [
      'a fractional step',
      { ...real, steps: [step({ durationMs: 10.5 })] },
      ['steps[0].durationMs'],
    ],
    ['an unknown success kind', { ...real, success: { kind: 'dance' } }, ['success.kind']],
    ['an unknown failure kind', { ...real, failure: { kind: 'dance' } }, ['failure.kind']],
    ['a failure with no hasSnore', { ...real, failure: { kind: 'gag' } }, ['failure.hasSnore']],
    ['an id in camelCase', { ...real, id: 'stayAwake' }, ['id']],
    ['a stray key', { ...real, durationMs: 30000 }, ['durationMs']],
    [
      'a bar fill that is neither opponent nor player',
      {
        ...real,
        framing: {
          ...(real.framing as object),
          bar: { labelKey: 'hud.sequence_stay_awake', fill: 'boss', value: 'timeLeft' },
        },
      },
      ['framing.bar.fill'],
    ],
    [
      'a bar value the sim cannot read',
      {
        ...real,
        framing: {
          ...(real.framing as object),
          bar: { labelKey: 'hud.sequence_stay_awake', fill: 'opponent', value: 'health' },
        },
      },
      ['framing.bar.value'],
    ],
    [
      'a camera with no zoom',
      {
        ...real,
        framing: { ...(real.framing as object), camera: { focusPct: 60, inMs: 900, outMs: 700 } },
      },
      ['framing.camera.zoomPct'],
    ],
    [
      'a feedback cue that is not an id',
      { ...real, feedback: { started: 'Go', succeeded: 'ok', failed: 'ko' } },
      ['feedback.started'],
    ],
  ])('refuses %s', (_name, value, expected) => {
    expect(pathsOf(value)).toEqual(expected);
  });
});

const LULLABY_FILE = 'content/sequences/lullaby_walk.json';
const lullaby: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/sequences/lullaby_walk.json', import.meta.url), 'utf8'),
);
const lullabyStep = lullaby.steps as Record<string, unknown>[];

function lullabyPaths(value: unknown): string[] {
  const result = parseContentFile(LULLABY_FILE, JSON.stringify(value), SequenceDefSchema);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/sequences/lullaby_walk.json (story 4.5)', () => {
  it('parses as a beats step with a babyAwake failure and a calmLeft bar', () => {
    const parsed = parseContentFile(LULLABY_FILE, JSON.stringify(lullaby), SequenceDefSchema);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('lullaby_walk');
    expect(parsed.value.steps.map((entry) => entry.kind)).toEqual(['beats']);
    expect(parsed.value.failure.kind).toBe('babyAwake');
    expect(parsed.value.framing.bar?.value).toBe('calmLeft');
  });

  it('keeps the frozen fixture a valid def of the same shape', () => {
    expect(createTestLullabyWalk().steps[0]?.kind).toBe('beats');
  });

  it('keeps every number of the beats step and its failure with a unit suffix', () => {
    const suffix = /(Ms|Pct|Beats|bpmStart|bpmEnd|decoyBeats)$/;
    const step = lullabyStep[0] as Record<string, unknown>;
    const failure = lullaby.failure as Record<string, unknown>;
    for (const [key, value] of [...Object.entries(step), ...Object.entries(failure)]) {
      if (typeof value === 'number') expect(key, key).toMatch(suffix);
    }
  });

  it.each([
    [
      'decoys that do not strictly increase',
      { ...lullaby, steps: [{ ...lullabyStep[0], decoyBeats: [7, 7] }] },
      ['steps[0].decoyBeats'],
    ],
    [
      'decoys out of order',
      { ...lullaby, steps: [{ ...lullabyStep[0], decoyBeats: [15, 7] }] },
      ['steps[0].decoyBeats'],
    ],
    [
      'a negative decoy',
      { ...lullaby, steps: [{ ...lullabyStep[0], decoyBeats: [-1] }] },
      ['steps[0].decoyBeats[0]'],
    ],
    [
      'a zero tempo',
      { ...lullaby, steps: [{ ...lullabyStep[0], bpmStart: 0 }] },
      ['steps[0].bpmStart'],
    ],
    [
      'a window of 0 ms',
      { ...lullaby, steps: [{ ...lullabyStep[0], windowMs: 0 }] },
      ['steps[0].windowMs'],
    ],
    [
      'a track that is not an id',
      { ...lullaby, steps: [{ ...lullabyStep[0], track: 'Lullaby' }] },
      ['steps[0].track'],
    ],
    [
      'a wake cost above 100',
      { ...lullaby, failure: { ...(lullaby.failure as object), missWakePct: 101 } },
      ['failure.missWakePct'],
    ],
    [
      'a failure with no strayWakePct',
      {
        ...lullaby,
        failure: { kind: 'babyAwake', missWakePct: 12, decoyWakePct: 20 },
      },
      ['failure.strayWakePct'],
    ],
    [
      'a beats step with a gag failure',
      { ...lullaby, failure: { kind: 'gag', hasSnore: false } },
      ['failure.kind'],
    ],
  ])('refuses %s', (_name, value, expected) => {
    expect(lullabyPaths(value)).toEqual(expected);
  });

  it('refuses a babyAwake failure on a sequence with no beats step', () => {
    expect(
      pathsOf({
        ...real,
        failure: { kind: 'babyAwake', missWakePct: 1, decoyWakePct: 1, strayWakePct: 1 },
      }),
    ).toEqual(['failure.kind']);
  });
});
