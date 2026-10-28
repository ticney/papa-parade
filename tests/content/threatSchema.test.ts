import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { ThreatDefSchema } from '@content/schemas/threat';
import { describe, expect, it } from 'vitest';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FILE = 'content/threats/outlet.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/threats/outlet.json', import.meta.url), 'utf8'),
);

// Every numeric key of a threat file is a duration.
const UNIT_SUFFIX = /Ms$/;

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), ThreatDefSchema);
}

/** A copy of the real file with the keys at the given paths replaced (`undefined` deletes). */
function mutated(...changes: [path: string, value: unknown][]) {
  const copy = structuredClone(real) as Record<string, unknown>;
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node = copy;
    for (const name of names) node = node[name] as Record<string, unknown>;
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  return parse(copy);
}

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/threats/outlet.json', () => {
  it('parses against ThreatDefSchema', () => {
    expect(parse(real)).toMatchObject({ ok: true });
  });

  it('is the outlet: a Parry answered in the standard window, ending in a gag', () => {
    const parsed = parse(real);
    if (!parsed.ok) throw new Error('expected the outlet to parse');
    expect(parsed.value.id).toBe('outlet');
    expect(parsed.value.response).toBe('parry');
    expect(parsed.value.windowMs).toBeNull();
    expect(parsed.value).toMatchObject({ target: 'anchor', gag: 'outlet_hair' });
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['an unknown key', [['bogusMs', 1]], ['bogusMs']],
    ['an unknown key in the feedback', [['feedback.bogus', 'x']], ['feedback.bogus']],
    ['a Firmness without holdUntilMs', [['response', 'firm']], ['holdUntilMs']],
    ['a Parry with holdUntilMs', [['holdUntilMs', 1500]], ['holdUntilMs']],
    [
      'a Firmness with a non-positive holdUntilMs',
      [
        ['response', 'firm'],
        ['holdUntilMs', 0],
      ],
      ['holdUntilMs'],
    ],
    ['a response the sim cannot judge yet', [['response', 'wait']], ['response']],
    ['a telegraph delay of 0', [['telegraphDelayMs', 0]], ['telegraphDelayMs']],
    ['a negative telegraph delay', [['telegraphDelayMs', -1]], ['telegraphDelayMs']],
    [
      'a missing telegraph delay (null is written)',
      [['telegraphDelayMs', undefined]],
      ['telegraphDelayMs'],
    ],
    ['a window of 0', [['windowMs', 0]], ['windowMs']],
    ['a cue id in camelCase', [['feedback.telegraph', 'telOutlet']], ['feedback.telegraph']],
    ['a gag id in camelCase', [['gag', 'outletHair']], ['gag']],
    ['an id with a dot', [['id', 'out.let']], ['id']],
    ['a negative cooldown', [['cooldownMs', -1]], ['cooldownMs']],
    ['an unknown icon', [['icon', 'anvil']], ['icon']],
    ['a missing icon', [['icon', undefined]], ['icon']],
    ['a missing cue', [['feedback.gag', undefined]], ['feedback.gag']],
    ['a missing target (no default)', [['target', undefined]], ['target']],
    ['an unknown target', [['target', 'baby']], ['target']],
  ])('rejects %s', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a gagCryMs of 0', [['gagCryMs', 0]], ['gagCryMs']],
    ['a negative gagCryMs', [['gagCryMs', -3000]], ['gagCryMs']],
    ['a non-integer gagCryMs', [['gagCryMs', 1500.5]], ['gagCryMs']],
    ['a gagCryMs that is a string', [['gagCryMs', '3000']], ['gagCryMs']],
  ])('rejects %s (story 3.1)', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it('accepts a gagCryMs (a whole number of sim ms) on an anchor threat, and no gagCryMs at all', () => {
    expect(mutated(['gagCryMs', 3000])).toMatchObject({ ok: true });
    expect(parse(real)).toMatchObject({ ok: true });
    expect(real.gagCryMs).toBeUndefined();
  });

  it('accepts a Firmness that carries holdUntilMs, on an anchor or on Papa', () => {
    expect(mutated(['response', 'firm'], ['holdUntilMs', 1500])).toMatchObject({ ok: true });
    expect(mutated(['response', 'firm'], ['holdUntilMs', 1500], ['target', 'papa'])).toMatchObject({
      ok: true,
    });
  });

  it('accepts a threat that takes the feel defaults and no cooldown', () => {
    expect(
      mutated(['telegraphDelayMs', null], ['windowMs', null], ['cooldownMs', 0]),
    ).toMatchObject({ ok: true });
  });

  it('gives every numeric key of the file a unit suffix', () => {
    const keys = Object.entries(real)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !UNIT_SUFFIX.test(key))).toEqual([]);
  });
});

describe('content/threats/papa_microsleep.json (story 1.19)', () => {
  const micro = JSON.parse(
    readFileSync(new URL('../../content/threats/papa_microsleep.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

  it('parses, stands on Papa, is parried and ends in the nap gag with the closed-eye glyph', () => {
    const parsed = parseContentFile(
      'content/threats/papa_microsleep.json',
      JSON.stringify(micro),
      ThreatDefSchema,
    );
    if (!parsed.ok) throw new Error('expected the micro-sleep to parse');
    expect(parsed.value).toMatchObject({
      id: 'papa_microsleep',
      target: 'papa',
      response: 'parry',
      gag: 'papa_asleep',
      icon: 'eyelids',
    });
  });

  it('keeps the outlet on an anchor', () => {
    expect(real.target).toBe('anchor');
  });
});

describe('content/threats/silence_mischief.json (story 1.21)', () => {
  const FILE_SILENCE = 'content/threats/silence_mischief.json';
  const silence = JSON.parse(
    readFileSync(new URL('../../content/threats/silence_mischief.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const parseSilence = (value: unknown) =>
    parseContentFile(FILE_SILENCE, JSON.stringify(value), ThreatDefSchema);
  const withChanges = (...changes: [key: string, value: unknown][]) => {
    const copy = { ...silence };
    for (const [key, value] of changes) {
      if (value === undefined) delete copy[key];
      else copy[key] = value;
    }
    return parseSilence(copy);
  };
  const paths = (result: ReturnType<typeof parseSilence>) =>
    result.ok ? [] : result.error.map((problem) => problem.jsonPath);

  it('parses as the hidden-zone variant: a Parry, a list of surprise gags, a time to find the baby', () => {
    const parsed = parseSilence(silence);
    if (!parsed.ok) throw new Error('expected the silence to parse');
    expect(parsed.value).toMatchObject({
      id: 'silence_mischief',
      target: 'hiddenZone',
      response: 'parry',
      icon: 'dots',
    });
    if (parsed.value.target !== 'hiddenZone') throw new Error('expected a hidden-zone def');
    expect(parsed.value.findMaxMs).toBeGreaterThan(0);
    expect(parsed.value.surpriseGags.length).toBeGreaterThan(0);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a hidden-zone def with a single gag', [['gag', 'outlet_hair']], ['gag']],
    ['a missing findMaxMs', [['findMaxMs', undefined]], ['findMaxMs']],
    ['a findMaxMs of 0', [['findMaxMs', 0]], ['findMaxMs']],
    ['a missing surpriseGags', [['surpriseGags', undefined]], ['surpriseGags']],
    ['an empty surpriseGags', [['surpriseGags', []]], ['surpriseGags']],
    [
      'a surprise gag id in camelCase',
      [['surpriseGags', ['tissuesEverywhere']]],
      ['surpriseGags[0]'],
    ],
  ])('rejects %s', (_name, changes, expected) => {
    expect(paths(withChanges(...changes))).toEqual(expected);
  });

  it('refuses surpriseGags and findMaxMs on an anchor def: they belong to a hidden zone', () => {
    const outletWithSurprises = { ...real, surpriseGags: ['outlet_hair'], findMaxMs: 1000 };
    const result = parse(outletWithSurprises);
    expect(result.ok).toBe(false);
    expect(failedPaths(result).sort()).toEqual(['findMaxMs', 'surpriseGags']);
  });

  it('gives every numeric key of the file a unit suffix', () => {
    const keys = Object.entries(silence)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key);
    expect(keys.filter((key) => !UNIT_SUFFIX.test(key))).toEqual([]);
  });
});
