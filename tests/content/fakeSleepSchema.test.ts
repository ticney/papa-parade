import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { THREAT_ICONS, ThreatDefSchema } from '@content/schemas/threat';
import { describe, expect, it } from 'vitest';

// The `feint` of a `wait` threat in the threat schema (story 4.7). The frozen fake sleep stands in for
// the live one: tunable values are never pinned here.
const fixture = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../support/${file}`, import.meta.url), 'utf8'));
const fakeSleep = fixture('testFakeSleep.threat.json');
const eyes = fixture('testBedtimeEyes.threat.json');
const outlet = JSON.parse(
  readFileSync(new URL('../../content/threats/outlet.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function parse(value: unknown) {
  return parseContentFile('content/threats/x.json', JSON.stringify(value), ThreatDefSchema);
}

function mutated(
  base: Record<string, unknown>,
  ...changes: [path: string, value: unknown][]
): string[] {
  const copy = structuredClone(base);
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node = copy;
    for (const name of names) node = node[name] as Record<string, unknown>;
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  const result = parse(copy);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('a wait threat with a feint (story 4.7)', () => {
  it('parses, and carries its feint', () => {
    const parsed = parse(fakeSleep);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.feint).toMatchObject({ icon: 'peek' });
    expect(parsed.value.feedback.feint).toBe('fake_sleep_eye_peeks');
  });

  it('knows the peek icon', () => {
    expect(THREAT_ICONS).toContain('peek');
  });

  it('still parses a wait with no feint', () => {
    expect(mutated(eyes)).toEqual([]);
  });

  it.each([
    ['a minDelayMs of 0', [['feint.minDelayMs', 0]], ['feint.minDelayMs']],
    ['a fractional minDelayMs', [['feint.minDelayMs', 1200.5]], ['feint.minDelayMs']],
    ['a fractional maxDelayMs', [['feint.maxDelayMs', 2600.5]], ['feint.maxDelayMs']],
    ['a minGapMs of 0', [['feint.minGapMs', 0]], ['feint.minGapMs']],
    ['a fractional minGapMs', [['feint.minGapMs', 900.5]], ['feint.minGapMs']],
    ['a missing minDelayMs', [['feint.minDelayMs', undefined]], ['feint.minDelayMs']],
    ['a missing maxDelayMs', [['feint.maxDelayMs', undefined]], ['feint.maxDelayMs']],
    ['a missing minGapMs', [['feint.minGapMs', undefined]], ['feint.minGapMs']],
    ['a missing icon', [['feint.icon', undefined]], ['feint.icon']],
    ['an unknown icon', [['feint.icon', 'anvil']], ['feint.icon']],
    ['an unknown key', [['feint.extra', 1]], ['feint.extra']],
  ] as const)('rejects %s', (_name, changes, expected) => {
    expect(mutated(fakeSleep, ...(changes as unknown as [string, unknown][]))).toEqual(expected);
  });

  it('rejects a maxDelayMs of 0 on the maxDelayMs, whatever the other rule says', () => {
    expect(new Set(mutated(fakeSleep, ['feint.maxDelayMs', 0]))).toEqual(
      new Set(['feint.maxDelayMs']),
    );
  });

  it('rejects a minDelayMs above maxDelayMs, on the maxDelayMs', () => {
    expect(mutated(fakeSleep, ['feint.minDelayMs', 2700])).toEqual(['feint.maxDelayMs']);
  });

  it('accepts a minDelayMs equal to maxDelayMs (a fixed feint)', () => {
    expect(mutated(fakeSleep, ['feint.minDelayMs', 2000], ['feint.maxDelayMs', 2000])).toEqual([]);
  });

  it('rejects a gap that does not fit before the earliest signal', () => {
    // 2600 + 900 = 3500 = minDelayMs fits; one ms more does not.
    expect(mutated(fakeSleep, ['feint.minGapMs', 901])).toEqual(['feint.maxDelayMs']);
    expect(mutated(fakeSleep, ['feint.maxDelayMs', 2601])).toEqual(['feint.maxDelayMs']);
    expect(mutated(fakeSleep, ['minDelayMs', 3499])).toEqual(['feint.maxDelayMs']);
  });

  it('accepts a gap that fits exactly', () => {
    expect(mutated(fakeSleep, ['feint.minGapMs', 900])).toEqual([]);
    expect(mutated(fakeSleep, ['feint.minGapMs', 899])).toEqual([]);
  });

  it('refuses a missing feedback.feint', () => {
    expect(mutated(fakeSleep, ['feedback.feint', undefined])).toEqual(['feedback.feint']);
  });

  it('refuses a feedback.feint cue id in camelCase', () => {
    expect(mutated(fakeSleep, ['feedback.feint', 'eyePeeks'])).toEqual(['feedback.feint']);
  });

  it('refuses an unwanted feedback.feint on a wait with no feint', () => {
    expect(mutated(eyes, ['feedback.feint', 'fake_sleep_eye_peeks'])).toEqual(['feedback.feint']);
  });
});

describe('the feint on a response that is not a wait (story 4.7)', () => {
  const feint = { minDelayMs: 1200, maxDelayMs: 2600, minGapMs: 900, icon: 'peek' };

  it('refuses a feint on a parry', () => {
    expect(mutated(outlet, ['feint', feint])).toEqual(['feint']);
  });

  it('refuses a feint on a firm threat too', () => {
    expect(mutated(outlet, ['response', 'firm'], ['holdUntilMs', 1500], ['feint', feint])).toEqual([
      'feint',
    ]);
  });

  it('refuses a feedback.feint on a parry', () => {
    expect(mutated(outlet, ['feedback.feint', 'fake_sleep_eye_peeks'])).toEqual(['feedback.feint']);
  });
});
