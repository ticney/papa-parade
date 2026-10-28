import { type Feel, FeelSchema } from '@content/schemas/feel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContent } from '../../tests/support/testContent.ts';
import {
  type ControlDescriptor,
  describeFeelControls,
  type FolderDescriptor,
  getAtPath,
  isNextLevelKey,
  isOverriddenKey,
  type JsonSchema,
  leafControls,
  leafPatch,
  mergePatch,
  type NumberDescriptor,
  overrideLeafKeys,
  type PathStep,
  pathKeyOf,
} from './feelControls.ts';
import { applyFeelPatch } from './feelPatch.ts';

const feel = createTestContent().feel;
const schema = z.toJSONSchema(FeelSchema) as JsonSchema;
const root = describeFeelControls(schema, feel);
const leaves = leafControls(root);

/** Every leaf of a JSON value as a path; an array is walked item by item (the panel binds each). */
function valuePaths(value: unknown, path: PathStep[] = []): PathStep[][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => valuePaths(item, [...path, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      key === '$schema' ? [] : valuePaths(child, [...path, key]),
    );
  }
  return [path];
}

const find = (pathKey: string): ControlDescriptor => {
  const found = leaves.find((leaf) => leaf.pathKey === pathKey);
  if (found === undefined) throw new Error(`no control for ${pathKey}`);
  return found;
};
const number = (pathKey: string): NumberDescriptor => find(pathKey) as NumberDescriptor;

describe('describeFeelControls', () => {
  it('has a control for every leaf of the feel, and none for anything else', () => {
    const expected = valuePaths(feel).map(pathKeyOf).sort();
    expect(leaves.map((leaf) => leaf.pathKey).sort()).toEqual(expected);
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('makes one folder per top-level section of the feel, in the schema’s order', () => {
    const titles = root.children.map((child) => child.label);
    expect(titles).toEqual(Object.keys(feel).filter((key) => key !== '$schema'));
    expect(root.children.every((child) => child.kind === 'folder')).toBe(true);
  });

  it('nests folders for nested objects, down to each physics kind', () => {
    const timing = root.children.find((child) => child.label === 'timing') as FolderDescriptor;
    expect(timing.children.map((child) => child.label)).toContain('slowMoPerfect');
    const physics = root.children.find((child) => child.label === 'physics') as FolderDescriptor;
    const kinds = physics.children.find((child) => child.label === 'kinds') as FolderDescriptor;
    expect(kinds.children.map((child) => child.label)).toEqual(Object.keys(feel.physics.kinds));
    const firstKind = kinds.children[0] as FolderDescriptor;
    expect(firstKind.kind).toBe('folder');
    expect(firstKind.children.map((child) => child.label)).toContain('massKg');
  });

  it('reads the bounds from the schema: both bounds make a slider, one bound does not', () => {
    const timeScale = number('timing.slowMoPerfect.timeScale');
    expect(timeScale).toMatchObject({ min: 0.05, max: 1, hasSlider: true, isMinExclusive: false });
    const windowMs = number('timing.windowMs');
    expect(windowMs).toMatchObject({ min: 0, isMinExclusive: true, hasSlider: false });
    expect(windowMs.max).toBeUndefined();
    const tolerance = number('timing.toleranceMs');
    expect(tolerance).toMatchObject({ min: 0, isMinExclusive: false, hasSlider: false });
  });

  it('keeps an exclusive upper bound, flagged', () => {
    const deadzone = number('input.stickDeadzonePct');
    expect(deadzone).toMatchObject({ min: 0, max: 100, isMaxExclusive: true, hasSlider: true });
  });

  it('gives an integer a step of 1, and takes MAX_SAFE_INTEGER for « no maximum »', () => {
    const silenceAlertMs = number('baby.silenceAlertMs');
    expect(silenceAlertMs).toMatchObject({ isInteger: true, step: 1, hasSlider: false });
    expect(silenceAlertMs.max).toBeUndefined();
    expect(number('timing.windowMs').step).toBeUndefined();
    expect(number('timing.windowMs').isInteger).toBe(false);
  });

  it('turns an enum into a list of its options', () => {
    expect(find('input.earlyPress')).toMatchObject({ kind: 'list', options: ['fail', 'guard'] });
    const shape = leaves.find((leaf) => leaf.pathKey.endsWith('.shape'));
    expect(shape).toMatchObject({ kind: 'list', options: ['box', 'cylinder', 'ball'] });
  });

  it('turns a boolean into a boolean control', () => {
    expect(find('difficulty.normal.hasInstinct').kind).toBe('boolean');
  });

  it('binds one control per item of mama.starThresholdPoints, with the item’s bounds', () => {
    const items = leaves.filter((leaf) => leaf.pathKey.startsWith('mama.starThresholdPoints['));
    expect(items).toHaveLength(feel.mama.starThresholdPoints.length);
    expect(items[0]).toMatchObject({ kind: 'number', min: 0, max: 100, hasSlider: true });
    expect(items[0]?.path).toEqual(['mama', 'starThresholdPoints', 0]);
  });

  it('carries the description of the schema as the hint, and empty when there is none', () => {
    expect(number('timing.windowMs').hint).toMatch(/\S/);
    expect(find('timing.windowMs').hint).toBe(
      getAtPath(schema, ['properties', 'timing', 'properties', 'windowMs', 'description']),
    );
    const bare = describeFeelControls(
      { type: 'object', properties: { a: { type: 'number' } } },
      { a: 1 },
    );
    expect(bare.children[0]?.hint).toBe('');
  });

  it('marks the keys the sim reads only when a level starts', () => {
    const marked = leaves.filter((leaf) => leaf.isNextLevel).map((leaf) => leaf.pathKey);
    expect(marked).toContain('movement.papaRadiusM');
    expect(marked).toContain('baby.bodyRadiusM');
    expect(marked).toContain('baby.babbleMinMs');
    expect(marked).toContain('fatigue.startPoints');
    expect(marked.filter((key) => key.startsWith('physics.')).length).toBe(
      leaves.filter((leaf) => leaf.pathKey.startsWith('physics.')).length,
    );
    expect(find('timing.windowMs').isNextLevel).toBe(false);
    expect(find('baby.babbleMaxMs').isNextLevel).toBe(false);
    expect(isNextLevelKey('physics')).toBe(false);
  });

  it('shows a new key of the schema with no change here (a schema invented for the test)', () => {
    const invented = describeFeelControls(
      {
        type: 'object',
        properties: {
          $schema: { type: 'string' },
          juice: {
            type: 'object',
            properties: {
              shakeAmount: { type: 'number', minimum: 0, maximum: 1, description: 'How hard.' },
              mode: { type: 'string', enum: ['soft', 'hard'] },
              label: { type: 'string' },
            },
          },
        },
      },
      { juice: { shakeAmount: 0.3, mode: 'soft', label: 'x' } },
    );
    expect(leafControls(invented).map((leaf) => [leaf.pathKey, leaf.kind])).toEqual([
      ['juice.shakeAmount', 'number'],
      ['juice.mode', 'list'],
      ['juice.label', 'text'],
    ]);
  });

  it('skips a schema node it does not know, and answers an empty folder for a schema with no object', () => {
    expect(describeFeelControls({ type: 'number' }, 1)).toMatchObject({
      kind: 'folder',
      children: [],
    });
    const odd = describeFeelControls(
      { type: 'object', properties: { x: { type: 'null' }, y: 5, z: { type: 'array' } } },
      {},
    );
    expect(odd.children).toEqual([]);
  });

  it('does not ask the sim anything: building the descriptors changes nothing in the feel', () => {
    const before = structuredClone(feel);
    describeFeelControls(schema, feel);
    expect(feel).toEqual(before);
  });
});

describe('leafPatch', () => {
  it('builds the nested one-leaf patch of a number', () => {
    expect(leafPatch(feel, ['timing', 'slowMoPerfect', 'timeScale'], 0.4)).toEqual({
      timing: { slowMoPerfect: { timeScale: 0.4 } },
    });
  });

  it('gives the whole array for an item of an array, with that item replaced', () => {
    const next = leafPatch(feel, ['mama', 'starThresholdPoints', 2], 77) as {
      mama: { starThresholdPoints: number[] };
    };
    const expected = [...feel.mama.starThresholdPoints];
    expected[2] = 77;
    expect(next).toEqual({ mama: { starThresholdPoints: expected } });
    // The feel itself is not touched.
    expect(feel.mama.starThresholdPoints).not.toBe(next.mama.starThresholdPoints);
    expect(feel.mama.starThresholdPoints[2]).not.toBe(77);
  });

  it('produces a patch the sim’s own check and the schema both accept', () => {
    for (const leaf of leaves) {
      const value = getAtPath(feel, leaf.path);
      const patch = leafPatch(feel, leaf.path, value);
      const merged = applyFeelPatch(feel as Feel, patch);
      expect(merged.ok, leaf.pathKey).toBe(true);
    }
  });
});

describe('mergePatch', () => {
  it('merges objects key by key and replaces arrays and scalars', () => {
    expect(
      mergePatch({ a: { b: 1, c: 2 }, list: [1, 2, 3] }, { a: { c: 3, d: 4 }, list: [9] }),
    ).toEqual({ a: { b: 1, c: 3, d: 4 }, list: [9] });
  });

  it('changes neither argument', () => {
    const base = { a: { b: 1 } };
    const patch = { a: { c: 2 } };
    const merged = mergePatch(base, patch);
    expect(base).toEqual({ a: { b: 1 } });
    expect(patch).toEqual({ a: { c: 2 } });
    expect((merged.a as object) === (patch.a as object)).toBe(false);
  });
});

describe('getAtPath and pathKeyOf', () => {
  it('reads a nested value, an array item, and undefined past the end', () => {
    expect(getAtPath(feel, ['timing', 'windowMs'])).toBe(feel.timing.windowMs);
    expect(getAtPath(feel, ['mama', 'starThresholdPoints', 1])).toBe(
      feel.mama.starThresholdPoints[1],
    );
    expect(getAtPath(feel, ['timing', 'nope', 'deeper'])).toBeUndefined();
    expect(getAtPath(5, ['a'])).toBeUndefined();
  });

  it('writes a path dotted, with an index in brackets', () => {
    expect(pathKeyOf(['mama', 'starThresholdPoints', 0])).toBe('mama.starThresholdPoints[0]');
    expect(pathKeyOf([])).toBe('');
  });
});

describe('level overrides', () => {
  it('lists the leaves of an overrides object, an array being one leaf', () => {
    expect(
      overrideLeafKeys({
        timing: { windowMs: 1, slowMoPerfect: { timeScale: 0.5 } },
        mama: { starThresholdPoints: [1, 2] },
      }),
    ).toEqual(['timing.windowMs', 'timing.slowMoPerfect.timeScale', 'mama.starThresholdPoints']);
    expect(overrideLeafKeys(undefined)).toEqual([]);
    expect(overrideLeafKeys({})).toEqual([]);
  });

  it('matches a control to an override by its key, or by the array it belongs to', () => {
    const keys = new Set(['timing.windowMs', 'mama.starThresholdPoints']);
    expect(isOverriddenKey('timing.windowMs', keys)).toBe(true);
    expect(isOverriddenKey('mama.starThresholdPoints[3]', keys)).toBe(true);
    expect(isOverriddenKey('timing.perfectMs', keys)).toBe(false);
    expect(isOverriddenKey('timing.windowMsExtra', keys)).toBe(false);
  });
});
