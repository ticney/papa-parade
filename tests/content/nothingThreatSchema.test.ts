import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { ThreatDefSchema } from '@content/schemas/threat';
import { describe, expect, it } from 'vitest';

// The `nothing` response in the threat schema (story 4.9): `nothingMs` is required on a `nothing` def
// and refused elsewhere, and every key that shapes another response's window or signal is refused on
// it. Read from the frozen fixture, never from the live file: Geo retunes that one freely.
const fixture = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../support/${file}`, import.meta.url), 'utf8'));
const sigh = fixture('testFalseAlarm.threat.json');
const realWake = fixture('testRealWake.threat.json');

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

describe('the false alarm, a nothing on the baby (story 4.9)', () => {
  it('parses, and is a nothing on the baby with the sigh glyph', () => {
    const parsed = parse(sigh);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ response: 'nothing', target: 'baby', icon: 'sigh' });
  });

  it.each([
    ['a missing nothingMs', [['nothingMs', undefined]], ['nothingMs']],
    ['a nothingMs of 0', [['nothingMs', 0]], ['nothingMs']],
    ['a fractional nothingMs', [['nothingMs', 1500.5]], ['nothingMs']],
    ['a windowMs', [['windowMs', 300]], ['windowMs']],
    ['a signalVerbKey', [['signalVerbKey', 'verb.go']], ['signalVerbKey']],
    ['a signalIcon', [['signalIcon', 'eyes']], ['signalIcon']],
    ['a feedback.signal', [['feedback.signal', 'some_signal']], ['feedback.signal']],
    ['a minDelayMs', [['minDelayMs', 1000]], ['minDelayMs']],
    ['a maxDelayMs', [['maxDelayMs', 2000]], ['maxDelayMs']],
    ['a holdUntilMs', [['holdUntilMs', 1500]], ['holdUntilMs']],
    ['a release', [['release', { pressWithinMs: 100 }]], ['release']],
    [
      'a feint',
      [['feint', { minDelayMs: 1, maxDelayMs: 2, minGapMs: 1, icon: 'peek' }]],
      ['feint'],
    ],
  ] as const)('rejects %s on a nothing', (_name, changes, expected) => {
    const paths = mutated(sigh, ...(changes as unknown as [string, unknown][]));
    for (const path of expected) expect(paths).toContain(path);
  });

  it('refuses a hiddenZone target on its own path, even when the variant is complete', () => {
    expect(
      mutated(
        sigh,
        ['target', 'hiddenZone'],
        ['findMaxMs', 5000],
        ['surpriseGags', ['tissues_everywhere']],
        ['gag', undefined],
      ),
    ).toEqual(['target']);
  });

  it("refuses a verbKey of null: the default verb is the dodge response's", () => {
    expect(mutated(sigh, ['verbKey', null])).toEqual(['verbKey']);
  });
});

describe('nothingMs on a response that is not a nothing (story 4.9)', () => {
  it('refuses it on a parry', () => {
    expect(mutated(realWake, ['nothingMs', 2000])).toEqual(['nothingMs']);
  });

  it('accepts a baby target for a parry too (the real wake)', () => {
    expect(parse(realWake)).toMatchObject({ ok: true });
  });
});

describe('the baby target (story 4.9)', () => {
  it('is accepted by an anchored def and refused by an unknown target', () => {
    expect(mutated(sigh, ['target', 'baby'])).toEqual([]);
    expect(mutated(sigh, ['target', 'crib'])).not.toEqual([]);
  });

  it('accepts the sigh glyph and refuses an unknown one', () => {
    expect(mutated(sigh, ['icon', 'sigh'])).toEqual([]);
    expect(mutated(sigh, ['icon', 'yawn'])).toEqual(['icon']);
  });

  it('is judged as a blue circle like the other responses', () => {
    expect(mutated(sigh, ['iconShape', 'triangle'], ['color', 'dodge'])).toEqual(['iconShape']);
  });
});
