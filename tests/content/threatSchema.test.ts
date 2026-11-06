import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { THREAT_CATASTROPHE_CATEGORIES, ThreatDefSchema } from '@content/schemas/threat';
import { AFTER_EFFECT_BUSY_MAX_MS, MICRO_SLEEP_BUSY_MAX_MS } from '@shared/constants';
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
    ['a response the sim cannot judge yet', [['response', 'dodge']], ['response']],
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
    ['an unknown target', [['target', 'crib']], ['target']],
  ])('rejects %s', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a gagCryMs of 0', [['gagCryMs', 0]], ['gagCryMs']],
    ['a gagCryMs shorter than one cry period', [['gagCryMs', 999]], ['gagCryMs']],
    ['a negative gagCryMs', [['gagCryMs', -3000]], ['gagCryMs']],
    ['a non-integer gagCryMs', [['gagCryMs', 1500.5]], ['gagCryMs']],
    ['a gagCryMs that is a string', [['gagCryMs', '3000']], ['gagCryMs']],
  ])('rejects %s (story 3.1)', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['a missing verbKey (null is written, not omitted)', [['verbKey', undefined]], ['verbKey']],
    ['a missing iconShape', [['iconShape', undefined]], ['iconShape']],
    ['a missing color', [['color', undefined]], ['color']],
    ['a verbKey outside the verb. group', [['verbKey', 'age.adult']], ['verbKey']],
    ['a verbKey in camelCase', [['verbKey', 'verb.liftIt']], ['verbKey']],
    ['a verbKey with nothing after the dot', [['verbKey', 'verb.']], ['verbKey']],
    ['a verbKey that is a plain French word', [['verbKey', 'SOULÈVE !']], ['verbKey']],
    [
      'a null verbKey on a parry def (only a dodge has a default verb)',
      [['verbKey', null]],
      ['verbKey'],
    ],
    [
      'a null verbKey on a firm def',
      [
        ['response', 'firm'],
        ['holdUntilMs', 1500],
        ['verbKey', null],
      ],
      ['verbKey'],
    ],
    ['an unknown iconShape', [['iconShape', 'square']], ['iconShape']],
    ['an unknown color', [['color', 'green']], ['color']],
    ['a circle that is not parry-coloured', [['color', 'dodge']], ['color']],
    [
      'a triangle with the parry colour (the pair is the signal)',
      [['iconShape', 'triangle']],
      ['color'],
    ],
    [
      'a triangle / dodge marker on a parry def, until the dodge response exists',
      [
        ['iconShape', 'triangle'],
        ['color', 'dodge'],
      ],
      ['iconShape'],
    ],
    [
      'a triangle / dodge marker on a firm def',
      [
        ['response', 'firm'],
        ['holdUntilMs', 1500],
        ['iconShape', 'triangle'],
        ['color', 'dodge'],
      ],
      ['iconShape'],
    ],
  ])('rejects %s (story 2.2)', (_name, changes, expected) => {
    expect(failedPaths(mutated(...changes))).toEqual(expected);
  });

  it('tells that the triangle joins with the dodge response (story 5.1)', () => {
    const result = mutated(['iconShape', 'triangle'], ['color', 'dodge']);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error[0]?.message).toMatch(/dodge response \(story 5\.1\)/);
  });

  it('reports a broken pair alone, not once more as a response problem', () => {
    const result = mutated(['iconShape', 'triangle']);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error).toHaveLength(1);
    expect(result.error[0]?.message).toMatch(/pair/);
  });

  it('accepts a circle + parry marker with a verb key, on an anchor, on Papa and on a firm def', () => {
    expect(parse(real)).toMatchObject({ ok: true });
    expect(mutated(['target', 'papa'])).toMatchObject({ ok: true });
    expect(mutated(['response', 'firm'], ['holdUntilMs', 1500])).toMatchObject({ ok: true });
    expect(mutated(['verbKey', 'verb.firm'])).toMatchObject({ ok: true });
  });

  it('copies the three keys into the parsed def', () => {
    const parsed = parse(real);
    if (!parsed.ok) throw new Error('expected the outlet to parse');
    expect(parsed.value).toMatchObject({
      verbKey: 'verb.lift',
      iconShape: 'circle',
      color: 'parry',
    });
  });

  it('accepts a gagCryMs (a whole number of sim ms) on an anchor threat, and no gagCryMs at all', () => {
    expect(mutated(['gagCryMs', 3000])).toMatchObject({ ok: true });
    expect(mutated(['gagCryMs', 1000])).toMatchObject({ ok: true });
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

describe('content/threats/arms_cry.json (story 4.1)', () => {
  const armsCry = JSON.parse(
    readFileSync(new URL('../../content/threats/arms_cry.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

  it('parses, stands on Papa, is parried, ends in the wail and makes the baby cry', () => {
    const parsed = parseContentFile(
      'content/threats/arms_cry.json',
      JSON.stringify(armsCry),
      ThreatDefSchema,
    );
    if (!parsed.ok) throw new Error('expected the cry in the arms to parse');
    expect(parsed.value).toMatchObject({
      id: 'arms_cry',
      target: 'papa',
      response: 'parry',
      gag: 'arms_wail',
      icon: 'cry',
      verbKey: 'verb.rock',
      gagCryMs: 4000,
    });
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

  it.each<[string, [string, unknown][], string[]]>([
    ['a missing verbKey', [['verbKey', undefined]], ['verbKey']],
    ['a missing iconShape', [['iconShape', undefined]], ['iconShape']],
    ['a missing color', [['color', undefined]], ['color']],
    ['a mismatched pair', [['color', 'dodge']], ['color']],
  ])('rejects %s (story 2.2)', (_name, changes, expected) => {
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

describe('afterEffect (story 3.15)', () => {
  const effects: [string, Record<string, unknown>][] = [
    ['none', { kind: 'none' }],
    ['electrified', { kind: 'electrified', busyMs: 1500, dimMs: 6000 }],
    ['babyDownstairs', { kind: 'babyDownstairs', carryUpMs: 2000, selfReturnMs: 6000 }],
    ['debris', { kind: 'debris', pickUpMs: 1000 }],
    ['mess', { kind: 'mess' }],
    ['asleep', { kind: 'asleep', busyMs: 3000 }],
  ];

  it.each(effects)('accepts a %s afterEffect', (_kind, effect) => {
    expect(mutated(['afterEffect', effect])).toMatchObject({ ok: true });
  });

  it('is required: a def with none is refused at `afterEffect`', () => {
    expect(failedPaths(mutated(['afterEffect', undefined]))).toContain('afterEffect');
  });

  it('refuses an unknown kind, a missing duration and a key of another kind', () => {
    expect(mutated(['afterEffect', { kind: 'burning' }]).ok).toBe(false);
    expect(mutated(['afterEffect', { kind: 'electrified', busyMs: 1500 }]).ok).toBe(false);
    expect(mutated(['afterEffect', { kind: 'mess', busyMs: 1000 }]).ok).toBe(false);
    expect(mutated(['afterEffect', { kind: 'none', dimMs: 1000 }]).ok).toBe(false);
    expect(mutated(['afterEffect', { kind: 'debris', pickUpMs: 1000, extra: 1 }]).ok).toBe(false);
  });

  it('holds what keeps Papa busy to AFTER_EFFECT_BUSY_MAX_MS (2 s), and the nap to MICRO_SLEEP_BUSY_MAX_MS (3 s)', () => {
    const at = (effect: Record<string, unknown>) => mutated(['afterEffect', effect]).ok;
    expect(at({ kind: 'electrified', busyMs: AFTER_EFFECT_BUSY_MAX_MS, dimMs: 6000 })).toBe(true);
    expect(at({ kind: 'electrified', busyMs: AFTER_EFFECT_BUSY_MAX_MS + 1, dimMs: 6000 })).toBe(
      false,
    );
    expect(
      at({ kind: 'babyDownstairs', carryUpMs: AFTER_EFFECT_BUSY_MAX_MS + 1, selfReturnMs: 6000 }),
    ).toBe(false);
    expect(at({ kind: 'debris', pickUpMs: AFTER_EFFECT_BUSY_MAX_MS + 1 })).toBe(false);
    expect(at({ kind: 'asleep', busyMs: MICRO_SLEEP_BUSY_MAX_MS })).toBe(true);
    expect(at({ kind: 'asleep', busyMs: MICRO_SLEEP_BUSY_MAX_MS + 1 })).toBe(false);
    // The nap's cap is not the others': 2.5 s of electrified is refused, 2.5 s of nap is not.
    expect(at({ kind: 'electrified', busyMs: 2500, dimMs: 6000 })).toBe(false);
    expect(at({ kind: 'asleep', busyMs: 2500 })).toBe(true);
  });

  it('wants every duration to be a positive whole number of ms', () => {
    for (const bad of [0, -100, 1.5]) {
      expect(mutated(['afterEffect', { kind: 'electrified', busyMs: bad, dimMs: 6000 }]).ok).toBe(
        false,
      );
      expect(mutated(['afterEffect', { kind: 'electrified', busyMs: 1500, dimMs: bad }]).ok).toBe(
        false,
      );
      expect(
        mutated(['afterEffect', { kind: 'babyDownstairs', carryUpMs: 1000, selfReturnMs: bad }]).ok,
      ).toBe(false);
    }
  });
});

describe('catastrophe (story 3.16)', () => {
  it.each(THREAT_CATASTROPHE_CATEGORIES)('accepts the category %s', (category) => {
    expect(mutated(['catastrophe', category])).toMatchObject({ ok: true });
  });

  it('is required: a def without it is refused at `catastrophe`', () => {
    expect(failedPaths(mutated(['catastrophe', undefined]))).toContain('catastrophe');
  });

  it('refuses a category that is not one of the four (choreBeat is not a threat category)', () => {
    expect(mutated(['catastrophe', 'choreBeat']).ok).toBe(false);
    expect(mutated(['catastrophe', 'bogus']).ok).toBe(false);
    expect(mutated(['catastrophe', 35]).ok).toBe(false);
  });
});

describe('content/threats/pot_on_stove.json (story 9.5)', () => {
  const FILE_POT = 'content/threats/pot_on_stove.json';
  const pot = JSON.parse(
    readFileSync(new URL('../../content/threats/pot_on_stove.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const parsePot = (value: unknown) =>
    parseContentFile(FILE_POT, JSON.stringify(value), ThreatDefSchema);
  const withPot = (...changes: [key: string, value: unknown][]) => {
    const copy = { ...pot };
    for (const [key, value] of changes) {
      if (value === undefined) delete copy[key];
      else copy[key] = value;
    }
    return parsePot(copy);
  };
  const failed = (result: ReturnType<typeof parsePot>): string[] =>
    result.ok ? [] : result.error.map((problem) => problem.jsonPath);

  it('parses as a parry on a chore station, with a noise of its own', () => {
    const parsed = parsePot(pot);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      id: 'pot_on_stove',
      target: 'station',
      response: 'parry',
      icon: 'pot',
      verbKey: 'verb.lower_heat',
      catastrophe: 'mess',
      afterEffect: { kind: 'mess' },
    });
    expect(parsed.value.gagNoisePct).toBeGreaterThan(0);
  });

  it('refuses a station threat that is not a parry: only a pot to lower is a station threat', () => {
    expect(failed(withPot(['response', 'firm'], ['holdUntilMs', 1500]))).toEqual(['response']);
    expect(failed(withPot(['response', 'nothing'], ['nothingMs', 1000]))).toEqual(['response']);
    expect(failed(withPot(['response', 'parry']))).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['above a whole gauge', 100.5],
    ['a string', '10'],
  ])('refuses a gagNoisePct that is %s', (_name, value) => {
    expect(failed(withPot(['gagNoisePct', value]))).toEqual(['gagNoisePct']);
  });

  it('accepts a gagNoisePct up to a whole gauge, and none at all (the gag makes no noise)', () => {
    expect(withPot(['gagNoisePct', 100])).toMatchObject({ ok: true });
    expect(withPot(['gagNoisePct', 0.5])).toMatchObject({ ok: true });
    expect(withPot(['gagNoisePct', undefined])).toMatchObject({ ok: true });
  });

  it('allows gagNoisePct on any threat, like gagCryMs', () => {
    expect(mutated(['gagNoisePct', 15])).toMatchObject({ ok: true });
  });
});
