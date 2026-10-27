import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { BotsSchema } from '@content/schemas/bots';
import { describe, expect, it } from 'vitest';
import { createTestBots } from '../support/testContent.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// units only.

const real: Json = JSON.parse(
  readFileSync(new URL('../../content/bots.json', import.meta.url), 'utf8'),
);

type Json = Record<string, unknown>;

function parse(value: unknown) {
  return parseContentFile('content/bots.json', JSON.stringify(value), BotsSchema);
}

/** A copy of the real file with the values at the given dotted paths replaced (`undefined` deletes). */
function mutated(path: string, value: unknown) {
  const copy = structuredClone(real) as Json;
  const names = path.split('.');
  const key = names.pop() as string;
  let node = copy;
  for (const name of names) node = node[name] as Json;
  if (value === undefined) delete node[key];
  else node[key] = value;
  return parse(copy);
}

// Every numeric key carries its unit, as in the other content files.
const UNIT_SUFFIX = /(?:Ms|M|PerSec)$/;

function numericKeys(node: unknown, path = ''): string[] {
  if (typeof node === 'number') return [path];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    numericKeys(value, path === '' ? key : `${path}.${key}`),
  );
}

describe('content/bots.json', () => {
  it('is valid', () => {
    expect(parse(real).ok).toBe(true);
  });

  it('is the shape of the frozen test settings', () => {
    expect(parse(createTestBots()).ok).toBe(true);
  });

  it('gives every number a unit in its name', () => {
    const keys = numericKeys(real);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.split('.').pop()).toMatch(UNIT_SUFFIX);
  });

  it('refuses an unknown key, at the top and in each group', () => {
    expect(mutated('extra', 1).ok).toBe(false);
    expect(mutated('human.extra', 1).ok).toBe(false);
    expect(mutated('random.extra', 1).ok).toBe(false);
  });

  it.each([
    'tapMs',
    'human',
    'random',
    'human.reactionMs',
    'human.aimOffsetMs',
    'random.maxHoldMs',
  ])('needs %s', (path) => {
    expect(mutated(path, undefined).ok).toBe(false);
  });

  it.each([
    ['tapMs', 0],
    ['tapMs', -1],
    ['tapMs', 'x'],
    ['human.reactionMs', -1],
    ['human.jitterSdMs', -0.5],
    ['random.actionsPerSec', -1],
    ['random.actionsPerSec', 101],
    ['random.floorReachM', 0],
    ['random.maxHoldMs', 0],
  ])('refuses %s = %s', (path, value) => {
    const result = mutated(path, value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.jsonPath).toBe(path);
  });

  it.each([
    ['human.reactionMs', 0],
    ['human.jitterSdMs', 0],
    ['human.aimOffsetMs', -400],
    ['random.actionsPerSec', 0],
  ])('accepts %s = %s', (path, value) => {
    expect(mutated(path, value).ok).toBe(true);
  });
});
