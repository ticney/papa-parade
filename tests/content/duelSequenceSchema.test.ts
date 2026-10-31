import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import {
  SEQUENCE_FAILURE_KINDS,
  SEQUENCE_STEP_KINDS,
  SequenceDefSchema,
} from '@content/schemas/sequence';
import { describe, expect, it } from 'vitest';

// The duel step and the `retreats` failure in the sequence schema (story 4.6). Tunable values are
// never pinned here: structure, ranges and cross-field rules only.
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../content/sequences/${file}`, import.meta.url), 'utf8'));
const duel = read('bedtime_duel.json');
const stayAwake = read('stay_awake.json');
const lullaby = read('lullaby_walk.json');

function failedPaths(value: unknown): string[] {
  const result = parseContentFile(
    'content/sequences/x.json',
    JSON.stringify(value),
    SequenceDefSchema,
  );
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

function edited(
  base: Record<string, unknown>,
  change: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = structuredClone(base);
  change(copy);
  return copy;
}

const steps = (copy: Record<string, unknown>) => copy.steps as Record<string, unknown>[];
const failure = (copy: Record<string, unknown>) => copy.failure as Record<string, unknown>;
const framing = (copy: Record<string, unknown>) => copy.framing as Record<string, unknown>;

describe('content/sequences/bedtime_duel.json (story 4.6)', () => {
  it('parses, and lists the duel kind and the retreats failure', () => {
    expect(failedPaths(duel)).toEqual([]);
    expect(SEQUENCE_STEP_KINDS).toContain('duel');
    expect(SEQUENCE_FAILURE_KINDS).toContain('retreats');
  });

  it.each([
    [
      'a missing threatDef',
      (step: Record<string, unknown>) => delete step.threatDef,
      'steps[0].threatDef',
    ],
    ['a missing restMs', (step: Record<string, unknown>) => delete step.restMs, 'steps[0].restMs'],
    ['a negative restMs', (step: Record<string, unknown>) => (step.restMs = -1), 'steps[0].restMs'],
    [
      'a fractional restMs',
      (step: Record<string, unknown>) => (step.restMs = 1.5),
      'steps[0].restMs',
    ],
    [
      'a durationMs of 0',
      (step: Record<string, unknown>) => (step.durationMs = 0),
      'steps[0].durationMs',
    ],
    [
      'a threatDef in camelCase',
      (step: Record<string, unknown>) => (step.threatDef = 'bedtimeEyes'),
      'steps[0].threatDef',
    ],
    ['an unknown key', (step: Record<string, unknown>) => (step.gapMinMs = 1), 'steps[0].gapMinMs'],
  ])('rejects %s', (_name, change, expected) => {
    expect(
      failedPaths(edited(duel, (copy) => change(steps(copy)[0] as Record<string, unknown>))),
    ).toEqual([expected]);
  });

  it('accepts a restMs of 0 (a round at once)', () => {
    expect(
      failedPaths(edited(duel, (copy) => ((steps(copy)[0] as Record<string, unknown>).restMs = 0))),
    ).toEqual([]);
  });

  it.each([
    [
      'a maxRetreats of 0',
      (f: Record<string, unknown>) => (f.maxRetreats = 0),
      'failure.maxRetreats',
    ],
    [
      'a fractional maxRetreats',
      (f: Record<string, unknown>) => (f.maxRetreats = 2.5),
      'failure.maxRetreats',
    ],
    [
      'a missing maxRetreats',
      (f: Record<string, unknown>) => delete f.maxRetreats,
      'failure.maxRetreats',
    ],
  ])('rejects %s', (_name, change, expected) => {
    expect(failedPaths(edited(duel, (copy) => change(failure(copy))))).toEqual([expected]);
  });
});

describe('the rules that tie a duel to its failure (story 4.6)', () => {
  it('refuses a duel step with a gag failure', () => {
    expect(
      failedPaths(edited(duel, (copy) => (copy.failure = { kind: 'gag', hasSnore: false }))),
    ).toEqual(['failure.kind']);
  });

  it('refuses a retreats failure with no duel step', () => {
    expect(
      failedPaths(
        edited(stayAwake, (copy) => (copy.failure = { kind: 'retreats', maxRetreats: 3 })),
      ),
    ).toContain('failure.kind');
  });

  it('refuses a retreats def that has a step which is not a duel', () => {
    const mixed = edited(duel, (copy) => {
      steps(copy).push(structuredClone(steps(stayAwake)[0] as Record<string, unknown>));
    });
    expect(failedPaths(mixed)).toEqual(['steps']);
  });

  it('refuses a timeLeft bar on a retreats def, and accepts none', () => {
    const withBar = edited(duel, (copy) => {
      framing(copy).bar = {
        labelKey: 'hud.sequence_stay_awake',
        fill: 'opponent',
        value: 'timeLeft',
      };
    });
    expect(failedPaths(withBar)).toEqual(['framing.bar.value']);
    expect(failedPaths(duel)).toEqual([]);
  });

  it('leaves the stay_awake and lullaby_walk defs as they were', () => {
    expect(failedPaths(stayAwake)).toEqual([]);
    expect(failedPaths(lullaby)).toEqual([]);
  });
});
