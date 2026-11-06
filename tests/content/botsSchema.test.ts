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
const UNIT_SUFFIX = /(?:Ms|M|PerSec|Pct)$/;

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
    expect(mutated('human.readError.extra', 1).ok).toBe(false);
    expect(mutated('human.readError.withChronoRing.extra', 1).ok).toBe(false);
    expect(mutated('random.extra', 1).ok).toBe(false);
    expect(mutated('chores.extra', 1).ok).toBe(false);
  });

  it.each([
    'tapMs',
    'human',
    'random',
    'human.reactionMeanMs',
    'human.reactionSdMs',
    'human.reactionMinMs',
    'human.readError',
    'human.readError.withChronoRing',
    'human.readError.withoutChronoRing.sdMs',
    'human.missWhileBusyPct',
    'human.aimOffsetMs',
    'human.backTurnedReactionMs',
    'chores',
    'chores.isEnabled',
    'chores.quietMinMs',
    'random.maxHoldMs',
  ])('needs %s', (path) => {
    expect(mutated(path, undefined).ok).toBe(false);
  });

  it.each([
    ['tapMs', 0],
    ['tapMs', -1],
    ['tapMs', 'x'],
    ['human.reactionMeanMs', -1],
    ['human.reactionSdMs', -1],
    ['human.reactionMinMs', -1],
    ['human.readError.withChronoRing.sdMs', -1],
    ['human.readError.withChronoRing.sdMs', 2001],
    ['human.readError.withoutChronoRing.sdMs', -1],
    ['human.readError.withoutChronoRing.sdMs', 2001],
    ['human.missWhileBusyPct', -1],
    ['human.missWhileBusyPct', 100.5],
    ['human.jitterSdMs', -0.5],
    ['human.backTurnedReactionMs', -1],
    ['human.backTurnedReactionMs', 25_000],
    ['chores.quietMinMs', -1],
    ['chores.quietMinMs', 25_000],
    ['chores.quietMinMs', 'x'],
    ['chores.isEnabled', 'yes'],
    ['chores.isEnabled', 1],
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
    ['human.reactionMeanMs', 0],
    ['human.reactionSdMs', 0],
    ['human.reactionMinMs', 0],
    ['human.readError.withChronoRing.sdMs', 0],
    ['human.readError.withChronoRing.offsetMs', -400],
    ['human.readError.withoutChronoRing.sdMs', 2000],
    ['human.missWhileBusyPct', 0],
    ['human.missWhileBusyPct', 100],
    ['human.jitterSdMs', 0],
    ['human.aimOffsetMs', -400],
    ['human.backTurnedReactionMs', 0],
    ['chores.quietMinMs', 0],
    ['chores.isEnabled', false],
    ['random.actionsPerSec', 0],
  ])('accepts %s = %s', (path, value) => {
    expect(mutated(path, value).ok).toBe(true);
  });
});
