import { describe, expect, it } from 'vitest';
import { COMMAND_TYPES, commandProblem } from './commands.ts';

describe('commandProblem', () => {
  it('accepts well formed commands of every type', () => {
    expect(commandProblem({ type: 'SetTimeScale', t: 0, scale: 0.5 })).toBeNull();
    expect(commandProblem({ type: 'TapFloor', t: 10, xM: 1.5, zM: -2 })).toBeNull();
    expect(commandProblem({ type: 'TapObject', t: 10, objectId: 'coffee_machine' })).toBeNull();
    expect(commandProblem({ type: 'Move', t: 10, dirX: 0, dirZ: -3 })).toBeNull();
    expect(commandProblem({ type: 'MoveStop', t: 10 })).toBeNull();
    expect(commandProblem({ type: 'PressThreat', t: 10, threatId: 1 })).toBeNull();
    expect(commandProblem({ type: 'Release', t: 10 })).toBeNull();
    expect(commandProblem({ type: 'StartDisruption', t: 10, index: 0 })).toBeNull();
    for (const tier of ['assistance', 'normal', 'experienced']) {
      expect(commandProblem({ type: 'SetDifficultyTier', t: 0, tier })).toBeNull();
    }
    expect(commandProblem({ type: 'ForceInstinct', t: 10 })).toBeNull();
    expect(commandProblem({ type: 'ForceInstinct', t: Number.NaN })).toMatch(/finite/);
    expect(
      commandProblem({ type: 'SetFeel', t: 10, patch: { timing: { windowMs: 320 } } }),
    ).toBeNull();
    expect(
      commandProblem({
        type: 'PushProp',
        t: 10,
        propId: 'mug_01',
        impulseXNs: 0.4,
        impulseYNs: 0,
        impulseZNs: -0.1,
      }),
    ).toBeNull();
  });

  it('knows every command type it accepts', () => {
    expect([...COMMAND_TYPES].sort()).toEqual([
      'ForceInstinct',
      'ForceThreat',
      'Move',
      'MoveStop',
      'PressThreat',
      'PushProp',
      'Release',
      'SetBladder',
      'SetDifficultyTier',
      'SetFatigue',
      'SetFeel',
      'SetInputLag',
      'SetNoise',
      'SetTimeScale',
      'StartDisruption',
      'TapBaby',
      'TapFloor',
      'TapObject',
    ]);
  });

  it.each([
    ['NaN xM', { type: 'TapFloor', t: 0, xM: Number.NaN, zM: 0 }, /xM/],
    ['Infinity zM', { type: 'TapFloor', t: 0, xM: 0, zM: Number.POSITIVE_INFINITY }, /zM/],
    ['a string xM', { type: 'TapFloor', t: 0, xM: '1', zM: 0 }, /xM/],
    ['a missing zM', { type: 'TapFloor', t: 0, xM: 1 }, /zM/],
    ['a TapObject with no object', { type: 'TapObject', t: 0 }, /objectId/],
    ['a TapObject with an empty object id', { type: 'TapObject', t: 0, objectId: '' }, /objectId/],
    ['a TapObject with a numeric object id', { type: 'TapObject', t: 0, objectId: 3 }, /objectId/],
    ['a NaN dirX', { type: 'Move', t: 0, dirX: Number.NaN, dirZ: 1 }, /dirX/],
    ['an Infinity dirZ', { type: 'Move', t: 0, dirX: 1, dirZ: Number.NEGATIVE_INFINITY }, /dirZ/],
    ['a zero vector', { type: 'Move', t: 0, dirX: 0, dirZ: 0 }, /\(0, 0\)/],
    ['a negative zero vector', { type: 'Move', t: 0, dirX: -0, dirZ: 0 }, /\(0, 0\)/],
    ['a PressThreat with no threat', { type: 'PressThreat', t: 0 }, /threatId/],
    ['a PressThreat on threat 0', { type: 'PressThreat', t: 0, threatId: 0 }, /threatId/],
    ['a fractional threatId', { type: 'PressThreat', t: 0, threatId: 1.5 }, /threatId/],
    ['a string threatId', { type: 'PressThreat', t: 0, threatId: '1' }, /threatId/],
    ['a StartDisruption with no index', { type: 'StartDisruption', t: 0 }, /index/],
    ['a negative StartDisruption index', { type: 'StartDisruption', t: 0, index: -1 }, /index/],
    ['a fractional StartDisruption index', { type: 'StartDisruption', t: 0, index: 0.5 }, /index/],
    ['a string StartDisruption index', { type: 'StartDisruption', t: 0, index: '0' }, /index/],
    ['a SetDifficultyTier with no tier', { type: 'SetDifficultyTier', t: 0 }, /tier/],
    [
      'a SetDifficultyTier of an unknown tier',
      { type: 'SetDifficultyTier', t: 0, tier: 'hard' },
      /tier/,
    ],
    ['a SetDifficultyTier of a number', { type: 'SetDifficultyTier', t: 0, tier: 1 }, /tier/],
    ['a Release with a NaN t', { type: 'Release', t: Number.NaN }, /finite/],
    ['a non-finite t', { type: 'MoveStop', t: Number.NaN }, /finite/],
    [
      'a PushProp with no prop',
      { type: 'PushProp', t: 0, impulseXNs: 1, impulseYNs: 0, impulseZNs: 0 },
      /propId/,
    ],
    [
      'a PushProp with an empty prop id',
      { type: 'PushProp', t: 0, propId: '', impulseXNs: 1, impulseYNs: 0, impulseZNs: 0 },
      /propId/,
    ],
    [
      'a PushProp with a numeric prop id',
      { type: 'PushProp', t: 0, propId: 1, impulseXNs: 1, impulseYNs: 0, impulseZNs: 0 },
      /propId/,
    ],
    [
      'a PushProp with a NaN impulse',
      { type: 'PushProp', t: 0, propId: 'a', impulseXNs: Number.NaN, impulseYNs: 0, impulseZNs: 1 },
      /impulseXNs/,
    ],
    [
      'a PushProp with an infinite impulse',
      {
        type: 'PushProp',
        t: 0,
        propId: 'a',
        impulseXNs: 0,
        impulseYNs: Number.POSITIVE_INFINITY,
        impulseZNs: 1,
      },
      /impulseYNs/,
    ],
    [
      'a PushProp with a string impulse',
      { type: 'PushProp', t: 0, propId: 'a', impulseXNs: 0, impulseYNs: 0, impulseZNs: '1' },
      /impulseZNs/,
    ],
    [
      'a PushProp with a missing impulse',
      { type: 'PushProp', t: 0, propId: 'a', impulseXNs: 1, impulseYNs: 0 },
      /impulseZNs/,
    ],
    [
      'a PushProp with a zero impulse',
      { type: 'PushProp', t: 0, propId: 'a', impulseXNs: 0, impulseYNs: -0, impulseZNs: 0 },
      /\(0, 0, 0\)/,
    ],
    ['an unknown type', { type: 'Teleport', t: 0 }, /unknown command type/],
    ['a non-object', 42, /object/],
  ])('refuses %s', (_name, command, message) => {
    expect(commandProblem(command)).toMatch(message);
  });
});

describe('SetFatigue (story 1.19)', () => {
  it('accepts a finite number of points, whatever its value (the sim holds it in [0, 100])', () => {
    for (const points of [0, 80, -5, 250]) {
      expect(commandProblem({ type: 'SetFatigue', t: 0, points })).toBeNull();
    }
  });

  it.each([
    ['no points', { type: 'SetFatigue', t: 0 }],
    ['NaN points', { type: 'SetFatigue', t: 0, points: Number.NaN }],
    ['Infinity points', { type: 'SetFatigue', t: 0, points: Number.POSITIVE_INFINITY }],
    ['a string', { type: 'SetFatigue', t: 0, points: '80' }],
  ])('refuses %s', (_name, command) => {
    expect(commandProblem(command)).toMatch(/SetFatigue: points must be a finite number/);
  });
});

describe('SetBladder (story 4.3)', () => {
  it('accepts a finite number of percent, whatever its value (the sim holds it in [0, 100])', () => {
    for (const pct of [0, 80, -5, 250]) {
      expect(commandProblem({ type: 'SetBladder', t: 0, pct })).toBeNull();
    }
  });

  it.each([
    ['no pct', { type: 'SetBladder', t: 0 }],
    ['NaN pct', { type: 'SetBladder', t: 0, pct: Number.NaN }],
    ['Infinity pct', { type: 'SetBladder', t: 0, pct: Number.POSITIVE_INFINITY }],
    ['a string', { type: 'SetBladder', t: 0, pct: '80' }],
  ])('refuses %s', (_name, command) => {
    expect(commandProblem(command)).toMatch(/SetBladder: pct must be a finite number/);
  });
});

describe('commandProblem › SetFeel', () => {
  class Foo {
    readonly a = 1;
  }
  const send = (patch: unknown) => commandProblem({ type: 'SetFeel', t: 0, patch });

  it('accepts nested objects of numbers, strings, booleans and arrays', () => {
    expect(send({})).toBeNull();
    expect(send({ input: { earlyPress: 'guard', touchRadiusPx: 60 } })).toBeNull();
    expect(send({ mama: { starThresholdPoints: [10, 20, 30] } })).toBeNull();
    expect(send({ a: { b: { c: true } } })).toBeNull();
  });

  it('refuses a patch that is not a plain object', () => {
    for (const patch of [undefined, null, 5, 'timing', [], [{ a: 1 }], new Foo(), new Map()]) {
      expect(send(patch)).toMatch(/^SetFeel: /);
    }
  });

  it('refuses a non-finite number at any depth', () => {
    expect(send({ timing: { windowMs: Number.NaN } })).toMatch(/must be finite/);
    expect(send({ timing: { windowMs: Number.POSITIVE_INFINITY } })).toMatch(/must be finite/);
    expect(send({ mama: { starThresholdPoints: [1, Number.NaN] } })).toMatch(
      /starThresholdPoints\[1\]/,
    );
  });

  it('refuses the keys that reach the prototype, at any depth', () => {
    expect(send(JSON.parse('{"__proto__":{"x":1}}'))).toMatch(/forbidden key __proto__/);
    expect(send({ timing: { constructor: { x: 1 } } })).toMatch(/forbidden key constructor/);
    expect(send({ prototype: 1 })).toMatch(/forbidden key prototype/);
  });

  it('refuses values that are not data: null, undefined, functions, class instances, a cycle', () => {
    expect(send({ timing: { windowMs: null } })).toMatch(/plain object/);
    expect(send({ timing: { windowMs: undefined } })).toMatch(/plain object/);
    expect(send({ timing: { windowMs: () => 1 } })).toMatch(/plain object/);
    expect(send({ timing: new Foo() })).toMatch(/plain object/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(send(cycle)).toMatch(/nested too deep/);
  });
});
