import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { ThreatDefSchema } from '@content/schemas/threat';
import { describe, expect, it } from 'vitest';

// The `wait` response in the threat schema (story 4.6): its five keys are required on a `wait`
// threat and refused anywhere else. Tunable values are never pinned here.
const real = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../content/threats/${file}`, import.meta.url), 'utf8'));
const eyes = real('bedtime_eyes.json');
const outlet = real('outlet.json');

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

describe('content/threats/bedtime_eyes.json (story 4.6)', () => {
  it('parses, and is a wait on Papa', () => {
    const parsed = parse(eyes);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ response: 'wait', target: 'papa' });
  });

  it.each([
    ['a missing minDelayMs', [['minDelayMs', undefined]], ['minDelayMs']],
    ['a missing maxDelayMs', [['maxDelayMs', undefined]], ['maxDelayMs']],
    ['a missing signalVerbKey', [['signalVerbKey', undefined]], ['signalVerbKey']],
    ['a missing signalIcon', [['signalIcon', undefined]], ['signalIcon']],
    ['a missing feedback.signal', [['feedback.signal', undefined]], ['feedback.signal']],
    ['a minDelayMs of 0', [['minDelayMs', 0]], ['minDelayMs']],
    ['a fractional maxDelayMs', [['maxDelayMs', 4000.5]], ['maxDelayMs']],
    ['a minDelayMs above maxDelayMs', [['minDelayMs', 9_000_000]], ['maxDelayMs']],
    [
      'a signalVerbKey outside the verb. group',
      [['signalVerbKey', 'age.adult']],
      ['signalVerbKey'],
    ],
    ['an unknown signalIcon', [['signalIcon', 'anvil']], ['signalIcon']],
    ['a signal cue id in camelCase', [['feedback.signal', 'eyesClosed']], ['feedback.signal']],
  ] as const)('rejects %s', (_name, changes, expected) => {
    expect(mutated(eyes, ...(changes as unknown as [string, unknown][]))).toEqual(expected);
  });

  it('accepts a minDelayMs equal to maxDelayMs (a fixed wait)', () => {
    expect(mutated(eyes, ['minDelayMs', 4000], ['maxDelayMs', 4000])).toEqual([]);
  });

  it('knows the eyes icon', () => {
    expect(mutated(eyes, ['icon', 'eyes'], ['signalIcon', 'eyelids'])).toEqual([]);
  });
});

describe('the wait keys on a response that is not a wait (story 4.6)', () => {
  it.each([
    ['minDelayMs', 2000],
    ['maxDelayMs', 6000],
    ['signalVerbKey', 'verb.go'],
    ['signalIcon', 'eyelids'],
    ['feedback.signal', 'bedtime_eyes_closed'],
  ] as const)('refuses %s on a parry', (path, value) => {
    expect(mutated(outlet, [path, value])).toEqual([path]);
  });

  it('refuses the wait keys on a firm threat too', () => {
    expect(
      mutated(outlet, ['response', 'firm'], ['holdUntilMs', 1500], ['minDelayMs', 2000]),
    ).toEqual(['minDelayMs']);
  });

  it('refuses a wait with a holdUntilMs (it is a Firmness key)', () => {
    expect(mutated(eyes, ['holdUntilMs', 1500])).toEqual(['holdUntilMs']);
  });

  it('refuses a null verbKey on a wait (only a dodge has a default verb)', () => {
    expect(mutated(eyes, ['verbKey', null])).toEqual(['verbKey']);
  });
});
