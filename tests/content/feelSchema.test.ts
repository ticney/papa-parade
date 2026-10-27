import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeelSchema } from '../../src/content/schemas/feel.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FEEL_URL = new URL('../../content/feel.json', import.meta.url);
const real: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(FEEL_URL, 'utf8'));

// AC 1 lists the suffixes. The bare `fatigue.perSec` is the one documented exception (Dev Notes ›
// Feel keys): the group name `fatigue` already carries the quantity.
// `RadiusM` and `DistM` are metres (`papaRadiusM`, `wanderMaxDistM`): a length is spelled out, so a
// bare `M` does not pass.
// Story 1.16 adds `ReachM` (`propReachM`: how far a gag reaches).
// Story 1.15 adds `Kg`, `Ns` (newton-seconds) and `Mps2`, and the dimensionless physics ratios
// `friction` and `restitution` (a coefficient has no unit; the key says what it is).
const UNIT_SUFFIX =
  /(?:Ms|Pct|PerSec|Mps|Mps2|Deg|Px|Scale|Multiplier|Points|Count|Stars|RadiusM|DistM|ReachM|Kg|Ns)$|^(?:perSec|friction|restitution)$/;

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
    [
      'a negative slow-mo return',
      [['timing.slowMoPerfect.returnMs', -1]],
      ['timing.slowMoPerfect.returnMs'],
    ],
    [
      'a missing slow-mo return',
      [['timing.slowMoLastThreat.returnMs', undefined]],
      ['timing.slowMoLastThreat.returnMs'],
    ],
    [
      'a perfect slow-mo below the minimum time scale',
      [['timing.slowMoPerfect.timeScale', 0.01]],
      ['timing.slowMoPerfect.timeScale'],
    ],
    [
      'a last-threat slow-mo below the minimum time scale',
      [['timing.slowMoLastThreat.timeScale', 0.01]],
      ['timing.slowMoLastThreat.timeScale'],
    ],
    ['a non-integer count', [['instinct.missesCount', 1.5]], ['instinct.missesCount']],
    ['a walking speed of 0', [['movement.walkSpeedMps', 0]], ['movement.walkSpeedMps']],
    [
      'a walking speed that jumps walls',
      [['movement.walkSpeedMps', 13]],
      ['movement.walkSpeedMps'],
    ],
    [
      'a papa radius that closes the room',
      [['movement.papaRadiusM', 1.5]],
      ['movement.papaRadiusM'],
    ],
    ['a negative papa radius', [['movement.papaRadiusM', -0.1]], ['movement.papaRadiusM']],
    ['a crawl speed of 0', [['baby.crawlSpeedMps', 0]], ['baby.crawlSpeedMps']],
    ['a crawl speed that jumps walls', [['baby.crawlSpeedMps', 13]], ['baby.crawlSpeedMps']],
    ['a negative baby radius', [['baby.bodyRadiusM', -0.1]], ['baby.bodyRadiusM']],
    ['a baby radius that closes the room', [['baby.bodyRadiusM', 1.5]], ['baby.bodyRadiusM']],
    [
      'babble bounds in the wrong order',
      [
        ['baby.babbleMinMs', 5000],
        ['baby.babbleMaxMs', 1000],
      ],
      ['baby.babbleMinMs'],
    ],
    ['a negative babble pause', [['baby.babbleMinMs', -1]], ['baby.babbleMinMs']],
    [
      'wander distances in the wrong order',
      [
        ['baby.wanderMinDistM', 4],
        ['baby.wanderMaxDistM', 2],
      ],
      ['baby.wanderMinDistM'],
    ],
    ['a negative minimum wander distance', [['baby.wanderMinDistM', -1]], ['baby.wanderMinDistM']],
    [
      'a wander distance of 0',
      [
        ['baby.wanderMinDistM', 0],
        ['baby.wanderMaxDistM', 0],
      ],
      ['baby.wanderMaxDistM'],
    ],
    ['a negative lock time', [['baby.lockMs', -1]], ['baby.lockMs']],
    ['an approach speed of 0', [['baby.approachSpeedMps', 0]], ['baby.approachSpeedMps']],
    [
      'an approach speed that jumps walls',
      [['baby.approachSpeedMps', 13]],
      ['baby.approachSpeedMps'],
    ],
    ['a negative act time', [['baby.actMs', -1]], ['baby.actMs']],
    ['a stick deadzone of 100 %', [['input.stickDeadzonePct', 100]], ['input.stickDeadzonePct']],
    ['a negative stick deadzone', [['input.stickDeadzonePct', -1]], ['input.stickDeadzonePct']],
    ['a stick angle step of 0', [['input.stickAngleStepDeg', 0]], ['input.stickAngleStepDeg']],
    ['a stick angle step above 90', [['input.stickAngleStepDeg', 91]], ['input.stickAngleStepDeg']],
    ['a missing group', [['movement', undefined]], ['movement']],
    ['a missing key', [['timing.windowMs', undefined]], ['timing.windowMs']],
  ])('rejects %s', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });
});

describe('feel.physics (story 1.15)', () => {
  // `mug` is a kind of the real file; the values stay Geo's, only the structure is pinned.
  const mugPath = (key: string) => `physics.kinds.mug.${key}`;
  const mugKeys = ['shape', 'massKg', 'friction', 'restitution', 'breakable', 'breakImpulseNs'];

  it.each(mugKeys)('refuses a kind with no %s, at its path', (key) => {
    expect(failedPaths(mutated([mugPath(key), undefined]))).toEqual([mugPath(key)]);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a negative mass', [[mugPath('massKg'), -1]], [mugPath('massKg')]],
    ['a zero mass', [[mugPath('massKg'), 0]], [mugPath('massKg')]],
    ['a negative friction', [[mugPath('friction'), -0.1]], [mugPath('friction')]],
    ['a restitution above 1', [[mugPath('restitution'), 1.5]], [mugPath('restitution')]],
    ['an unknown shape', [[mugPath('shape'), 'pyramid']], [mugPath('shape')]],
    [
      'a breakable kind with a non-positive break impulse',
      [
        [mugPath('breakable'), true],
        [mugPath('breakImpulseNs'), 0],
      ],
      [mugPath('breakImpulseNs')],
    ],
    ['a zero gravity', [['physics.gravityMps2', 0]], ['physics.gravityMps2']],
    [
      'a zero impact threshold',
      [['physics.impactMinImpulseNs', 0]],
      ['physics.impactMinImpulseNs'],
    ],
    ['a negative cooldown', [['physics.impactCooldownMs', -1]], ['physics.impactCooldownMs']],
    ['an unknown key in a kind', [[mugPath('bogusKg'), 1]], [mugPath('bogusKg')]],
  ])('refuses %s', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it('accepts a prop kind that is not breakable', () => {
    expect(mutated([mugPath('breakable'), false])).toMatchObject({ ok: true });
  });
});

describe('feel.gags (story 1.16)', () => {
  const tablePath = (key: string) => `gags.tableObjectFall.${key}`;

  it.each(['pushImpulseNs', 'propReachM'])('refuses a missing %s, at its path', (key) => {
    expect(failedPaths(mutated([tablePath(key), undefined]))).toEqual([tablePath(key)]);
  });

  it.each(['pushImpulseNs', 'propReachM'])('refuses a %s of 0, at its path', (key) => {
    expect(failedPaths(mutated([tablePath(key), 0]))).toEqual([tablePath(key)]);
  });

  it('refuses a missing gags group', () => {
    expect(failedPaths(mutated(['gags', undefined]))).toEqual(['gags']);
  });

  it('refuses an unknown key in a gag', () => {
    expect(failedPaths(mutated([tablePath('bogusNs'), 1]))).toEqual([tablePath('bogusNs')]);
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
    expect(UNIT_SUFFIX.test('distanceM')).toBe(false);
    expect(UNIT_SUFFIX.test('papaRadiusM')).toBe(true);
    expect(UNIT_SUFFIX.test('wanderMinDistM')).toBe(true);
    expect(UNIT_SUFFIX.test('windowMs')).toBe(true);
    expect(UNIT_SUFFIX.test('massKg')).toBe(true);
    expect(UNIT_SUFFIX.test('breakImpulseNs')).toBe(true);
    expect(UNIT_SUFFIX.test('gravityMps2')).toBe(true);
    expect(UNIT_SUFFIX.test('propReachM')).toBe(true);
    expect(UNIT_SUFFIX.test('mass')).toBe(false);
    expect(UNIT_SUFFIX.test('impulse')).toBe(false);
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
