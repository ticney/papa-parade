import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeelSchema, NOISE_SOURCE_IDS } from '../../src/content/schemas/feel.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FEEL_URL = new URL('../../content/feel.json', import.meta.url);
const real: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(FEEL_URL, 'utf8'));

// AC 1 lists the suffixes. The bare `fatigue.perSec` is the one documented exception (Dev Notes ›
// Feel keys): the group name `fatigue` already carries the quantity.
// `RadiusM` and `DistM` are metres (`papaRadiusM`, `wanderMaxDistM`): a length is spelled out, so a
// bare `M` does not pass.
// Story 1.15 adds `Kg`, `Ns` (newton-seconds) and `Mps2`, and the dimensionless physics ratios
// `friction` and `restitution` (a coefficient has no unit; the key says what it is).
// Story 1.17 adds `ReachM` (`contextReachM`: a length in metres, spelled out like `RadiusM`).
// Story 2.5 adds `Hz` and the exact keys `amplitudeM` and `sizeM` (lengths in metres of the fx
// presets) and `count` (a particle count).
// Story 2.7 adds `Taps` (`minValidTaps`: a count of taps) and the exact key `bpm` (a tempo; the unit
// is the name).
// Story 3.16 adds the exact keys of `catastrophe.risePct` (`nearMiss`, `mess`, `microSleep`,
// `choreBeat`): the group name `risePct` carries the unit, like `fatigue.perSec`.
// Story 4.1 adds `OffsetM` (`putDownOffsetM`) and the exact key `reachM` (lengths in metres, spelled out).
// Story 9.2 adds `WidthM` and `DepthM` (`frameWidthM`: lengths in metres, spelled out) and the exact key
// `dampingRatio` (a spring's damping ratio has no unit; the key says what it is).
const UNIT_SUFFIX =
  /(?:Ms|Pct|PerSec|Mps|Mps2|Deg|Px|Scale|Multiplier|Points|Count|Stars|RadiusM|DistM|ReachM|OffsetM|WidthM|DepthM|Kg|Ns|Hz|Taps)$|^(?:perSec|friction|restitution|amplitudeM|sizeM|count|bpm|reachM|dampingRatio|nearMiss|mess|microSleep|choreBeat)$/;

/** The four numbers of a brow pose (story 7.10), whatever their values. */
const BROW_POSE_SHAPE = {
  raiseOffsetM: expect.any(Number),
  tiltDeg: expect.any(Number),
  inwardOffsetM: expect.any(Number),
  skewOffsetM: expect.any(Number),
};

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
      'a negative fairness margin (story 3.13)',
      [['director.fairnessMarginMs', -1]],
      ['director.fairnessMarginMs'],
    ],
    ['an unknown director key (story 3.13)', [['director.bogusMs', 1]], ['director.bogusMs']],
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
      'cry-in-the-arms bounds in the wrong order (story 4.1)',
      [
        ['carry.armsCryMinMs', 9000],
        ['carry.armsCryMaxMs', 1000],
      ],
      ['carry.armsCryMinMs'],
    ],
    [
      'a combo minimum at the maximum (story 4.2)',
      [
        ['combo.minMultiplier', 8],
        ['combo.maxMultiplier', 8],
      ],
      ['combo.minMultiplier'],
    ],
    [
      'a combo minimum above the maximum',
      [
        ['combo.minMultiplier', 5],
        ['combo.maxMultiplier', 3],
      ],
      ['combo.minMultiplier'],
    ],
    ['a combo minimum of 0', [['combo.minMultiplier', 0]], ['combo.minMultiplier']],
    ['a fractional combo maximum', [['combo.maxMultiplier', 4.5]], ['combo.maxMultiplier']],
    ['a combo tick of 0 ms', [['combo.carryTickMs', 0]], ['combo.carryTickMs']],
    [
      'base points per response of 0 (a cash-in would be +0)',
      [['combo.basePerResponsePoints', 0]],
      ['combo.basePerResponsePoints'],
    ],
    [
      'base points per tick of 0',
      [['combo.basePerCarryTickPoints', 0]],
      ['combo.basePerCarryTickPoints'],
    ],
    [
      'a cash-in slow-mo below the minimum time scale',
      [['combo.slowMoCashIn.timeScale', 0.01]],
      ['combo.slowMoCashIn.timeScale'],
    ],
    ['a missing combo section', [['combo', undefined]], ['combo']],
    ['a missing carry.reachM', [['carry.reachM', undefined]], ['carry.reachM']],
    ['a reach of 0 (nothing would ever be in it)', [['carry.reachM', 0]], ['carry.reachM']],
    ['a negative carry.putDownOffsetM', [['carry.putDownOffsetM', -1]], ['carry.putDownOffsetM']],
    ...(
      [
        'laughPerPerfectPoints',
        'laughPerSuccessPoints',
        'calmNoiseThresholdPct',
        'sighPerPropOnFloorPoints',
        'sighPerBrokenPropPoints',
        'sighPerMischiefPoints',
        'screamPerNearMissPoints',
        'laughPerLookPartPoints',
      ] as const
    ).flatMap((key): [string, [string, unknown][], string[]][] => [
      [`a missing mama.${key}`, [[`mama.${key}`, undefined]], [`mama.${key}`]],
      [`a negative mama.${key}`, [[`mama.${key}`, -1]], [`mama.${key}`]],
    ]),
    [
      'maxima of the note that do not add up to 100 (story 1.22)',
      [['mama.laughMaxPoints', (real.mama?.laughMaxPoints as number) + 1]],
      ['mama.laughMaxPoints'],
    ],
    [
      'a base score that is not the sigh and scream maxima (story 1.22 D3)',
      [['mama.baseScorePoints', (real.mama?.baseScorePoints as number) + 1]],
      ['mama.baseScorePoints'],
    ],
    ['a missing mama.calmMaxPoints', [['mama.calmMaxPoints', undefined]], ['mama.calmMaxPoints']],
    ['a missing mama.homeMaxPoints', [['mama.homeMaxPoints', undefined]], ['mama.homeMaxPoints']],
    [
      'maxima of the note that do not add up to 100 through the calm row (story 3.12)',
      [['mama.calmMaxPoints', (real.mama?.calmMaxPoints as number) + 1]],
      ['mama.laughMaxPoints'],
    ],
    [
      'maxima of the note that do not add up to 100 through the home row (story 3.12)',
      [['mama.homeMaxPoints', (real.mama?.homeMaxPoints as number) - 1]],
      ['mama.laughMaxPoints'],
    ],
    [
      'a fractional calm maximum: the rows are whole numbers that add up to the score',
      [['mama.calmMaxPoints', 20.5]],
      ['mama.calmMaxPoints'],
    ],
    ['a fractional home maximum', [['mama.homeMaxPoints', 15.5]], ['mama.homeMaxPoints']],
    [
      'a calm noise threshold above 100 %',
      [['mama.calmNoiseThresholdPct', 120]],
      ['mama.calmNoiseThresholdPct'],
    ],
    // The prototype's fixed baby state is gone (story 3.12): the file is strict.
    ...(['babyStateMaxPoints', 'babyStateFixedPoints'] as const).map(
      (key): [string, [string, unknown][], string[]] => [
        `the removed mama.${key}`,
        [[`mama.${key}`, 20]],
        [`mama.${key}`],
      ],
    ),
    ['a fractional sigh maximum', [['mama.sighMaxPoints', 15.5]], ['mama.sighMaxPoints']],
    [
      'a wake penalty above the five stars (story 3.2)',
      [['mama.earlyWakePenaltyStars', 6]],
      ['mama.earlyWakePenaltyStars'],
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
    [
      'an instinct below the minimum time scale (the sim would refuse it)',
      [['instinct.timeScale', 0.01]],
      ['instinct.timeScale'],
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
    ['a context reach of 0', [['input.contextReachM', 0]], ['input.contextReachM']],
    ['a missing context reach', [['input.contextReachM', undefined]], ['input.contextReachM']],
    ['a negative context reach', [['input.contextReachM', -1]], ['input.contextReachM']],
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

  it.each(['pushImpulseNs', 'propReachDistM'])('refuses a missing %s, at its path', (key) => {
    expect(failedPaths(mutated([tablePath(key), undefined]))).toEqual([tablePath(key)]);
  });

  it.each(['pushImpulseNs', 'propReachDistM'])('refuses a %s of 0, at its path', (key) => {
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
    expect(UNIT_SUFFIX.test('propReachDistM')).toBe(true);
    expect(UNIT_SUFFIX.test('minValidTaps')).toBe(true);
    expect(UNIT_SUFFIX.test('bpm')).toBe(true);
    expect(UNIT_SUFFIX.test('frameWidthM')).toBe(true);
    expect(UNIT_SUFFIX.test('dampingRatio')).toBe(true);
    expect(UNIT_SUFFIX.test('ratio')).toBe(false);
    expect(UNIT_SUFFIX.test('frameM')).toBe(false);
    expect(UNIT_SUFFIX.test('taps')).toBe(false);
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

describe('feel.fx (story 2.5)', () => {
  const p = (path: string) => `fx.${path}`;

  it('accepts the bounds themselves', () => {
    expect(
      mutated(
        [p('shakeFrequencyHz'), 4],
        [p('success.shake.amplitudeM'), 0],
        [p('success.particles.count'), 0],
        [p('perfect.stampMs'), 0],
        [p('perfectCamera.zoomInMs'), 0],
        [p('perfectCamera.refocusMs'), 0],
      ),
    ).toMatchObject({ ok: true });
    expect(
      mutated(
        [p('shakeFrequencyHz'), 30],
        [p('perfect.shake.amplitudeM'), 0.1],
        [p('perfect.shake.durationMs'), 400],
        [p('perfect.particles.count'), 32],
        [p('perfect.stampMs'), 900],
        [p('perfectCamera.zoomPct'), 40],
      ),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a frequency below 4 Hz', [[p('shakeFrequencyHz'), 3]], [p('shakeFrequencyHz')]],
    ['a frequency above 30 Hz', [[p('shakeFrequencyHz'), 31]], [p('shakeFrequencyHz')]],
    ['an amplitude above 0.1 m', [[p('gag.shake.amplitudeM'), 0.11]], [p('gag.shake.amplitudeM')]],
    ['a negative amplitude', [[p('gag.shake.amplitudeM'), -0.01]], [p('gag.shake.amplitudeM')]],
    [
      'a shake over 400 ms',
      [[p('success.shake.durationMs'), 401]],
      [p('success.shake.durationMs')],
    ],
    ['an unknown style', [[p('success.particles.style'), 'blob']], [p('success.particles.style')]],
    ['a burst over the cap', [[p('success.particles.count'), 33]], [p('success.particles.count')]],
    ['a fractional count', [[p('success.particles.count'), 2.5]], [p('success.particles.count')]],
    [
      'a speed above 6 m/s',
      [[p('success.particles.speedMps'), 7]],
      [p('success.particles.speedMps')],
    ],
    ['a life under 50 ms', [[p('success.particles.lifeMs'), 49]], [p('success.particles.lifeMs')]],
    [
      'a life over 1000 ms',
      [[p('success.particles.lifeMs'), 1001]],
      [p('success.particles.lifeMs')],
    ],
    ['a size under 0.01 m', [[p('gag.particles.sizeM'), 0.005]], [p('gag.particles.sizeM')]],
    ['a size over 0.3 m', [[p('gag.particles.sizeM'), 0.31]], [p('gag.particles.sizeM')]],
    ['a stamp over the UX ceiling', [[p('perfect.stampMs'), 901]], [p('perfect.stampMs')]],
    ['a zoom above 40 %', [[p('perfectCamera.zoomPct'), 41]], [p('perfectCamera.zoomPct')]],
    ['a yaw above 12 degrees', [[p('perfectCamera.yawDeg'), 13]], [p('perfectCamera.yawDeg')]],
    ['a focus above 60 %', [[p('perfectCamera.focusPct'), 61]], [p('perfectCamera.focusPct')]],
    ['a zoom-in over 500 ms', [[p('perfectCamera.zoomInMs'), 501]], [p('perfectCamera.zoomInMs')]],
    [
      'a refocus over 500 ms',
      [[p('perfectCamera.refocusMs'), 501]],
      [p('perfectCamera.refocusMs')],
    ],
    ['a missing preset', [[p('perfect'), undefined]], [p('perfect')]],
    ['a missing fx block', [['fx', undefined]], ['fx']],
    ['an unknown preset', [[p('bogus'), {}]], [p('bogus')]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });
});

describe('feel.fx.photoCamera and feel.endOfLevel.frozenNearMissReachM (story 3.6)', () => {
  const p = (path: string) => `fx.photoCamera.${path}`;
  const reach = 'endOfLevel.frozenNearMissReachM';

  it('accepts the bounds themselves', () => {
    expect(
      mutated([p('yawDeg'), 15], [p('pitchDeg'), 20], [p('zoomPct'), 0], [reach, 0.01]),
    ).toMatchObject({ ok: true });
    expect(mutated([p('yawDeg'), 75], [p('pitchDeg'), 60], [p('zoomPct'), 40])).toMatchObject({
      ok: true,
    });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a yaw under 15 degrees', [[p('yawDeg'), 14]], [p('yawDeg')]],
    ['a yaw over 75 degrees', [[p('yawDeg'), 76]], [p('yawDeg')]],
    ['a pitch under 20 degrees', [[p('pitchDeg'), 19]], [p('pitchDeg')]],
    ['a pitch over 60 degrees', [[p('pitchDeg'), 61]], [p('pitchDeg')]],
    ['a negative zoom', [[p('zoomPct'), -1]], [p('zoomPct')]],
    ['a zoom above 40 %', [[p('zoomPct'), 41]], [p('zoomPct')]],
    ['a missing camera', [['fx.photoCamera', undefined]], ['fx.photoCamera']],
    ['a reach of 0', [[reach, 0]], [reach]],
    ['a negative reach', [[reach, -1]], [reach]],
    ['a missing reach', [[reach, undefined]], [reach]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });
});

describe('feel.camera (story 9.2)', () => {
  const p = (path: string) => `camera.${path}`;

  it('accepts the bounds themselves', () => {
    expect(
      mutated(
        [p('frameWidthM'), 3],
        [p('frameDepthM'), 3],
        [p('deadZoneWidthPct'), 0],
        [p('deadZoneHeightPct'), 0],
        [p('edgeMarginPct'), 0],
        [p('catchUpMs'), 50],
        [p('dampingRatio'), 0.5],
        [p('reducedCatchUpMs'), 50],
      ),
    ).toMatchObject({ ok: true });
    expect(
      mutated(
        [p('frameWidthM'), 30],
        [p('frameDepthM'), 30],
        [p('deadZoneWidthPct'), 18],
        [p('deadZoneHeightPct'), 18],
        [p('edgeMarginPct'), 40],
        [p('catchUpMs'), 3000],
        [p('dampingRatio'), 1],
        [p('reducedCatchUpMs'), 5000],
      ),
    ).toMatchObject({ ok: true });
    // The widest dead zone, with no edge margin.
    expect(
      mutated([p('deadZoneWidthPct'), 80], [p('deadZoneHeightPct'), 80], [p('edgeMarginPct'), 0]),
    ).toMatchObject({ ok: true });
  });

  it('accepts a reduced catch-up equal to the normal one', () => {
    expect(mutated([p('catchUpMs'), 600], [p('reducedCatchUpMs'), 600])).toMatchObject({
      ok: true,
    });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a frame under 3 m wide', [[p('frameWidthM'), 2.9]], [p('frameWidthM')]],
    ['a frame over 30 m wide', [[p('frameWidthM'), 31]], [p('frameWidthM')]],
    ['a frame under 3 m deep', [[p('frameDepthM'), 2.9]], [p('frameDepthM')]],
    ['a frame over 30 m deep', [[p('frameDepthM'), 31]], [p('frameDepthM')]],
    ['a negative dead zone', [[p('deadZoneWidthPct'), -1]], [p('deadZoneWidthPct')]],
    ['a negative dead zone height', [[p('deadZoneHeightPct'), -1]], [p('deadZoneHeightPct')]],
    [
      'a dead zone over 80 % wide',
      [
        [p('deadZoneWidthPct'), 81],
        [p('edgeMarginPct'), 0],
      ],
      [p('deadZoneWidthPct')],
    ],
    [
      'a dead zone over 80 %',
      [
        [p('deadZoneHeightPct'), 81],
        [p('edgeMarginPct'), 0],
      ],
      [p('deadZoneHeightPct')],
    ],
    ['a negative edge margin', [[p('edgeMarginPct'), -1]], [p('edgeMarginPct')]],
    [
      'an edge margin over 40 %',
      [
        [p('edgeMarginPct'), 41],
        [p('deadZoneWidthPct'), 0],
        [p('deadZoneHeightPct'), 0],
      ],
      [p('edgeMarginPct')],
    ],
    ['a catch-up under 50 ms', [[p('catchUpMs'), 49]], [p('catchUpMs')]],
    [
      'a catch-up over 3000 ms',
      [
        [p('catchUpMs'), 3001],
        [p('reducedCatchUpMs'), 5000],
      ],
      [p('catchUpMs')],
    ],
    ['a damping under 0.5', [[p('dampingRatio'), 0.49]], [p('dampingRatio')]],
    ['a damping over 1', [[p('dampingRatio'), 1.01]], [p('dampingRatio')]],
    ['a reduced catch-up over 5000 ms', [[p('reducedCatchUpMs'), 5001]], [p('reducedCatchUpMs')]],
    [
      // Its bound, and the refine: no catch-up is under 50 ms, so the reduced one is below it too.
      'a reduced catch-up under 50 ms',
      [
        [p('catchUpMs'), 50],
        [p('reducedCatchUpMs'), 49],
      ],
      [p('reducedCatchUpMs'), p('reducedCatchUpMs')],
    ],
    [
      'a dead zone that reaches into the edge margin across',
      [
        [p('deadZoneWidthPct'), 40],
        [p('edgeMarginPct'), 30],
      ],
      [p('deadZoneWidthPct')],
    ],
    [
      'a dead zone that reaches into the edge margin up and down',
      [
        [p('deadZoneHeightPct'), 70],
        [p('edgeMarginPct'), 15],
      ],
      [p('deadZoneHeightPct')],
    ],
    [
      'a reduced catch-up faster than the normal one',
      [
        [p('catchUpMs'), 600],
        [p('reducedCatchUpMs'), 599],
      ],
      [p('reducedCatchUpMs')],
    ],
    ['a missing camera block', [['camera', undefined]], ['camera']],
    ['an unknown key', [[p('zoomPct'), 10]], [p('zoomPct')]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });
});

describe('feel.characters (story 7.8)', () => {
  const p = (path: string) => `characters.${path}`;

  it('accepts the bounds themselves', () => {
    expect(
      mutated(
        [p('fades.startMs'), 0],
        [p('fades.stopMs'), 0],
        [p('fades.returnMs'), 0],
        [p('fades.otherMs'), 0],
        [p('turn.reachMs'), 50],
        [p('turn.dampingRatio'), 0.3],
        [p('turn.overshootMaxDeg'), 0],
        [p('lean.maxAccelDeg'), 0],
        [p('lean.maxTurnDeg'), 0],
        [p('lean.reachMs'), 50],
        [p('breath.periodMs'), 334],
        [p('breath.alertPeriodMs'), 334],
        [p('breath.papaAmplitudeDeg'), 0],
        [p('breath.babyAmplitudeDeg'), 0],
        [p('gaze.maxYawDeg'), 0],
        [p('gaze.behindDeg'), 0],
        [p('gaze.reachMs'), 50],
        [p('stoop.maxDeg'), 0],
        [p('forelock.reachMs'), 50],
        [p('forelock.dampingRatio'), 0.3],
        [p('forelock.maxDeg'), 0],
        [p('expressions.reachMs'), 50],
        [p('expressions.papa.browScalePct'), 50],
        [p('expressions.papa.surprisedMs'), 0],
        [p('expressions.papa.firmAfterMs'), 0],
        [p('expressions.papa.proudMs'), 0],
        [p('expressions.papa.poses.firm.raiseOffsetM'), -0.02],
        [p('expressions.papa.poses.firm.tiltDeg'), -45],
        [p('expressions.papa.poses.firm.inwardOffsetM'), 0],
        [p('expressions.papa.poses.firm.skewOffsetM'), -0.02],
        [p('expressions.baby.browScalePct'), 50],
        [p('expressions.baby.delightedMs'), 0],
        [p('expressions.baby.sulkyMs'), 0],
        [p('look.outlineWidthPct'), 50],
        [p('look.rimStrengthPct'), 0],
        [p('look.rimWidthPct'), 1],
        [p('look.fourthTonePct'), 0],
      ),
    ).toMatchObject({ ok: true });
    expect(
      mutated(
        [p('fades.startMs'), 400],
        [p('fades.stopMs'), 400],
        [p('fades.returnMs'), 200],
        [p('fades.otherMs'), 400],
        [p('turn.reachMs'), 1000],
        [p('turn.dampingRatio'), 1],
        [p('turn.overshootMaxDeg'), 45],
        [p('lean.maxAccelDeg'), 45],
        [p('lean.maxTurnDeg'), 45],
        [p('lean.fullAccelMps2'), 100],
        [p('lean.fullTurnDegPerSec'), 3600],
        [p('lean.reachMs'), 1000],
        [p('breath.periodMs'), 20000],
        [p('breath.alertPeriodMs'), 20000],
        [p('breath.papaAmplitudeDeg'), 10],
        [p('breath.babyAmplitudeDeg'), 10],
        [p('gaze.maxYawDeg'), 90],
        [p('gaze.behindDeg'), 180],
        [p('gaze.reachMs'), 1000],
        [p('stoop.maxDeg'), 45],
        [p('forelock.reachMs'), 1000],
        [p('forelock.dampingRatio'), 1],
        [p('forelock.maxDeg'), 40],
        [p('expressions.reachMs'), 1000],
        [p('expressions.papa.browScalePct'), 250],
        [p('expressions.papa.surprisedMs'), 5000],
        [p('expressions.papa.firmAfterMs'), 3000],
        [p('expressions.papa.proudMs'), 5000],
        [p('expressions.baby.poses.sleepy.raiseOffsetM'), 0.05],
        [p('expressions.baby.poses.sleepy.tiltDeg'), 45],
        [p('expressions.baby.poses.sleepy.inwardOffsetM'), 0.02],
        [p('expressions.baby.poses.sleepy.skewOffsetM'), 0.02],
        [p('expressions.baby.browScalePct'), 250],
        [p('expressions.baby.delightedMs'), 5000],
        [p('expressions.baby.sulkyMs'), 5000],
        [p('look.outlineWidthPct'), 300],
        [p('look.rimStrengthPct'), 100],
        [p('look.rimWidthPct'), 100],
        [p('look.isFourthToneOn'), true],
        [p('look.fourthTonePct'), 100],
      ),
    ).toMatchObject({ ok: true });
  });

  it('accepts an alarmed breath as slow as the calm one', () => {
    expect(mutated([p('breath.periodMs'), 2000], [p('breath.alertPeriodMs'), 2000])).toMatchObject({
      ok: true,
    });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a negative start fade', [[p('fades.startMs'), -1]], [p('fades.startMs')]],
    ['a start fade over 400 ms', [[p('fades.startMs'), 401]], [p('fades.startMs')]],
    ['a stop fade over 400 ms', [[p('fades.stopMs'), 401]], [p('fades.stopMs')]],
    ['a return fade over 200 ms', [[p('fades.returnMs'), 201]], [p('fades.returnMs')]],
    ['an other fade over 400 ms', [[p('fades.otherMs'), 401]], [p('fades.otherMs')]],
    ['a turn under 50 ms', [[p('turn.reachMs'), 49]], [p('turn.reachMs')]],
    ['a turn over 1000 ms', [[p('turn.reachMs'), 1001]], [p('turn.reachMs')]],
    ['a turn damping under 0.3', [[p('turn.dampingRatio'), 0.29]], [p('turn.dampingRatio')]],
    ['a turn damping over 1', [[p('turn.dampingRatio'), 1.01]], [p('turn.dampingRatio')]],
    ['an overshoot over 45°', [[p('turn.overshootMaxDeg'), 46]], [p('turn.overshootMaxDeg')]],
    ['a negative overshoot', [[p('turn.overshootMaxDeg'), -1]], [p('turn.overshootMaxDeg')]],
    ['a pitch over 45°', [[p('lean.maxAccelDeg'), 46]], [p('lean.maxAccelDeg')]],
    ['a lean over 45°', [[p('lean.maxTurnDeg'), 46]], [p('lean.maxTurnDeg')]],
    ['a full acceleration of 0', [[p('lean.fullAccelMps2'), 0]], [p('lean.fullAccelMps2')]],
    ['a full acceleration over 100', [[p('lean.fullAccelMps2'), 101]], [p('lean.fullAccelMps2')]],
    ['a full turn rate of 0', [[p('lean.fullTurnDegPerSec'), 0]], [p('lean.fullTurnDegPerSec')]],
    [
      'a full turn rate over 3600',
      [[p('lean.fullTurnDegPerSec'), 3601]],
      [p('lean.fullTurnDegPerSec')],
    ],
    ['a lean reach under 50 ms', [[p('lean.reachMs'), 49]], [p('lean.reachMs')]],
    [
      // Its bound, and the refine: the alarmed breath is the faster one.
      'a breath faster than the flash cap',
      [
        [p('breath.periodMs'), 333],
        [p('breath.alertPeriodMs'), 334],
      ],
      [p('breath.periodMs'), p('breath.alertPeriodMs')],
    ],
    [
      'an alarmed breath faster than the flash cap',
      [[p('breath.alertPeriodMs'), 333]],
      [p('breath.alertPeriodMs')],
    ],
    ['a breath over 20 s', [[p('breath.periodMs'), 20001]], [p('breath.periodMs')]],
    [
      'an alarmed breath slower than the calm one',
      [
        [p('breath.periodMs'), 2000],
        [p('breath.alertPeriodMs'), 2001],
      ],
      [p('breath.alertPeriodMs')],
    ],
    [
      "Papa's breath over 10°",
      [[p('breath.papaAmplitudeDeg'), 10.1]],
      [p('breath.papaAmplitudeDeg')],
    ],
    [
      "the baby's breath over 10°",
      [[p('breath.babyAmplitudeDeg'), 10.1]],
      [p('breath.babyAmplitudeDeg')],
    ],
    ['a gaze over 90°', [[p('gaze.maxYawDeg'), 91]], [p('gaze.maxYawDeg')]],
    ['a behind angle over 180°', [[p('gaze.behindDeg'), 181]], [p('gaze.behindDeg')]],
    ['a behind angle under the head clamp', [[p('gaze.behindDeg'), 59]], [p('gaze.behindDeg')]],
    ['a gaze reach over 1000 ms', [[p('gaze.reachMs'), 1001]], [p('gaze.reachMs')]],
    ['a stoop over 45°', [[p('stoop.maxDeg'), 46]], [p('stoop.maxDeg')]],
    // Story 7.9: the forelock's pendulum. Past 40° a hanging lock could stand up (D8).
    ['a forelock reach under 50 ms', [[p('forelock.reachMs'), 49]], [p('forelock.reachMs')]],
    ['a forelock reach over 1000 ms', [[p('forelock.reachMs'), 1001]], [p('forelock.reachMs')]],
    [
      'a forelock damping under 0.3',
      [[p('forelock.dampingRatio'), 0.29]],
      [p('forelock.dampingRatio')],
    ],
    [
      'a forelock damping over 1',
      [[p('forelock.dampingRatio'), 1.01]],
      [p('forelock.dampingRatio')],
    ],
    ['a forelock turn over 40°', [[p('forelock.maxDeg'), 41]], [p('forelock.maxDeg')]],
    ['a negative forelock turn', [[p('forelock.maxDeg'), -1]], [p('forelock.maxDeg')]],
    ['a missing forelock group', [[p('forelock'), undefined]], [p('forelock')]],
    ['an unknown forelock key', [[p('forelock.lengthM'), 0.1]], [p('forelock.lengthM')]],
    // Story 7.10: the faces. Strict at every level; the poses keep the brows on the forehead.
    ['a brow reach under 50 ms', [[p('expressions.reachMs'), 49]], [p('expressions.reachMs')]],
    ['a brow reach over 1000 ms', [[p('expressions.reachMs'), 1001]], [p('expressions.reachMs')]],
    [
      "Papa's brows under 50 %",
      [[p('expressions.papa.browScalePct'), 49]],
      [p('expressions.papa.browScalePct')],
    ],
    [
      "the baby's brows over 250 %",
      [[p('expressions.baby.browScalePct'), 251]],
      [p('expressions.baby.browScalePct')],
    ],
    [
      'a negative surprise',
      [[p('expressions.papa.surprisedMs'), -1]],
      [p('expressions.papa.surprisedMs')],
    ],
    [
      'a surprise over 5 s',
      [[p('expressions.papa.surprisedMs'), 5001]],
      [p('expressions.papa.surprisedMs')],
    ],
    [
      'a frown after over 3 s',
      [[p('expressions.papa.firmAfterMs'), 3001]],
      [p('expressions.papa.firmAfterMs')],
    ],
    ['a pride over 5 s', [[p('expressions.papa.proudMs'), 5001]], [p('expressions.papa.proudMs')]],
    [
      'a delight over 5 s',
      [[p('expressions.baby.delightedMs'), 5001]],
      [p('expressions.baby.delightedMs')],
    ],
    ['a negative sulk', [[p('expressions.baby.sulkyMs'), -1]], [p('expressions.baby.sulkyMs')]],
    [
      'a raise over 5 cm',
      [[p('expressions.papa.poses.surprised.raiseOffsetM'), 0.051]],
      [p('expressions.papa.poses.surprised.raiseOffsetM')],
    ],
    [
      'a drop under 2 cm',
      [[p('expressions.baby.poses.sulky.raiseOffsetM'), -0.021]],
      [p('expressions.baby.poses.sulky.raiseOffsetM')],
    ],
    [
      'a tilt over 45°',
      [[p('expressions.papa.poses.tired.tiltDeg'), 46]],
      [p('expressions.papa.poses.tired.tiltDeg')],
    ],
    [
      'a tilt under −45°',
      [[p('expressions.baby.poses.focused.tiltDeg'), -46]],
      [p('expressions.baby.poses.focused.tiltDeg')],
    ],
    [
      'brows apart (a negative inward)',
      [[p('expressions.papa.poses.firm.inwardOffsetM'), -0.001]],
      [p('expressions.papa.poses.firm.inwardOffsetM')],
    ],
    [
      'an inward over 2 cm',
      [[p('expressions.baby.poses.sulky.inwardOffsetM'), 0.021]],
      [p('expressions.baby.poses.sulky.inwardOffsetM')],
    ],
    [
      'a skew over 2 cm',
      [[p('expressions.papa.poses.proud.skewOffsetM'), 0.021]],
      [p('expressions.papa.poses.proud.skewOffsetM')],
    ],
    [
      'a missing pose',
      [[p('expressions.papa.poses.proud'), undefined]],
      [p('expressions.papa.poses.proud')],
    ],
    [
      "a pose of the other character's",
      [
        [
          p('expressions.papa.poses.sleepy'),
          { raiseOffsetM: 0, tiltDeg: 0, inwardOffsetM: 0, skewOffsetM: 0 },
        ],
      ],
      [p('expressions.papa.poses.sleepy')],
    ],
    [
      'an unknown pose key',
      [[p('expressions.baby.poses.sulky.raiseM'), 0.01]],
      [p('expressions.baby.poses.sulky.raiseM')],
    ],
    [
      'an unknown face key',
      [[p('expressions.baby.neutralMs'), 100]],
      [p('expressions.baby.neutralMs')],
    ],
    ['a missing expressions group', [[p('expressions'), undefined]], [p('expressions')]],
    ['an outline under 50 %', [[p('look.outlineWidthPct'), 49]], [p('look.outlineWidthPct')]],
    ['an outline over 300 %', [[p('look.outlineWidthPct'), 301]], [p('look.outlineWidthPct')]],
    ['a rim over 100 %', [[p('look.rimStrengthPct'), 101]], [p('look.rimStrengthPct')]],
    [
      'a rim width of 0 (an undefined smoothstep)',
      [[p('look.rimWidthPct'), 0]],
      [p('look.rimWidthPct')],
    ],
    ['a rim width over 100 %', [[p('look.rimWidthPct'), 101]], [p('look.rimWidthPct')]],
    ['a 4th tone over 100 %', [[p('look.fourthTonePct'), 101]], [p('look.fourthTonePct')]],
    [
      'a 4th tone switch that is a number',
      [[p('look.isFourthToneOn'), 1]],
      [p('look.isFourthToneOn')],
    ],
    ['a missing characters block', [['characters', undefined]], ['characters']],
    ['a missing fades group', [[p('fades'), undefined]], [p('fades')]],
    ['an unknown key', [[p('turn.rateDegPerSec'), 720]], [p('turn.rateDegPerSec')]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });

  it('starts from the D1 values (the review retuned lean.fullAccelMps2 and added gaze.behindDeg; 7.9 the forelock; 7.10 the faces, by shape only)', () => {
    expect(real.characters).toEqual({
      fades: { startMs: 100, stopMs: 200, returnMs: 150, otherMs: 100 },
      turn: { reachMs: 250, dampingRatio: 0.6, overshootMaxDeg: 10 },
      lean: {
        maxAccelDeg: 10,
        maxTurnDeg: 8,
        fullAccelMps2: 45,
        fullTurnDegPerSec: 360,
        reachMs: 120,
      },
      breath: { periodMs: 3000, alertPeriodMs: 1500, papaAmplitudeDeg: 1.5, babyAmplitudeDeg: 2 },
      gaze: { maxYawDeg: 60, behindDeg: 150, reachMs: 200 },
      stoop: { maxDeg: 15 },
      forelock: { reachMs: 100, dampingRatio: 0.6, maxDeg: 30 },
      // Story 7.10: the faces' starting values are Geo's to tune in the feel panel (golden rule), so only their
      // shape is pinned here: the groups and every key, never a number (the bounds tests above hold the ranges).
      expressions: {
        reachMs: expect.any(Number),
        papa: {
          browScalePct: expect.any(Number),
          surprisedMs: expect.any(Number),
          firmAfterMs: expect.any(Number),
          proudMs: expect.any(Number),
          poses: {
            surprised: BROW_POSE_SHAPE,
            firm: BROW_POSE_SHAPE,
            tired: BROW_POSE_SHAPE,
            proud: BROW_POSE_SHAPE,
          },
        },
        baby: {
          browScalePct: expect.any(Number),
          delightedMs: expect.any(Number),
          sulkyMs: expect.any(Number),
          poses: {
            delighted: BROW_POSE_SHAPE,
            sulky: BROW_POSE_SHAPE,
            focused: BROW_POSE_SHAPE,
            sleepy: BROW_POSE_SHAPE,
          },
        },
      },
      look: {
        outlineWidthPct: 150,
        rimStrengthPct: 35,
        rimWidthPct: 30,
        isFourthToneOn: false,
        fourthTonePct: 24,
      },
    });
  });
});

describe('feel.music (story 2.6)', () => {
  const p = (path: string) => `music.${path}`;

  it('accepts the bounds themselves', () => {
    expect(
      mutated(
        [p('tense.fadeInMs'), 0],
        [p('tense.fadeOutMs'), 0],
        [p('tense.calmGainPct'), 0],
        [p('slowMo.belowScale'), 0.1],
        [p('slowMo.lowpassHz'), 200],
        [p('slowMo.playbackRatePct'), 25],
        [p('slowMo.inMs'), 0],
        [p('slowMo.outMs'), 0],
      ),
    ).toMatchObject({ ok: true });
    expect(
      mutated(
        [p('tense.fadeInMs'), 5000],
        [p('tense.fadeOutMs'), 5000],
        [p('tense.calmGainPct'), 100],
        [p('slowMo.belowScale'), 1],
        [p('slowMo.lowpassHz'), 20000],
        [p('slowMo.playbackRatePct'), 100],
        [p('slowMo.inMs'), 2000],
        [p('slowMo.outMs'), 2000],
      ),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a fade-in over 5000 ms', [[p('tense.fadeInMs'), 5001]], [p('tense.fadeInMs')]],
    ['a negative fade-in', [[p('tense.fadeInMs'), -1]], [p('tense.fadeInMs')]],
    ['a fractional fade-in', [[p('tense.fadeInMs'), 1.5]], [p('tense.fadeInMs')]],
    ['a fade-out over 5000 ms', [[p('tense.fadeOutMs'), 5001]], [p('tense.fadeOutMs')]],
    ['a negative fade-out', [[p('tense.fadeOutMs'), -1]], [p('tense.fadeOutMs')]],
    ['a calm gain above 100 %', [[p('tense.calmGainPct'), 101]], [p('tense.calmGainPct')]],
    ['a negative calm gain', [[p('tense.calmGainPct'), -1]], [p('tense.calmGainPct')]],
    ['a bound scale under 0.1', [[p('slowMo.belowScale'), 0.09]], [p('slowMo.belowScale')]],
    ['a bound scale above 1', [[p('slowMo.belowScale'), 1.01]], [p('slowMo.belowScale')]],
    ['a low-pass under 200 Hz', [[p('slowMo.lowpassHz'), 199]], [p('slowMo.lowpassHz')]],
    ['a low-pass above 20000 Hz', [[p('slowMo.lowpassHz'), 20001]], [p('slowMo.lowpassHz')]],
    ['a rate under 25 %', [[p('slowMo.playbackRatePct'), 24]], [p('slowMo.playbackRatePct')]],
    ['a rate above 100 %', [[p('slowMo.playbackRatePct'), 101]], [p('slowMo.playbackRatePct')]],
    ['a sweep-in over 2000 ms', [[p('slowMo.inMs'), 2001]], [p('slowMo.inMs')]],
    ['a negative sweep-in', [[p('slowMo.inMs'), -1]], [p('slowMo.inMs')]],
    ['a sweep-out over 2000 ms', [[p('slowMo.outMs'), 2001]], [p('slowMo.outMs')]],
    ['a missing music block', [['music', undefined]], ['music']],
    ['an unknown key', [[p('bogus'), 1]], [p('bogus')]],
    ['an unknown key in the tense stem', [[p('tense.bogusMs'), 1]], [p('tense.bogusMs')]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });
});

describe('feel.calibration (story 2.7)', () => {
  const p = (path: string) => `calibration.${path}`;

  it('accepts the bounds themselves', () => {
    expect(
      mutated(
        [p('beatCount'), 3],
        [p('bpm'), 40],
        [p('outlierMs'), 0],
        [p('offsetMinMs'), -1000],
        [p('offsetMaxMs'), 1],
        [p('minValidTaps'), 1],
        [p('leadInMs'), 0],
        [p('tailMs'), 0],
        [p('audioWaitMs'), 0],
        [p('doneHoldMs'), 0],
        [p('pulseMs'), 1],
      ),
    ).toMatchObject({ ok: true });
    expect(
      mutated(
        [p('beatCount'), 16],
        [p('bpm'), 180],
        [p('outlierMs'), 1000],
        [p('offsetMinMs'), 0],
        [p('offsetMaxMs'), 166], // under half an interval at 180 BPM (166.67 ms)
        [p('minValidTaps'), 16],
        [p('leadInMs'), 5000],
        [p('tailMs'), 5000],
        [p('audioWaitMs'), 10000],
        [p('doneHoldMs'), 5000],
        [p('pulseMs'), 1000],
      ),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['too few beats', [[p('beatCount'), 2]], [p('beatCount'), p('minValidTaps')]],
    ['too many beats', [[p('beatCount'), 17]], [p('beatCount')]],
    ['a fractional beat count', [[p('beatCount'), 8.5]], [p('beatCount')]],
    // At 181 BPM half an interval (165.7 ms) is also under the real maximum offset (250 ms).
    ['a tempo over 180 BPM (3 Hz flashing)', [[p('bpm'), 181]], [p('bpm'), p('offsetMaxMs')]],
    ['a tempo under 40 BPM', [[p('bpm'), 39]], [p('bpm')]],
    ['a negative outlier bound', [[p('outlierMs'), -1]], [p('outlierMs')]],
    ['a positive minimum offset', [[p('offsetMinMs'), 1]], [p('offsetMinMs')]],
    ['a minimum offset under -1000', [[p('offsetMinMs'), -1001]], [p('offsetMinMs')]],
    ['a negative maximum offset', [[p('offsetMaxMs'), -1]], [p('offsetMaxMs')]],
    // Over 1000 it also fails the half-interval refine: listed twice.
    [
      'a maximum offset over 1000',
      [[p('offsetMaxMs'), 1001]],
      [p('offsetMaxMs'), p('offsetMaxMs')],
    ],
    ['no valid tap needed', [[p('minValidTaps'), 0]], [p('minValidTaps')]],
    ['more valid taps than beats', [[p('minValidTaps'), 9]], [p('minValidTaps')]],
    ['a negative lead-in', [[p('leadInMs'), -1]], [p('leadInMs')]],
    ['a negative tail', [[p('tailMs'), -1]], [p('tailMs')]],
    ['a negative audio wait', [[p('audioWaitMs'), -1]], [p('audioWaitMs')]],
    ['a negative done hold', [[p('doneHoldMs'), -1]], [p('doneHoldMs')]],
    ['a pulse of 0 ms', [[p('pulseMs'), 0]], [p('pulseMs')]],
    ['a missing calibration block', [['calibration', undefined]], ['calibration']],
    ['an unknown key', [[p('bogus'), 1]], [p('bogus')]],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });

  it('refuses more valid taps than beats, even with both in bounds', () => {
    expect(failedPaths(mutated([p('beatCount'), 4], [p('minValidTaps'), 5]))).toEqual([
      p('minValidTaps'),
    ]);
  });

  it('refuses a maximum offset from half a beat interval, whatever the tempo', () => {
    // 100 BPM: an interval is 600 ms, half is 300.
    expect(failedPaths(mutated([p('bpm'), 100], [p('offsetMaxMs'), 300]))).toEqual([
      p('offsetMaxMs'),
    ]);
    expect(mutated([p('bpm'), 100], [p('offsetMaxMs'), 299])).toMatchObject({ ok: true });
    // 180 BPM: half an interval is 166.67 ms.
    expect(failedPaths(mutated([p('bpm'), 180], [p('offsetMaxMs'), 167]))).toEqual([
      p('offsetMaxMs'),
    ]);
  });

  it('refuses a minimum offset that is not below the maximum', () => {
    expect(failedPaths(mutated([p('offsetMinMs'), 0], [p('offsetMaxMs'), 0]))).toEqual([
      p('offsetMinMs'),
    ]);
  });
});

describe('feel.noise (story 3.1)', () => {
  const SOURCES = 'noise.sources';
  const impact = `${SOURCES}.propImpact`;

  it('has one row per source the sim and the sim report know, in file order', () => {
    const sources = (real.noise as { sources: Record<string, unknown> }).sources;
    expect(Object.keys(sources)).toEqual([...NOISE_SOURCE_IDS]);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['minPct above maxPct', [[`${impact}.minPct`, 20]], [`noise.sources.propImpact.minPct`]],
    [
      'minImpulseNs equal to maxImpulseNs',
      [[`${impact}.minImpulseNs`, 2]],
      [`noise.sources.propImpact.minImpulseNs`],
    ],
    [
      'minImpulseNs above maxImpulseNs',
      [[`${impact}.minImpulseNs`, 3]],
      [`noise.sources.propImpact.minImpulseNs`],
    ],
    ['an alertPct above 100', [['noise.alertPct', 101]], ['noise.alertPct']],
    ['a negative decayPerSec', [['noise.decayPerSec', -1]], ['noise.decayPerSec']],
    ['a pct above 100', [[`${SOURCES}.sniff.noisePct`, 101]], [`${SOURCES}.sniff.noisePct`]],
    [
      'a negative pct',
      [[`${SOURCES}.floorCreak.noisePct`, -1]],
      [`${SOURCES}.floorCreak.noisePct`],
    ],
    ['a maxPct above 100', [[`${impact}.maxPct`, 101]], [`${impact}.maxPct`]],
    [
      'a negative samePropCooldownMs',
      [[`${impact}.samePropCooldownMs`, -1]],
      [`${impact}.samePropCooldownMs`],
    ],
    ['a missing noise block', [['noise', undefined]], ['noise']],
    ['a missing source', [[`${SOURCES}.sniff`, undefined]], [`${SOURCES}.sniff`]],
    ['an unknown source', [[`${SOURCES}.bogus`, { noisePct: 1 }]], [`${SOURCES}.bogus`]],
    [
      'an unknown key in a source',
      [[`${SOURCES}.sniff.bogusPct`, 1]],
      [`${SOURCES}.sniff.bogusPct`],
    ],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });

  it('accepts a samePropCooldownMs of 0 (no window) and minPct = maxPct', () => {
    expect(mutated([`${impact}.samePropCooldownMs`, 0])).toMatchObject({ ok: true });
    expect(mutated([`${impact}.minPct`, 15])).toMatchObject({ ok: true });
  });
});

describe('feel.bladder (story 4.3)', () => {
  it('refuses a slowdownPct of 100 or more: Papa must always arrive', () => {
    expect(failedPaths(mutated(['bladder.slowdownPct', 100]))).toEqual(['bladder.slowdownPct']);
    expect(failedPaths(mutated(['bladder.slowdownPct', 120]))).toEqual(['bladder.slowdownPct']);
    expect(mutated(['bladder.slowdownPct', 99])).toMatchObject({ ok: true });
    expect(mutated(['bladder.slowdownPct', 0])).toMatchObject({ ok: true });
  });

  it('refuses a missing group and an unknown key', () => {
    expect(failedPaths(mutated(['bladder', undefined]))).toEqual(['bladder']);
    expect(failedPaths(mutated(['bladder.bogusPct', 1]))).toEqual(['bladder.bogusPct']);
  });
});

describe('feel.catastrophe (story 3.16)', () => {
  const TIERS = ['assistance', 'normal', 'experienced'] as const;

  it.each<[string, [string, unknown][], string[]]>([
    ['a missing catastrophe block', [['catastrophe', undefined]], ['catastrophe']],
    ['a missing rise row', [['catastrophe.risePct.mess', undefined]], ['catastrophe.risePct.mess']],
    ['an unknown rise row', [['catastrophe.risePct.bogus', 1]], ['catastrophe.risePct.bogus']],
    ['a rise above 100', [['catastrophe.risePct.nearMiss', 101]], ['catastrophe.risePct.nearMiss']],
    ['a negative rise', [['catastrophe.risePct.mess', -1]], ['catastrophe.risePct.mess']],
    ['a negative decayPerSec', [['catastrophe.decayPerSec', -0.5]], ['catastrophe.decayPerSec']],
    [
      'a perfectDropPct above 100',
      [['catastrophe.perfectDropPct', 101]],
      ['catastrophe.perfectDropPct'],
    ],
    ['an alertPct above 100', [['catastrophe.alertPct', 101]], ['catastrophe.alertPct']],
    [
      'faceStepsPct that are not ascending',
      [['catastrophe.faceStepsPct', [50, 25]]],
      ['catastrophe.faceStepsPct'],
    ],
    [
      'faceStepsPct that are equal',
      [['catastrophe.faceStepsPct', [30, 30]]],
      ['catastrophe.faceStepsPct'],
    ],
    [
      'a last face step at alertPct',
      [['catastrophe.faceStepsPct', [25, 70]]],
      ['catastrophe.faceStepsPct'],
    ],
    [
      'a last face step above alertPct',
      [['catastrophe.faceStepsPct', [25, 80]]],
      ['catastrophe.faceStepsPct'],
    ],
    [
      'three face steps',
      [['catastrophe.faceStepsPct', [10, 25, 50]]],
      ['catastrophe.faceStepsPct'],
    ],
    ['an unknown key', [['catastrophe.bogusPct', 1]], ['catastrophe.bogusPct']],
  ])('refuses %s, at its path', (_name, changes, paths) => {
    expect(failedPaths(mutated(...changes))).toEqual(paths);
  });

  it('accepts the bounds themselves', () => {
    expect(mutated(['catastrophe.faceStepsPct', [0, 69]])).toMatchObject({ ok: true });
    expect(mutated(['catastrophe.decayPerSec', 0])).toMatchObject({ ok: true });
    expect(mutated(['catastrophe.risePct.nearMiss', 100])).toMatchObject({ ok: true });
  });

  it.each(TIERS)('requires a catastropheMultiplier on the %s tier', (tier) => {
    const path = `difficulty.${tier}.catastropheMultiplier`;
    expect(failedPaths(mutated([path, undefined]))).toEqual([path]);
    expect(failedPaths(mutated([path, -1]))).toEqual([path]);
  });
});
