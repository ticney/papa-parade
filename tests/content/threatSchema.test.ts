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
    expect(parsed.value.gag).toBe('outlet_hair');
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['an unknown key', [['bogusMs', 1]], ['bogusMs']],
    ['an unknown key in the feedback', [['feedback.bogus', 'x']], ['feedback.bogus']],
    ['a Firmness (not judged yet)', [['response', 'firm']], ['response']],
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
