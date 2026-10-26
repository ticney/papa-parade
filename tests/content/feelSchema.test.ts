import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeelSchema } from '../../src/content/schemas/feel.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FEEL_URL = new URL('../../content/feel.json', import.meta.url);
const real: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(FEEL_URL, 'utf8'));

const UNIT_SUFFIX = /(?:Ms|Pct|PerSec|Mps|Deg|Px|Scale|Multiplier|Points|Count|Stars)$|^perSec$/;

function parse(value: unknown) {
  return parseContentFile('content/feel.json', JSON.stringify(value), FeelSchema);
}

type Json = Record<string, unknown>;

/** A copy of the real file with the leaves at the given `group.key` paths replaced (`undefined` deletes). */
function mutated(...changes: [path: string, value: unknown][]) {
  const copy = structuredClone(real) as Json;
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node = copy;
    for (const name of names) {
      const next = node[name];
      if (typeof next !== 'object' || next === null) throw new Error(`no group ${name} in ${path}`);
      node = next as Json;
    }
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  return parse(copy);
}

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/feel.json', () => {
  it('parses against FeelSchema', () => {
    expect(parse(real)).toMatchObject({ ok: true });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['an unknown key', [['timing.bogusMs', 1]], ['timing.bogusMs']],
    ['a string where a number is expected', [['timing.windowMs', 'x']], ['timing.windowMs']],
    [
      'perfectMs above windowMs',
      [
        ['timing.windowMs', 100],
        ['timing.perfectMs', 200],
      ],
      ['timing.perfectMs'],
    ],
    [
      'unsorted star thresholds',
      [['mama.starThresholdPoints', [20, 10, 60, 75, 90]]],
      ['mama.starThresholdPoints'],
    ],
    [
      'star thresholds of the wrong length',
      [['mama.starThresholdPoints', [20, 40, 60]]],
      ['mama.starThresholdPoints'],
    ],
    [
      'micro-sleep bounds in the wrong order',
      [
        ['fatigue.microSleepMinMs', 9000],
        ['fatigue.microSleepMaxMs', 1000],
      ],
      ['fatigue.microSleepMinMs'],
    ],
    [
      'a fixed baby state above its maximum',
      [
        ['mama.babyStateMaxPoints', 10],
        ['mama.babyStateFixedPoints', 20],
      ],
      ['mama.babyStateFixedPoints'],
    ],
    ['an unknown earlyPress value', [['input.earlyPress', 'maybe']], ['input.earlyPress']],
    ['a time scale of 0', [['instinct.timeScale', 0]], ['instinct.timeScale']],
    ['a time scale above 1', [['instinct.timeScale', 1.5]], ['instinct.timeScale']],
    ['a percentage above 100', [['fatigue.windowPenaltyPct', 120]], ['fatigue.windowPenaltyPct']],
    ['a negative duration', [['movement.glideMaxMs', -1]], ['movement.glideMaxMs']],
    ['a non-integer count', [['instinct.missesCount', 1.5]], ['instinct.missesCount']],
    ['a missing group', [['movement', undefined]], ['movement']],
    ['a missing key', [['timing.windowMs', undefined]], ['timing.windowMs']],
  ])('rejects %s', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });
});

describe('feel unit suffixes', () => {
  function numericLeafKeys(value: unknown, key = ''): string[] {
    if (typeof value === 'number') return [key];
    if (Array.isArray(value)) return value.some((item) => typeof item === 'number') ? [key] : [];
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([name, child]) => numericLeafKeys(child, name));
    }
    return [];
  }

  it('gives every numeric key of the file a unit suffix', () => {
    const leaves = numericLeafKeys(real);
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves.filter((key) => !UNIT_SUFFIX.test(key))).toEqual([]);
  });

  it('catches a key without a unit', () => {
    expect(UNIT_SUFFIX.test('duration')).toBe(false);
    expect(UNIT_SUFFIX.test('speed')).toBe(false);
    expect(UNIT_SUFFIX.test('windowMs')).toBe(true);
  });
});

describe('FeelSchema as JSON Schema', () => {
  const emitted = z.toJSONSchema(FeelSchema) as Record<string, unknown>;

  function undescribed(node: unknown, path = ''): string[] {
    if (typeof node !== 'object' || node === null) return [];
    const properties = (node as { properties?: Record<string, unknown> }).properties;
    if (properties === undefined) return [];
    return Object.entries(properties).flatMap(([name, child]) => {
      const here = path === '' ? name : `${path}.${name}`;
      const missing = (child as { description?: unknown }).description ? [] : [here];
      return [...missing, ...undescribed(child, here)];
    });
  }

  it('describes every property, groups included', () => {
    expect(undescribed(emitted)).toEqual([]);
  });

  it('is strict at every level', () => {
    expect(emitted.additionalProperties).toBe(false);
  });
});
